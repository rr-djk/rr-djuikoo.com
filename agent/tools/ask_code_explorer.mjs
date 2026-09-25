// The orchestrator's door to the code explorer, not a second implementation of
// exploration: a Strands agent can only act through its tools, so this is how it
// delegates. Everything done with the files lives in code_explorer.mjs.
//
// The repository URL is resolved from content.json and never taken from the
// model. That resolution is what keeps the Lambda from being steered into
// downloading anything a visitor names.

import { z } from "zod";

import { fetchRepo, RepoError, resolveRepo } from "../code_explorer/repo.mjs";
import { findProject, unknownProject } from "./portfolio.mjs";

// The owner's GitHub account, read from the contact block rather than hardcoded:
// it is what tells a repository he owns from one a team owns, and it follows
// src/profile.mjs if the account ever changes.
function ownerHandle(contact) {
  const entry = (contact?.items ?? []).find((item) => item.prefix === "GitHub");
  const match = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/?$/.exec(entry?.href ?? "");
  return match?.[1] ?? null;
}

export function isForeignRepo(handle, owner) {
  return Boolean(handle && owner.toLowerCase() !== handle.toLowerCase());
}

/**
 * The ATTRIBUTION line handed back with the report. It rides on the tool result
 * rather than the system prompt so it sits in the model's immediate context when
 * it writes the answer, even deep into a long conversation.
 */
export function buildAttribution({ ownerName, projectName, owner, foreign }) {
  if (!foreign) return `ATTRIBUTION: this repository belongs to ${ownerName}'s own account.`;
  return (
    `ATTRIBUTION: this repository belongs to '${owner}', not to ${ownerName}. ` +
    `It is a collaborative project. The code described above is the team's work. Present as his only what ` +
    `the '${projectName}' entry credits to him, and say plainly that the project was built with others.`
  );
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

// Errors are left to the caller: RepoError carries a message safe for the
// model, anything else is a bug.
async function readProjectCode(project, question, sessionId, exploreRepo) {
  const target = resolveRepo(project);
  const { root } = await fetchRepo(target);
  const report = await exploreRepo(root, question, sessionId);
  return { report, target };
}

// exploreRepo comes in through the context rather than an import: the code
// explorer takes its own tools from the toolbox, so importing it here would
// close an import cycle.
export const DELEGATION_TOOLS = {
  ask_code_explorer: ({ content, sessionId, exploreRepo }) => ({
    description:
      "Ask a sub-agent to read a project's public source code and report what it does. " +
      "Use it only for a technical question the project entry cannot answer - which files exist, " +
      "how a feature is implemented, what a module does. It reads code, it cannot say why a choice was made.",
    inputSchema: z.object({
      project_name: z.string().describe("Exact or partial project name, e.g. 'MyAm'"),
      question: z.string().describe("The technical question to answer from the code"),
    }),
    callback: async ({ project_name, question }) => {
      const project = findProject(content.projects, project_name);
      if (!project) return unknownProject(content.projects, project_name);

      let report, target;
      try {
        ({ report, target } = await readProjectCode(project, question, sessionId, exploreRepo));
      } catch (err) {
        if (err instanceof RepoError) return err.message;
        console.error(`code explorer failed for '${project.name}'`, err);
        return "The source code could not be read right now.";
      }

      const attribution = buildAttribution({
        ownerName: content.identity?.name ?? "the portfolio owner",
        projectName: project.name,
        owner: target.owner,
        foreign: isForeignRepo(ownerHandle(content.contact), target.owner),
      });
      return formatExplorerReport({ attribution, owner: target.owner, repo: target.repo, report });
    },
  }),
};
