// Brings a portfolio project's public GitHub repository into /tmp so the code
// explorer can read it.
//
// The URL is never taken from the model: it is read from the project entry in
// content.json, which is what makes content.json the allowlist. Without that,
// a visitor's question could steer the Lambda into downloading anything.

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { x as extract } from "tar";

const WORKSPACE = join(tmpdir(), "repos");

// Validates the shape of the URL only - any owner is fine, the portfolio has a
// project under an organisation it does not own. The allowlist is content.json
// itself; this guards against an entry that is not a GitHub repository at all.
const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

// Tried in order. All three repositories sit on main today, so master is purely
// defensive, for a project added later.
const BRANCHES = ["main", "master"];

const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_FILE_BYTES = 512 * 1024;

// Source, configuration and documentation. Everything else is skipped: the
// explorer never reads a binary, and unpacking one only costs time and disk.
// Infrastructure files carry as much weight as application code here: two of the
// three projects are largely Terraform, so .tf and .tfvars belong in this set.
// .env is deliberately absent - only .env.example below is read, so a committed
// secret is never pulled into the explorer's reach even from a public repository.
export const CODE_EXTENSIONS = new Set([
  ".bash", ".c", ".cfg", ".cjs", ".conf", ".cpp", ".cs", ".css", ".dart",
  ".go", ".gradle", ".h", ".hcl", ".hpp", ".html", ".ini", ".java", ".js", ".json",
  ".jsx", ".kt", ".kts", ".md", ".mjs", ".php", ".properties", ".py", ".rb", ".rs",
  ".scala", ".service", ".sh", ".sql", ".swift", ".tf", ".tfvars", ".timer", ".toml",
  ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);

const CODE_FILENAMES = new Set([
  ".dockerignore", ".editorconfig", ".env.example", ".gitignore", ".npmrc",
  "dockerfile", "gemfile", "makefile", "procfile", "rakefile",
]);

/**
 * A failure the visitor can be told about, carrying a message safe to hand to
 * the model. Anything else escaping this module is a bug, not a known case.
 */
export class RepoError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepoError";
  }
}

/**
 * Reads the GitHub repository out of a project entry from content.json.
 * @param {object} project - A single entry of content.projects.
 * @returns {{owner: string, repo: string, url: string}}
 * @throws {RepoError} When the project carries no usable GitHub link.
 */
export function resolveRepo(project) {
  for (const link of project.links ?? []) {
    const match = REPO_URL.exec(link.href ?? "");
    if (match) return { owner: match[1], repo: match[2], url: link.href };
  }
  throw new RepoError(`The project '${project.name}' has no public repository to read.`);
}

function isCode(entryPath) {
  // tar applies `strip` after the filter, so the path still carries GitHub's
  // "<repo>-<ref>/" prefix here. Only the trailing name is looked at, so that
  // does not matter - but it would for any rule based on the leading segments.
  const name = entryPath.slice(entryPath.lastIndexOf("/") + 1).toLowerCase();
  if (CODE_FILENAMES.has(name)) return true;

  const dot = name.lastIndexOf(".");
  return dot > 0 && CODE_EXTENSIONS.has(name.slice(dot));
}

async function download(owner, repo) {
  let lastStatus;

  for (const branch of BRANCHES) {
    const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.tar.gz`;

    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      // Covers the abort as well as a refused or dropped connection.
      console.error(`repo download failed for ${owner}/${repo}@${branch}`, err);
      throw new RepoError("The repository could not be downloaded right now.");
    }

    // No size check on the archive: GitHub builds it on the fly and sends no
    // content-length, so a cap on the declared size never fired.
    if (response.ok) return response;

    response.body?.cancel();
    lastStatus = response.status;
    if (response.status === 404) continue;

    console.error(`repo download refused for ${owner}/${repo}@${branch}: HTTP ${response.status}`);
    if (response.status === 403 || response.status === 429) {
      throw new RepoError("The source is momentarily unavailable, it can be tried again shortly.");
    }
    throw new RepoError(`The repository could not be downloaded (HTTP ${response.status}).`);
  }

  // Every branch answered 404: the repository is private, renamed or gone. The
  // URL stays out of the message, the model has no use for it.
  console.error(`repo not reachable for ${owner}/${repo}, last status ${lastStatus}`);
  throw new RepoError("That repository is not reachable.");
}

/**
 * Downloads and extracts a repository under /tmp, or reuses the copy left by an
 * earlier invocation of the same execution environment.
 * @param {{owner: string, repo: string}} target - As returned by resolveRepo.
 * @returns {Promise<{root: string, cached: boolean}>} Directory holding the source.
 * @throws {RepoError} On any known failure, with a message meant for the model.
 */
export async function fetchRepo({ owner, repo }) {
  const root = join(WORKSPACE, `${owner}__${repo}`);

  // /tmp survives between warm invocations, so the second question about a
  // project skips the download entirely.
  if (await stat(root).catch(() => null)) return { root, cached: true };

  const response = await download(owner, repo);

  // Extracted aside then moved into place: an interrupted run must not leave a
  // half-unpacked tree behind that the check above would take for a valid cache.
  //
  // The staging name is unique per call rather than fixed. In Lambda a fixed one
  // would already be safe, since an execution environment serves one invocation
  // at a time and each has its own /tmp. The unique name means the module does
  // not lean on that guarantee, and it matters outside Lambda - nothing
  // serialises two local runs of this code against the same directory.
  const staging = `${root}.partial-${randomUUID()}`;
  await mkdir(staging, { recursive: true });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      extract({
        cwd: staging,
        // GitHub wraps everything in "<repo>-<ref>/".
        strip: 1,
        // Regular files only. A symlink that survived extraction would be
        // followed by read_file and jump outside the repository: the path
        // barrier in code_explorer.mjs resolves names lexically and cannot see
        // where a link points. Directories need no entry, they are recreated by
        // the paths of the files inside them.
        filter: (entryPath, entry) =>
          entry.type === "File" && isCode(entryPath) && entry.size <= MAX_FILE_BYTES,
      })
    );
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    console.error(`repo extraction failed for ${owner}/${repo}`, err);
    throw new RepoError("The repository archive could not be read.");
  }

  await rename(staging, root);
  return { root, cached: false };
}
