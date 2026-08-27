// ==========================================================
// Année dynamique dans le footer
// ==========================================================
document.getElementById('year').textContent = new Date().getFullYear();

// ==========================================================
// CHAT — squelette prêt à brancher sur la Lambda / Bedrock
//
// TODO(dev): remplacer AGENT_ENDPOINT par l'URL de ta Lambda
// Function URL une fois déployée (ex: via Terraform, output
// `lambda_function_url`).
// ==========================================================
const AGENT_ENDPOINT = ''; // TODO(dev): 'https://xxxxxxxx.lambda-url.us-east-1.on.aws/'

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatBody = document.getElementById('chat-body');
const emptyState = document.querySelector('.chat-empty-state');

function appendMessage(role, text) {
  // Retire l'état vide dès le premier message
  if (emptyState) emptyState.remove();

  const el = document.createElement('div');
  el.className = `chat-message ${role}`;
  el.textContent = text;
  chatBody.appendChild(el);
  chatBody.scrollTop = chatBody.scrollHeight;
  return el;
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;

  appendMessage('user', message);
  chatInput.value = '';

  // TODO(dev): tant que AGENT_ENDPOINT n'est pas configuré,
  // on affiche un message de statut plutôt que d'appeler une URL vide.
  if (!AGENT_ENDPOINT) {
    appendMessage('agent', "[Namespace] L'agent n'est pas encore connecté — branche AGENT_ENDPOINT dans js/main.js.");
    return;
  }

  const agentMessageEl = appendMessage('agent', '');

  try {
    // TODO(dev): adapter le payload au format attendu par ta Lambda
    const response = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    // TODO(dev): si la Lambda Function URL est en mode
    // RESPONSE_STREAM, lire response.body via un ReadableStream
    // ici pour afficher le texte au fur et à mesure plutôt
    // qu'en un seul bloc.
    const data = await response.json();
    agentMessageEl.textContent = data.reply ?? '[Namespace] Réponse vide de l\'agent.';
  } catch (err) {
    agentMessageEl.textContent = "[Namespace] Erreur lors de l'appel à l'agent.";
    console.error(err);
  }
});
