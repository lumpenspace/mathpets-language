# MathPets

MathPets is a small language for collaboratively building social and physical
systems simulations. It is designed to be easy for language models to write
and easy for humans to read, discuss, and revise.

This repository contains only the language toolchain:

- `packages/language` — parser, validator, and JavaScript emitter
- `packages/engine` — deterministic spatial and round-based runtime contracts
- `packages/model-api` — the JavaScript model-building target
- `packages/ide` — VS Code support for `.pet` files
- `docs` — the Markdown language reference
- `skills/author-mathpets-models` — a reusable LLM authoring skill

## Quick start

```sh
npm install
npm test
node scripts/compile-model.mjs path/to/model.pet > model.js
```

Build the VS Code extension with `npm run package:extension`. This produces
`packages/ide/mathpets-ide-0.1.0.vsix`, installable through VS Code's
**Extensions: Install from VSIX…** command.

MathPets keeps simulation structure visible in plain text: world bounds,
parameters, agent-owned fields, setup, repeated steps, and externally supplied
round decisions are separate named sections. Start with
[the language reference](docs/pets-language-spec.md).

## Development

```sh
npm run typecheck
npm test
npm run package:extension
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
