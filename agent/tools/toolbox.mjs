// Every tool an agent can call, and which agent may call which.
//
// An agent never builds its tools: it asks for its own set, bound to the data
// of the current invocation (content, session, extracted repository). The grants
// below are the whole permission table, so what each agent can reach is read in
// one place.

import { tool } from "@strands-agents/sdk";

import { PORTFOLIO_TOOLS } from "./portfolio.mjs";
import { DELEGATION_TOOLS } from "./ask_code_explorer.mjs";
import { REPOSITORY_TOOLS } from "./repository.mjs";

class Toolbox {
  #specs = new Map();
  #grants = new Map();

  /**
   * @param {Record<string, (context: object) => object>} specs - Tool name to a
   *   function returning {description, inputSchema, callback} for one invocation.
   */
  register(specs) {
    for (const [name, spec] of Object.entries(specs)) {
      if (this.#specs.has(name)) throw new Error(`tool '${name}' is registered twice`);
      this.#specs.set(name, spec);
    }
    return this;
  }

  // Checked here rather than at invocation: a typo in a grant fails the cold
  // start, not the first visitor who happens to need that tool.
  grant(agentName, names) {
    for (const name of names) {
      if (!this.#specs.has(name)) throw new Error(`tool '${name}' granted to '${agentName}' is not registered`);
    }
    this.#grants.set(agentName, names);
    return this;
  }

  /**
   * The tools an agent is allowed, bound to the current invocation.
   * @param {string} agentName - Same name as the agent's MODELS entry.
   * @param {object} context - Whatever the granted tools read.
   * @returns {object[]} Strands tools.
   * @throws {Error} For an agent with no grant, so a typo cannot silently mean "no tools".
   */
  forAgent(agentName, context) {
    const names = this.#grants.get(agentName);
    if (!names) throw new Error(`no tools granted to agent '${agentName}'`);
    return names.map((name) => tool({ name, ...this.#specs.get(name)(context) }));
  }
}

export const toolbox = new Toolbox()
  .register(PORTFOLIO_TOOLS)
  .register(DELEGATION_TOOLS)
  .register(REPOSITORY_TOOLS)
  // context: { content, sessionId, exploreRepo }
  .grant("orchestrator", [
    "get_profile",
    "list_projects",
    "get_project_details",
    "get_education",
    "get_experience",
    "get_certifications",
    "get_contact",
    "ask_code_explorer",
  ])
  // context: { root, budget }
  .grant("code_explorer", ["list_files", "search_code", "read_file"])
  // Judges each message on its own, with no tool to call.
  .grant("gatekeeper", []);
