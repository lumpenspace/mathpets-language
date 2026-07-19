import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compilePetsToJavaScript, instantiatePetsModel } = require("../packages/ide/dist/compiler.cjs");
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
const instantiated = instantiatePetsModel(source);
if (!instantiated.model) throw new Error(JSON.stringify(instantiated.diagnostics));
if (instantiated.model.getSnapshot().params.density !== 62) throw new Error("Runtime lost the authored parameter default.");
instantiated.model.world.runTick();
if (instantiated.model.getSnapshot().ticks !== 1) throw new Error("Runtime transport did not advance one tick.");
const invalid = compilePetsToJavaScript(source.replace("density: number", "density: mystery"));
if (invalid.code || invalid.diagnostics.length === 0) throw new Error("Invalid model was accepted.");
console.log("compiler smoke test passed");
