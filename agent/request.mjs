// What a /api/chat request is allowed to look like, checked before any AWS or
// Bedrock call. No I/O here: everything is decided from the Lambda event alone.

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

/**
 * A refusal the visitor may see as is: text and code reach the browser verbatim.
 * Any other error is internal and never shown.
 */
export class ChatError extends Error {
  constructor(text, code) {
    super(text);
    this.text = text;
    this.code = code;
  }
}

// The first X-Forwarded-For entry is whatever the client wrote: CloudFront keeps
// it and appends the real address at the end. Reading it let one caller dodge the
// rate limit with a fresh fake IP per request, or exhaust someone else's quota.
export function getClientIp(event) {
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

/**
 * @param {object} event - The Lambda function URL event.
 * @returns {{message: string, sessionId: string, captchaToken: unknown}}
 * @throws {ChatError} INVALID_MESSAGE, MESSAGE_TOO_LONG or INVALID_SESSION.
 */
export function parseRequestBody(event) {
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

// Checked only when the session still needs the captcha, not in
// parseRequestBody: a verified session never has its token looked at.
export function isWellFormedCaptchaToken(token) {
  return typeof token === "string" && token.length <= MAX_CAPTCHA_TOKEN_CHARS;
}
