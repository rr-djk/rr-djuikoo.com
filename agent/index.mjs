// Infra-only plumbing: streams NDJSON back to the browser.
// No GET / CHAT_HTML here - site is served from S3/CloudFront.

import { answerWith } from "./agent.mjs";

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      },
    });

    const send = (obj) => responseStream.write(`${JSON.stringify(obj)}\n`);

    try {
      const body = JSON.parse(event.body ?? "{}");
      const message = body.message ?? "Hello!";
      const sessionId = body.sessionId ?? "no-session";

      for await (const chunk of answerWith(message, sessionId)) {
        send(chunk);
      }
      send({ type: "done" });
    } catch (err) {
      send({ type: "error", text: `${err.name}: ${err.message}` });
    }

    responseStream.end();
  }
);
