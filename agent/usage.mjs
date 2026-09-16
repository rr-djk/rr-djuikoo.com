// One structured line per model invocation, read back with Logs Insights to
// attribute cost to a conversation. Token counts only: the question and the
// answer are visitor input and stay out of the logs. No dollar amount either -
// prices change, so the multiplication belongs to the query, not to the code.
//
// Shared by every agent on purpose: the dashboard widget in terraform/monitoring.tf
// queries these field names, so the line has to be emitted from a single place or
// a rename in one agent would break the table without any error.

/**
 * Writes the chat.usage line for one agent invocation.
 * @param {object} args
 * @param {string} args.agent - Which agent ran ("gatekeeper", "orchestrator", ...).
 * @param {string} args.sessionId - Conversation the invocation belongs to.
 * @param {string} args.modelId - Model the agent actually called.
 * @param {object} args.result - AgentResult returned by the Strands stream.
 */
export function logUsage({ agent, sessionId, modelId, result }) {
  const invocation = result?.metrics?.latestAgentInvocation;
  if (!invocation) return;

  const usage = invocation.usage;
  console.log(
    JSON.stringify({
      event: "chat.usage",
      agent,
      sessionId,
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      cycles: invocation.cycles.length,
      stopReason: result.stopReason,
    })
  );
}
