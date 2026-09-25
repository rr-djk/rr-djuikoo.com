// Infra-only plumbing: streams NDJSON back to the browser.
// No GET / CHAT_HTML here - site is served from S3/CloudFront.

import { answerWith } from "./orchestrator/orchestrator.mjs";
import { isCaptchaVerified } from "./captcha.mjs";
import { sessions, rateLimit } from "./dynamo.mjs";
import { ChatError, getClientIp, isWellFormedCaptchaToken, parseRequestBody } from "./request.mjs";

const HEARTBEAT_MS = 10_000;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

function createNdjsonStream(rawStream) {
  const stream = awslambda.HttpResponseStream.from(rawStream, {
    statusCode: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
  const send = (obj) => stream.write(`${JSON.stringify(obj)}\n`);
  return { stream, send };
}

// Only the first message of a session carries a token: once verified, the
// session skips Turnstile for the rest of its life.
async function ensureCaptchaVerified(sessionId, captchaToken, clientIp) {
  if (await sessions.hasCaptchaVerified(sessionId)) return;
  if (!captchaToken) {
    throw new ChatError("Please solve the captcha challenge first.", "CAPTCHA_REQUIRED");
  }
  if (!isWellFormedCaptchaToken(captchaToken)) {
    throw new ChatError("Invalid captcha token.", "CAPTCHA_INVALID");
  }
  if (!(await isCaptchaVerified(captchaToken, clientIp))) {
    throw new ChatError("Captcha verification failed.", "CAPTCHA_INVALID");
  }
  await sessions.markCaptchaVerified(sessionId);
}

// CloudFront's origin response timeout measures the silence between two packets,
// not the total duration. A long tool call - the code explorer reading a whole
// repository - would otherwise look like a dead origin and get cut. The browser
// ignores this event type: readReply only handles token, error and done.
async function streamReply(message, sessionId, send) {
  const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);
  try {
    for await (const chunk of answerWith(message, sessionId)) {
      send(chunk);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

// The single place an error becomes something the browser sees.
function errorEventFor(err) {
  if (err instanceof ChatError) return { type: "error", text: err.text, code: err.code };

  // AWS SDK errors carry role ARNs, the account id and table names. The detail
  // goes to CloudWatch only; the visitor gets nothing an attacker could map.
  console.error("chat request failed", err);
  return { type: "error", text: "An internal error occurred.", code: "INTERNAL_ERROR" };
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const { stream, send } = createNdjsonStream(responseStream);

    try {
      const clientIp = getClientIp(event);
      const rateLimitResult = await rateLimit.check(clientIp, {
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        max: RATE_LIMIT_MAX,
      });
      if (!rateLimitResult.allowed) {
        throw new ChatError("Rate limit exceeded. Try again later.", "RATE_LIMITED");
      }

      const { message, sessionId, captchaToken } = parseRequestBody(event);
      await ensureCaptchaVerified(sessionId, captchaToken, clientIp);
      await streamReply(message, sessionId, send);
    } catch (err) {
      send(errorEventFor(err));
    } finally {
      send({ type: "done" });
      stream.end();
    }
  }
);
