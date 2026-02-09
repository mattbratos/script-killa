"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeleprompterPanel = void 0;
const vscode = __importStar(require("vscode"));
const fountainParser_1 = require("./fountainParser");
class TeleprompterPanel {
    static viewType = 'scriptKilla.teleprompter';
    /** Track one panel per document URI */
    static panels = new Map();
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
        const existing = TeleprompterPanel.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            return existing;
        }
        const panel = vscode.window.createWebviewPanel(TeleprompterPanel.viewType, `Teleprompter: ${fileName(document)}`, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            retainContextWhenHidden: true,
        });
        // Move to a new editor group so it can be popped out to its own window
        vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
        const instance = new TeleprompterPanel(panel, extensionUri, document);
        TeleprompterPanel.panels.set(key, instance);
        return instance;
    }
    constructor(panel, extensionUri, document) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.document = document;
        // Set the webview HTML content
        this.panel.webview.html = this.getHtmlForWebview();
        // Listen for messages from the webview
        this.panel.webview.onDidReceiveMessage((msg) => this.onDidReceiveMessage(msg), null, this.disposables);
        // Listen for document changes (from the text editor or other sources)
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === this.document.uri.toString()) {
                this.onDocumentChanged();
            }
        }, null, this.disposables);
        // Listen for document close
        vscode.workspace.onDidCloseTextDocument((doc) => {
            if (doc.uri.toString() === this.document.uri.toString()) {
                this.panel.dispose();
            }
        }, null, this.disposables);
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('script-killa')) {
                this.sendSettings();
                this.update();
            }
        }, null, this.disposables);
        // Cleanup on panel close
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    /**
     * Parse the document and send updated dialogue blocks to the webview.
     */
    update() {
        const text = this.document.getText();
        this.currentBlocks = (0, fountainParser_1.parseFountainDialogue)(text);
        const config = getConfig();
        const msg = {
            type: 'updateBlocks',
            blocks: this.currentBlocks,
            hiddenCharacters: config.hiddenCharacters.map(c => c.toUpperCase()),
        };
        this.panel.webview.postMessage(msg);
    }
    /**
     * Send current settings to the webview.
     */
    sendSettings() {
        const config = getConfig();
        const msg = {
            type: 'updateSettings',
            fontSize: config.fontSize,
            fontFamily: config.fontFamily,
            scrollSpeed: config.scrollSpeed,
            hiddenCharacters: config.hiddenCharacters.map(c => c.toUpperCase()),
        };
        this.panel.webview.postMessage(msg);
    }
    /**
     * Handle messages from the webview.
     */
    async onDidReceiveMessage(msg) {
        switch (msg.type) {
            case 'ready':
                // Webview is ready, send initial data
                this.sendSettings();
                this.update();
                break;
            case 'edit':
                await this.applyEdit(msg.blockId, msg.newText);
                break;
        }
    }
    /**
     * Apply an edit from the webview back to the source .fountain document.
     */
    async applyEdit(blockId, newText) {
        const block = this.currentBlocks.find(b => b.id === blockId);
        if (!block) {
            return;
        }
        const startPos = this.document.positionAt(block.sourceRange.startOffset);
        const endPos = this.document.positionAt(block.sourceRange.endOffset);
        const range = new vscode.Range(startPos, endPos);
        // Set flag so the document-change listener skips re-parse
        this.isSelfEdit = true;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, range, newText);
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            // Save the document silently
            await this.document.save();
            // Re-parse after our own edit so offsets stay fresh
            const text = this.document.getText();
            this.currentBlocks = (0, fountainParser_1.parseFountainDialogue)(text);
            // Confirm the edit to the webview
            this.panel.webview.postMessage({
                type: 'editConfirm',
                blockId,
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
        TeleprompterPanel.panels.delete(key);
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
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'teleprompter.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'teleprompter.js'));
        const nonce = getNonce();
        return /* html */ `<!DOCTYPE html>
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
	<!-- Invisible hover zone to reveal toolbar -->
	<div id="toolbar-trigger"></div>

	<!-- Top toolbar: display settings (hidden by default) -->
	<div id="toolbar">
		<div class="toolbar-group">
			<label>width</label>
			<button class="step-btn" id="btn-width-down" title="Narrower (-50)">-</button>
			<input type="range" id="width-slider" min="200" max="1200" value="600" step="25">
			<span class="mono-value" id="width-value">600</span>
			<button class="step-btn" id="btn-width-up" title="Wider (+50)">+</button>
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
			<button class="step-btn" id="btn-guide-down" title="Higher (-5%)">-</button>
			<input type="range" id="guide-slider" min="10" max="80" value="35" step="1">
			<span class="mono-value" id="guide-value">35</span><span class="mono-value">%</span>
			<button class="step-btn" id="btn-guide-up" title="Lower (+5%)">+</button>
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
			<polygon points="0,6 22,14 0,22" fill="#ffffff" opacity="0.7"/>
		</svg>
	</div>

	<!-- Main scroll area -->
	<div id="teleprompter-container">
		<div id="dialogue-area"></div>
	</div>

	<!-- Invisible hover zone to reveal bottom bar -->
	<div id="bottom-trigger"></div>

	<!-- Bottom control bar: play, speed, status (hidden by default) -->
	<div id="bottom-bar">
		<div class="bottom-status">
			<span class="status-dot" id="status-dot"></span>
			<span id="status-text">ready</span>
		</div>

		<div class="bottom-group">
			<label>spd</label>
			<button class="speed-btn" id="btn-speed-down" title="Slower (-5)">-</button>
			<input type="range" id="bottom-speed-slider" min="0" max="100" value="20" step="1">
			<span class="mono-value" id="bottom-speed-value">20</span>
			<button class="speed-btn" id="btn-speed-up" title="Faster (+5)">+</button>
		</div>

		<button id="btn-play-main" title="Play / Pause (Space)">
			<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>
		</button>

		<div class="bottom-info" id="block-count">--</div>

		<span class="spacebar-hint">space</span>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }
}
exports.TeleprompterPanel = TeleprompterPanel;
/** Read extension configuration */
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('script-killa');
    return {
        hiddenCharacters: cfg.get('hiddenCharacters', ['MATT']),
        fontSize: cfg.get('fontSize', 32),
        fontFamily: cfg.get('fontFamily', "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"),
        scrollSpeed: cfg.get('scrollSpeed', 20),
    };
}
/** Extract filename from a TextDocument */
function fileName(doc) {
    const parts = doc.uri.path.split('/');
    return parts[parts.length - 1] || 'Untitled';
}
/** Generate a random nonce for CSP */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=teleprompterPanel.js.map