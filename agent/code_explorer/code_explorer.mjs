// Reads an extracted repository and reports what the code does.
//
// Runs with no history and no DynamoDB: one question, one extracted tree, one
// report. It is reached only through the orchestrator's ask_code_explorer tool,
// which resolves the project and hands over the directory repo.mjs filled.

import { Agent } from "@strands-agents/sdk";

import { CODE_EXPLORER_PROMPT } from "./prompts.mjs";
import { logUsage } from "../usage.mjs";
import { createModel, MODELS } from "../models.mjs";
import { toolbox } from "../tools/toolbox.mjs";
import { createBudget } from "../tools/repository.mjs";

const AGENT_NAME = "code_explorer";
const model = createModel(AGENT_NAME);

/**
 * Reads the repository and answers one question about it.
 * @param {string} root - Absolute path of the extracted repository.
 * @param {string} question - What the orchestrator wants to know.
 * @param {string} sessionId - Conversation the call belongs to, for the usage log.
 * @returns {Promise<string>} The explorer's report, in its own words.
 */
export async function exploreRepo(root, question, sessionId) {
  const budget = createBudget();

  const agent = new Agent({
    model,
    systemPrompt: CODE_EXPLORER_PROMPT,
    tools: toolbox.forAgent(AGENT_NAME, { root, budget }),
    printer: false,
  });

  const result = await agent.invoke(question);

  logUsage({ agent: AGENT_NAME, sessionId, modelId: MODELS[AGENT_NAME].modelId, result });

  console.log(
    JSON.stringify({
      event: "explore.budget",
      sessionId,
      toolCalls: budget.calls,
      bytesRead: budget.bytes,
      exhausted: budget.exhausted(),
    })
  );

  return result.toString().trim();
}
