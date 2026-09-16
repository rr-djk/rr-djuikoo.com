// Exercises the code explorer's three tools directly, without any model.
// Strands tools expose invoke(), so each callback is reachable on its own.
//
// Reads the local disk only. No Bedrock, no cost.

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeExplorerTools } from "../agent/code_explorer/code_explorer.mjs";
import { fetchRepo, resolveRepo } from "../agent/code_explorer/repo.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let root;

before(async () => {
  const content = JSON.parse(await readFile(join(ROOT, "site/content.json"), "utf8"));
  const project = content.projects.find((p) => p.name === "rr-djuikoo.com");
  ({ root } = await fetchRepo(resolveRepo(project)));
});

/** Fresh tools over the extracted tree, so each test gets its own budget. */
const tools = () => {
  const made = makeExplorerTools(root);
  return { ...Object.fromEntries(made.tools.map((t) => [t.name, t])), spent: made.spent };
};

describe("fonctionnement nominal", () => {
  it("list_files montre l'arborescence", async () => {
    const listing = await tools().list_files.invoke({ path: "." });
    assert.match(listing, /agent\//);
    assert.match(listing, /terraform\//);
  });

  it("search_code trouve dans le Terraform", async (t) => {
    const found = await tools().search_code.invoke({ pattern: "reserved_concurrent" });
    t.diagnostic(found.split("\n")[0].slice(0, 90));
    assert.match(found, /terraform\//);
  });

  it("read_file lit un fichier réel", async () => {
    const file = await tools().read_file.invoke({ path: "scripts/build-site.mjs" });
    assert.match(file, /escapeHtml/);
  });

  it("read_file le dit quand le fichier n'existe pas", async () => {
    const missing = await tools().read_file.invoke({ path: "agent/nexiste.pas" });
    assert.match(missing, /^No file at/);
  });

  it("search_code le dit quand la regex est invalide", async () => {
    const bad = await tools().search_code.invoke({ pattern: "auth(" });
    assert.match(bad, /not a valid/);
  });

  it("search_code le dit quand rien ne correspond", async () => {
    const nothing = await tools().search_code.invoke({ pattern: "zzzqqqxxx-introuvable" });
    assert.match(nothing, /^No match/);
  });
});

describe("confinement des chemins", () => {
  const escapes = [
    "../../../etc/passwd",
    "../",
    "/etc/passwd",
    "agent/../../../../etc/hosts",
    "./agent/../../..",
  ];

  for (const path of escapes) {
    it(`read_file refuse '${path}'`, async () => {
      const out = await tools().read_file.invoke({ path });
      assert.match(out, /outside the repository|^No file at/);
    });
  }

  it("list_files refuse de remonter", async () => {
    const up = await tools().list_files.invoke({ path: ".." });
    assert.match(up, /outside the repository/);
  });
});

describe("plafond d'appels", () => {
  it("laisse passer 12 appels puis demande de conclure", async () => {
    const { list_files } = tools();
    const results = [];
    for (let i = 0; i < 14; i += 1) results.push(await list_files.invoke({ path: "." }));

    const spent = (r) => r.startsWith("Exploration budget spent");
    assert.ok(results.slice(0, 12).every((r) => !spent(r)), "un des 12 premiers appels a été refusé");
    assert.equal(results.findIndex(spent), 12, "le refus n'est pas tombé au 13e appel");
    assert.match(results[13], /Answer now with what you have already seen/);
  });
});

describe("plafond d'octets et troncature", () => {
  it("tronque un fichier de plus de 30 ko", async (t) => {
    const made = tools();
    const big = await made.read_file.invoke({ path: "agent/package-lock.json" });
    t.diagnostic(`${made.spent().bytes} octets comptés`);

    assert.match(big, /\[truncated,/);
    assert.ok(made.spent().bytes <= 30 * 1024, "une lecture a compté plus de 30 ko");
  });

  it("finit par épuiser le budget d'octets", async (t) => {
    const made = tools();
    // Chaque lecture plafonne à 30 ko : il faut quatre lectures pleines pour
    // franchir les 120 ko. Le même fichier relu compte à chaque fois, ce qui est
    // le comportement voulu, le contexte du modèle grossissant tout autant.
    for (let i = 0; i < 4; i += 1) await made.read_file.invoke({ path: "agent/package-lock.json" });

    const after = made.spent();
    t.diagnostic(`${after.bytes} octets en ${after.calls} appels`);
    assert.equal(after.exhausted, true);
  });
});
