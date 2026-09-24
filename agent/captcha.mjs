// Cloudflare Turnstile verification, gating the first request of a session.
//
// Failure here means Cloudflare's siteverify endpoint could not be reached or
// answered with an unexpected shape - an outage, not a rejection. The request
// is let through rather than walling off every visitor over an infra hiccup.

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 10_000;

// Must match the widget's data-action in src/index.template.html: a token
// solved for a different surface would otherwise verify here too.
const EXPECTED_ACTION = "chat_first_message";
const ALLOWED_HOSTNAMES = new Set(["rr-djuikoo.com"]);

let cachedSecret;

/**
 * Fetches and caches the Turnstile secret key from AWS SSM.
 * @returns {Promise<string>} The decrypted secret key.
 */
async function getSecret() {
  if (cachedSecret) return cachedSecret;
  const res = await ssm.send(
    new GetParameterCommand({ Name: process.env.TURNSTILE_SECRET_PARAM, WithDecryption: true })
  );
  cachedSecret = res.Parameter.Value;
  return cachedSecret;
}

/**
 * Resolves the secret key, using test overrides if provided or falling back to SSM.
 * @param {string} [overridesSecret] - Optional secret override for testing.
 * @returns {Promise<string>} The resolved secret key.
 */
async function fetchSecret(overridesSecret) {
  return overridesSecret ?? (await getSecret());
}

/**
 * Calls Cloudflare's siteverify API with the given token and IP.
 * @param {string} secret - The Turnstile secret key.
 * @param {string} token - The client response token.
 * @param {string} remoteIp - The visitor's IP address.
 * @returns {Promise<object>} The JSON response payload.
 */
async function callSiteverifyApi(secret, token, remoteIp) {
  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

/**
 * Validates the siteverify payload against expected success status, action,
 * and hostname.
 * @param {object} data - The siteverify JSON payload.
 * @returns {boolean} True if valid.
 */
function validateTurnstileResponse(data) {
  if (!data?.success) {
    console.error("turnstile verification rejected", data?.["error-codes"]);
    return false;
  }
  if (data.action !== EXPECTED_ACTION || !ALLOWED_HOSTNAMES.has(data.hostname)) {
    console.error(`turnstile mismatch: action=${data.action} hostname=${data.hostname}`);
    return false;
  }
  return true;
}

/**
 * Verifies a Turnstile token, failing open if network or SSM issues occur.
 * @param {string} token - The cf-turnstile-response token from the client.
 * @param {string} remoteIp - The visitor's IP address.
 * @param {{secret?: string}} [overrides] - Test-only overrides.
 * @returns {Promise<boolean>} Whether the request may proceed.
 */
export async function isCaptchaVerified(token, remoteIp, overrides = {}) {
  try {
    const secret = await fetchSecret(overrides.secret);
    const data = await callSiteverifyApi(secret, token, remoteIp);
    return validateTurnstileResponse(data);
  } catch (err) {
    console.error("turnstile verification failed, failing open:", err.message || err);
    return true; // fail-open
  }
}
