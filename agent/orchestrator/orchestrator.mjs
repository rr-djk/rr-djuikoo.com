import { Agent } from "@strands-agents/sdk";
import { loadContent } from "./content.mjs";
import { ORCHESTRATOR_PROMPT } from "./prompts.mjs";
import { logUsage } from "../usage.mjs";
import { refusalFor } from "../gatekeeper/gatekeeper.mjs";
import { exploreRepo } from "../code_explorer/code_explorer.mjs";
import { sessions } from "../dynamo.mjs";
import { createModel, MODELS } from "../models.mjs";
import { toolbox } from "../tools/toolbox.mjs";

const AGENT_NAME = "orchestrator";
const model = createModel(AGENT_NAME);

// The text a streaming event carries, or null for every other kind of event.
function textDeltaOf(event) {
    if (event.type !== "modelStreamUpdateEvent") return null;
    const inner = event.event;
    if (inner.type !== "modelContentBlockDeltaEvent" || inner.delta?.type !== "textDelta") return null;
    return inner.delta.text;
}

export async function* answerWith(message, sessionId) {
    // The content is loaded first because the screener needs it: without the
    // project names it cannot tell a question about MyAm from one about anything
    // else it has never heard of, and refuses both. It is cached for five minutes
    // and falls back to a local copy, so the refusal path stays cheap.
    let content;
    try {
        content = await loadContent();
    } catch (err) {
        console.error("unable to load portfolio content", err);
        yield { type: "error", text: "[Namespace] Portfolio content is unavailable right now." };
        return;
    }

    // Screened before the history read. A refused message is never written to the
    // session either: keeping the attempt would leave it in the context of every
    // later turn, which is exactly how the orchestrator was talked out of its
    // instructions.
    const refusal = await refusalFor(message, sessionId, content);
    if (refusal) {
        yield { type: "token", text: refusal };
        return;
    }

    const history = await sessions.loadHistory(sessionId);
    const agent = new Agent({
        model,
        systemPrompt: ORCHESTRATOR_PROMPT,
        messages: history,
        // sessionId rides along so the sub-agent's token counts land on the
        // right conversation.
        tools: toolbox.forAgent(AGENT_NAME, { content, sessionId, exploreRepo }),
        printer: false,
    });

    // stream() returns the AgentResult as the generator's return value, which a
    // `for await` loop discards. Driving the iterator by hand is the only way to
    // reach the token counts it carries without giving up streaming.
    const stream = agent.stream(message);
    let result;

    for (;;) {
        const { value, done } = await stream.next();
        if (done) {
            result = value;
            break;
        }

        const text = textDeltaOf(value);
        if (text !== null) yield { type: "token", text };
    }

    await sessions.saveHistory(sessionId, agent.messages);
    logUsage({ agent: AGENT_NAME, sessionId, modelId: MODELS[AGENT_NAME].modelId, result });
}
