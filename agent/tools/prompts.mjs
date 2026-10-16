// Every instruction the tools hand the model: descriptions, parameter
// descriptions, and the replies that tell it what to do next. Replies that only
// report a state ("No file at 'x'") stay with the code that produces them.
//
// Keyed by tool name, as in the grants of toolbox.mjs. A misspelt key yields
// undefined, which Strands accepts silently as an empty description.

export const TOOL_PROMPTS = {
  get_profile: {
    description: "Get the portfolio owner's identity (name, title, short bio) and the long-form about text.",
  },
  list_projects: {
    description: "List portfolio projects, optionally filtered by name or tech. Returns matching projects as JSON.",
    params: { query: "Filter by name or tech, e.g. 'terraform' or 'aws'" },
  },
  get_project_details: {
    description: "Get details for a single portfolio project by name.",
    params: { project_name: "Exact or partial project name, e.g. 'rr-djuikoo.com'" },
  },
  get_education: {
    description: "Get education history for the portfolio owner.",
  },
  get_experience: {
    description: "Get work experience entries, optionally filtered by company.",
    params: { company: "Filter by company name" },
  },
  get_certifications: {
    description: "Get certifications, optionally filtered by name.",
    params: { name: "Filter by certification name" },
  },
  get_contact: {
    description: "Get contact information (email, LinkedIn, GitHub) for the portfolio owner.",
  },

  ask_code_explorer: {
    description:
      "Ask a sub-agent to read a project's public source code and report what it does. " +
      "Use it only for a technical question the project entry cannot answer - which files exist, " +
      "how a feature is implemented, what a module does. It reads code, it cannot say why a choice was made.",
    params: {
      project_name: "Exact or partial project name, e.g. 'MyAm'",
      // The explorer answers in the language it is asked in, whatever its own
      // prompt says, so the language has to be set here.
      question:
        "The technical question to answer from the code, written in English even when the visitor writes in another language",
    },
  },

  list_files: {
    description: "List the files and directories at a path inside the repository. Use '.' for the root.",
    params: { path: "Directory path relative to the repository root" },
  },
  read_file: {
    description: "Read a source file from the repository. Large files come back truncated.",
    params: { path: "File path relative to the repository root" },
  },
  search_code: {
    description:
      "Search the repository for plain text, ignoring case, and return the matching lines with their file and line number. " +
      "Separate alternatives with '|' to match any of them. No regular expression syntax: '.', '*' or '\\s' are searched literally. " +
      "Use this before read_file to find where something lives.",
    params: { pattern: "Plain text, or alternatives separated by '|', e.g. 'jwt|token'" },
  },
};

// Returned by any repository tool once the exploration's allowance is spent.
export const BUDGET_SPENT =
  "Exploration budget spent. Answer now with what you have already seen, and say plainly " +
  "which parts of the repository you did not get to look at.";

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
