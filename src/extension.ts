import * as vscode from 'vscode';
import { TeleprompterPanel } from './teleprompterPanel';

export function activate(context: vscode.ExtensionContext) {
	console.log('script-killa: extension activated');

	// Command: Open Teleprompter
	const openTeleprompter = vscode.commands.registerCommand(
		'script-killa.openTeleprompter',
		() => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage(
					'Open a .fountain file first to launch the teleprompter.',
				);
				return;
			}

			const doc = editor.document;
			if (!doc.fileName.endsWith('.fountain')) {
				vscode.window.showWarningMessage(
					'The active file is not a .fountain file.',
				);
				return;
			}

			TeleprompterPanel.createOrShow(context.extensionUri, doc);
		},
	);

	context.subscriptions.push(openTeleprompter);
}

export function deactivate() {}
