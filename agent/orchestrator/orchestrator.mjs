import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { loadContent } from "./content.mjs";
import { ORCHESTRATOR_PROMPT } from "./prompts.mjs";
import { logUsage } from "../usage.mjs";
import { refusalFor } from "../gatekeeper/gatekeeper.mjs";
import { exploreRepo } from "../code_explorer/code_explorer.mjs";
import { fetchRepo, RepoError, resolveRepo } from "../code_explorer/repo.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const AGENT_NAME = "orchestrator";
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "global.anthropic.claude-haiku-4-5-20251001-v1:0";

// maxTokens is set on purpose: left unset, Bedrock reserves the model maximum
// against the account quota on every call, which throttles even light traffic.
// It also caps the cost of a single answer, and the prompt asks for brief ones.
const model = new BedrockModel({
    modelId: MODEL_ID,
    maxTokens: 1024,
});

async function loadHistory(sessionId) {
    const resp = await ddb.send(
        new GetCommand({
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId },
        })
    );
    return resp.Item ? JSON.parse(resp.Item.messages) : [];
}

async function saveHistory(sessionId, messages) {
    // A merge, not a replace: index.mjs may have set captchaVerified on this
    // same item before the orchestrator ever ran, and a PutCommand here would
    // wipe it on every turn.
    await ddb.send(
        new UpdateCommand({
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: "SET messages = :messages, expiresAt = :expiresAt",
            ExpressionAttributeValues: {
                ":messages": JSON.stringify(messages),
                ":expiresAt": Math.floor(Date.now() / 1000) + 24 * 60 * 60,
            },
        })
    );
}

// Shared by get_project_details and ask_code_explorer so one name never resolves
// to two different projects depending on which tool the model reached for.
function findProject(projects, name) {
    const q = name.toLowerCase();
    const exactMatch = projects.find((p) => p.name.toLowerCase() === q);
    return exactMatch ?? projects.find((p) => p.name.toLowerCase().includes(q));
}

// The owner's GitHub account, read from the contact block rather than hardcoded:
// it is what tells a repository he owns from one a team owns, and it follows
// src/profile.mjs if the account ever changes.
function ownerHandle(contact) {
    const entry = (contact?.items ?? []).find((item) => item.prefix === "GitHub");
    const match = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/?$/.exec(entry?.href ?? "");

    return match?.[1] ?? null;
}

/**
 * Wraps the explorer's report for the orchestrator and puts the attribution last.
 *
 * The report is third-party data: it paraphrases files from a repository anyone
 * with merge rights can write to, including one the owner does not control. A
 * file starting with its own "ATTRIBUTION:" line used to sit next to the real
 * one with nothing telling the model which was true. The marker is neutralised
 * inside the report, the report is fenced, and the real line comes after it so
 * it is the last word the model reads.
 *
 * @param {object} args
 * @param {string} args.attribution - The ATTRIBUTION line computed from content.json.
 * @param {string} args.owner - GitHub account of the repository.
 * @param {string} args.repo - Repository name.
 * @param {string} args.report - The explorer's report, untrusted.
 * @returns {string} Text returned to the orchestrator as the tool result.
 */
export function formatExplorerReport({ attribution, owner, repo, report }) {
    const fenced = report
        .replace(/ATTRIBUTION\s*:/gi, "[attribution claim removed]")
        // A closing tag in the report would end the fence early and let the rest
        // read as if it came from outside it.
        .replace(/<\s*\/?\s*explorer_report\s*>/gi, "[tag removed]");

    return `Repository: ${owner}/${repo}\n\n<explorer_report>\n${fenced}\n</explorer_report>\n\n${attribution}`;
}

// Tools are built per invocation from the content loaded for that invocation,
// which keeps the callbacks synchronous over plain data and confines the
// asynchronous load to a single place. sessionId rides along so the sub-agent's
// token counts land on the right conversation.
export function makeTools(content, sessionId) {
    const { projects, education, experience, certifications, identity, about, contact } = content;

    const getProfile = tool({
        name: "get_profile",
        description:
        "Get the portfolio owner's identity (name, title, short bio) and the long-form about text.",
        inputSchema: z.object({}),
        callback: async () => JSON.stringify({ identity, about }),
    });

    const listProjects = tool({
        name: "list_projects",
        description: "List portfolio projects, optionally filtered by name or tech. Returns matching projects as JSON.",
        inputSchema: z.object({
            query: z.string().optional().describe("Filter by name or tech, e.g. 'terraform' or 'aws'"),
        }),
        callback: async ({ query }) => {
            if (!query) return JSON.stringify(projects);
            const q = query.toLowerCase();
            const matches = projects.filter(
                (p) => p.name.toLowerCase().includes(q) || p.tech.some((t) => t.toLowerCase().includes(q))
            );
            if (matches.length === 0) return `No projects found matching '${query}'.`;
            return JSON.stringify(matches);
        },
    });

    const getProjectDetails = tool({
        name: "get_project_details",
        description: "Get details for a single portfolio project by name.",
        inputSchema: z.object({
            project_name: z.string().describe("Exact or partial project name, e.g. 'rr-djuikoo.com'"),
        }),
        callback: async ({ project_name }) => {
            const match = findProject(projects, project_name);
            if (!match) return `No project found matching '${project_name}'. Available: ${projects.map((p) => p.name).join(", ")}.`;
            return JSON.stringify(match);
        },
    });

    const getEducation = tool({
        name: "get_education",
        description: "Get education history for the portfolio owner.",
        inputSchema: z.object({}),
        callback: async () => JSON.stringify(education),
    });

    const getExperience = tool({
        name: "get_experience",
        description: "Get work experience entries, optionally filtered by company.",
        inputSchema: z.object({
            company: z.string().optional().describe("Filter by company name"),
        }),
        callback: async ({ company }) => {
            if (!company) return JSON.stringify(experience);
            const q = company.toLowerCase();
            const matches = experience.filter((e) => e.org.toLowerCase().includes(q));
            if (matches.length === 0) return `No experience found matching '${company}'.`;
            return JSON.stringify(matches);
        },
    });

    const getCertifications = tool({
        name: "get_certifications",
        description: "Get certifications, optionally filtered by name.",
        inputSchema: z.object({
            name: z.string().optional().describe("Filter by certification name"),
        }),
        callback: async ({ name }) => {
            if (!name) return JSON.stringify(certifications);
            const q = name.toLowerCase();
            const matches = certifications.filter((c) => c.name.toLowerCase().includes(q));
            if (matches.length === 0) return `No certifications found matching '${name}'.`;
            return JSON.stringify(matches);
        },
    });

    const getContact = tool({
        name: "get_contact",
        description: "Get contact information (email, LinkedIn, GitHub) for the portfolio owner.",
        inputSchema: z.object({}),
        callback: async () => JSON.stringify(contact),
    });

    // The door to the code explorer, not a second implementation of exploration:
    // a Strands agent can only act through its tools, so this is how the
    // orchestrator delegates. Everything it does with the files lives in
    // code_explorer.mjs.
    //
    // The repository URL is resolved here, from content.json, and never taken from
    // the model. That resolution is what keeps the Lambda from being steered into
    // downloading anything a visitor names.
    const askCodeExplorer = tool({
        name: "ask_code_explorer",
        description:
        "Ask a sub-agent to read a project's public source code and report what it does. " +
            "Use it only for a technical question the project entry cannot answer - which files exist, " +
            "how a feature is implemented, what a module does. It reads code, it cannot say why a choice was made.",
        inputSchema: z.object({
            project_name: z.string().describe("Exact or partial project name, e.g. 'MyAm'"),
            question: z.string().describe("The technical question to answer from the code"),
        }),
        callback: async ({ project_name, question }) => {
            // Attempt to locate the requested project in the portfolio entries
            const project = findProject(projects, project_name);
            if (!project) {
                return `No project found matching '${project_name}'. Available: ${projects.map((p) => p.name).join(", ")}.`;
            }

            let report;
            let target;
            try {
                // Resolve the repository coordinates and fetch its compressed source archive
                target = resolveRepo(project);
                const { root } = await fetchRepo(target);

                // Delegate the technical inspection to the sub-agent
                report = await exploreRepo(root, question, sessionId);
            } catch (err) {
                // Return expected domain errors directly to the model
                if (err instanceof RepoError) return err.message;

                // Log unexpected system failures and return a friendly fallback message
                console.error(`code explorer failed for '${project.name}'`, err);
                return "The source code could not be read right now.";
            }

            // Safely extract the primary developer's identity and GitHub handle
            const ownerName = identity?.name ?? "the portfolio owner";
            const handle = ownerHandle(contact);

            // Check if the repository is owned by an external organization or collaborator
            const foreign = Boolean(handle && target.owner.toLowerCase() !== handle.toLowerCase());

            // The attribution instruction is attached directly to the tool report rather than
            // the system prompt. This ensures it is in the model's immediate context window
            // when writing the response, avoiding hallucinations in long multi-turn chats.
            const attribution = foreign
                ? `ATTRIBUTION: this repository belongs to '${target.owner}', not to ${ownerName}. ` +
                    `It is a collaborative project. The code described above is the team's work. Present as his only what ` +
                    `the '${project.name}' entry credits to him, and say plainly that the project was built with others.`
                : `ATTRIBUTION: this repository belongs to ${ownerName}'s own account.`;

            return formatExplorerReport({ attribution, owner: target.owner, repo: target.repo, report });
        },
    });

    return [
        getProfile,
        listProjects,
        getProjectDetails,
        getEducation,
        getExperience,
        getCertifications,
        getContact,
        askCodeExplorer,
    ];
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

    const history = await loadHistory(sessionId);
    const agent = new Agent({
        model,
        systemPrompt: ORCHESTRATOR_PROMPT,
        messages: history,
        tools: makeTools(content, sessionId),
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

        if (
            value.type === "modelStreamUpdateEvent" &&
                value.event.type === "modelContentBlockDeltaEvent" &&
                value.event.delta?.type === "textDelta"
        ) {
            yield { type: "token", text: value.event.delta.text };
        }
    }

    await saveHistory(sessionId, agent.messages);
    logUsage({ agent: AGENT_NAME, sessionId, modelId: MODEL_ID, result });
}
