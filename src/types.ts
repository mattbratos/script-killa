/** Source range tracking for mapping webview edits back to the .fountain file */
export interface SourceRange {
	/** Byte offset of the start of the dialogue text in the source file */
	startOffset: number;
	/** Byte offset of the end of the dialogue text in the source file */
	endOffset: number;
}

/** A single dialogue block extracted from a Fountain file */
export interface DialogueBlock {
	/** Stable identifier — line number of the character cue (0-based) */
	id: number;
	/** The character name (UPPERCASE), may include extensions like (V.O.) */
	characterName: string;
	/** Optional parenthetical, e.g. "(whispering)" */
	parenthetical: string | null;
	/** The dialogue text lines (may contain newlines) */
	dialogueText: string;
	/** Where the dialogue text lives in the source file (for write-back) */
	sourceRange: SourceRange;
}

// --- Messages between extension host and webview ---

export interface UpdateBlocksMessage {
	type: 'updateBlocks';
	blocks: DialogueBlock[];
	hiddenCharacters: string[];
}

export interface UpdateSettingsMessage {
	type: 'updateSettings';
	fontSize: number;
	fontFamily: string;
	scrollSpeed: number;
	hiddenCharacters: string[];
}

export interface EditConfirmMessage {
	type: 'editConfirm';
	blockId: number;
}

/** Messages sent from extension host TO the webview */
export type ExtensionToWebviewMessage =
	| UpdateBlocksMessage
	| UpdateSettingsMessage
	| EditConfirmMessage;

export interface EditMessage {
	type: 'edit';
	blockId: number;
	newText: string;
}

export interface ReadyMessage {
	type: 'ready';
}

/** Messages sent from the webview TO the extension host */
export type WebviewToExtensionMessage =
	| EditMessage
	| ReadyMessage;

/** Extension configuration (contributes.configuration) */
export interface TeleprompterConfig {
	hiddenCharacters: string[];
	fontSize: number;
	fontFamily: string;
	scrollSpeed: number;
}
