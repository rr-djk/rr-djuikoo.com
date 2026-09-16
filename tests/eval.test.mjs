// Covers what agent-eval.mjs can be covered on for free.
//
// The runner never executes agent-eval.mjs itself - it is not named *.test.mjs -
// so nothing else looks at it, and the only way to find it broken used to be
// running `make eval`, which costs money. Two things are checked here:
//
//   - that the module loads at all. Deleting a helper it imported once broke it
//     silently; `node --check` had passed, because it parses syntax without
//     resolving imports.
//   - that its file-citation extraction works. That is the only check in the
//     eval which proves anything, and it shipped with a blind spot: bare
//     filenames like `acm.tf` were ignored, so an answer could cite twelve files,
//     have nine of them unverified, and still be reported ok.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { citedFiles, indexRepo } from "./agent-eval.mjs";
import { fetchRepo, resolveRepo } from "../agent/code_explorer/repo.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

let index;

before(async () => {
  const content = JSON.parse(await readFile(join(ROOT, "site/content.json"), "utf8"));
  const project = content.projects.find((p) => p.name === "rr-djuikoo.com");
  index = indexRepo((await fetchRepo(resolveRepo(project))).root);
});

describe("le banc d'évaluation", () => {
  it("se charge sans rien exécuter", async () => {
    const module = await import("./agent-eval.mjs");

    // Its body sits behind a direct-execution guard, so importing it runs no
    // code and calls no model. Only the helpers are exposed.
    assert.deepEqual(Object.keys(module).sort(), ["citedFiles", "indexRepo"]);
  });
});

describe("l'extraction des fichiers cités", () => {
  it("accepte un chemin réel avec son répertoire", (t) => {
    const { cited, missing } = citedFiles(
      "Le déploiement passe par scripts/build-site.mjs et .github/workflows/deploy-site.yml.",
      index
    );
    t.diagnostic(cited.join(", "));
    assert.equal(cited.length, 2);
    assert.deepEqual(missing, []);
  });

  it("accepte un nom de fichier nu, cité sans son répertoire", (t) => {
    // C'est la forme que l'agent emploie le plus souvent, et celle qui était
    // ignorée : `acm.tf` vit sous terraform/ mais la réponse ne le dit pas.
    const { cited, missing } = citedFiles("La configuration tient dans `acm.tf` et `lambda.tf`.", index);
    t.diagnostic(cited.join(", "));
    assert.deepEqual(cited.sort(), ["acm.tf", "lambda.tf"]);
    assert.deepEqual(missing, []);
  });

  it("dénonce un fichier inventé", () => {
    const { missing } = citedFiles("Tout est dans src/deploy/pipeline.ts et dans config-magique.yml.", index);
    assert.deepEqual(missing.sort(), ["config-magique.yml", "src/deploy/pipeline.ts"]);
  });

  it("ne compte pas deux fois un fichier cité avec et sans répertoire", () => {
    const { cited } = citedFiles("Voir scripts/build-site.mjs, c'est-à-dire build-site.mjs.", index);
    assert.deepEqual(cited, ["scripts/build-site.mjs"]);
  });

  it("ignore une URL", () => {
    const { cited } = citedFiles("Le dépôt est sur https://github.com/rr-djk/rr-djuikoo.com.", index);
    assert.deepEqual(cited, []);
  });

  it("ne prend pas un numéro de version pour un fichier", () => {
    // Sans la liste d'extensions de repo.mjs, `3.2` correspondrait au motif.
    const { cited } = citedFiles("Le backend tourne sous Spring Boot 3.2 et Java 21.", index);
    assert.deepEqual(cited, []);
  });

  it("ne trouve rien dans une réponse sans fichier", () => {
    const { cited, missing } = citedFiles("Je ne peux pas répondre, demande-lui directement.", index);
    assert.deepEqual(cited, []);
    assert.deepEqual(missing, []);
  });
});
