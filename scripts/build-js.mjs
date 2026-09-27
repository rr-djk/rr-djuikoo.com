#!/usr/bin/env node
// esbuild-wasm, not esbuild: .npmrc sets ignore-scripts=true (deliberate,
// matches the repo's security posture), and esbuild's native package needs its
// postinstall script to place the platform binary. esbuild-wasm ships its
// .wasm directly in the npm tarball, so it installs and runs with scripts
// disabled. Trade-off: no *Sync API, hence this file is async.

import * as esbuild from "esbuild-wasm";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const ENTRY = fileURLToPath(new URL("src/js/main.js", root));
const OUT = fileURLToPath(new URL("site/js/main.js", root));

// format: "iife" keeps the output a classic script — main.js relies on
// Turnstile's ?onload=onTurnstileLoad calling a global, which a "module"
// script would delay past the callback's own execution.
const result = await esbuild.build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  metafile: true,
});

const { bytes } = result.metafile.outputs["site/js/main.js"];
console.log(`site/js/main.js  ${bytes} octets`);
