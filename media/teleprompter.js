// @ts-check

/**
 * Teleprompter webview script.
 *
 * Runs inside the VS Code webview — communicates with the extension host
 * via the vscode.postMessage / window.addEventListener('message') API.
 */
(function () {
	// @ts-ignore — acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	// --- DOM Elements ---
	const container = /** @type {HTMLElement} */ (document.getElementById('teleprompter-container'));
	const dialogueArea = /** @type {HTMLElement} */ (document.getElementById('dialogue-area'));
	const btnPlay = /** @type {HTMLButtonElement} */ (document.getElementById('btn-play'));
	const speedSlider = /** @type {HTMLInputElement} */ (document.getElementById('speed-slider'));
	const speedValue = /** @type {HTMLElement} */ (document.getElementById('speed-value'));
	const btnSizeDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-down'));
	const btnSizeUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-up'));
	const fontSizeValue = /** @type {HTMLElement} */ (document.getElementById('font-size-value'));
	const fontSelect = /** @type {HTMLSelectElement} */ (document.getElementById('font-select'));
	const mirrorToggle = /** @type {HTMLInputElement} */ (document.getElementById('mirror-toggle'));
	const toolbar = /** @type {HTMLElement} */ (document.getElementById('toolbar'));

	// --- State ---
	let isScrolling = false;
	let scrollSpeed = 20; // px per second
	let fontSize = 32;
	let fontFamily = 'sans-serif';
	/** @type {string[]} */
	let hiddenCharacters = [];
	let lastFrameTime = 0;
	let animationId = 0;

	// Wheel override: temporarily pause auto-scroll when user scrolls manually
	let wheelPauseTimer = 0;
	let wasScrollingBeforeWheel = false;

	// Edit debounce timers per block
	/** @type {Map<number, number>} */
	const editTimers = new Map();

	// --- Auto-scroll ---

	function startScroll() {
		if (isScrolling) { return; }
		isScrolling = true;
		btnPlay.textContent = '⏸ Pause';
		btnPlay.classList.add('active');
		lastFrameTime = performance.now();
		animationId = requestAnimationFrame(scrollFrame);
	}

	function stopScroll() {
		isScrolling = false;
		btnPlay.textContent = '▶ Play';
		btnPlay.classList.remove('active');
		if (animationId) {
			cancelAnimationFrame(animationId);
			animationId = 0;
		}
	}

	function toggleScroll() {
		if (isScrolling) {
			stopScroll();
		} else {
			startScroll();
		}
	}

	function scrollFrame(/** @type {number} */ now) {
		if (!isScrolling) { return; }

		const elapsed = (now - lastFrameTime) / 1000; // seconds
		lastFrameTime = now;

		const delta = scrollSpeed * elapsed;
		container.scrollTop += delta;

		// Stop if we've hit the bottom
		if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
			stopScroll();
			return;
		}

		animationId = requestAnimationFrame(scrollFrame);
	}

	// --- Toolbar fading during scroll ---
	let toolbarFadeTimer = 0;

	function fadeToolbar() {
		toolbar.classList.add('faded');
	}

	function showToolbar() {
		toolbar.classList.remove('faded');
		clearTimeout(toolbarFadeTimer);
		if (isScrolling) {
			toolbarFadeTimer = setTimeout(fadeToolbar, 3000);
		}
	}

	// --- Render dialogue blocks ---

	/**
	 * @param {Array<{id: number, characterName: string, parenthetical: string|null, dialogueText: string}>} blocks
	 */
	function renderBlocks(blocks) {
		// Preserve scroll position
		const scrollTop = container.scrollTop;

		dialogueArea.innerHTML = '';

		for (const block of blocks) {
			const wrapper = document.createElement('div');
			wrapper.className = 'dialogue-block';
			wrapper.dataset.blockId = String(block.id);

			// Character name
			const nameEl = document.createElement('div');
			nameEl.className = 'character-name';
			nameEl.textContent = block.characterName;

			// Check if this character should be hidden
			const baseName = block.characterName
				.replace(/\s*\(.*?\)\s*$/, '')
				.trim()
				.toUpperCase();
			if (hiddenCharacters.includes(baseName)) {
				nameEl.classList.add('hidden');
			}

			wrapper.appendChild(nameEl);

			// Parenthetical (if present)
			if (block.parenthetical) {
				const parenEl = document.createElement('div');
				parenEl.className = 'parenthetical';
				parenEl.textContent = block.parenthetical;
				wrapper.appendChild(parenEl);
			}

			// Dialogue text (editable)
			const textEl = document.createElement('div');
			textEl.className = 'dialogue-text';
			textEl.contentEditable = 'true';
			textEl.spellcheck = true;
			textEl.dataset.blockId = String(block.id);
			textEl.textContent = block.dialogueText;

			// Listen for edits
			textEl.addEventListener('input', () => {
				onDialogueEdit(block.id, textEl);
			});

			wrapper.appendChild(textEl);
			dialogueArea.appendChild(wrapper);
		}

		// Restore scroll position
		container.scrollTop = scrollTop;

		// Apply current font settings
		applyFontSettings();
	}

	/**
	 * Handle an edit in a dialogue block (debounced).
	 * @param {number} blockId
	 * @param {HTMLElement} el
	 */
	function onDialogueEdit(blockId, el) {
		// Clear existing timer for this block
		const existingTimer = editTimers.get(blockId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			editTimers.delete(blockId);

			// Get the text content (preserving newlines from <br> etc.)
			const newText = el.innerText;

			vscode.postMessage({
				type: 'edit',
				blockId: blockId,
				newText: newText,
			});
		}, 500);

		editTimers.set(blockId, timer);
	}

	/**
	 * Flash a "saved" indicator on a dialogue block.
	 * @param {number} blockId
	 */
	function flashSaved(blockId) {
		const el = dialogueArea.querySelector(`.dialogue-text[data-block-id="${blockId}"]`);
		if (el) {
			el.classList.add('saved');
			setTimeout(() => el.classList.remove('saved'), 800);
		}
	}

	// --- Font & display settings ---

	function applyFontSettings() {
		dialogueArea.style.fontSize = fontSize + 'px';
		dialogueArea.style.fontFamily = fontFamily;
		fontSizeValue.textContent = String(fontSize);
	}

	function setFontSize(/** @type {number} */ size) {
		fontSize = Math.max(16, Math.min(72, size));
		applyFontSettings();
	}

	function setFontFamily(/** @type {string} */ family) {
		fontFamily = family;
		applyFontSettings();
	}

	function setScrollSpeed(/** @type {number} */ speed) {
		scrollSpeed = speed;
		speedValue.textContent = String(speed);
		speedSlider.value = String(speed);
	}

	// --- Event Listeners ---

	// Play/Pause button
	btnPlay.addEventListener('click', toggleScroll);

	// Speed slider
	speedSlider.addEventListener('input', () => {
		setScrollSpeed(parseInt(speedSlider.value, 10));
	});

	// Font size buttons
	btnSizeDown.addEventListener('click', () => setFontSize(fontSize - 2));
	btnSizeUp.addEventListener('click', () => setFontSize(fontSize + 2));

	// Font family selector
	fontSelect.addEventListener('change', () => {
		setFontFamily(fontSelect.value);
	});

	// Mirror toggle
	mirrorToggle.addEventListener('change', () => {
		container.classList.toggle('mirrored', mirrorToggle.checked);
	});

	// Spacebar toggles play/pause
	document.addEventListener('keydown', (e) => {
		if (e.code === 'Space' && e.target === document.body) {
			e.preventDefault();
			toggleScroll();
		}
	});

	// Mouse wheel temporarily overrides auto-scroll
	container.addEventListener('wheel', () => {
		if (isScrolling) {
			wasScrollingBeforeWheel = true;
			stopScroll();
		}

		clearTimeout(wheelPauseTimer);
		wheelPauseTimer = setTimeout(() => {
			if (wasScrollingBeforeWheel) {
				wasScrollingBeforeWheel = false;
				startScroll();
			}
		}, 3000);

		showToolbar();
	}, { passive: true });

	// Show toolbar on mouse move near top
	document.addEventListener('mousemove', (e) => {
		if (e.clientY < 80) {
			showToolbar();
		}
	});

	// --- Messages from extension host ---

	window.addEventListener('message', (event) => {
		const msg = event.data;

		switch (msg.type) {
			case 'updateBlocks':
				hiddenCharacters = msg.hiddenCharacters || [];
				renderBlocks(msg.blocks);
				break;

			case 'updateSettings':
				setFontSize(msg.fontSize);
				setFontFamily(msg.fontFamily);
				setScrollSpeed(msg.scrollSpeed);
				hiddenCharacters = msg.hiddenCharacters || [];
				// Select the matching font option
				for (const opt of fontSelect.options) {
					if (opt.value === msg.fontFamily) {
						opt.selected = true;
						break;
					}
				}
				break;

			case 'editConfirm':
				flashSaved(msg.blockId);
				break;
		}
	});

	// --- Init ---

	// Tell the extension we're ready
	vscode.postMessage({ type: 'ready' });
})();
