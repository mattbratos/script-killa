import * as vscode from 'vscode';
import { parseFountainDialogue, getBaseCharacterName } from './fountainParser';
import {
	DialogueBlock,
	TeleprompterConfig,
	ExtensionToWebviewMessage,
	WebviewToExtensionMessage,
} from './types';

export class TeleprompterPanel {
	public static readonly viewType = 'scriptKilla.teleprompter';

	/** Track one panel per document URI */
	private static panels = new Map<string, TeleprompterPanel>();

	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private document: vscode.TextDocument;
	private disposables: vscode.Disposable[] = [];

	/** Current parsed blocks — used to map edits back to source */
	private currentBlocks: DialogueBlock[] = [];

	/** Flag to suppress re-parse when we ourselves triggered the document change */
	private isSelfEdit = false;

	/** Debounce timer for document change events */
	private updateTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Create or reveal a teleprompter panel for the given document.
	 */
	public static createOrShow(
		extensionUri: vscode.Uri,
		document: vscode.TextDocument,
	): TeleprompterPanel {
		const key = document.uri.toString();
		const existing = TeleprompterPanel.panels.get(key);

		if (existing) {
			existing.panel.reveal(vscode.ViewColumn.Beside);
			return existing;
		}

		const panel = vscode.window.createWebviewPanel(
			TeleprompterPanel.viewType,
			`Teleprompter: ${fileName(document)}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
				retainContextWhenHidden: true,
			},
		);

		const instance = new TeleprompterPanel(panel, extensionUri, document);
		TeleprompterPanel.panels.set(key, instance);
		return instance;
	}

	private constructor(
		panel: vscode.WebviewPanel,
		extensionUri: vscode.Uri,
		document: vscode.TextDocument,
	) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.document = document;

		// Set the webview HTML content
		this.panel.webview.html = this.getHtmlForWebview();

		// Listen for messages from the webview
		this.panel.webview.onDidReceiveMessage(
			(msg: WebviewToExtensionMessage) => this.onDidReceiveMessage(msg),
			null,
			this.disposables,
		);

		// Listen for document changes (from the text editor or other sources)
		vscode.workspace.onDidChangeTextDocument(
			(e) => {
				if (e.document.uri.toString() === this.document.uri.toString()) {
					this.onDocumentChanged();
				}
			},
			null,
			this.disposables,
		);

		// Listen for document close
		vscode.workspace.onDidCloseTextDocument(
			(doc) => {
				if (doc.uri.toString() === this.document.uri.toString()) {
					this.panel.dispose();
				}
			},
			null,
			this.disposables,
		);

		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(
			(e) => {
				if (e.affectsConfiguration('script-killa')) {
					this.sendSettings();
					this.update();
				}
			},
			null,
			this.disposables,
		);

		// Cleanup on panel close
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	/**
	 * Parse the document and send updated dialogue blocks to the webview.
	 */
	public update(): void {
		const text = this.document.getText();
		this.currentBlocks = parseFountainDialogue(text);

		const config = getConfig();
		const msg: ExtensionToWebviewMessage = {
			type: 'updateBlocks',
			blocks: this.currentBlocks,
			hiddenCharacters: config.hiddenCharacters.map(c => c.toUpperCase()),
		};

		this.panel.webview.postMessage(msg);
	}

	/**
	 * Send current settings to the webview.
	 */
	private sendSettings(): void {
		const config = getConfig();
		const msg: ExtensionToWebviewMessage = {
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
	private async onDidReceiveMessage(msg: WebviewToExtensionMessage): Promise<void> {
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
	private async applyEdit(blockId: number, newText: string): Promise<void> {
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
			this.currentBlocks = parseFountainDialogue(text);

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
	private onDocumentChanged(): void {
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
	private dispose(): void {
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
	private getHtmlForWebview(): string {
		const webview = this.panel.webview;

		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'teleprompter.css'),
		);
		const jsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'media', 'teleprompter.js'),
		);

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
	<div id="toolbar">
		<div class="toolbar-group">
			<button id="btn-play" title="Play / Pause (Space)">> play</button>
		</div>
		<div class="toolbar-separator"></div>
		<div class="toolbar-group">
			<label>spd</label>
			<input type="range" id="speed-slider" min="0" max="100" value="20" step="1">
			<span class="mono-value" id="speed-value">20</span>
		</div>
		<div class="toolbar-separator"></div>
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
			<label>
				<input type="checkbox" id="mirror-toggle">
				mirror
			</label>
		</div>
	</div>

	<div id="reading-guide"></div>

	<div id="teleprompter-container">
		<div id="dialogue-area"></div>
	</div>

	<div id="status-bar">
		<div><span class="status-dot" id="status-dot"></span><span id="status-text">ready</span></div>
		<div id="block-count">--</div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
	}
}

/** Read extension configuration */
function getConfig(): TeleprompterConfig {
	const cfg = vscode.workspace.getConfiguration('script-killa');
	return {
		hiddenCharacters: cfg.get<string[]>('hiddenCharacters', ['MATT']),
		fontSize: cfg.get<number>('fontSize', 32),
		fontFamily: cfg.get<string>('fontFamily', "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace"),
		scrollSpeed: cfg.get<number>('scrollSpeed', 20),
	};
}

/** Extract filename from a TextDocument */
function fileName(doc: vscode.TextDocument): string {
	const parts = doc.uri.path.split('/');
	return parts[parts.length - 1] || 'Untitled';
}

/** Generate a random nonce for CSP */
function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
