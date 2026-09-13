import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { loadContent } from "./content.mjs";
import { SYSTEM_PROMPT } from "./prompts.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

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
  await ddb.send(
    new PutCommand({
      TableName: process.env.SESSIONS_TABLE,
      Item: {
        sessionId,
        messages: JSON.stringify(messages),
        expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      },
    })
  );
}

// Tools are built per invocation from the content loaded for that invocation,
// which keeps the callbacks synchronous over plain data and confines the
// asynchronous load to a single place.
function makeTools(content) {
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
      const q = project_name.toLowerCase();
      const match = projects.find((p) => p.name.toLowerCase() === q) ?? projects.find((p) => p.name.toLowerCase().includes(q));
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

  return [
    getProfile,
    listProjects,
    getProjectDetails,
    getEducation,
    getExperience,
    getCertifications,
    getContact,
  ];
}

// One structured line per answer, read back with Logs Insights to attribute cost
// to a conversation. Token counts only: the question and the answer are visitor
// input and stay out of the logs. No dollar amount either - prices change, so the
// multiplication belongs to the query, not to the code.
function logUsage(sessionId, result) {
  const invocation = result?.metrics?.latestAgentInvocation;
  if (!invocation) return;

  const usage = invocation.usage;
  console.log(
    JSON.stringify({
      event: "chat.usage",
      sessionId,
      modelId: MODEL_ID,
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

export async function* answerWith(message, sessionId) {
  let content;
  try {
    content = await loadContent();
  } catch (err) {
    console.error("unable to load portfolio content", err);
    yield { type: "error", text: "[Namespace] Portfolio content is unavailable right now." };
    return;
  }

  const history = await loadHistory(sessionId);
  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: makeTools(content),
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
    } else if (value.type === "beforeToolCallEvent") {
      yield { type: "tool", name: value.toolUse?.name ?? "tool" };
    }
  }

  await saveHistory(sessionId, agent.messages);
  logUsage(sessionId, result);
}
