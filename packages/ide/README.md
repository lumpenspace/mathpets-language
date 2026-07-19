# MathPets IDE

VS Code language support for MathPets `.pet` source files.

## Features

- Syntax highlighting for MathPets metadata, sections, expressions, styles, and presets.
- Autocomplete snippets for sections, fields, controls, nested agent blocks, `let` locals, built-ins, styles, and symbols declared in the current file.
- A side-panel preview with a model overview, world sketch, controls, normalized MathPets body, and output tab.
- Commands:
  - `Pet: Open Preview`
  - `Pet: Compile Current File`
  - `Pet: Compile Workspace`
  - `Pet: Show Compilation Output`

## Development

Load the extension directly from this workspace:

```sh
code --extensionDevelopmentPath=packages/ide .
```

## Package And Install

Build a local VSIX from the extension package:

```sh
cd packages/ide
npx @vscode/vsce package
code --install-extension pets-ide-0.0.0.vsix
```

The `.vscodeignore` file keeps `vsce` from following the monorepo workspace graph into unrelated packages.

The compile commands invoke the bundled MathPets parser, validator, and
JavaScript emitter. Successful output is written to the `Pet` output channel;
compiler diagnostics are reported as errors.
