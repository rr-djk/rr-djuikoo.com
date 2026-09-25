// The code explorer's three tools over one extracted repository.
//
// The root travels in the invocation context rather than a global or an
// environment variable, which would break as soon as two invocations share a
// container.

import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { z } from "zod";

// Three budgets, one shared allowance. Bytes read is the one that bites: a 30 KB
// file is roughly 8,000 tokens, and the context replays them on every later turn.
// Calls bound the round trips, the deadline is the last resort.
const MAX_TOOL_CALLS = 12;
const MAX_READ_BYTES = 120 * 1024;
const EXPLORATION_MS = 45_000;

// Sliced by characters, not bytes: cutting mid-codepoint would corrupt the
// text. The budget below still counts real bytes, so the allowance stays exact
// even though the cut is approximate.
const FILE_TRUNCATE_CHARS = 30 * 1024;
const MAX_SEARCH_MATCHES = 40;
const MAX_PATTERN_LENGTH = 200;

const BUDGET_SPENT =
  "Exploration budget spent. Answer now with what you have already seen, and say plainly " +
  "which parts of the repository you did not get to look at.";

/**
 * One exploration's allowance, shared by the three tools of that exploration.
 * @returns {{calls: number, bytes: number, until: number, exhausted: () => boolean}}
 */
export function createBudget() {
  return {
    calls: 0,
    bytes: 0,
    until: Date.now() + EXPLORATION_MS,
    exhausted() {
      return this.calls >= MAX_TOOL_CALLS || this.bytes >= MAX_READ_BYTES || Date.now() > this.until;
    },
  };
}

// Second barrier behind tar's own: tar guards what gets written during
// extraction, this guards what gets read afterwards. The path comes from the
// model, which is ultimately steered by a visitor's question.
function inside(root, path) {
  const target = resolve(root, path ?? ".");
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export const REPOSITORY_TOOLS = {
  list_files: ({ root, budget }) => ({
    description: "List the files and directories at a path inside the repository. Use '.' for the root.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory path relative to the repository root"),
    }),
    callback: async ({ path }) => {
      if (budget.exhausted()) return BUDGET_SPENT;
      budget.calls += 1;

      const target = inside(root, path);
      if (!target) return `Path '${path}' is outside the repository.`;

      let entries;
      try {
        entries = await readdir(target, { withFileTypes: true });
      } catch {
        return `No directory at '${path ?? "."}'.`;
      }

      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => (e.isDirectory() ? `  ${e.name}/` : `  ${e.name}`));

      return lines.length ? `${path ?? "."}:\n${lines.join("\n")}` : `'${path ?? "."}' is empty.`;
    },
  }),

  read_file: ({ root, budget }) => ({
    description: "Read a source file from the repository. Large files come back truncated.",
    inputSchema: z.object({
      path: z.string().describe("File path relative to the repository root"),
    }),
    callback: async ({ path }) => {
      if (budget.exhausted()) return BUDGET_SPENT;
      budget.calls += 1;

      const target = inside(root, path);
      if (!target) return `Path '${path}' is outside the repository.`;

      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) return `No file at '${path}'.`;

      const text = await readFile(target, "utf8").catch(() => null);
      if (text === null) return `'${path}' could not be read as text.`;

      const kept = text.slice(0, FILE_TRUNCATE_CHARS);
      budget.bytes += Buffer.byteLength(kept);

      return kept.length < text.length
        ? `${kept}\n\n... [truncated, '${path}' is larger than 30 KB]`
        : kept;
    },
  }),

  search_code: ({ root, budget }) => ({
    description:
      "Search the repository for plain text, ignoring case, and return the matching lines with their file and line number. " +
      "Separate alternatives with '|' to match any of them. No regular expression syntax: '.', '*' or '\\s' are searched literally. " +
      "Use this before read_file to find where something lives.",
    inputSchema: z.object({
      pattern: z.string().describe("Plain text, or alternatives separated by '|', e.g. 'jwt|token'"),
    }),
    callback: async ({ pattern }) => {
      if (budget.exhausted()) return BUDGET_SPENT;
      budget.calls += 1;

      if (pattern.length > MAX_PATTERN_LENGTH) return "That search pattern is too long.";

      // Literal matching, never a RegExp built from the model's pattern. A
      // backtracking pattern such as (a+)+$ blocks inside a single test() call,
      // where no deadline check can run, and would hold the Lambda to its timeout.
      const terms = pattern
        .split("|")
        .map((term) => term.toLowerCase())
        .filter(Boolean);
      if (!terms.length) return "That search pattern is empty.";

      const matches = [];
      for await (const file of walk(root)) {
        // Checked per file rather than once up front: a search over a large tree
        // is the one call that can outlive the deadline on its own.
        if (Date.now() > budget.until) break;

        const text = await readFile(file, "utf8").catch(() => null);
        if (text === null) continue;

        const name = relative(root, file);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          // Also checked per line: a single file can be long enough to matter.
          if (Date.now() > budget.until) break;

          const line = lines[i].toLowerCase();
          if (!terms.some((term) => line.includes(term))) continue;
          matches.push(`${name}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (matches.length >= MAX_SEARCH_MATCHES) break;
        }
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }

      if (!matches.length) return `No match for '${pattern}'.`;

      const capped = matches.length >= MAX_SEARCH_MATCHES ? "\n\n... [more matches not shown]" : "";
      return `${matches.join("\n")}${capped}`;
    },
  }),
};
