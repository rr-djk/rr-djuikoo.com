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

function appendMessage(role, text) {
  if (emptyState) emptyState.remove();

  const el = document.createElement('div');
  el.className = `chat-message ${role}`;
  el.textContent = text;
  chatBody.appendChild(el);
  chatBody.scrollTop = chatBody.scrollHeight;
  return el;
}

// Fills the agent bubble from the Lambda response.
// Today: simple JSON response.
// Later: read NDJSON stream token-by-token.
async function readReply(targetEl, response) {
  const data = await response.json();
    targetEl.textContent = data.reply ?? '[Namespace] Empty agent reply.';
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
