import { DialogueBlock, SourceRange } from './types';

/**
 * Scene heading prefixes (case-insensitive).
 * A line starting with any of these followed by a dot or space is a scene heading.
 */
const SCENE_HEADING_PREFIXES = [
	'INT.', 'EXT.', 'EST.', 'INT./EXT.', 'INT/EXT.', 'I/E.',
	'INT ', 'EXT ', 'EST ', 'INT./EXT ', 'INT/EXT ', 'I/E ',
];

/** Returns true if the line is a scene heading */
function isSceneHeading(line: string): boolean {
	const trimmed = line.trimStart();
	// Forced scene heading: starts with a single period (not "..")
	if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
		return true;
	}
	const upper = trimmed.toUpperCase();
	return SCENE_HEADING_PREFIXES.some(prefix => upper.startsWith(prefix));
}

/** Returns true if the line is a transition (all-caps ending in TO:) */
function isTransition(line: string): boolean {
	const trimmed = line.trim();
	// Forced transition: starts with >
	if (trimmed.startsWith('>') && !trimmed.endsWith('<')) {
		return true;
	}
	// Standard transition: all uppercase, ends with TO:
	return /^[A-Z\s.]+TO:$/.test(trimmed);
}

/** Returns true if the line looks like a character cue */
function isCharacterCue(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return false;
	}

	// Forced character: starts with @
	if (trimmed.startsWith('@')) {
		return trimmed.length > 1;
	}

	// Must contain at least one letter
	if (!/[A-Z]/.test(trimmed)) {
		return false;
	}

	// Strip character extensions like (V.O.), (O.S.), (CONT'D), and ^ for dual dialogue
	const withoutExtension = trimmed
		.replace(/\s*\^$/, '')           // dual dialogue marker
		.replace(/\s*\(.*?\)\s*$/, '')   // parenthetical extension
		.trim();

	if (withoutExtension.length === 0) {
		return false;
	}

	// Must be entirely uppercase (letters, numbers, spaces, periods, hyphens, apostrophes)
	if (!/^[A-Z0-9\s.\-']+$/.test(withoutExtension)) {
		return false;
	}

	// Not a scene heading
	if (isSceneHeading(trimmed)) {
		return false;
	}

	// Not a transition
	if (isTransition(trimmed)) {
		return false;
	}

	return true;
}

/** Returns true if the line is a parenthetical: wrapped in () */
function isParenthetical(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('(') && trimmed.endsWith(')');
}

/** Returns true if the line is empty or contains only whitespace */
function isBlank(line: string): boolean {
	return line.trim().length === 0;
}

/** Returns true if we're inside a boneyard comment block */
function isBoneyardStart(line: string): boolean {
	return line.includes('/*');
}

function isBoneyardEnd(line: string): boolean {
	return line.includes('*/');
}

/**
 * Parse a Fountain document and extract dialogue blocks with source offsets.
 *
 * @param text The full text content of the .fountain file
 * @returns Array of DialogueBlock objects with source position tracking
 */
export function parseFountainDialogue(text: string): DialogueBlock[] {
	const blocks: DialogueBlock[] = [];
	const lines = text.split('\n');

	let inBoneyard = false;
	let inTitlePage = true; // Title page is at the start of the file

	// Track character offset as we walk through lines
	let currentOffset = 0;

	// State machine for dialogue parsing
	let state: 'idle' | 'character' | 'parenthetical' | 'dialogue' = 'idle';
	let currentBlock: Partial<DialogueBlock> | null = null;
	let dialogueStartOffset = 0;
	let dialogueLines: string[] = [];

	function finishBlock() {
		if (currentBlock && dialogueLines.length > 0) {
			const dialogueText = dialogueLines.join('\n');
			currentBlock.dialogueText = dialogueText;

			// endOffset is the end of the last dialogue line
			const endOffset = dialogueStartOffset + dialogueText.length;
			currentBlock.sourceRange = {
				startOffset: dialogueStartOffset,
				endOffset,
			};

			blocks.push(currentBlock as DialogueBlock);
		}
		state = 'idle';
		currentBlock = null;
		dialogueLines = [];
		dialogueStartOffset = 0;
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineOffset = currentOffset;

		// Advance offset past this line (include the \n that was split on)
		currentOffset += line.length + (i < lines.length - 1 ? 1 : 0);

		// Handle boneyard comments
		if (inBoneyard) {
			if (isBoneyardEnd(line)) {
				inBoneyard = false;
			}
			continue;
		}
		if (isBoneyardStart(line)) {
			// If open and close on same line, just skip the line
			if (isBoneyardEnd(line) && line.indexOf('*/') > line.indexOf('/*')) {
				continue;
			}
			inBoneyard = true;
			finishBlock();
			continue;
		}

		// Title page: key:value pairs at the top of the file, ends at first blank line
		if (inTitlePage) {
			if (isBlank(line)) {
				inTitlePage = false;
			}
			continue;
		}

		// Skip notes [[...]]
		const trimmed = line.trim();
		if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
			continue;
		}

		// Skip sections (#, ##, ###)
		if (trimmed.startsWith('#')) {
			finishBlock();
			continue;
		}

		// Skip synopses (= at start)
		if (trimmed.startsWith('=') && !trimmed.startsWith('===')) {
			continue;
		}

		// Skip page breaks
		if (/^={3,}$/.test(trimmed)) {
			finishBlock();
			continue;
		}

		// Skip centered text >...<
		if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
			finishBlock();
			continue;
		}

		// Skip lyrics ~
		if (trimmed.startsWith('~')) {
			continue;
		}

		switch (state) {
			case 'idle': {
				// Looking for a character cue.
				// Character cue must be preceded by a blank line.
				if (i > 0 && isBlank(lines[i - 1]) && !isBlank(line) && isCharacterCue(line)) {
					let charName = trimmed;
					// Remove dual dialogue marker
					charName = charName.replace(/\s*\^$/, '').trim();
					// Remove forced character marker
					if (charName.startsWith('@')) {
						charName = charName.substring(1).trim();
					}

					currentBlock = {
						id: i,
						characterName: charName,
						parenthetical: null,
						dialogueText: '',
						sourceRange: { startOffset: 0, endOffset: 0 },
					};
					state = 'character';
				}
				break;
			}

			case 'character': {
				// After a character cue, expect parenthetical or dialogue
				if (isBlank(line)) {
					// Blank line after character cue = no dialogue, abort
					finishBlock();
				} else if (isParenthetical(line)) {
					currentBlock!.parenthetical = trimmed;
					state = 'parenthetical';
				} else {
					// This is the first line of dialogue
					dialogueStartOffset = lineOffset;
					dialogueLines = [line];
					state = 'dialogue';
				}
				break;
			}

			case 'parenthetical': {
				// After parenthetical, expect dialogue or blank
				if (isBlank(line)) {
					finishBlock();
				} else {
					dialogueStartOffset = lineOffset;
					dialogueLines = [line];
					state = 'dialogue';
				}
				break;
			}

			case 'dialogue': {
				// Dialogue continues until a blank line
				if (isBlank(line)) {
					finishBlock();
				} else {
					dialogueLines.push(line);
				}
				break;
			}
		}
	}

	// Finish any in-progress block at end of file
	finishBlock();

	return blocks;
}

/**
 * Extract just the character name without extensions like (V.O.), (O.S.)
 */
export function getBaseCharacterName(characterName: string): string {
	return characterName
		.replace(/\s*\(.*?\)\s*$/, '')
		.trim();
}
