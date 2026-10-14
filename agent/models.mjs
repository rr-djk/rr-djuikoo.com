// The model each agent calls, one entry per agent so each can change on its own.

import { BedrockModel } from "@strands-agents/sdk";

const HAIKU_5_5 = "global.anthropic.claude-haiku-5-5";

// Adaptive thinking is on by default on Haiku 5.5 and billed as output tokens,
// which would break the maxTokens budget control below. Omitting the field
// selects adaptive thinking, so it must be disabled explicitly on every call.
const NO_THINKING = { thinking: { type: "disabled" } };

// maxTokens is always set: left unset, Bedrock reserves the model maximum
// against the account quota on every call.
export const MODELS = {
  gatekeeper: { modelId: HAIKU_5_5, maxTokens: 100, additionalRequestFields: NO_THINKING },
  orchestrator: { modelId: HAIKU_5_5, maxTokens: 1024, additionalRequestFields: NO_THINKING },

  // Its report is replayed in the orchestrator's context, so every token is paid
  // twice. Raised from 1024: a report on a broad question ran from 760 to past
  // 1024 tokens across identical runs, and a report cut at the limit throws
  // MaxTokensError, so the orchestrator got no report at all.
  code_explorer: { modelId: HAIKU_5_5, maxTokens: 2048, additionalRequestFields: NO_THINKING },
};

/**
 * Builds the Bedrock model configured for one agent.
 * @param {keyof MODELS} agentName - Key of the MODELS entry.
 * @returns {BedrockModel}
 */
export function createModel(agentName) {
  const { modelId, maxTokens, additionalRequestFields } = MODELS[agentName];
  return new BedrockModel({ modelId, maxTokens, additionalRequestFields });
}
