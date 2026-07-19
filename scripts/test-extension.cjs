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
const disposable = () => ({ dispose() {} });
const document = {
  languageId: "pet", isDirty: false,
  uri: { fsPath: "/tmp/blink.pet", toString: () => "file:///tmp/blink.pet" },
  getText: () => source,
};
const vscode = {
  window: {
    activeTextEditor: { document },
    createOutputChannel: () => ({ appendLine: (line) => lines.push(line), clear: () => { lines.length = 0; }, show() {}, dispose() {} }),
    showInformationMessage() {}, showErrorMessage(message) { throw new Error(message); },
    showWarningMessage(message) { throw new Error(message); }, onDidChangeActiveTextEditor: disposable,
  },
  commands: { registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); } },
  languages: { registerCompletionItemProvider: disposable },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/tmp" } }], getWorkspaceFolder: () => ({ uri: { fsPath: "/tmp" } }),
    getConfiguration: () => ({ get: () => false }), onDidSaveTextDocument: disposable,
    onDidChangeTextDocument: disposable, findFiles: async () => [], openTextDocument: async () => document,
  },
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((item) => item.dispose()) }) },
  CompletionItem: function(label) { this.label = label; }, CompletionItemKind: new Proxy({}, { get: () => 1 }),
  SnippetString: function(value) { this.value = value; }, MarkdownString: function(value) { this.value = value; },
  ViewColumn: { Beside: 2 },
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "vscode") return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const extension = require("../packages/ide/src/extension.js");
extension.activate({ subscriptions: [] });
Promise.resolve(commands.get("pets.compileFile")()).then(() => {
  if (!lines.some((line) => line.includes("defineModel"))) throw new Error("Compile command did not invoke the compiler.");
  console.log("extension smoke test passed");
});
