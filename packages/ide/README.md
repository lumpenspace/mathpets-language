# MathPets IDE

VS Code language support for MathPets `.pet` source files.

## Features

- Syntax highlighting for MathPets metadata, sections, expressions, styles, and presets.
- Autocomplete snippets for sections, fields, controls, nested agent blocks, `let` locals, built-ins, styles, and symbols declared in the current file.
- A runtime-backed side-panel preview with live world snapshots, authored parameter defaults, editable controls, and Play, Pause, Step, and Reset transport.
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
code --install-extension mathpets-ide-0.1.2.vsix
```

The `.vscodeignore` file keeps `vsce` from following the monorepo workspace graph into unrelated packages.

The compile commands invoke the bundled MathPets parser, validator, and
JavaScript emitter. Successful output is written to the `Pet` output channel;
compiler diagnostics are reported as errors. The preview instantiates that same
compiled model locally, so its controls and transport exercise the real runtime.
