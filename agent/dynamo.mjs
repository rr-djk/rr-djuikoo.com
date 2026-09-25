import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SESSIONS_TABLE = process.env.SESSIONS_TABLE;
const RATE_LIMIT_TABLE = process.env.RATE_LIMIT_TABLE;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export const sessions = {
  // Early check in DynamoDB so a session that already passed the captcha skips
  // it before incurring LLM/Bedrock costs in loadHistory.
  async hasCaptchaVerified(sessionId) {
    if (!SESSIONS_TABLE) return true;
    const res = await ddb.send(
      new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } })
    );
    return res.Item?.captchaVerified === true;
  },

  // Uses UpdateCommand (upsert) so we don't overwrite the whole item:
  // 1. Creates the session item if this is the user's first message.
  // 2. Preserves captchaVerified when saveHistory updates the session later.
  async markCaptchaVerified(sessionId) {
    if (!SESSIONS_TABLE) return;
    await ddb.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression:
          "SET captchaVerified = :true, expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeValues: {
          ":true": true,
          ":ttl": nowSeconds() + 24 * 60 * 60,
        },
      })
    );
  },

  async loadHistory(sessionId) {
    const res = await ddb.send(
      new GetCommand({ TableName: SESSIONS_TABLE, Key: { sessionId } })
    );
    return res.Item?.messages ? JSON.parse(res.Item.messages) : [];
  },

  async saveHistory(sessionId, messages) {
    // A merge, not a replace: index.mjs may have set captchaVerified on this
    // same item before the orchestrator ever ran, and a PutCommand here would
    // wipe it on every turn.
    await ddb.send(
      new UpdateCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId },
        UpdateExpression: "SET messages = :messages, expiresAt = :expiresAt",
        ExpressionAttributeValues: {
          ":messages": JSON.stringify(messages),
          ":expiresAt": nowSeconds() + 24 * 60 * 60,
        },
      })
    );
  },
};

export const rateLimit = {
  async check(clientIp, { windowSeconds, max }) {
    if (!RATE_LIMIT_TABLE) return { allowed: true };

    const now = nowSeconds();
    const windowEnd = now + windowSeconds;

    // The window number is part of the key, so each window starts a fresh
    // counter. Relying on the TTL to reset may not hold: DynamoDB deletes
    // expired items within days, not minutes.
    const windowNumber = Math.floor(now / windowSeconds);

    const res = await ddb.send(
      new UpdateCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: { ip: `${clientIp}#${windowNumber}` },
        UpdateExpression:
          "SET #count = if_not_exists(#count, :zero) + :inc, expiresAt = if_not_exists(expiresAt, :windowEnd)",
        ExpressionAttributeNames: { "#count": "count" },
        ExpressionAttributeValues: {
          ":zero": 0,
          ":inc": 1,
          ":windowEnd": windowEnd,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const count = res.Attributes?.count ?? 1;
    return { allowed: count <= max, count };
  },
};
