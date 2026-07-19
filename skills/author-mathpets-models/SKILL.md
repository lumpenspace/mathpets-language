---
name: author-mathpets-models
description: Design, write, revise, explain, and compile MathPets `.pet` models for social, physical, spatial, network, and agent-based simulations. Use when creating a MathPets simulation, translating a conceptual model into MathPets, debugging compiler diagnostics, or modifying world, parameter, pet, patch, link, setup, step, brush, team, or round sections.
---

# Author MathPets Models

Create readable simulation source collaboratively with the user, then use the
compiler as the authority on syntax and semantics.

## Workflow

1. Read `docs/pets-language-spec.md`. Search within it for the sections needed
   by the requested model rather than loading unrelated details.
2. State the model's entities, owned state, environment, update schedule, and
   observables in plain language before editing source.
3. Map environment state to `patches:`, mobile entities to `pets:`,
   relationships to `links:`, user inputs to `params:`, and outputs to
   `monitors:`.
4. Keep `setup:` deterministic under a fixed seed. Choose ordinary `step:` for
   sequential updates and `step staged:` when all agents must read the same
   pre-step state.
5. Write or update a `.pet` file. Prefer descriptive kebab-case names and short
   comments explaining modeling assumptions.
6. From the repository root, run `npm run build`, then compile with:

   ```sh
   node scripts/compile-model.mjs path/to/model.pet > /tmp/model.js
   ```

7. Fix compiler diagnostics and repeat until compilation succeeds.
8. Summarize assumptions, parameters, update ordering, stopping conditions,
   and behavior that deserves empirical validation.

## Modeling guidance

- Make ownership explicit. Globals, patches, pets, and links should not mirror
  the same fact unless synchronization is part of the model.
- Separate mechanism from presentation.
- Pin randomness while debugging; avoid relying on incidental iteration order.
- Use staged updates for diffusion, cellular automata, simultaneous games, and
  systems where in-place writes would bias results.
- Use rounds only when decisions genuinely arrive from an external participant
  or process. Keep the protocol transport-neutral.
- Prefer the smallest model that exhibits the target phenomenon. Add metrics
  before adding complexity.

## Verification

Run `npm test` after compiler or extension changes. For model-only changes,
compile the affected `.pet` file and inspect the emitted module for the
expected `defineModel`, setup, and step structure. Do not claim success from a
surface-level indentation scan; use the real compiler.
