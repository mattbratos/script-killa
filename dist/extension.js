"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/teleprompterPanel.ts
var vscode = __toESM(require("vscode"));

// src/fountainParser.ts
var SCENE_HEADING_PREFIXES = [
  "INT.",
  "EXT.",
  "EST.",
  "INT./EXT.",
  "INT/EXT.",
  "I/E.",
  "INT ",
  "EXT ",
  "EST ",
  "INT./EXT ",
  "INT/EXT ",
  "I/E "
];
function isSceneHeading(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(".") && !trimmed.startsWith("..")) {
    return true;
  }
  const upper = trimmed.toUpperCase();
  return SCENE_HEADING_PREFIXES.some((prefix) => upper.startsWith(prefix));
}
function isTransition(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith(">") && !trimmed.endsWith("<")) {
    return true;
  }
  return /^[A-Z\s.]+TO:$/.test(trimmed);
}
function isCharacterCue(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith("@")) {
    return trimmed.length > 1;
  }
  if (!/[A-Z]/.test(trimmed)) {
    return false;
  }
  const withoutExtension = trimmed.replace(/\s*\^$/, "").replace(/\s*\(.*?\)\s*$/, "").trim();
  if (withoutExtension.length === 0) {
    return false;
  }
  if (!/^[A-Z0-9\s.\-']+$/.test(withoutExtension)) {
    return false;
  }
  if (isSceneHeading(trimmed)) {
    return false;
  }
  if (isTransition(trimmed)) {
    return false;
  }
  return true;
}
function isParenthetical(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("(") && trimmed.endsWith(")");
}
function isBlank(line) {
  return line.trim().length === 0;
}
function isBoneyardStart(line) {
  return line.includes("/*");
}
function isBoneyardEnd(line) {
  return line.includes("*/");
}
function parseFountainDialogue(text) {
  const blocks = [];
  const lines = text.split("\n");
  let inBoneyard = false;
  let inTitlePage = true;
  let currentOffset = 0;
  let state = "idle";
  let currentBlock = null;
  let dialogueStartOffset = 0;
  let dialogueLines = [];
  function finishBlock() {
    if (currentBlock && dialogueLines.length > 0) {
      const dialogueText = dialogueLines.join("\n");
      currentBlock.dialogueText = dialogueText;
      const endOffset = dialogueStartOffset + dialogueText.length;
      currentBlock.sourceRange = {
        startOffset: dialogueStartOffset,
        endOffset
      };
      blocks.push(currentBlock);
    }
    state = "idle";
    currentBlock = null;
    dialogueLines = [];
    dialogueStartOffset = 0;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineOffset = currentOffset;
    currentOffset += line.length + (i < lines.length - 1 ? 1 : 0);
    if (inBoneyard) {
      if (isBoneyardEnd(line)) {
        inBoneyard = false;
      }
      continue;
    }
    if (isBoneyardStart(line)) {
      if (isBoneyardEnd(line) && line.indexOf("*/") > line.indexOf("/*")) {
        continue;
      }
      inBoneyard = true;
      finishBlock();
      continue;
    }
    if (inTitlePage) {
      if (isBlank(line)) {
        inTitlePage = false;
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      finishBlock();
      continue;
    }
    if (trimmed.startsWith("=") && !trimmed.startsWith("===")) {
      continue;
    }
    if (/^={3,}$/.test(trimmed)) {
      finishBlock();
      continue;
    }
    if (trimmed.startsWith(">") && trimmed.endsWith("<")) {
      finishBlock();
      continue;
    }
    if (trimmed.startsWith("~")) {
      continue;
    }
    switch (state) {
      case "idle": {
        if (i > 0 && isBlank(lines[i - 1]) && !isBlank(line) && isCharacterCue(line)) {
          let charName = trimmed;
          charName = charName.replace(/\s*\^$/, "").trim();
          if (charName.startsWith("@")) {
            charName = charName.substring(1).trim();
          }
          currentBlock = {
            id: i,
            characterName: charName,
            parenthetical: null,
            dialogueText: "",
            sourceRange: { startOffset: 0, endOffset: 0 }
          };
          state = "character";
        }
        break;
      }
      case "character": {
        if (isBlank(line)) {
          finishBlock();
        } else if (isParenthetical(line)) {
          currentBlock.parenthetical = trimmed;
          state = "parenthetical";
        } else {
          dialogueStartOffset = lineOffset;
          dialogueLines = [line];
          state = "dialogue";
        }
        break;
      }
      case "parenthetical": {
        if (isBlank(line)) {
          finishBlock();
        } else {
          dialogueStartOffset = lineOffset;
          dialogueLines = [line];
          state = "dialogue";
        }
        break;
      }
      case "dialogue": {
        if (isBlank(line)) {
          finishBlock();
        } else {
          dialogueLines.push(line);
        }
        break;
      }
    }
  }
  finishBlock();
  return blocks;
}

// src/teleprompterPanel.ts
var TeleprompterPanel = class _TeleprompterPanel {
  static viewType = "scriptKilla.teleprompter";
  /** Track one panel per document URI */
  static panels = /* @__PURE__ */ new Map();
  panel;
  extensionUri;
  document;
  disposables = [];
  /** Current parsed blocks — used to map edits back to source */
  currentBlocks = [];
  /** Flag to suppress re-parse when we ourselves triggered the document change */
  isSelfEdit = false;
  /** Debounce timer for document change events */
  updateTimer;
  /**
   * Create or reveal a teleprompter panel for the given document.
   */
  static createOrShow(extensionUri, document) {
    const key = document.uri.toString();
    const existing = _TeleprompterPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      _TeleprompterPanel.viewType,
      `Teleprompter: ${fileName(document)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
        retainContextWhenHidden: true
      }
    );
    const instance = new _TeleprompterPanel(panel, extensionUri, document);
    _TeleprompterPanel.panels.set(key, instance);
    return instance;
  }
  constructor(panel, extensionUri, document) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.document = document;
    this.panel.webview.html = this.getHtmlForWebview();
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onDidReceiveMessage(msg),
      null,
      this.disposables
    );
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === this.document.uri.toString()) {
          this.onDocumentChanged();
        }
      },
      null,
      this.disposables
    );
    vscode.workspace.onDidCloseTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.document.uri.toString()) {
          this.panel.dispose();
        }
      },
      null,
      this.disposables
    );
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("script-killa")) {
          this.sendSettings();
          this.update();
        }
      },
      null,
      this.disposables
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }
  /**
   * Parse the document and send updated dialogue blocks to the webview.
   */
  update() {
    const text = this.document.getText();
    this.currentBlocks = parseFountainDialogue(text);
    const config = getConfig();
    const msg = {
      type: "updateBlocks",
      blocks: this.currentBlocks,
      hiddenCharacters: config.hiddenCharacters.map((c) => c.toUpperCase())
    };
    this.panel.webview.postMessage(msg);
  }
  /**
   * Send current settings to the webview.
   */
  sendSettings() {
    const config = getConfig();
    const msg = {
      type: "updateSettings",
      fontSize: config.fontSize,
      fontFamily: config.fontFamily,
      scrollSpeed: config.scrollSpeed,
      hiddenCharacters: config.hiddenCharacters.map((c) => c.toUpperCase())
    };
    this.panel.webview.postMessage(msg);
  }
  /**
   * Handle messages from the webview.
   */
  async onDidReceiveMessage(msg) {
    switch (msg.type) {
      case "ready":
        this.sendSettings();
        this.update();
        break;
      case "edit":
        await this.applyEdit(msg.blockId, msg.newText);
        break;
    }
  }
  /**
   * Apply an edit from the webview back to the source .fountain document.
   */
  async applyEdit(blockId, newText) {
    const block = this.currentBlocks.find((b) => b.id === blockId);
    if (!block) {
      return;
    }
    const startPos = this.document.positionAt(block.sourceRange.startOffset);
    const endPos = this.document.positionAt(block.sourceRange.endOffset);
    const range = new vscode.Range(startPos, endPos);
    this.isSelfEdit = true;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, range, newText);
    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      await this.document.save();
      const text = this.document.getText();
      this.currentBlocks = parseFountainDialogue(text);
      this.panel.webview.postMessage({
        type: "editConfirm",
        blockId
      });
    }
    this.isSelfEdit = false;
  }
  /**
   * Debounced handler for when the underlying document changes.
   */
  onDocumentChanged() {
    if (this.isSelfEdit) {
      return;
    }
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => {
      this.update();
    }, 300);
  }
  /**
   * Cleanup all resources.
   */
  dispose() {
    const key = this.document.uri.toString();
    _TeleprompterPanel.panels.delete(key);
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
  /**
   * Build the full HTML for the webview, referencing CSS/JS from media/.
   */
  getHtmlForWebview() {
    const webview = this.panel.webview;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "teleprompter.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "teleprompter.js")
    );
    const nonce = getNonce();
    return (
      /* html */
      `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none';
			style-src ${webview.cspSource} 'unsafe-inline';
			script-src 'nonce-${nonce}';
			font-src ${webview.cspSource};">
	<link href="${cssUri}" rel="stylesheet">
	<title>Teleprompter</title>
</head>
<body>
	<!-- Top toolbar: display settings -->
	<div id="toolbar">
		<div class="toolbar-group">
			<label>width</label>
			<input type="range" id="width-slider" min="200" max="1200" value="600" step="25">
			<span class="mono-value" id="width-value">600</span>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>size</label>
			<button id="btn-size-down" title="Decrease font size">-</button>
			<span class="mono-value" id="font-size-value">32</span>
			<button id="btn-size-up" title="Increase font size">+</button>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>font</label>
			<select id="font-select">
				<option value="'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace" selected>Mono</option>
				<option value="'Inter', 'Segoe UI', system-ui, sans-serif">Sans</option>
				<option value="'Georgia', 'Times New Roman', serif">Serif</option>
				<option value="'Courier New', 'Courier', monospace">Courier</option>
				<option value="monospace">System Mono</option>
			</select>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>align</label>
			<button id="btn-align-left" class="align-btn active" title="Align left">L</button>
			<button id="btn-align-center" class="align-btn" title="Align center">C</button>
			<button id="btn-align-right" class="align-btn" title="Align right">R</button>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>guide</label>
			<input type="range" id="guide-slider" min="10" max="80" value="35" step="1">
			<span class="mono-value" id="guide-value">35</span><span class="mono-value">%</span>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>
				<input type="checkbox" id="mirror-toggle">
				mirror
			</label>
		</div>
	</div>

	<!-- Dim overlay above reading line -->
	<div id="dim-overlay"></div>

	<!-- Reading guide line -->
	<div id="reading-guide"></div>

	<!-- Reading position indicator (arrow on left) -->
	<div id="reading-indicator">
		<svg width="28" height="28" viewBox="0 0 28 28">
			<polygon points="0,6 22,14 0,22" fill="#00ff88" opacity="0.7"/>
		</svg>
	</div>

	<!-- Main scroll area -->
	<div id="teleprompter-container">
		<div id="dialogue-area"></div>
	</div>

	<!-- Bottom control bar: play, speed, status -->
	<div id="bottom-bar">
		<div class="bottom-status">
			<span class="status-dot" id="status-dot"></span>
			<span id="status-text">ready</span>
		</div>

		<div class="bottom-group">
			<label>spd</label>
			<input type="range" id="bottom-speed-slider" min="0" max="100" value="20" step="1">
			<span class="mono-value" id="bottom-speed-value">20</span>
		</div>

		<button id="btn-play-main" title="Play / Pause (Space)">
			<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>
		</button>

		<div class="bottom-info" id="block-count">--</div>

		<span class="spacebar-hint">space</span>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`
    );
  }
};
function getConfig() {
  const cfg = vscode.workspace.getConfiguration("script-killa");
  return {
    hiddenCharacters: cfg.get("hiddenCharacters", ["MATT"]),
    fontSize: cfg.get("fontSize", 32),
    fontFamily: cfg.get("fontFamily", "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"),
    scrollSpeed: cfg.get("scrollSpeed", 20)
  };
}
function fileName(doc) {
  const parts = doc.uri.path.split("/");
  return parts[parts.length - 1] || "Untitled";
}
function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// src/extension.ts
function activate(context) {
  console.log("script-killa: extension activated");
  const openTeleprompter = vscode2.commands.registerCommand(
    "script-killa.openTeleprompter",
    () => {
      const editor = vscode2.window.activeTextEditor;
      if (!editor) {
        vscode2.window.showWarningMessage(
          "Open a .fountain file first to launch the teleprompter."
        );
        return;
      }
      const doc = editor.document;
      if (!doc.fileName.endsWith(".fountain")) {
        vscode2.window.showWarningMessage(
          "The active file is not a .fountain file."
        );
        return;
      }
      TeleprompterPanel.createOrShow(context.extensionUri, doc);
    }
  );
  context.subscriptions.push(openTeleprompter);
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
