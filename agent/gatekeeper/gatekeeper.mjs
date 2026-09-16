// Screens a visitor message before the orchestrator.
// Deliberately stateless: Every message is judged on its own.

import { Agent, BedrockModel } from "@strands-agents/sdk";
import { GATEKEEPER_PROMPT } from "./prompts.mjs";
import { logUsage } from "../usage.mjs";

const AGENT_NAME = "gatekeeper";
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// The verdict is a single word, so the ceiling can sit just above it. Beyond the
// output tokens it saves, Bedrock reserves maxTokens against the account quota on
// every call, so a low value also keeps this extra call from eating into the
// headroom the orchestrator needs.
const MAX_TOKENS = 100;

const model = new BedrockModel({
  modelId: MODEL_ID,
  maxTokens: MAX_TOKENS,
});

// Matched on a prefix rather than the whole word, so leading punctuation or a
// stray token does not turn a refusal into a pass. "RELEVANT" never starts with
// these letters, so the shortcut cannot misread the other verdict.
const REFUSAL_PREFIX = "OFF";

// Sent verbatim when a message is refused, so a refusal costs nothing beyond the
// verdict itself.
export const OFF_TOPIC_REPLY =
  "I only answer questions about the background, projects and skills presented on this site.";

/**
 * Decides whether a visitor message is worth sending to the orchestrator.
 * @param {string} message - The visitor's message, verbatim.
 * @param {string} sessionId - Conversation the message belongs to, for the usage log.
 * @returns {Promise<boolean>} true when the message should be answered.
 */
export async function isRelevant(message, sessionId) {
  const agent = new Agent({
    model,
    systemPrompt: GATEKEEPER_PROMPT,
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
    return true;
  }

  logUsage({ agent: AGENT_NAME, sessionId, modelId: MODEL_ID, result });

  // Anything that is not a clear refusal is a pass, unreadable output included:
  // same reasoning as the catch above.
  const verdict = result.toString().trim().toUpperCase();
  return !verdict.startsWith(REFUSAL_PREFIX);
}
