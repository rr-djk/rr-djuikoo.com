// ==========================================================
// Dynamic year in footer
// ==========================================================
document.getElementById('year').textContent = new Date().getFullYear();

// ==========================================================
// CHAT — calls /api/chat via CloudFront
// ==========================================================

// A random ID for this conversation, sent with every message. The browser
// holds only this ticket — where the conversation lives is up to your agent.
const sessionId = crypto.randomUUID();

const AGENT_ENDPOINT = '/api/chat';

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatBody = document.getElementById('chat-body');
const chatSubmitBtn = chatForm.querySelector('button[type="submit"]');
const emptyState = document.querySelector('.chat-empty-state');

// One request in flight at a time: the form stays locked until the reply stream
// ends with `done`, with `error`, or with a failed fetch.
let isBusy = false;

/**
 * Locks or unlocks the chat form while a reply is streaming.
 * @param {boolean} busy - Whether a request is in flight.
 */
function setBusy(busy) {
  isBusy = busy;
  chatInput.disabled = busy;
  chatSubmitBtn.disabled = busy;
  chatInput.setAttribute('aria-busy', String(busy));
  if (!busy) chatInput.focus();
}

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

/**
 * Reads the NDJSON reply stream and updates the target element.
 * @param {HTMLElement} targetEl - Element to update with streamed tokens.
 * @param {Response} response - Fetch response to consume.
 * @returns {Promise<void>}
 */
async function readReply(targetEl, response) {
  for await (const message of parseNDJSONStream(response)) {
    if (message.type === "token") {
      targetEl.textContent += message.text;
      chatBody.scrollTop = chatBody.scrollHeight;
    } else if (message.type === "error") {
      // Rate limiting comes back as a 200 with this code, not as an HTTP error.
      targetEl.textContent =
        message.code === "RATE_LIMITED"
          ? "[Namespace] Trop de questions d'affilée. Réessaie dans quelques minutes."
          : message.text;
    } else if (message.type === "done") {
      break;
    }
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
    // The body is built once and reused verbatim: the hash must cover the exact
    // bytes that are sent, or CloudFront's signature will not match.
    const body = JSON.stringify({ message, sessionId });
    const response = await fetch(AGENT_ENDPOINT, {
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

    await readReply(agentMessageEl, response);
  } catch (err) {
    agentMessageEl.textContent = "[Namespace] Error calling the agent.";
    console.error(err);
  } finally {
    setBusy(false);
  }
});
