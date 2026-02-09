import * as assert from 'assert';
import { parseFountainDialogue, getBaseCharacterName } from '../fountainParser';

suite('Fountain Parser', () => {

	test('parses simple dialogue block', () => {
		const text = [
			'',
			'MATT',
			'Hello, this is a test.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(blocks[0].dialogueText, 'Hello, this is a test.');
		assert.strictEqual(blocks[0].parenthetical, null);
		assert.strictEqual(blocks[0].id, 1); // line index of character cue
	});

	test('parses dialogue with parenthetical', () => {
		const text = [
			'',
			'SARAH',
			'(whispering)',
			'I can hear them coming.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'SARAH');
		assert.strictEqual(blocks[0].parenthetical, '(whispering)');
		assert.strictEqual(blocks[0].dialogueText, 'I can hear them coming.');
	});

	test('parses multi-line dialogue', () => {
		const text = [
			'',
			'JOHN',
			'First line of dialogue.',
			'Second line of dialogue.',
			'Third line.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].dialogueText,
			'First line of dialogue.\nSecond line of dialogue.\nThird line.');
	});

	test('parses multiple dialogue blocks', () => {
		const text = [
			'',
			'MATT',
			'Hey there!',
			'',
			'SARAH',
			'Hello back.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(blocks[0].dialogueText, 'Hey there!');
		assert.strictEqual(blocks[1].characterName, 'SARAH');
		assert.strictEqual(blocks[1].dialogueText, 'Hello back.');
	});

	test('skips scene headings', () => {
		const text = [
			'',
			'INT. OFFICE - DAY',
			'',
			'MATT',
			'Good morning.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
	});

	test('skips EXT scene headings', () => {
		const text = [
			'',
			'EXT. PARK - NIGHT',
			'',
			'JANE',
			'Beautiful evening.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'JANE');
	});

	test('skips transitions', () => {
		const text = [
			'',
			'MATT',
			'Line before transition.',
			'',
			'CUT TO:',
			'',
			'SARAH',
			'Line after transition.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(blocks[1].characterName, 'SARAH');
	});

	test('skips title page', () => {
		const text = [
			'Title: My Script',
			'Author: John Doe',
			'Draft date: 2025-01-01',
			'',
			'MATT',
			'First dialogue after title page.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
	});

	test('handles character extensions (V.O.)', () => {
		const text = [
			'',
			'MATT (V.O.)',
			'Voice over line.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT (V.O.)');
	});

	test('handles forced character with @', () => {
		const text = [
			'',
			'@McCLANE',
			'Yippee ki-yay.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'McCLANE');
	});

	test('handles dual dialogue', () => {
		const text = [
			'',
			'BRICK',
			'Screw retirement.',
			'',
			'STEEL ^',
			'Screw retirement.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].characterName, 'BRICK');
		assert.strictEqual(blocks[1].characterName, 'STEEL');
	});

	test('skips boneyard comments', () => {
		const text = [
			'',
			'MATT',
			'Before boneyard.',
			'',
			'/* This is a comment',
			'spanning multiple lines */',
			'',
			'SARAH',
			'After boneyard.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(blocks[1].characterName, 'SARAH');
	});

	test('skips notes', () => {
		const text = [
			'',
			'MATT',
			'A dialogue line.',
			'',
			'[[This is a note]]',
			'',
			'SARAH',
			'Another line.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
	});

	test('skips sections and synopses', () => {
		const text = [
			'',
			'# Act 1',
			'',
			'= The hero arrives.',
			'',
			'MATT',
			'I have arrived.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
	});

	test('source range offsets are correct for simple case', () => {
		//     0123456789...
		const text = '\nMATT\nHello world.\n';
		//  line0: '' (offset 0, len 0 + newline = 1)
		//  line1: 'MATT' (offset 1, len 4 + newline = 5)
		//  line2: 'Hello world.' (offset 6, len 12 + newline = 13)
		//  line3: '' (offset 19)

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].sourceRange.startOffset, 6);
		assert.strictEqual(blocks[0].sourceRange.endOffset, 18); // 6 + 12
		assert.strictEqual(text.substring(blocks[0].sourceRange.startOffset, blocks[0].sourceRange.endOffset), 'Hello world.');
	});

	test('source range offsets are correct for multi-line dialogue', () => {
		const text = '\nMATT\nLine one.\nLine two.\n';

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);

		const extracted = text.substring(
			blocks[0].sourceRange.startOffset,
			blocks[0].sourceRange.endOffset
		);
		assert.strictEqual(extracted, 'Line one.\nLine two.');
	});

	test('getBaseCharacterName strips extensions', () => {
		assert.strictEqual(getBaseCharacterName('MATT'), 'MATT');
		assert.strictEqual(getBaseCharacterName('MATT (V.O.)'), 'MATT');
		assert.strictEqual(getBaseCharacterName('SARAH (O.S.)'), 'SARAH');
		assert.strictEqual(getBaseCharacterName("MATT (CONT'D)"), 'MATT');
	});

	test('handles end of file without trailing newline', () => {
		const text = '\nMATT\nFinal line.';

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].dialogueText, 'Final line.');
	});

	test('action lines are not treated as character cues', () => {
		const text = [
			'',
			'INT. OFFICE - DAY',
			'',
			'Matt walks into the room and sits down.',
			'',
			'MATT',
			'Hello.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
	});

	test('whitespace-only line continues dialogue (Fountain paragraph break)', () => {
		const text = [
			'',
			'MATT',
			'First paragraph of dialogue.',
			'  ',
			'Second paragraph of dialogue.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(
			blocks[0].dialogueText,
			'First paragraph of dialogue.\n\nSecond paragraph of dialogue.'
		);
	});

	test('truly empty line ends dialogue, whitespace-only does not', () => {
		const text = [
			'',
			'MATT',
			'First part.',
			'  ',
			'Still Matt talking.',
			'',
			'SARAH',
			'Different character.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 2);
		assert.strictEqual(blocks[0].characterName, 'MATT');
		assert.strictEqual(
			blocks[0].dialogueText,
			'First part.\n\nStill Matt talking.'
		);
		assert.strictEqual(blocks[1].characterName, 'SARAH');
	});

	test('multiple whitespace paragraph breaks within dialogue', () => {
		const text = [
			'',
			'MATT',
			'Paragraph one.',
			'  ',
			'Paragraph two.',
			'  ',
			'Paragraph three.',
			'',
		].join('\n');

		const blocks = parseFountainDialogue(text);
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(
			blocks[0].dialogueText,
			'Paragraph one.\n\nParagraph two.\n\nParagraph three.'
		);
	});
});
