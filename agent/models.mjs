// The model each agent calls, one entry per agent so each can change on its own.

import { BedrockModel } from "@strands-agents/sdk";

const HAIKU_4_5 = "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// maxTokens is always set: left unset, Bedrock reserves the model maximum
// against the account quota on every call.
export const MODELS = {
  gatekeeper: { modelId: HAIKU_4_5, maxTokens: 100 },
  orchestrator: { modelId: HAIKU_4_5, maxTokens: 1024 },

  // Its report is replayed in the orchestrator's context, so every token is paid
  // twice. Raised from 1024: a report on a broad question ran from 760 to past
  // 1024 tokens across identical runs, and a report cut at the limit throws
  // MaxTokensError, so the orchestrator got no report at all.
  code_explorer: { modelId: HAIKU_4_5, maxTokens: 2048 },
};

/**
 * Builds the Bedrock model configured for one agent.
 * @param {keyof MODELS} agentName - Key of the MODELS entry.
 * @returns {BedrockModel}
 */
export function createModel(agentName) {
  const { modelId, maxTokens } = MODELS[agentName];
  return new BedrockModel({ modelId, maxTokens });
}
