#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/compile-model.mjs <model.pet>");
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { compilePetsToJavaScript } = require("../packages/ide/dist/compiler.cjs");
const result = compilePetsToJavaScript(await readFile(input, "utf8"));
if (!result.code || result.diagnostics.length > 0) {
  for (const diagnostic of result.diagnostics) console.error(diagnostic.message ?? String(diagnostic));
  process.exit(1);
}
process.stdout.write(result.code);
