// Infra-only plumbing: streams NDJSON back to the browser.
// No GET / CHAT_HTML here - site is served from S3/CloudFront.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { answerWith } from "./orchestrator/orchestrator.mjs";
import { isCaptchaVerified } from "./captcha.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const HEARTBEAT_MS = 10_000;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

// Must stay equal to the chat input's maxlength in src/index.template.html. That
// attribute only binds the page: a request sent straight to /api/chat skips it,
// and the gatekeeper and the orchestrator would each bill the message as input.
const MAX_MESSAGE_CHARS = 2000;

// Cloudflare never issues a longer Turnstile token; anything past this is a
// hand-built request, not a real widget response.
const MAX_CAPTCHA_TOKEN_CHARS = 2048;

// A UUID v4, the shape crypto.randomUUID() gives the browser. Anything else is a
// hand-built request: a guessable id would let one caller replay another's history.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ChatError extends Error {
  constructor(text, code) {
    super(text);
    this.text = text;
    this.code = code;
  }
}

// The first X-Forwarded-For entry is whatever the client wrote: CloudFront keeps
// it and appends the real address at the end. Reading it let one caller dodge the
// rate limit with a fresh fake IP per request, or exhaust someone else's quota.
function getClientIp(event) {
  const headers = event.headers ?? {};

  // Written by CloudFront itself, as "ip:port". Cut at the last colon: an IPv6
  // address holds several, and cutting at the first would merge every IPv6
  // visitor of a prefix into a single counter.
  const viewerAddress = headers["cloudfront-viewer-address"];
  if (viewerAddress) {
    const lastColon = viewerAddress.lastIndexOf(":");
    return lastColon === -1 ? viewerAddress : viewerAddress.substring(0, lastColon);
  }

  const forwarded = headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",").pop().trim();

  // Behind CloudFront this is the edge server's address, not the visitor's: a
  // shared counter, stricter rather than bypassable.
  return event.requestContext?.http?.sourceIp ?? "127.0.0.1";
}

async function checkRateLimit(ip) {
  const table = process.env.RATE_LIMIT_TABLE;
  if (!table) return { allowed: true };
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = now + RATE_LIMIT_WINDOW_SECONDS;

  // The window number is part of the key, so each 10-minute slice starts a fresh
  // counter. Relying on the TTL to reset may not hold: DynamoDB deletes expired
  // items within days, not minutes.
  const windowNumber = Math.floor(now / RATE_LIMIT_WINDOW_SECONDS);

  const res = await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { ip: `${ip}#${windowNumber}` },
      UpdateExpression:
        "SET #count = if_not_exists(#count, :zero) + :inc, expiresAt = if_not_exists(expiresAt, :windowEnd)",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":zero": 0, ":inc": 1, ":windowEnd": windowEnd },
      ReturnValues: "ALL_NEW",
    })
  );

  const count = res.Attributes?.count ?? 1;
  return { allowed: count <= RATE_LIMIT_MAX, count };
}

// Performs an early check in DynamoDB to verify the CAPTCHA status
// before incurring LLM/Bedrock costs in loadHistory.
async function hasVerifiedCaptcha(sessionId) {
  const table = process.env.SESSIONS_TABLE;
  if (!table) return true;
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { sessionId } }));
  return res.Item?.captchaVerified === true;
}

// Uses UpdateCommand (upsert) so we don't overwrite the whole item:
// 1. Creates the session item if this is the user's first message.
// 2. Preserves captchaVerified when saveHistory updates the session later.
async function markCaptchaVerified(sessionId) {
  const table = process.env.SESSIONS_TABLE;
  if (!table) return;
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { sessionId },
      UpdateExpression: "SET captchaVerified = :true, expiresAt = if_not_exists(expiresAt, :ttl)",
      ExpressionAttributeValues: { ":true": true, ":ttl": Math.floor(Date.now() / 1000) + 24 * 60 * 60 },
    })
  );
}

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

function parseRequestBody(event) {
  const body = JSON.parse(event.body ?? "{}");
  const message = body.message ?? "Hello!";
  const sessionId = body.sessionId;
  const captchaToken = body.captchaToken;

  // The type check is what makes the length check hold: an object has no
  // length and an array's is its item count, so either would slip through.
  // No trim, so the count matches what maxlength lets the browser send.
  if (typeof message !== "string") {
    throw new ChatError("Message must be a string.", "INVALID_MESSAGE");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new ChatError(
      `Message too long: ${MAX_MESSAGE_CHARS} characters maximum.`,
      "MESSAGE_TOO_LONG"
    );
  }
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    throw new ChatError("Invalid session.", "INVALID_SESSION");
  }
  return { message, sessionId, captchaToken };
}

async function ensureCaptchaVerified(sessionId, captchaToken, ip) {
  if (await hasVerifiedCaptcha(sessionId)) return;
  if (!captchaToken) {
    throw new ChatError("Please solve the captcha challenge first.", "CAPTCHA_REQUIRED");
  }
  if (typeof captchaToken !== "string" || captchaToken.length > MAX_CAPTCHA_TOKEN_CHARS) {
    throw new ChatError("Invalid captcha token.", "CAPTCHA_INVALID");
  }
  if (!(await isCaptchaVerified(captchaToken, ip))) {
    throw new ChatError("Captcha verification failed.", "CAPTCHA_INVALID");
  }
  await markCaptchaVerified(sessionId);
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

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const { stream, send } = createNdjsonStream(responseStream);

    try {
      const ip = getClientIp(event);
      const rl = await checkRateLimit(ip);
      if (!rl.allowed) {
        throw new ChatError("Rate limit exceeded. Try again later.", "RATE_LIMITED");
      }

      const { message, sessionId, captchaToken } = parseRequestBody(event);
      await ensureCaptchaVerified(sessionId, captchaToken, ip);
      await streamReply(message, sessionId, send);
    } catch (err) {
      if (err instanceof ChatError) {
        send({ type: "error", text: err.text, code: err.code });
      } else {
        // AWS SDK errors carry role ARNs, the account id and table names. The detail
        // goes to CloudWatch only; the visitor gets nothing an attacker could map.
        console.error("chat request failed", err);
        send({ type: "error", text: "An internal error occurred.", code: "INTERNAL_ERROR" });
      }
    } finally {
      send({ type: "done" });
      stream.end();
    }
  }
);
