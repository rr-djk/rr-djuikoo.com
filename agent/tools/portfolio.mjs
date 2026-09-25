// Read-only views over content.json. The content is loaded once per invocation
// by the caller, so every callback here is synchronous over plain data.

import { z } from "zod";

/**
 * Resolves a project by exact name first, then by partial name, ignoring case.
 * Shared by get_project_details and ask_code_explorer so one name never resolves
 * to two different projects depending on which tool the model reached for.
 */
export function findProject(projects, name) {
  const q = name.toLowerCase();
  const exactMatch = projects.find((p) => p.name.toLowerCase() === q);
  return exactMatch ?? projects.find((p) => p.name.toLowerCase().includes(q));
}

export function unknownProject(projects, name) {
  return `No project found matching '${name}'. Available: ${projects.map((p) => p.name).join(", ")}.`;
}

// The optional filter three tools share: everything without a query, else the
// items where one of the texts contains it, ignoring case.
function filtered(items, query, textsOf, label) {
  if (!query) return JSON.stringify(items);
  const q = query.toLowerCase();
  const matches = items.filter((item) => textsOf(item).some((text) => text.toLowerCase().includes(q)));
  if (matches.length === 0) return `No ${label} found matching '${query}'.`;
  return JSON.stringify(matches);
}

export const PORTFOLIO_TOOLS = {
  get_profile: ({ content }) => ({
    description: "Get the portfolio owner's identity (name, title, short bio) and the long-form about text.",
    inputSchema: z.object({}),
    callback: async () => JSON.stringify({ identity: content.identity, about: content.about }),
  }),

  list_projects: ({ content }) => ({
    description: "List portfolio projects, optionally filtered by name or tech. Returns matching projects as JSON.",
    inputSchema: z.object({
      query: z.string().optional().describe("Filter by name or tech, e.g. 'terraform' or 'aws'"),
    }),
    callback: async ({ query }) => filtered(content.projects, query, (p) => [p.name, ...p.tech], "projects"),
  }),

  get_project_details: ({ content }) => ({
    description: "Get details for a single portfolio project by name.",
    inputSchema: z.object({
      project_name: z.string().describe("Exact or partial project name, e.g. 'rr-djuikoo.com'"),
    }),
    callback: async ({ project_name }) => {
      const match = findProject(content.projects, project_name);
      return match ? JSON.stringify(match) : unknownProject(content.projects, project_name);
    },
  }),

  get_education: ({ content }) => ({
    description: "Get education history for the portfolio owner.",
    inputSchema: z.object({}),
    callback: async () => JSON.stringify(content.education),
  }),

  get_experience: ({ content }) => ({
    description: "Get work experience entries, optionally filtered by company.",
    inputSchema: z.object({
      company: z.string().optional().describe("Filter by company name"),
    }),
    callback: async ({ company }) => filtered(content.experience, company, (e) => [e.org], "experience"),
  }),

  get_certifications: ({ content }) => ({
    description: "Get certifications, optionally filtered by name.",
    inputSchema: z.object({
      name: z.string().optional().describe("Filter by certification name"),
    }),
    callback: async ({ name }) => filtered(content.certifications, name, (c) => [c.name], "certifications"),
  }),

  get_contact: ({ content }) => ({
    description: "Get contact information (email, LinkedIn, GitHub) for the portfolio owner.",
    inputSchema: z.object({}),
    callback: async () => JSON.stringify(content.contact),
  }),
};
