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
const emptyState = document.querySelector('.chat-empty-state');

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
      targetEl.textContent = message.text;
    }
  }
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage('user', message);
  chatInput.value = '';

  const agentMessageEl = appendMessage('agent', '');

  try {
    const response = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await readReply(agentMessageEl, response);
  } catch (err) {
    agentMessageEl.textContent = "[Namespace] Error calling the agent.";
    console.error(err);
  }
});
