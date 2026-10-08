// Sends the agents' traces to Langfuse over OpenTelemetry.
//
// Strands already emits the spans (invocation, model call, tool call, token
// counts); this module only gives them somewhere to go. It is fail-open on
// purpose: if the keys cannot be read or Langfuse is down, the chat answers
// exactly as before and simply goes untraced.

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const ssm = new SSMClient({});

// Without this wait, the end of the response freezes the Lambda before the batch
// leaves and traces vanish. The cap keeps a Langfuse outage from holding the
// response open.
const FLUSH_TIMEOUT_MS = 2_000;

async function readCredentials() {
  const res = await ssm.send(
    new GetParameterCommand({ Name: process.env.LANGFUSE_KEYS_PARAM, WithDecryption: true })
  );
  const { publicKey, secretKey } = JSON.parse(res.Parameter.Value);
  return { publicKey, secretKey };
}

async function createProvider() {
  const { publicKey, secretKey } = await readCredentials();
  const basicAuth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  const exporter = new OTLPTraceExporter({
    url: `${process.env.LANGFUSE_BASE_URL}/api/public/otel/v1/traces`,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      // Langfuse v4 data model: without it new traces are not shown in real time.
      "x-langfuse-ingestion-version": "4",
    },
  });

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": "rr-djuikoo-chat" }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  // register() installs the async context manager that nests the sub-agent's
  // spans under the orchestrator's; Strands then finds this provider through
  // the global OpenTelemetry API.
  provider.register();
  return provider;
}

// One attempt per container: a failure is remembered rather than retried on
// every request, which would put an SSM call in front of each message.
let providerPromise;

/**
 * Starts tracing once per container. Never throws.
 * @returns {Promise<object|null>} The provider, or null when tracing is off.
 */
export function startTelemetry() {
  providerPromise ??= createProvider().catch((err) => {
    console.error("telemetry disabled, traces will not be sent", err);
    return null;
  });
  return providerPromise;
}

/**
 * Sends what is still batched, waiting at most FLUSH_TIMEOUT_MS. Never throws.
 */
export async function flushTelemetry() {
  const provider = await providerPromise;
  if (!provider) return;
  await Promise.race([
    provider.forceFlush().catch((err) => console.error("telemetry flush failed", err)),
    new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS).unref()),
  ]);
}

/**
 * Runs one chat request inside a root span, so the gatekeeper, the orchestrator
 * and the code explorer show up as a single trace instead of three.
 * @param {object} args
 * @param {string} args.sessionId - Conversation, which Langfuse groups traces by.
 * @param {string} args.message - The visitor's message, shown as the trace input.
 * @param {(span: object) => Promise<void>} run - The work to trace.
 */
export function traceChatRequest({ sessionId, message }, run) {
  return trace.getTracer("rr-djuikoo-chat").startActiveSpan(
    "chat.request",
    {
      attributes: {
        "langfuse.session.id": sessionId,
        "langfuse.observation.input": message,
      },
    },
    async (span) => {
      try {
        return await run(span);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}
