// Exercises agent/code_explorer/repo.mjs on the three real projects and on every
// failure case it is meant to name.
//
// Touches GitHub and the local disk. No Bedrock, no cost.

import { readdirSync, statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { before, describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchRepo, RepoError, resolveRepo } from "../agent/code_explorer/repo.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE = join(tmpdir(), "repos");

let projects;

before(async () => {
  // Cleared first so the run starts from the same state every time, whatever a
  // previous one left behind. Without this the cold-fetch checks only hold on
  // the first run of the day. Re-downloading the three repositories costs about
  // a second, and it means the download path is exercised on every run.
  //
  // This is also why the suite runs with --test-concurrency=1: tools.test.mjs
  // reads the tree this wipes.
  await rm(WORKSPACE, { recursive: true, force: true });
  projects = JSON.parse(await readFile(join(ROOT, "site/content.json"), "utf8")).projects;
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function summarise(root) {
  const files = walk(root);
  const kb = Math.round(files.reduce((n, f) => n + statSync(f).size, 0) / 1024);
  const exts = new Map();
  for (const f of files) {
    const dot = f.lastIndexOf(".");
    const ext = dot > f.lastIndexOf("/") ? f.slice(dot) : "(sans extension)";
    exts.set(ext, (exts.get(ext) ?? 0) + 1);
  }
  const top = [...exts].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return { count: files.length, kb, top };
}

describe("les trois dépôts", () => {
  it("se téléchargent, s'extraient, puis sortent du cache", async (t) => {
    for (const project of projects) {
      const target = resolveRepo(project);

      const coldStart = Date.now();
      const first = await fetchRepo(target);
      const coldMs = Date.now() - coldStart;

      const warmStart = Date.now();
      const second = await fetchRepo(target);
      const warmMs = Date.now() - warmStart;

      const s = summarise(first.root);

      // Reported rather than asserted: a threshold here would be arbitrary, but
      // reading the breakdown is how a missing extension gets noticed - that is
      // exactly how .tf was found to be absent from the allowlist.
      t.diagnostic(
        `${project.name} → ${target.owner}/${target.repo} : ${s.count} fichiers, ${s.kb} Ko | ` +
          `${s.top.map(([e, n]) => `${e}:${n}`).join("  ")} | ${coldMs} ms à froid, ${warmMs} ms à chaud`
      );

      assert.ok(s.count > 0, `${project.name} : aucun fichier extrait`);
      assert.equal(first.cached, false, `${project.name} : le premier appel aurait dû télécharger`);
      assert.equal(second.cached, true, `${project.name} : le second appel aurait dû servir le cache`);
      assert.ok(warmMs < coldMs, `${project.name} : le cache n'a rien accéléré`);
    }
  });

  it("n'extrait rien d'autre que des fichiers réguliers", () => {
    // A symlink surviving extraction would be followed by read_file, and the
    // path barrier in code_explorer.mjs resolves names lexically: it cannot see
    // where a link points. The extraction filter keeps regular files only.
    const strays = walk(WORKSPACE).filter((f) => {
      const s = statSync(f, { throwIfNoEntry: false });
      return s && !s.isFile();
    });
    assert.deepEqual(strays, []);
  });
});

describe("les cas d'échec", () => {
  const cases = [
    ["projet sans lien GitHub", () => resolveRepo({ name: "Sans dépôt", links: [] })],
    ["lien hors motif (site web)", () => resolveRepo({ name: "X", links: [{ href: "https://example.com/a/b" }] })],
    ["lien hors motif (gitlab)", () => resolveRepo({ name: "X", links: [{ href: "https://gitlab.com/a/b" }] })],
    ["lien GitHub trop profond", () => resolveRepo({ name: "X", links: [{ href: "https://github.com/a/b/tree/main" }] })],
    ["dépôt inexistant", () => fetchRepo({ owner: "rr-djk", repo: "ce-depot-n-existe-pas-du-tout" })],
    ["dépôt privé", () => fetchRepo({ owner: "github", repo: "private-nonexistent-xyz" })],
  ];

  for (const [label, run] of cases) {
    it(`${label} rend un RepoError lisible`, async (t) => {
      // try/catch rather than assert.rejects: resolveRepo throws synchronously
      // while fetchRepo rejects, and both shapes have to be caught the same way.
      let err = null;
      try {
        await run();
      } catch (caught) {
        err = caught;
      }

      assert.ok(err, "aucune erreur levée");
      t.diagnostic(`${err.name}: ${err.message}`);

      assert.ok(err instanceof RepoError, `attendu un RepoError, reçu ${err.name}`);
      // The message goes to the model and from there to a visitor: no URL, no
      // library name, no stack fragment.
      assert.doesNotMatch(err.message, /github\.com|\btar\b|ENOENT|at Object\./);
    });
  }
});
