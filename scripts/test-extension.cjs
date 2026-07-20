"use strict";
const Module = require("node:module");
const commands = new Map();
const lines = [];
const source = `model:
  name: Blink

world:
  x: -2..2
  y: -2..2
  topology: box

patches:
  active: boolean = false

setup:
  patches:
    active := false

step:
  patches:
    active := not active
`;
const invalidSource = source.replace("active: boolean", "active boolean");
let activeSource = source;
const mappedDiagnostics = new Map();
let registeredUriHandler = null;
const disposable = () => ({ dispose() {} });
const document = {
  languageId: "pet", isDirty: false,
  uri: { fsPath: "/tmp/blink.pet", toString: () => "file:///tmp/blink.pet" },
  getText: () => activeSource,
  positionAt: (offset) => {
    const before = activeSource.slice(0, offset);
    const linesBefore = before.split("\n");
    return { line: linesBefore.length - 1, character: linesBefore.at(-1).length };
  },
};
const vscode = {
  window: {
    activeTextEditor: { document },
    createOutputChannel: () => ({ appendLine: (line) => lines.push(line), clear: () => { lines.length = 0; }, show() {}, dispose() {} }),
    showInformationMessage() {}, showErrorMessage() {}, showTextDocument: async () => {},
    showWarningMessage(message) { throw new Error(message); }, onDidChangeActiveTextEditor: disposable,
    registerUriHandler: (handler) => { registeredUriHandler = handler; return disposable(); },
  },
  commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); } },
  languages: {
    registerCompletionItemProvider: disposable,
    createDiagnosticCollection: () => ({
      set: (uri, diagnostics) => mappedDiagnostics.set(uri.toString(), diagnostics),
      delete: (uri) => mappedDiagnostics.delete(uri.toString()),
      dispose() {},
    }),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/tmp" } }], getWorkspaceFolder: () => ({ uri: { fsPath: "/tmp" } }),
    getConfiguration: () => ({ get: () => false }), onDidSaveTextDocument: disposable,
    onDidChangeTextDocument: disposable, findFiles: async () => [], openTextDocument: async () => document,
  },
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((item) => item.dispose()) }) },
  CompletionItem: function(label) { this.label = label; }, CompletionItemKind: new Proxy({}, { get: () => 1 }),
  SnippetString: function(value) { this.value = value; }, MarkdownString: function(value) { this.value = value; },
  ViewColumn: { Beside: 2 },
  Range: function(start, end) { this.start = start; this.end = end; },
  Diagnostic: function(range, message, severity) { this.range = range; this.message = message; this.severity = severity; },
  DiagnosticSeverity: { Error: 0 },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "vscode") return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const extension = require("../packages/ide/src/extension.js");
extension.activate({ subscriptions: [] });
(async () => {
  if (!registeredUriHandler) throw new Error("MathPets URI handler was not registered.");
  await commands.get("pets.compileFile")();
  if (!lines.some((line) => line.includes("defineModel"))) throw new Error("Compile command did not invoke the compiler.");
  activeSource = invalidSource;
  await commands.get("pets.compileFile")();
  const invalidDiagnostics = mappedDiagnostics.get(document.uri.toString());
  if (!invalidDiagnostics?.length) throw new Error("Invalid source was not mapped to VS Code diagnostics.");
  if (invalidDiagnostics[0].source !== "MathPets") throw new Error("Diagnostic source was not identified.");
  if (invalidDiagnostics[0].range.start.line !== 9) throw new Error(`Diagnostic mapped to line ${invalidDiagnostics[0].range.start.line + 1}, expected 10.`);
  activeSource = source;
  await commands.get("pets.compileFile")();
  if (mappedDiagnostics.has(document.uri.toString())) throw new Error("Successful compile did not clear stale diagnostics.");
  console.log("extension smoke test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
