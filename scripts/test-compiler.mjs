import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compilePetsToJavaScript } = require("../packages/ide/dist/compiler.cjs");
const source = `model:
  name: Fire

world:
  x: -8..8
  y: -6..6
  topology: box

params:
  density: number = slider(62, 0..100)

patches:
  state: empty | tree | burning | burned = empty

setup:
  patches:
    state := if (random-float(100) < density) then tree else empty

step staged:
  patches:
    where burning:
      state := burned
`;
const valid = compilePetsToJavaScript(source);
if (!valid.code || valid.diagnostics.length) throw new Error(JSON.stringify(valid.diagnostics));
if (!valid.code.includes("defineModel")) throw new Error("Emitter produced no model module.");
const invalid = compilePetsToJavaScript(source.replace("density: number", "density: mystery"));
if (invalid.code || invalid.diagnostics.length === 0) throw new Error("Invalid model was accepted.");
console.log("compiler smoke test passed");
