"use strict";

const path = require("path");
const vscode = require("vscode");
const { compilePetsToJavaScript, instantiatePetsModel } = require("../dist/compiler.cjs");

const LANGUAGE_ID = "pet";
const output = vscode.window.createOutputChannel("Pet");
const diagnosticCollection = vscode.languages.createDiagnosticCollection("mathpets");
let savingForExplicitCompile = false;
let previewPanel = null;
let previewDocumentUri = null;
let previewUpdateTimer = null;
let previewRuntime = null;
let previewRuntimeSource = null;
let previewRunTimer = null;

const TOP_LEVEL_SECTIONS = new Set([
  "model",
  "defs",
  "world",
  "params",
  "memory",
  "monitors",
  "patches",
  "pets",
  "setup",
  "step",
  "styles",
  "presets",
]);

function activate(context) {
  context.subscriptions.push(output);
  context.subscriptions.push(diagnosticCollection);
  context.subscriptions.push(vscode.commands.registerCommand("pets.openPreview", openPreview));
  context.subscriptions.push(vscode.commands.registerCommand("pets.compileFile", compileActiveFile));
  context.subscriptions.push(vscode.commands.registerCommand("pets.compileWorkspace", compileWorkspace));
  context.subscriptions.push(vscode.commands.registerCommand("pets.showOutput", () => output.show(true)));
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: openModelUri }));
  context.subscriptions.push(registerCompletionProvider());
  context.subscriptions.push(registerCompileOnSave());
  context.subscriptions.push(registerPreviewRefresh());
}

function deactivate() {}

async function openModelUri(uri) {
  if (uri.path !== "/open") return;
  const params = new URLSearchParams(uri.query);
  const sourceUrl = params.get("url");
  if (!sourceUrl) {
    vscode.window.showErrorMessage("MathPets link is missing its model URL.");
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    vscode.window.showErrorMessage("MathPets link contains an invalid model URL.");
    return;
  }
  const allowedRemote = parsedUrl.protocol === "https:" && (parsedUrl.hostname === "mathpets.world" || parsedUrl.hostname.endsWith(".mathpets.world"));
  const allowedLocal = parsedUrl.protocol === "http:" && (parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1");
  if (!allowedRemote && !allowedLocal) {
    vscode.window.showErrorMessage("MathPets links may only load models from mathpets.world or localhost.");
    return;
  }

  try {
    const response = await fetch(parsedUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    const document = await vscode.workspace.openTextDocument({ language: LANGUAGE_ID, content: source });
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage(`Opened ${params.get("name") || "MathPets model"}. Save it to keep a local copy.`);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not open MathPets model: ${error.message ?? String(error)}`);
  }
}

async function openPreview() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== LANGUAGE_ID) {
    vscode.window.showWarningMessage("Open a .pet file before running Pet: Open Preview.");
    return;
  }

  previewDocumentUri = editor.document.uri;

  if (!previewPanel) {
    previewPanel = vscode.window.createWebviewPanel(
      "petsPreview",
      previewTitle(editor.document),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    previewPanel.onDidDispose(() => {
      stopPreviewTimer();
      previewPanel = null;
      previewDocumentUri = null;
      previewRuntime = null;
      previewRuntimeSource = null;
    });
    previewPanel.webview.onDidReceiveMessage((message) => {
      if (message?.command === "compile") {
        compilePreviewDocument().catch(showPreviewError);
      } else if (message?.command === "refresh") {
        refreshPreviewDocument().catch(showPreviewError);
      } else if (message?.command === "transport") {
        handlePreviewTransport(message.action).catch(showPreviewError);
      } else if (message?.command === "set-param") {
        setPreviewParam(message.name, message.value).catch(showPreviewError);
      }
    });
  } else {
    previewPanel.reveal(vscode.ViewColumn.Beside);
  }

  updatePreview(editor.document);
}

function registerPreviewRefresh() {
  return vscode.Disposable.from(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isPreviewDocument(event.document)) {
        schedulePreviewUpdate(event.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isPreviewDocument(document)) {
        schedulePreviewUpdate(document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!previewPanel || !editor || editor.document.languageId !== LANGUAGE_ID) {
        return;
      }
      previewDocumentUri = editor.document.uri;
      schedulePreviewUpdate(editor.document);
    }),
  );
}

function isPreviewDocument(document) {
  return Boolean(
    previewPanel &&
      previewDocumentUri &&
      document.languageId === LANGUAGE_ID &&
      document.uri.toString() === previewDocumentUri.toString(),
  );
}

function schedulePreviewUpdate(document) {
  if (previewUpdateTimer) {
    clearTimeout(previewUpdateTimer);
  }
  previewUpdateTimer = setTimeout(() => updatePreview(document), 160);
}

function updatePreview(document) {
  if (!previewPanel || document.languageId !== LANGUAGE_ID) {
    return;
  }
  const source = document.getText();
  if (source !== previewRuntimeSource) {
    stopPreviewTimer();
    const instantiated = instantiatePetsModel(source);
    previewRuntime = instantiated.model;
    previewRuntimeSource = source;
  }
  previewPanel.title = previewTitle(document);
  previewPanel.webview.html = renderPreviewHtml(document, previewPanel.webview, previewRuntime?.getSnapshot?.() ?? null);
}

function stopPreviewTimer() {
  if (previewRunTimer) clearInterval(previewRunTimer);
  previewRunTimer = null;
}

async function handlePreviewTransport(action) {
  if (!previewRuntime || !previewDocumentUri) return;
  if (action === "play") {
    previewRuntime.world.start();
    stopPreviewTimer();
    previewRunTimer = setInterval(async () => {
      previewRuntime?.world.runTick();
      if (previewDocumentUri && previewPanel) {
        const document = await vscode.workspace.openTextDocument(previewDocumentUri);
        const snapshot = previewRuntime?.getSnapshot?.() ?? null;
        const analysis = analyzeCritSource(document.getText());
        previewPanel.webview.postMessage({
          command: "state",
          ticks: snapshot?.ticks ?? 0,
          status: snapshot?.status ?? "ready",
          worldHtml: renderWorldSvg(analysis, snapshot),
        });
      }
    }, 250);
  } else if (action === "pause") {
    previewRuntime.world.pause();
    stopPreviewTimer();
  } else if (action === "step") {
    previewRuntime.world.runTick();
  } else if (action === "reset") {
    stopPreviewTimer();
    previewRuntime.restart();
  }
  updatePreview(await vscode.workspace.openTextDocument(previewDocumentUri));
}

async function setPreviewParam(name, value) {
  if (!previewRuntime || !previewDocumentUri) return;
  previewRuntime.setParamValue(name, value);
  updatePreview(await vscode.workspace.openTextDocument(previewDocumentUri));
}

async function refreshPreviewDocument() {
  if (!previewDocumentUri) {
    return;
  }
  updatePreview(await vscode.workspace.openTextDocument(previewDocumentUri));
}

function showPreviewError(error) {
  output.appendLine(String(error));
  vscode.window.showErrorMessage(`Pet preview failed: ${error.message ?? String(error)}`);
}

function previewTitle(document) {
  const analysis = analyzeCritSource(document.getText());
  return `Pet Preview: ${analysis.metadata.name || path.basename(document.uri.fsPath)}`;
}

async function compilePreviewDocument() {
  if (!previewDocumentUri) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(previewDocumentUri);
  compileDocument(document, { revealOutput: false, notify: false });
  updatePreview(document);
}

async function compileActiveFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== LANGUAGE_ID) {
    vscode.window.showWarningMessage("Open a .pet file before running Pet: Compile Current File.");
    return;
  }

  if (editor.document.isDirty) {
    savingForExplicitCompile = true;
    try {
      await editor.document.save();
    } finally {
      savingForExplicitCompile = false;
    }
  }

  compileDocument(editor.document, { revealOutput: true, notify: true });
}

async function compileWorkspace() {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage("Open a workspace before compiling Pet source.");
    return;
  }

  const files = await vscode.workspace.findFiles("**/*.pet", "**/node_modules/**");
  output.clear();
  output.show(true);
  output.appendLine(`Compiling ${files.length} Pet file${files.length === 1 ? "" : "s"}...`);

  let failed = 0;
  for (const uri of files) {
    const document = await vscode.workspace.openTextDocument(uri);
    const ok = compileDocument(document, { revealOutput: false, notify: false, append: true });
    if (!ok) {
      failed += 1;
    }
  }

  const message = failed === 0
    ? `Pet workspace compilation finished: ${files.length} file${files.length === 1 ? "" : "s"} ok.`
    : `Pet workspace compilation found ${failed} file${failed === 1 ? "" : "s"} with issues.`;
  output.appendLine("");
  output.appendLine(message);

  if (failed === 0) {
    vscode.window.showInformationMessage(message);
  } else {
    vscode.window.showErrorMessage(message);
  }
}

function registerCompileOnSave() {
  return vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId !== LANGUAGE_ID || savingForExplicitCompile) {
      return;
    }

    const config = vscode.workspace.getConfiguration("pets", document.uri);
    if (!config.get("compileOnSave")) {
      return;
    }

    const workspaceFolder = resolveWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      compileDocument(document, { revealOutput: false, notify: false });
    }
  });
}

function resolveWorkspaceFolder(uri) {
  if (!uri) {
    return undefined;
  }

  return vscode.workspace.getWorkspaceFolder(uri);
}

function compileDocument(document, options = {}) {
  const analysis = analyzeCritSource(document.getText());
  let compiled;
  try {
    compiled = compilePetsToJavaScript(document.getText());
  } catch (error) {
    compiled = { code: null, diagnostics: [{ message: error.message ?? String(error) }] };
  }
  const workspaceFolder = resolveWorkspaceFolder(document.uri);
  const label = workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath) : document.uri.fsPath;
  const append = options.append ?? false;

  if (!append) {
    output.clear();
  }

  if (options.revealOutput ?? true) {
    output.show(true);
  }

  output.appendLine(`${label}`);

  if (!compiled.code || compiled.diagnostics.length > 0) {
    diagnosticCollection.set(document.uri, compiled.diagnostics.map((diagnostic) => toVscodeDiagnostic(document, diagnostic)));
    for (const diagnostic of compiled.diagnostics) {
      output.appendLine(`  error: ${diagnostic.message ?? String(diagnostic)}`);
    }
    if (options.notify ?? true) {
      vscode.window.showErrorMessage("Pet compilation failed. See the Pet output channel.");
    }
    return false;
  }

  diagnosticCollection.delete(document.uri);

  output.appendLine(`  model: ${analysis.metadata.name || "Untitled"}`);
  output.appendLine(`  world: ${analysis.world.width ?? "?"} x ${analysis.world.height ?? "?"}`);
  output.appendLine(`  params: ${analysis.params.length}, monitors: ${analysis.monitors.length}, steps: ${analysis.stepSections.length}`);
  output.appendLine("");
  output.appendLine(compiled.code.trimEnd());
  output.appendLine("");

  if (options.notify ?? true) {
    vscode.window.showInformationMessage("Pet compilation finished.");
  }

  return true;
}

function toVscodeDiagnostic(document, diagnostic) {
  const from = Math.max(0, Math.min(document.getText().length, diagnostic.from ?? 0));
  let to = Math.max(from, Math.min(document.getText().length, diagnostic.to ?? from));
  if (to === from && to < document.getText().length) to += 1;
  const item = new vscode.Diagnostic(
    new vscode.Range(document.positionAt(from), document.positionAt(to)),
    diagnostic.message ?? String(diagnostic),
    vscode.DiagnosticSeverity.Error,
  );
  item.source = "MathPets";
  return item;
}

function registerCompletionProvider() {
  return vscode.languages.registerCompletionItemProvider(
    { language: LANGUAGE_ID, scheme: "file" },
    {
      provideCompletionItems(document, position) {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_-]*/) ?? undefined;
        const section = findCurrentSection(document, position.line);
        const linePrefix = document.lineAt(position).text.slice(0, position.character);
        const atIndentedStart = linePrefix.trim().length === 0;
        const sourceIndex = collectSourceIndex(document.getText());
        const entries = [];

        if (atIndentedStart && isTopLevelPosition(document, position.line)) {
          entries.push(...TOP_LEVEL_COMPLETIONS);
        }

        if (section === "model") {
          entries.push(...MODEL_COMPLETIONS);
        } else if (section === "world") {
          entries.push(...WORLD_COMPLETIONS);
        } else if (section === "params") {
          entries.push(...DECLARATION_COMPLETIONS, ...TYPE_COMPLETIONS, ...CONTROL_COMPLETIONS, ...EXPRESSION_COMPLETIONS);
        } else if (section === "memory" || section === "monitors" || section === "patches" || section === "pets" || section === "pets") {
          entries.push(...DECLARATION_COMPLETIONS, ...TYPE_COMPLETIONS, ...EXPRESSION_COMPLETIONS);
          if (section === "pets" || section === "pets") {
            entries.push(...PET_COMPLETIONS);
          }
        } else if (section === "defs") {
          entries.push(...DEF_COMPLETIONS, ...TYPE_COMPLETIONS, ...EXPRESSION_COMPLETIONS);
        } else if (section === "setup" || section === "step") {
          entries.push(...STATEMENT_COMPLETIONS, ...EXPRESSION_COMPLETIONS);
        } else if (section === "styles") {
          entries.push(...STYLE_COMPLETIONS);
        } else if (section === "presets") {
          entries.push(...PRESET_COMPLETIONS);
        } else {
          entries.push(...TOP_LEVEL_COMPLETIONS, ...EXPRESSION_COMPLETIONS);
        }

        entries.push(...sourceIndexToCompletions(sourceIndex));
        return uniqueCompletions(entries).map((entry) => toCompletionItem(entry, range));
      },
    },
    ":",
    " ",
    "(",
    ".",
    "<",
  );
}

function renderPreviewHtml(document, webview, snapshot = null) {
  const analysis = analyzeCritSource(document.getText());
  const compiled = {
    statusLabel: analysis.diagnostics.length > 0 ? "Needs fixes" : "Preview compiled",
    relativePath: path.basename(document.uri.fsPath),
    content: analysis.petsSource,
  };
  const nonce = getNonce();
  const title = analysis.metadata.name || path.basename(document.uri.fsPath);
  const badges = [
    analysis.metadata.language || "mathpets",
    analysis.metadata.runtime || "jit",
    `${analysis.world.width ?? "?"} x ${analysis.world.height ?? "?"}`,
    document.isDirty ? "Unsaved" : "Saved",
    compiled.statusLabel,
  ];
  const diagnostics = analysis.diagnostics.length
    ? `<div class="notice">${analysis.diagnostics.map((message) => `<p>${escapeHtml(message)}</p>`).join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --accent-hover: var(--vscode-button-hoverBackground, var(--accent));
      --button-border: var(--vscode-button-border, color-mix(in srgb, var(--accent) 72%, var(--fg) 28%));
      --secondary-bg: var(--vscode-button-secondaryBackground, transparent);
      --secondary-fg: var(--vscode-button-secondaryForeground, var(--fg));
      --secondary-hover: var(--vscode-button-secondaryHoverBackground, var(--surface));
      --secondary-border: color-mix(in srgb, var(--border) 82%, var(--fg) 18%);
      --focus: var(--vscode-focusBorder, var(--accent));
      --surface: color-mix(in srgb, var(--bg) 90%, var(--fg) 10%);
      --code: var(--vscode-textCodeBlock-background);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 var(--vscode-font-family); }
    button, input { font: inherit; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; padding: 22px 24px 10px; }
    .eyebrow { margin: 0 0 5px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 14px; letter-spacing: 0; }
    .badges, .pill-row, .actions, .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .badges { margin-top: 12px; }
    .badge, .pill { border: 1px solid var(--border); border-radius: 999px; color: var(--muted); padding: 3px 8px; white-space: nowrap; }
    .pill { color: var(--fg); background: var(--surface); display: inline-flex; align-items: center; gap: 6px; }
    .actions { justify-content: flex-end; min-width: 170px; }
    .actions button { border: 1px solid var(--button-border); border-radius: 3px; min-height: 28px; padding: 5px 10px; color: var(--accent-fg); background: var(--accent); cursor: pointer; }
    .actions button:hover { background: var(--accent-hover); }
    .actions button.secondary { color: var(--secondary-fg); background: var(--secondary-bg); border-color: var(--secondary-border); }
    .actions button.secondary:hover { background: var(--secondary-hover); }
    .actions button:focus-visible, .tab:focus-visible { outline: 1px solid var(--focus); outline-offset: 2px; }
    .tabs { padding: 6px 24px 0; border-bottom: 1px solid var(--border); }
    .tab { border: 0; border-bottom: 2px solid transparent; color: var(--muted); background: transparent; padding: 8px 10px; cursor: pointer; }
    .tab.active { color: var(--fg); border-color: var(--accent); }
    .content { padding: 20px 24px 28px; }
    .pane { display: none; }
    .pane.active { display: block; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
    .metric, .panel { border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
    .metric { padding: 10px; min-width: 0; }
    .metric strong { display: block; font-size: 18px; line-height: 1.15; overflow-wrap: anywhere; }
    .metric span, .muted { color: var(--muted); }
    .overview { display: grid; grid-template-columns: minmax(260px, 1.05fr) minmax(260px, .95fr); gap: 16px; align-items: start; }
    .panel { padding: 14px; min-width: 0; }
    .world { display: grid; grid-template-columns: minmax(150px, 240px) 1fr; gap: 14px; align-items: center; }
    .world-svg { width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--border); background: #101828; }
    .kv { display: grid; grid-template-columns: 92px 1fr; gap: 6px 10px; }
    .kv dt { color: var(--muted); }
    .kv dd { margin: 0; overflow-wrap: anywhere; }
    .control-list, .symbol-list, .notes { display: grid; gap: 8px; }
    .control { display: grid; grid-template-columns: minmax(86px, 130px) 1fr auto; gap: 10px; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .control:last-child { border-bottom: 0; padding-bottom: 0; }
    .control input[type="range"] { width: 100%; }
    .swatch { width: 12px; height: 12px; border-radius: 50%; border: 1px solid color-mix(in srgb, #000 38%, #fff 62%); display: inline-block; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 500; }
    pre { margin: 0; padding: 14px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--code, var(--surface)); max-height: calc(100vh - 175px); }
    code { font: 12px/1.5 var(--vscode-editor-font-family); white-space: pre; }
    .notice, .empty { border: 1px dashed var(--border); border-radius: 6px; padding: 12px; margin-bottom: 16px; color: var(--muted); }
    .notice { border-style: solid; color: var(--fg); }
    @media (max-width: 780px) {
      .topbar, .overview, .world { display: block; }
      .actions { justify-content: flex-start; margin-top: 14px; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel { margin-bottom: 14px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">Pet preview</p>
      <h1>${escapeHtml(title)}</h1>
      <div class="badges">${badges.map((badge) => `<span class="badge">${escapeHtml(String(badge))}</span>`).join("")}</div>
    </div>
    <div class="actions">
      <button data-command="compile">Compile</button>
      <button class="secondary" data-command="refresh">Refresh</button>
    </div>
  </header>
  <nav class="tabs" aria-label="Preview tabs">
    <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="pets">Pets</button>
    <button class="tab" data-tab="output">Output</button>
  </nav>
  <main class="content">
    ${diagnostics}
    ${renderTransport(snapshot)}
    <section id="overview" class="pane active">${renderOverview(analysis, snapshot)}</section>
    <section id="pets" class="pane"><pre><code>${escapeHtml(analysis.petsSource || "No MathPets body found.")}</code></pre></section>
    <section id="output" class="pane">${renderGeneratedOutput(compiled)}</section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
        document.querySelectorAll(".pane").forEach((pane) => pane.classList.remove("active"));
        button.classList.add("active");
        document.getElementById(button.dataset.tab).classList.add("active");
      });
    });
    document.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({ command: button.dataset.command }));
    });
    document.querySelectorAll("[data-transport]").forEach((button) => {
      button.addEventListener("click", () => vscode.postMessage({ command: "transport", action: button.dataset.transport }));
    });
    document.querySelectorAll("[data-param]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = input.type === "checkbox" ? input.checked : Number(input.value);
        vscode.postMessage({ command: "set-param", name: input.dataset.param, value });
      });
    });
    window.addEventListener("message", (event) => {
      if (event.data?.command !== "state") return;
      const tick = document.getElementById("preview-tick");
      const status = document.getElementById("preview-status");
      const play = document.getElementById("preview-play");
      const world = document.getElementById("world-preview-container");
      if (tick) tick.textContent = "Tick " + event.data.ticks;
      if (status) status.textContent = event.data.status;
      if (play) {
        const running = event.data.status === "running";
        play.textContent = running ? "Pause" : "Play";
        play.dataset.transport = running ? "pause" : "play";
      }
      if (world && event.data.worldHtml) world.innerHTML = event.data.worldHtml;
    });
  </script>
</body>
</html>`;
}

function renderTransport(snapshot) {
  const running = snapshot?.status === "running";
  return `<div class="transport" style="display:flex;align-items:center;gap:8px;padding:10px 24px;border-bottom:1px solid var(--border)">
    <button id="preview-play" data-transport="${running ? "pause" : "play"}">${running ? "Pause" : "Play"}</button>
    <button data-transport="step">Step</button>
    <button data-transport="reset">Reset</button>
    <span id="preview-tick" class="muted">Tick ${escapeHtml(String(snapshot?.ticks ?? 0))}</span>
    <span id="preview-status" class="badge">${escapeHtml(snapshot?.status ?? "not running")}</span>
  </div>`;
}

function renderOverview(analysis, snapshot) {
  return `<div class="metric-grid">
    ${renderMetric(analysis.params.length, "Params")}
    ${renderMetric(analysis.monitors.length, "Monitors")}
    ${renderMetric(analysis.patchFields.length, "Patch fields")}
    ${renderMetric(analysis.stepSections.length, "Steps")}
  </div>
  <div class="overview">
    <div class="panel">
      <h2>World</h2>
      <div class="world">
        <div id="world-preview-container">${renderWorldSvg(analysis, snapshot)}</div>
        <dl class="kv">
          <dt>Range X</dt><dd>${escapeHtml(formatRange(analysis.world.minX, analysis.world.maxX))}</dd>
          <dt>Range Y</dt><dd>${escapeHtml(formatRange(analysis.world.minY, analysis.world.maxY))}</dd>
          <dt>Topology</dt><dd>${escapeHtml(analysis.world.topology || "unknown")}</dd>
          <dt>Setup</dt><dd>${analysis.setupStatements} statements</dd>
          <dt>Stop</dt><dd>${analysis.stopCondition ? escapeHtml(analysis.stopCondition) : "<span class=\"muted\">none</span>"}</dd>
        </dl>
      </div>
    </div>
    <div class="panel"><h2>Controls</h2>${renderControls(analysis.params, snapshot?.params)}</div>
    <div class="panel"><h2>Fields And States</h2>${renderFieldsAndStates(analysis)}</div>
    <div class="panel"><h2>Structure</h2>${renderStructure(analysis)}</div>
  </div>`;
}

function renderMetric(value, label) {
  return `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderControls(params, runtimeParams = {}) {
  if (params.length === 0) {
    return `<div class="empty">No params declared.</div>`;
  }

  return `<div class="control-list">${params.map((param) => {
    if (param.control?.kind === "slider") {
      const value = runtimeParams[param.name] ?? param.control.value;
      return `<div class="control">
        <strong>${escapeHtml(param.name)}</strong>
        <input data-param="${escapeAttribute(param.name)}" type="range" min="${escapeAttribute(param.control.min)}" max="${escapeAttribute(param.control.max)}" step="${escapeAttribute(param.control.step ?? 1)}" value="${escapeAttribute(value)}">
        <span>${escapeHtml(String(value))}</span>
      </div>`;
    }

    if (param.control?.kind === "toggle") {
      const value = runtimeParams[param.name] ?? param.control.value;
      return `<div class="control"><strong>${escapeHtml(param.name)}</strong><input data-param="${escapeAttribute(param.name)}" type="checkbox" ${value ? "checked" : ""}><span>${value ? "true" : "false"}</span></div>`;
    }

    return `<div class="control"><strong>${escapeHtml(param.name)}</strong><span class="muted">${escapeHtml(param.type)}</span><span>${escapeHtml(param.value || "")}</span></div>`;
  }).join("")}</div>`;
}

function renderFieldsAndStates(analysis) {
  const states = analysis.stateNames.length
    ? `<div class="pill-row">${analysis.stateNames.map((state, index) => {
      const color = analysis.stateColors[state] || fallbackColor(index);
      return `<span class="pill"><span class="swatch" style="background:${escapeAttribute(color)}"></span>${escapeHtml(state)}</span>`;
    }).join("")}</div>`
    : `<div class="empty">No enum states declared.</div>`;
  const fields = [...analysis.patchFields, ...analysis.memoryFields, ...analysis.monitors];
  const table = fields.length
    ? `<table><thead><tr><th>Name</th><th>Kind</th><th>Type</th><th>Initial</th></tr></thead><tbody>${fields.map((field) => `<tr><td>${escapeHtml(field.name)}</td><td>${escapeHtml(field.kind)}</td><td>${escapeHtml(field.type)}</td><td>${escapeHtml(field.value || "")}</td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">No fields declared.</div>`;
  return `<div class="symbol-list">${states}${table}</div>`;
}

function renderStructure(analysis) {
  const defRows = analysis.defs.map((def) => `<tr><td>${escapeHtml(def.name)}</td><td>function</td><td>${escapeHtml(def.signature)}</td></tr>`);
  const breedRows = analysis.pets.map((breed) => `<tr><td>${escapeHtml(breed.name)}</td><td>pet</td><td>${breed.fields.length} fields</td></tr>`);
  const stepRows = analysis.stepSections.map((step, index) => `<tr><td>step ${index + 1}</td><td>${step.staged ? "staged" : "direct"}</td><td>${step.statementCount} statements</td></tr>`);
  const rows = [...defRows, ...breedRows, ...stepRows];
  const notes = analysis.metadata.notes?.length
    ? `<div class="notes">${analysis.metadata.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</div>`
    : "";

  return `${rows.length
    ? `<table><thead><tr><th>Name</th><th>Kind</th><th>Detail</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<div class="empty">No defs, pets, or steps found.</div>`}${notes}`;
}

function renderWorldSvg(analysis, snapshot) {
  const width = Math.max(1, analysis.world.width ?? 16);
  const height = Math.max(1, analysis.world.height ?? 16);
  const columns = Math.min(18, Math.max(6, Math.round(Math.sqrt(width * 1.8))));
  const rows = Math.min(12, Math.max(5, Math.round(columns * Math.min(1.1, height / width || 1))));
  const cellWidth = 240 / columns;
  const cellHeight = 150 / rows;
  const states = analysis.stateNames.length ? analysis.stateNames : ["field"];
  const cells = [];

  if (snapshot?.patches?.length) {
    const minX = analysis.world.minX ?? 0;
    const minY = analysis.world.minY ?? 0;
    const worldWidth = Math.max(1, analysis.world.width ?? 1);
    const worldHeight = Math.max(1, analysis.world.height ?? 1);
    const patchWidth = 240 / worldWidth;
    const patchHeight = 150 / worldHeight;
    for (const patch of snapshot.patches) {
      const state = String(patch.state ?? "field");
      const index = Math.max(0, analysis.stateNames.indexOf(state));
      const color = analysis.stateColors[state] || fallbackColor(index);
      const x = (Number(patch.px) - minX) * patchWidth;
      const y = 150 - (Number(patch.py) - minY + 1) * patchHeight;
      cells.push(`<rect x="${x}" y="${y}" width="${patchWidth + 0.5}" height="${patchHeight + 0.5}" fill="${escapeAttribute(color)}"/>`);
    }
    for (const pet of snapshot.turtles ?? []) {
      const x = ((Number(pet.x) - minX + 0.5) / worldWidth) * 240;
      const y = 150 - ((Number(pet.y) - minY + 0.5) / worldHeight) * 150;
      cells.push(`<circle cx="${x}" cy="${y}" r="3" fill="#ffffff" stroke="#111827" stroke-width="1"/>`);
    }
    return `<svg class="world-svg" viewBox="0 0 240 150" role="img" aria-label="Live world preview"><rect x="0" y="0" width="240" height="150" fill="#101828"/>${cells.join("")}</svg>`;
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = (row * 7 + column * 5 + row * column) % states.length;
      const state = states[value];
      const color = analysis.stateColors[state] || continuousColor(column / Math.max(1, columns - 1), row / Math.max(1, rows - 1), value);
      cells.push(`<rect x="${column * cellWidth}" y="${row * cellHeight}" width="${cellWidth + 0.5}" height="${cellHeight + 0.5}" fill="${escapeAttribute(color)}"/>`);
    }
  }

  return `<svg class="world-svg" viewBox="0 0 240 150" role="img" aria-label="World preview"><rect x="0" y="0" width="240" height="150" fill="#101828"/>${cells.join("")}</svg>`;
}

function renderGeneratedOutput(generated) {
  const summary = `<div class="badges" style="margin:0 0 12px"><span class="badge">${escapeHtml(generated.statusLabel)}</span><span class="badge">${escapeHtml(generated.relativePath || "output.ts")}</span></div>`;
  if (!generated.content) {
    return `${summary}<div class="empty">No generated output found yet. Run Compile from this preview.</div>`;
  }

  return `${summary}<pre><code>${escapeHtml(generated.content)}</code></pre>`;
}

function analyzeCritSource(source) {
  const parsed = splitCritSource(source);
  const sections = parsed.sections;
  const petsSections = sections.filter((section) => section.name !== "styles" && section.name !== "presets");
  const petsBody = petsSections.map((section) => section.lines.join("\n")).join("\n").trim();
  const metadata = parsed.metadata;
  const modelName = metadata.name || "Untitled";
  const world = parseWorldSection(sections);
  const params = parseDeclarations(sections, "params").map((declaration) => ({
    ...declaration,
    kind: "param",
    control: parseControl(declaration.value),
  }));
  const memoryFields = parseDeclarations(sections, "memory").map((field) => ({ ...field, kind: "memory" }));
  const monitors = parseDeclarations(sections, "monitors").map((field) => ({ ...field, kind: "monitor" }));
  const patchFields = parseDeclarations(sections, "patches").map((field) => ({ ...field, kind: "patch" }));
  const pets = parsePetBreeds(sections);
  const defs = parseDefs(sections);
  const stepSections = sections
    .filter((section) => section.name === "step")
    .map((section) => ({
      staged: /\bstaged\b/.test(section.header),
      statementCount: countStatements(section.lines.slice(1)),
    }));
  const stateNames = [
    ...patchFields.flatMap((field) => extractEnumValues(field.type)),
    ...pets.flatMap((breed) => breed.fields.flatMap((field) => extractEnumValues(field.type))),
  ].filter(uniqueValue);
  const styleSource = sections.filter((section) => section.name === "styles").map((section) => section.lines.join("\n")).join("\n");

  return {
    diagnostics: parsed.diagnostics,
    metadata,
    petsSource: petsBody ? `model ${modelName}:\n\n${petsBody}\n` : "",
    world,
    params,
    memoryFields,
    monitors,
    patchFields,
    pets,
    defs,
    stepSections,
    setupStatements: countStatements(getSectionLines(sections, "setup").slice(1)),
    stopCondition: parseStopCondition(sections),
    stateNames,
    stateColors: parseStateColors(styleSource, stateNames),
  };
}

function splitCritSource(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const diagnostics = [];
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0 && !line.trim().startsWith("#"));
  const metadataLines = [];
  let index = firstContentIndex === -1 ? 0 : firstContentIndex;

  if (firstContentIndex === -1 || lines[firstContentIndex].trim() !== "model:") {
    diagnostics.push('Expected the first content line to be "model:".');
  } else {
    index = firstContentIndex + 1;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim().length > 0 && !line.trim().startsWith("#") && /^\S/.test(line)) {
        break;
      }
      metadataLines.push(line);
      index += 1;
    }
  }

  const sections = [];
  let current = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const sectionName = getTopLevelSectionName(line);

    if (sectionName) {
      current = { name: sectionName, header: trimmed, lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
      diagnostics.push(`Could not attach top-level line to a section: ${trimmed}`);
    }
  }

  return { metadata: parseMetadataBlock(metadataLines), sections, diagnostics };
}

function getTopLevelSectionName(line) {
  if (/^\s/.test(line)) {
    return null;
  }

  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }

  if (/^stop\s+when\b/.test(trimmed)) {
    return "stop";
  }

  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s+staged)?\s*:/);
  return match && TOP_LEVEL_SECTIONS.has(match[1]) && match[1] !== "model" ? match[1] : null;
}

function parseMetadataBlock(lines) {
  const metadata = { language: "mathpets", runtime: "jit", ported: true, notes: [] };
  let activeKey = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (keyMatch) {
      activeKey = keyMatch[1];
      const value = keyMatch[2] ?? "";
      if (value.length > 0) {
        metadata[activeKey] = parseScalar(value);
      } else if (activeKey === "notes") {
        metadata.notes = [];
      }
      continue;
    }

    const listMatch = line.match(/^-\s+(.+)$/);
    if (listMatch && activeKey === "notes") {
      metadata.notes.push(String(parseScalar(listMatch[1])));
    }
  }

  return metadata;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  const quoted = trimmed.match(/^(['"])(.*)\1$/);
  return quoted ? quoted[2] : trimmed;
}

function parseWorldSection(sections) {
  const text = getSectionLines(sections, "world").join("\n");
  const xMatch = text.match(/\bx\s+(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/);
  const yMatch = text.match(/\by\s+(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)/);
  const topologyMatch = text.match(/\btopology\s+([A-Za-z][A-Za-z0-9_-]*)/);
  const minX = xMatch ? Number(xMatch[1]) : null;
  const maxX = xMatch ? Number(xMatch[2]) : null;
  const minY = yMatch ? Number(yMatch[1]) : null;
  const maxY = yMatch ? Number(yMatch[2]) : null;
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: minX === null || maxX === null ? null : Math.floor(maxX - minX + 1),
    height: minY === null || maxY === null ? null : Math.floor(maxY - minY + 1),
    topology: topologyMatch?.[1] ?? null,
  };
}

function parseDeclarations(sections, name) {
  return sections
    .filter((section) => section.name === name)
    .flatMap((section) => section.lines.slice(1))
    .map((line) => line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^=]+?)\s*=\s*(.+)$/))
    .filter(Boolean)
    .map((match) => ({ name: match[1], type: match[2].trim(), value: match[3].trim() }));
}

function parseControl(value) {
  const slider = value.match(/^slider\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)(?:\s*,\s*step\s+(-?\d+(?:\.\d+)?))?\s*\)$/);
  if (slider) {
    return { kind: "slider", value: Number(slider[1]), min: Number(slider[2]), max: Number(slider[3]), step: slider[4] ? Number(slider[4]) : undefined };
  }

  const toggle = value.match(/^toggle\(\s*(true|false)\s*\)$/);
  if (toggle) {
    return { kind: "toggle", value: toggle[1] === "true" };
  }

  const select = value.match(/^select\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*\)$/);
  return select ? { kind: "select", value: select[1] } : null;
}

function parsePetBreeds(sections) {
  const breeds = [];
  for (const section of sections.filter((candidate) => candidate.name === "pets" || candidate.name === "pets")) {
    let breed = null;
    for (const rawLine of section.lines.slice(1)) {
      const line = rawLine.trim();
      const breedMatch = line.match(/^(?:pet|pet)\s+([A-Za-z][A-Za-z0-9_-]*)\s*:/);
      if (breedMatch) {
        breed = { name: breedMatch[1], fields: [] };
        breeds.push(breed);
        continue;
      }

      const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^=]+?)\s*=\s*(.+)$/);
      if (breed && fieldMatch) {
        breed.fields.push({ name: fieldMatch[1], type: fieldMatch[2].trim(), value: fieldMatch[3].trim() });
      }
    }
  }
  return breeds;
}

function parseDefs(sections) {
  return sections
    .filter((section) => section.name === "defs")
    .flatMap((section) => section.lines)
    .map((line) => line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(\(.*\)\s*:\s*.+?:\s*)$/))
    .filter(Boolean)
    .map((match) => ({ name: match[1], signature: `${match[1]}${match[2]}` }));
}

function parseStopCondition(sections) {
  const stop = sections.find((section) => section.name === "stop");
  return stop?.header.replace(/^stop\s+when\s*/, "") ?? "";
}

function parseStateColors(styleSource, stateNames) {
  const colors = {};
  let currentState = null;
  let currentIndent = 0;

  for (const rawLine of styleSource.split("\n")) {
    const keyMatch = rawLine.match(/^(\s*)([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (keyMatch) {
      const indent = keyMatch[1].length;
      const key = keyMatch[2];
      if (stateNames.includes(key)) {
        currentState = key;
        currentIndent = indent;
      } else if (currentState && indent <= currentIndent) {
        currentState = null;
      }
    }

    const colorMatch = rawLine.match(/^(\s*)color:\s*["']([^"']+)["']/);
    if (currentState && colorMatch && colorMatch[1].length > currentIndent) {
      colors[currentState] = colorMatch[2];
    }
  }

  return colors;
}

function extractEnumValues(typeSource) {
  const match = typeSource.match(/^enum\(([^)]*)\)/);
  return match ? match[1].split(",").map((value) => value.trim()).filter(Boolean) : [];
}

function countStatements(lines) {
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  }).length;
}

function getSectionLines(sections, name) {
  return sections.find((section) => section.name === name)?.lines ?? [];
}

function findCurrentSection(document, lineNumber) {
  let section = null;

  for (let index = 0; index <= lineNumber; index += 1) {
    const line = document.lineAt(index).text;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || /^\s/.test(line)) {
      continue;
    }

    const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s+staged)?\s*:/);
    if (sectionMatch && TOP_LEVEL_SECTIONS.has(sectionMatch[1])) {
      section = sectionMatch[1];
      continue;
    }

    if (/^stop\s+when\b/.test(trimmed)) {
      section = null;
    }
  }

  return section;
}

function isTopLevelPosition(document, lineNumber) {
  const line = document.lineAt(lineNumber).text;
  return line.trim().length === 0 || !/^\s/.test(line);
}

function collectSourceIndex(source) {
  const symbols = new Map();
  const enumValues = new Set();
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let section = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (!/^\s/.test(line)) {
      const sectionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)(?:\s+staged)?\s*:/);
      if (sectionMatch && TOP_LEVEL_SECTIONS.has(sectionMatch[1])) {
        section = sectionMatch[1];
        continue;
      }
    }

    const defMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*\(.*\)\s*:\s*.+?:\s*$/);
    if (section === "defs" && defMatch) {
      symbols.set(defMatch[1], { name: defMatch[1], kind: "function", detail: "function" });
      continue;
    }

    const breedMatch = trimmed.match(/^(?:pet|pet)\s+([A-Za-z][A-Za-z0-9_-]*)\s*:/);
    if ((section === "pets" || section === "pets") && breedMatch) {
      symbols.set(breedMatch[1], { name: breedMatch[1], kind: "variable", detail: "breed" });
      continue;
    }

    const letMatch = trimmed.match(/^let\s+([A-Za-z][A-Za-z0-9_-]*)\s*:/);
    if (section === "defs" && letMatch) {
      symbols.set(letMatch[1], { name: letMatch[1], kind: "variable", detail: "local" });
      continue;
    }

    const declarationMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^=]+?)\s*=/);
    if (declarationMatch) {
      const [, name, typeSource] = declarationMatch;
      symbols.set(name, { name, kind: symbolKindForSection(section), detail: typeSource.trim() });

      const enumMatch = typeSource.match(/^enum\(([^)]*)\)/);
      if (enumMatch) {
        for (const value of enumMatch[1].split(",")) {
          const enumValue = value.trim();
          if (enumValue.length > 0) {
            enumValues.add(enumValue);
          }
        }
      }
    }
  }

  return { symbols: [...symbols.values()], enumValues: [...enumValues] };
}

function symbolKindForSection(section) {
  if (section === "monitors") {
    return "property";
  }
  if (section === "patches" || section === "pets" || section === "pets") {
    return "field";
  }
  return "variable";
}

function sourceIndexToCompletions(index) {
  return [
    ...index.symbols.map((symbol) => ({
      label: symbol.name,
      kind: symbol.kind,
      detail: symbol.detail,
      documentation: "Declared in this Pet file.",
    })),
    ...index.enumValues.map((label) => ({
      label,
      kind: "constant",
      detail: "enum value",
      documentation: "Enum state declared in this Pet file.",
    })),
  ];
}

function toCompletionItem(entry, range) {
  const item = new vscode.CompletionItem(entry.label, completionKind(entry.kind));
  item.detail = entry.detail;
  item.documentation = entry.documentation ? new vscode.MarkdownString(entry.documentation) : undefined;
  item.range = range;

  if (entry.snippet) {
    item.insertText = new vscode.SnippetString(entry.insertText);
  } else if (entry.insertText) {
    item.insertText = entry.insertText;
  }

  return item;
}

function uniqueCompletions(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = `${entry.label}:${entry.detail ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

function completionKind(kind) {
  switch (kind) {
    case "class":
      return vscode.CompletionItemKind.Class;
    case "constant":
      return vscode.CompletionItemKind.Constant;
    case "field":
      return vscode.CompletionItemKind.Field;
    case "function":
      return vscode.CompletionItemKind.Function;
    case "keyword":
      return vscode.CompletionItemKind.Keyword;
    case "property":
      return vscode.CompletionItemKind.Property;
    case "snippet":
      return vscode.CompletionItemKind.Snippet;
    case "type":
      return vscode.CompletionItemKind.TypeParameter;
    case "variable":
      return vscode.CompletionItemKind.Variable;
    default:
      return vscode.CompletionItemKind.Text;
  }
}

function formatRange(min, max) {
  return min === null || max === null ? "unknown" : `${min}..${max}`;
}

function uniqueValue(value, index, values) {
  return values.indexOf(value) === index;
}

function fallbackColor(index) {
  return ["#111827", "#2563eb", "#16a34a", "#f97316", "#be123c", "#7c3aed", "#0891b2", "#ca8a04"][index % 8];
}

function continuousColor(x, y, offset) {
  const hue = Math.round(205 + x * 115 + y * 28 + offset * 17) % 360;
  const lightness = 28 + Math.round(y * 30);
  return `hsl(${hue} 72% ${lightness}%)`;
}

function getNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(String(value));
}

function snippet(label, insertText, detail, documentation) {
  return { label, insertText, detail, documentation, kind: "snippet", snippet: true };
}

function keyword(label, detail, documentation, insertText = label) {
  return { label, insertText, detail, documentation, kind: "keyword" };
}

function simple(label, kind, detail, documentation) {
  return { label, kind, detail, documentation };
}

const TOP_LEVEL_COMPLETIONS = [
  snippet("model", "model:\n  name: ${1:Name}", "section", "Declares MathPets metadata for the model."),
  snippet("defs", "defs:\n  ${1:name}(${2:value}: number): number:\n    ${2:value}", "section", "Declares reusable MathPets functions."),
  snippet("world", "world:\n  x: ${1:-25}..${2:25}\n  y: ${3:-25}..${4:25}\n  topology: ${5|box,torus,wrap-x,wrap-y|}", "section", "Defines the patch grid."),
  snippet("params", "params:\n  ${1:name}: number = slider(${2:value}, ${3:min}..${4:max})", "section", "Declares editable controls."),
  snippet("memory", "memory:\n  ${1:name}: number = ${2:value}", "section", "Declares model-owned scalar values."),
  snippet("monitors", "monitors:\n  ${1:name}: number = ${2:expression}", "section", "Declares readonly inspector values."),
  snippet("patches", "patches:\n  state: enum(${1:dead}, ${2:alive}) = ${1:dead}", "section", "Declares patch-owned fields."),
  snippet("pets", "pets:\n  pet ${1:cells}:\n    state: enum(${2:dead}, ${3:alive}) = ${2:dead}", "section", "Declares pet breeds."),
  snippet("actions", "actions:\n  ${1:random-move}:\n    ${2:turn(floor(random(50)))}", "pet", "Declares reusable pet action blocks."),
  snippet("setup", "setup:\n  patches:\n    ${1:field} <- ${2:value}", "section", "Initializes the model."),
  snippet("step staged", "step staged:\n  patches where ${1:state}:\n    state <- ${2:nextState}", "section", "Runs a staged update phase."),
  snippet("stop when", "stop when (${1:condition})", "section", "Declares an end condition."),
  snippet("styles", "styles:\n  patches:\n    default:\n      color: \"${1:#efe7d9}\"", "section", "Declares stylesheet source."),
  snippet("presets", "presets:\n  ${1:default}:\n    label: ${2:Default}\n    values:\n      ${3:param}: ${4:value}", "section", "Declares preset source."),
];

const MODEL_COMPLETIONS = [
  simple("name", "property", "metadata", "Model display name."),
  simple("language", "property", "metadata", "Usually mathpets."),
  simple("runtime", "property", "metadata", "Usually jit."),
  simple("ported", "property", "metadata", "Whether this model is ported."),
  simple("notes", "property", "metadata", "List of model notes."),
  simple("mathpets", "constant", "language"),
  simple("jit", "constant", "runtime"),
  simple("true", "constant", "boolean"),
  simple("false", "constant", "boolean"),
];

const WORLD_COMPLETIONS = [
  snippet("x", "x: ${1:-25}..${2:25}", "range", "Horizontal patch coordinate bounds."),
  snippet("y", "y: ${1:-25}..${2:25}", "range", "Vertical patch coordinate bounds."),
  snippet("topology", "topology: ${1|box,torus,wrap-x,wrap-y|}", "world", "Controls world edge behavior."),
  simple("box", "constant", "topology"),
  simple("torus", "constant", "topology"),
  simple("wrap-x", "constant", "topology"),
  simple("wrap-y", "constant", "topology"),
];

const TYPE_COMPLETIONS = [
  simple("number", "type", "type"),
  simple("boolean", "type", "type"),
  simple("string", "type", "type"),
  snippet("enum", "enum(${1:value})", "type", "Finite set of named values."),
];

const DECLARATION_COMPLETIONS = [
  snippet("number field", "${1:name}: number = ${2:0}", "declaration", "Declares a numeric value."),
  snippet("boolean field", "${1:name}: boolean = ${2|true,false|}", "declaration", "Declares a boolean value."),
  snippet("enum field", "${1:state}: enum(${2:dead}, ${3:alive}) = ${2:dead}", "declaration", "Declares enum-backed state."),
];

const DEF_COMPLETIONS = [
  snippet("function", "${1:name}(${2:value}: number): ${3:number}:\n  ${2:value}", "function", "Declares a reusable expression function."),
  snippet("let", "let ${1:name}: ${2:number} = ${3:expression}", "local", "Declares a local value inside a function."),
  keyword("return", "statement", "Returns from a function."),
];

const PET_COMPLETIONS = [
  snippet("pet", "pet ${1:cells}:\n  state: enum(${2:dead}, ${3:alive}) = ${2:dead}", "breed", "Declares a pet breed."),
  snippet("actions", "actions:\n  ${1:random-move}:\n    ${2:turn(floor(random(50)))}", "actions", "Declares reusable pet action blocks."),
];

const CONTROL_COMPLETIONS = [
  snippet("slider", "slider(${1:value}, ${2:min}..${3:max})", "control", "Creates a numeric slider."),
  snippet("slider step", "slider(${1:value}, ${2:min}..${3:max}, step ${4:1})", "control", "Creates a stepped numeric slider."),
  snippet("toggle", "toggle(${1|true,false|})", "control", "Creates a boolean toggle."),
  snippet("select", "select(${1:value})", "control", "Creates an enum dropdown."),
];

const STATEMENT_COMPLETIONS = [
  snippet("patches", "patches:\n  ${1:field} <- ${2:value}", "update", "Updates every patch."),
  snippet("patches where", "patches where (${1:condition}):\n  ${2:field} <- ${3:value}", "update", "Updates matching patches."),
  snippet("patches where block", "patches where (${1:condition}):\n  ${2:field} <- ${3:value}\n  ${4:nextField} <- ${5:nextValue}", "update block", "Runs multiple actions for each matching patch."),
  snippet("multi assignment", "${1:patch-here()} <- :\n  ${2:state}: ${3:value}", "assignment block", "Assigns several fields on one target."),
  snippet("create", "create ${1:breed} ${2:count}", "statement", "Creates pets of a breed."),
  snippet("repeat", "repeat ${1:3}:\n  ${2:statement}", "loop", "Runs an indented block a fixed number of times."),
  snippet("if", "if (${1:condition}) then ${2:trueValue} else ${3:falseValue}", "expression", "Chooses between two values."),
  snippet("count patches where", "count patches where ${1:state}", "reporter", "Counts patches matching a predicate."),
  snippet("count neighbors8 where", "count neighbors8 where ${1:state}", "reporter", "Counts adjacent patches."),
  snippet("count neighbors-at where", "count neighbors-at(${1:top-left, top, top-right}) where ${2:state}", "reporter", "Counts selected neighboring patches."),
  snippet("count breed where around", "count ${1:breed} where (${2:condition}) around (${3:x}, ${4:y})", "reporter", "Counts breed members on surrounding patches."),
  snippet("any neighbors4 where", "any neighbors4 where ${1:state}", "reporter", "Checks four-neighbor matches."),
  snippet("neighbor-at", "neighbor-at(${1:top}).${2:field}", "lookup", "Reads a directed neighboring patch."),
  snippet("patch-at", "patch-at(${1:x}, ${2:y}).${3:field}", "lookup", "Reads a field from a patch."),
  snippet("pet-at", "pet-at(${1:breed}, ${2:x}, ${3:y}).${4:field}", "lookup", "Reads a field from a pet at a coordinate."),
];

const EXPRESSION_COMPLETIONS = [
  simple("true", "constant", "boolean"),
  simple("false", "constant", "boolean"),
  keyword("and", "logic", "Logical and."),
  keyword("or", "logic", "Logical or."),
  keyword("not", "logic", "Logical negation."),
  keyword("in", "set", "Checks set membership."),
  keyword("where", "filter", "Filters an agentset."),
  keyword("repeat", "loop", "Runs an indented block a fixed number of times."),
  simple("patches", "variable", "agentset"),
  simple("pets", "variable", "agentset"),
  simple("pets", "variable", "legacy agentset"),
  simple("turtles", "variable", "legacy agentset"),
  simple("neighbors4", "variable", "agentset"),
  simple("neighbors8", "variable", "agentset"),
  simple("neighbor-at", "function", "lookup"),
  simple("neighbors-at", "function", "agentset"),
  simple("top-left", "constant", "direction"),
  simple("top", "constant", "direction"),
  simple("top-right", "constant", "direction"),
  simple("left", "constant", "direction"),
  simple("right", "constant", "direction"),
  simple("bottom-left", "constant", "direction"),
  simple("bottom", "constant", "direction"),
  simple("bottom-right", "constant", "direction"),
  simple("px", "property", "patch"),
  simple("py", "property", "patch"),
  simple("x", "property", "pet"),
  simple("y", "property", "pet"),
  simple("id", "property", "pet"),
  simple("heading", "property", "pet"),
  simple("min-x", "constant", "world"),
  simple("max-x", "constant", "world"),
  simple("min-y", "constant", "world"),
  simple("max-y", "constant", "world"),
  ...[
    "floor",
    "ceil",
    "round",
    "abs",
    "min",
    "max",
    "sqrt",
    "pow",
    "sin",
    "cos",
    "tan",
    "clamp",
    "random-float",
    "random-int",
    "random",
  ].map((label) => snippet(label, `${label}($1)`, "builtin", "Built-in MathPets function.")),
];

const STYLE_COMPLETIONS = [
  simple("patches", "property", "style"),
  simple("pets", "property", "style"),
  simple("pets", "property", "legacy style"),
  simple("default", "property", "style"),
  simple("states", "property", "style"),
  simple("fields", "property", "style"),
  simple("color", "property", "style"),
  simple("transition", "property", "style"),
  simple("scale", "property", "style"),
  simple("domain", "property", "style"),
  simple("range", "property", "style"),
  ...["viridis", "inferno", "magma", "plasma", "cividis", "turbo", "warm", "cool", "cubehelix", "rainbow", "sinebow"].map((label) =>
    simple(label, "constant", "color scale"),
  ),
];

const PRESET_COMPLETIONS = [
  simple("label", "property", "preset"),
  simple("values", "property", "preset"),
  simple("default", "constant", "preset"),
];

module.exports = {
  activate,
  deactivate,
};
