// Screens a visitor message before the orchestrator.
// Deliberately stateless: Every message is judged on its own.

import { Agent, BedrockModel } from "@strands-agents/sdk";
import { gatekeeperPrompt } from "./prompts.mjs";
import { logUsage } from "../usage.mjs";

const AGENT_NAME = "gatekeeper";
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// Enough for the marker plus one sentence in any language. Beyond the output
// tokens it saves, Bedrock reserves maxTokens against the account quota on every
// call, so keeping it tight also stops this extra call from eating into the
// headroom the orchestrator needs.
const MAX_TOKENS = 100;

const model = new BedrockModel({
  modelId: MODEL_ID,
  maxTokens: MAX_TOKENS,
});

// The refusal sentence is written by the model so it lands in the visitor's own
// language, the way the orchestrator answers everything else. The marker stays in
// front of it: a reply that does not carry one is let through rather than shown,
// so a garbled answer never reaches the visitor as if it were a refusal. Only the
// spellings the model drifts to are tolerated - OFF TOPIC, off-topic, no colon.
const REFUSAL_MARKER = /^off[\s_-]*topic\s*[:.-]?\s*/i;

// Used only when the model emits the marker and nothing after it. Leaving the
// bubble empty would read as a broken site rather than as a refusal.
const FALLBACK_REPLY =
  "I only answer questions about the background, projects and skills presented on this site.";

/**
 * Screens a visitor message before it reaches the orchestrator.
 * @param {string} message - The visitor's message, verbatim.
 * @param {string} sessionId - Conversation the message belongs to, for the usage log.
 * @param {object} content - The portfolio content, so the screener knows what the site is about.
 * @returns {Promise<string|null>} The refusal to show, or null to let the message through.
 */
export async function refusalFor(message, sessionId, content) {
  const agent = new Agent({
    model,
    systemPrompt: gatekeeperPrompt(content),
    printer: false,
  });

  let result;
  try {
    result = await agent.invoke(message);
  } catch (err) {
    // A Bedrock hiccup must not turn the site into a wall for a legitimate
    // visitor. The orchestrator's own prompt and the per-IP rate limit still
    // stand while this one is down.
    console.error("gatekeeper unavailable, letting the message through", err);
    return null;
  }

  logUsage({ agent: AGENT_NAME, sessionId, modelId: MODEL_ID, result });

  // Anything that is not a clear refusal is a pass, unreadable output included:
  // same reasoning as the catch above.
  const verdict = result.toString().trim();
  if (!REFUSAL_MARKER.test(verdict)) return null;

  return verdict.replace(REFUSAL_MARKER, "").trim() || FALLBACK_REPLY;
}
