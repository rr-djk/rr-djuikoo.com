// Infra-only plumbing: streams NDJSON back to the browser.
// No GET / CHAT_HTML here - site is served from S3/CloudFront.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { answerWith } from "./agent.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

function getClientIp(event) {
  const forwarded = event.headers?.["x-forwarded-for"] ?? event.headers?.["X-Forwarded-For"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return (
    event.headers?.["cloudfront-viewer-address"]?.split(":")[0] ??
    event.requestContext?.http?.sourceIp ??
    "unknown"
  );
}

async function checkRateLimit(ip) {
  const table = process.env.RATE_LIMIT_TABLE;
  if (!table) return { allowed: true };
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = now + RATE_LIMIT_WINDOW_SECONDS;

  const res = await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { ip },
      UpdateExpression:
        "SET #count = if_not_exists(#count, :zero) + :inc, expiresAt = if_not_exists(expiresAt, :windowEnd)",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":zero": 0, ":inc": 1, ":windowEnd": windowEnd },
      ReturnValues: "ALL_NEW",
    })
  );

  const count = res.Attributes?.count ?? 1;
  return { allowed: count <= RATE_LIMIT_MAX, count };
}

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
      const ip = getClientIp(event);
      const rl = await checkRateLimit(ip);
      if (!rl.allowed) {
        send({ type: "error", text: "Rate limit exceeded. Try again later.", code: "RATE_LIMITED" });
        send({ type: "done" });
        responseStream.end();
        return;
      }

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
