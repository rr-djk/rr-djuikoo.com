// Loads the portfolio content that scripts/build-site.mjs publishes
//
// The content travels through the site pipeline rather than the Lambda package,
// so editing src/profile.mjs and pushing to main updates both the page and the
// agent - no terraform apply needed.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const TTL_MS = 5 * 60 * 1000;
const DEFAULT_KEY = "content.json";

const s3 = new S3Client({});

let cached = null;
let inFlight = null;

async function fetchContent() {
  const bucket = process.env.CONTENT_BUCKET;

  // Local development: with no bucket configured, read the build output from
  // disk. In Lambda the variable is always set, so this path is never taken.
  if (!bucket) {
    const path = fileURLToPath(new URL("../site/content.json", import.meta.url));
    return JSON.parse(await readFile(path, "utf8"));
  }

  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: process.env.CONTENT_KEY ?? DEFAULT_KEY })
  );

  return JSON.parse(await response.Body.transformToString());
}

export async function loadContent() {
  if (cached && cached.expiresAt > Date.now()) return cached.content;

  // A rejected promise must never stay cached, or the container would replay
  // the same failure until it is recycled.
  const pending = (inFlight ??= fetchContent()
    .then((content) => {
      cached = { content, expiresAt: Date.now() + TTL_MS };
      return content;
    })
    .finally(() => {
      inFlight = null;
    }));

  try {
    return await pending;
  } catch (err) {
    // Serving a slightly stale copy beats failing the conversation.
    if (cached) {
      console.warn("content refresh failed, serving the cached copy", err);
      return cached.content;
    }
    throw err;
  }
}
