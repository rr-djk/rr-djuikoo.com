// ==========================================================
// CHAT — calls /api/chat via CloudFront
// ==========================================================

// Public by design — a Turnstile site key carries no secret.
const TURNSTILE_SITE_KEY = '0x4AAAAAAFBaTLxwAXT6SVZF';

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatBody = document.getElementById('chat-body');
const chatSubmitBtn = chatForm.querySelector('button[type="submit"]');
const emptyState = document.querySelector('.chat-empty-state');

// `breaks: true` makes single newlines render as <br>, matching how the agent
// actually formats its replies.
marked.use({ gfm: true, breaks: true });

// Tags the agent's reply can legitimately use. `img` is deliberately absent:
// the agent has no reason to emit one, and an inline image would blow past
// the 30%-wide chat bubble.
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'hr', 'blockquote',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href'];

// Hosts the site's own content links to (site/content.json). The reply can be
// steered by text the owner does not control - a file in a public repository the
// code explorer read - so a link to anywhere else would reach the visitor as a
// clickable link served from this domain. Update when the profile adds a host.
const ALLOWED_LINK_HOSTS = new Set([
  'github.com', 'www.linkedin.com', 'learn.microsoft.com', 'rr-djuikoo.com',
]);

/**
 * Tells whether a link in the agent's reply may stay clickable.
 * @param {string|null} href - The sanitized href attribute.
 * @returns {boolean} True for mailto: or an allowed host.
 */
function isAllowedLink(href) {
  if (!href) return false;
  if (href.startsWith('mailto:')) return true;
  try {
    return ALLOWED_LINK_HOSTS.has(new URL(href, location.origin).hostname);
  } catch {
    return false;
  }
}

// Links in the agent's reply should not navigate the chat away from the page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    // The text stays, only the link goes: the visitor still reads what the
    // agent wrote, but nothing off the allowlist can be clicked.
    if (!isAllowedLink(node.getAttribute('href'))) node.removeAttribute('href');
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Renders Markdown to sanitized HTML safe for innerHTML.
 * @param {string} text - Raw Markdown text.
 * @returns {string} Sanitized HTML.
 */
function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text), { ALLOWED_TAGS, ALLOWED_ATTR });
}

// One request in flight at a time: the form stays locked until the reply stream
// ends with `done`, with `error`, or with a failed fetch.
let isBusy = false;

// Sole owner of the Turnstile state. Only the first /api/chat call of a session
// needs a token: the backend marks the session verified once it accepts one,
// and the widget is never shown again after that.
const captcha = {
  token: null,
  widgetId: null,
  // Starts locked, since no token exists until the widget resolves.
  awaiting: true,

  render() {
    this.widgetId = window.turnstile.render('#turnstile-widget', {
      sitekey: TURNSTILE_SITE_KEY,
      action: 'chat_first_message',
      size: 'flexible',
      callback: (token) => this.onVerified(token),
      'expired-callback': () => this.onExpired(),
    });
  },

  /**
   * Called by the widget once the visitor solves the challenge.
   * @param {string} token - The cf-turnstile-response value to send with /api/chat.
   */
  onVerified(token) {
    this.token = token;
    this.awaiting = false;
    setBusy(isBusy);
  },

  /** Called by the widget when a solved token times out unused. */
  onExpired() {
    this.token = null;
    this.awaiting = true;
    setBusy(isBusy);
  },

  /** Asks for a new challenge after the backend refused the token. */
  reset() {
    this.token = null;
    this.awaiting = true;
    if (this.widgetId !== null) window.turnstile.reset(this.widgetId);
  },

  /**
   * Removes the widget once it is no longer needed. Only called after a backend
   * response actually accepted the session - not right when the widget itself
   * reports solved, since a server-side rejection still needs reset().
   */
  hide() {
    if (this.widgetId === null) return;
    window.turnstile.remove(this.widgetId);
    this.widgetId = null;
    document.getElementById('turnstile-widget')?.remove();
  },
};

/**
 * Locks or unlocks the chat form while a reply is streaming, or while no
 * captcha token is available yet.
 * @param {boolean} busy - Whether a request is in flight.
 */
function setBusy(busy) {
  isBusy = busy;
  const locked = busy || captcha.awaiting;
  chatInput.disabled = locked;
  chatSubmitBtn.disabled = locked;
  chatInput.setAttribute('aria-busy', String(busy));
  if (!locked) chatInput.focus();
}
setBusy(false);

// Named via the api.js `?onload=` query param, so Turnstile calls it itself
// once its script has loaded - no polling for window.turnstile needed.
window.onTurnstileLoad = () => captcha.render();

/**
 * Hashes a request body for CloudFront's SigV4 signature.
 * Lambda function URLs reject unsigned payloads, so a POST through the CDN must
 * carry the body hash in x-amz-content-sha256.
 * @param {string} text - Exact body string that will be sent.
 * @returns {Promise<string>} Lowercase hex SHA-256 digest.
 */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Appends a chat message to the chat body.
 * @param {string} role - Message role ("user" or "agent").
 * @param {string} text - Message text.
 * @returns {HTMLDivElement} The created message element.
 */
function appendMessage(role, text) {
  if (emptyState) emptyState.remove();

  const el = document.createElement('div');
  el.className = `chat-message ${role}`;
  el.textContent = text;
  chatBody.appendChild(el);
  chatBody.scrollTop = chatBody.scrollHeight;
  return el;
}

/**
 * Parses an NDJSON response stream.
 * @param {Response} response - Fetch response with a readable stream.
 * @yields {object} Parsed JSON object per line.
 */
async function* parseNDJSONStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();

    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
}

// The only code that knows how /api/chat is reached: the rest of the page sees
// a stream of {type, ...} events.
const chatApi = {
  endpoint: '/api/chat',

  // A random ID for this conversation, sent with every message. The browser
  // holds only this ticket — where the conversation lives is up to your agent.
  sessionId: crypto.randomUUID(),

  /**
   * Sends one message and returns the reply events.
   * @param {string} message - The visitor's message.
   * @param {string|null} captchaToken - Needed only until the session is verified.
   * @returns {Promise<AsyncGenerator<object>>} Parsed NDJSON events.
   * @throws {Error} On a failed fetch or a non-2xx response.
   */
  async send(message, captchaToken) {
    // The body is built once and reused verbatim: the hash must cover the exact
    // bytes that are sent, or CloudFront's signature will not match.
    const body = JSON.stringify({ message, sessionId: this.sessionId, captchaToken });
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Amz-Content-Sha256': await sha256Hex(body),
      },
      body,
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`chat HTTP ${response.status}`, detail);
      throw new Error(`HTTP ${response.status}`);
    }
    return parseNDJSONStream(response);
  },
};

// Error codes the backend sends as a 200 with a code, not as an HTTP error.
// Any code missing here shows the backend's own text.
const ERROR_MESSAGES = {
  RATE_LIMITED: "[Namespace] Trop de questions d'affilée. Réessaie dans quelques minutes.",
  CAPTCHA_REQUIRED: "[Namespace] Merci de résoudre le défi de sécurité avant d'envoyer un message.",
  CAPTCHA_INVALID: "[Namespace] Merci de résoudre le défi de sécurité avant d'envoyer un message.",
};
const CAPTCHA_ERROR_CODES = new Set(['CAPTCHA_REQUIRED', 'CAPTCHA_INVALID']);

/**
 * Reads the reply events and updates the target element.
 * @param {HTMLElement} targetEl - Element to update with streamed tokens.
 * @param {AsyncIterable<object>} events - As returned by chatApi.send.
 * @returns {Promise<void>}
 */
async function readReply(targetEl, events) {
  // Accumulates raw Markdown, never HTML: marked is stateless between calls,
  // so re-parsing the whole string on each frame safely closes any `**` (or
  // other syntax) left open by a token cut mid-stream.
  let markdown = '';
  let frame = 0;

  const flush = () => {
    frame = 0;
    targetEl.innerHTML = renderMarkdown(markdown);
    chatBody.scrollTop = chatBody.scrollHeight;
  };
  // Groups multiple incoming tokens to parse and update the DOM once per frame
  // instead of on every token.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(flush);
  };

  // `is-waiting` shows three dots until the first token lands. A tool call on the
  // agent's side can keep the bubble silent for several seconds, and a bare
  // blinking caret reads as a frozen page rather than as work in progress.
  targetEl.classList.add('is-streaming', 'is-waiting');
  try {
    for await (const message of events) {
      if (message.type === "token") {
        targetEl.classList.remove('is-waiting');
        markdown += message.text;
        schedule();
      } else if (message.type === "error") {
        markdown = ERROR_MESSAGES[message.code] ?? message.text;
        if (CAPTCHA_ERROR_CODES.has(message.code)) captcha.reset();
        schedule();
      } else if (message.type === "done") {
        break;
      }
    }
  } finally {
    // Cancel any pending frame before the final flush: otherwise a stray rAF
    // could later overwrite the error message the `submit` handler's catch
    // writes into this same element.
    if (frame) cancelAnimationFrame(frame);
    flush();
    targetEl.classList.remove('is-streaming', 'is-waiting');
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isBusy) return;

  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage('user', message);
  chatInput.value = '';

  const agentMessageEl = appendMessage('agent', '');
  setBusy(true);

  try {
    const events = await chatApi.send(message, captcha.token);
    await readReply(agentMessageEl, events);
    if (!captcha.awaiting) captcha.hide();
  } catch (err) {
    agentMessageEl.textContent = "[Namespace] Error calling the agent.";
    console.error(err);
  } finally {
    setBusy(false);
  }
});
