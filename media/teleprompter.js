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
	const toolbar = /** @type {HTMLElement} */ (document.getElementById('toolbar'));
	const bottomBar = /** @type {HTMLElement} */ (document.getElementById('bottom-bar'));
	const dimOverlay = /** @type {HTMLElement} */ (document.getElementById('dim-overlay'));
	const readingGuide = /** @type {HTMLElement} */ (document.getElementById('reading-guide'));
	const readingIndicator = /** @type {HTMLElement} */ (document.getElementById('reading-indicator'));

	// Toolbar controls
	const widthSlider = /** @type {HTMLInputElement} */ (document.getElementById('width-slider'));
	const widthValue = /** @type {HTMLElement} */ (document.getElementById('width-value'));
	const btnSizeDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-down'));
	const btnSizeUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-up'));
	const fontSizeValue = /** @type {HTMLElement} */ (document.getElementById('font-size-value'));
	const fontSelect = /** @type {HTMLSelectElement} */ (document.getElementById('font-select'));
	const mirrorToggle = /** @type {HTMLInputElement} */ (document.getElementById('mirror-toggle'));
	const guideSlider = /** @type {HTMLInputElement} */ (document.getElementById('guide-slider'));
	const guideValue = /** @type {HTMLElement} */ (document.getElementById('guide-value'));

	// Alignment buttons
	const btnAlignLeft = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-left'));
	const btnAlignCenter = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-center'));
	const btnAlignRight = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-right'));

	// Bottom bar controls
	const btnPlayMain = /** @type {HTMLButtonElement} */ (document.getElementById('btn-play-main'));
	const bottomSpeedSlider = /** @type {HTMLInputElement} */ (document.getElementById('bottom-speed-slider'));
	const bottomSpeedValue = /** @type {HTMLElement} */ (document.getElementById('bottom-speed-value'));
	const statusDot = /** @type {HTMLElement} */ (document.getElementById('status-dot'));
	const statusText = /** @type {HTMLElement} */ (document.getElementById('status-text'));
	const blockCount = /** @type {HTMLElement} */ (document.getElementById('block-count'));

	// --- State ---
	let isScrolling = false;
	let scrollSpeed = 20; // px per second
	let fontSize = 32;
	let fontFamily = "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace";
	let textWidth = 600;
	let textAlign = 'left';
	let guidePosition = 35; // percent from top
	/** @type {string[]} */
	let hiddenCharacters = [];
	let lastFrameTime = 0;
	let animationId = 0;
	let totalBlocks = 0;

	// Wheel override
	let wheelPauseTimer = 0;
	let wasScrollingBeforeWheel = false;

	// Edit debounce timers per block
	/** @type {Map<number, number>} */
	const editTimers = new Map();

	// --- Reading guide position ---

	function applyGuidePosition() {
		const pos = guidePosition + '%';
		document.documentElement.style.setProperty('--reading-pos', pos);
		guideValue.textContent = String(guidePosition);
		guideSlider.value = String(guidePosition);
	}

	function setGuidePosition(/** @type {number} */ pct) {
		guidePosition = Math.max(10, Math.min(80, pct));
		applyGuidePosition();
	}

	// --- Auto-scroll ---

	function startScroll() {
		if (isScrolling) { return; }
		isScrolling = true;
		updatePlayUI();
		lastFrameTime = performance.now();
		animationId = requestAnimationFrame(scrollFrame);
	}

	function stopScroll() {
		isScrolling = false;
		updatePlayUI();
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

	function updatePlayUI() {
		if (isScrolling) {
			btnPlayMain.classList.add('active');
			btnPlayMain.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
			statusDot.classList.add('live');
			statusText.textContent = 'live';
		} else {
			btnPlayMain.classList.remove('active');
			btnPlayMain.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>';
			statusDot.classList.remove('live');
			statusText.textContent = 'paused';
		}
	}

	function scrollFrame(/** @type {number} */ now) {
		if (!isScrolling) { return; }

		const elapsed = (now - lastFrameTime) / 1000;
		lastFrameTime = now;

		const delta = scrollSpeed * elapsed;
		container.scrollTop += delta;

		if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
			stopScroll();
			return;
		}

		animationId = requestAnimationFrame(scrollFrame);
	}

	// --- Toolbar fading ---
	let fadeTimer = 0;

	function fadeBars() {
		toolbar.classList.add('faded');
		bottomBar.classList.add('faded');
	}

	function showBars() {
		toolbar.classList.remove('faded');
		bottomBar.classList.remove('faded');
		clearTimeout(fadeTimer);
		if (isScrolling) {
			fadeTimer = setTimeout(fadeBars, 4000);
		}
	}

	// --- Render dialogue blocks ---

	/**
	 * @param {Array<{id: number, characterName: string, parenthetical: string|null, dialogueText: string}>} blocks
	 */
	function renderBlocks(blocks) {
		const scrollTop = container.scrollTop;

		dialogueArea.innerHTML = '';
		totalBlocks = blocks.length;
		blockCount.textContent = totalBlocks + ' blocks';

		for (const block of blocks) {
			const wrapper = document.createElement('div');
			wrapper.className = 'dialogue-block';
			wrapper.dataset.blockId = String(block.id);

			// Character name
			const nameEl = document.createElement('div');
			nameEl.className = 'character-name';
			nameEl.textContent = block.characterName;

			const baseName = block.characterName
				.replace(/\s*\(.*?\)\s*$/, '')
				.trim()
				.toUpperCase();
			if (hiddenCharacters.includes(baseName)) {
				nameEl.classList.add('hidden');
			}

			wrapper.appendChild(nameEl);

			// Parenthetical
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

			textEl.addEventListener('input', () => {
				onDialogueEdit(block.id, textEl);
			});

			wrapper.appendChild(textEl);
			dialogueArea.appendChild(wrapper);
		}

		container.scrollTop = scrollTop;

		applyFontSettings();
		applyWidth();
		applyAlignment();
	}

	/**
	 * @param {number} blockId
	 * @param {HTMLElement} el
	 */
	function onDialogueEdit(blockId, el) {
		const existingTimer = editTimers.get(blockId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const timer = setTimeout(() => {
			editTimers.delete(blockId);
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
	 * @param {number} blockId
	 */
	function flashSaved(blockId) {
		const el = dialogueArea.querySelector(`.dialogue-text[data-block-id="${blockId}"]`);
		if (el) {
			el.classList.add('saved');
			setTimeout(() => el.classList.remove('saved'), 800);
		}
	}

	// --- Display settings ---

	function applyFontSettings() {
		dialogueArea.style.fontSize = fontSize + 'px';
		dialogueArea.style.fontFamily = fontFamily;
		fontSizeValue.textContent = String(fontSize);
	}

	function applyWidth() {
		dialogueArea.style.maxWidth = textWidth + 'px';
		widthValue.textContent = String(textWidth);
		widthSlider.value = String(textWidth);
	}

	function applyAlignment() {
		dialogueArea.style.textAlign = textAlign;
		// Update button states
		btnAlignLeft.classList.toggle('active', textAlign === 'left');
		btnAlignCenter.classList.toggle('active', textAlign === 'center');
		btnAlignRight.classList.toggle('active', textAlign === 'right');
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
		bottomSpeedValue.textContent = String(speed);
		bottomSpeedSlider.value = String(speed);
	}

	function setTextWidth(/** @type {number} */ width) {
		textWidth = Math.max(200, Math.min(1200, width));
		applyWidth();
	}

	function setTextAlign(/** @type {string} */ align) {
		textAlign = align;
		applyAlignment();
	}

	// --- Event Listeners ---

	// Bottom bar: play/pause
	btnPlayMain.addEventListener('click', toggleScroll);

	// Bottom bar: speed
	bottomSpeedSlider.addEventListener('input', () => {
		setScrollSpeed(parseInt(bottomSpeedSlider.value, 10));
	});

	// Toolbar: width
	widthSlider.addEventListener('input', () => {
		setTextWidth(parseInt(widthSlider.value, 10));
	});

	// Toolbar: reading guide position
	guideSlider.addEventListener('input', () => {
		setGuidePosition(parseInt(guideSlider.value, 10));
	});

	// Toolbar: font size
	btnSizeDown.addEventListener('click', () => setFontSize(fontSize - 2));
	btnSizeUp.addEventListener('click', () => setFontSize(fontSize + 2));

	// Toolbar: font family
	fontSelect.addEventListener('change', () => {
		setFontFamily(fontSelect.value);
	});

	// Toolbar: alignment
	btnAlignLeft.addEventListener('click', () => setTextAlign('left'));
	btnAlignCenter.addEventListener('click', () => setTextAlign('center'));
	btnAlignRight.addEventListener('click', () => setTextAlign('right'));

	// Toolbar: mirror
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

		showBars();
	}, { passive: true });

	// Show bars on mouse move near edges
	document.addEventListener('mousemove', (e) => {
		if (e.clientY < 70 || e.clientY > window.innerHeight - 90) {
			showBars();
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

	applyGuidePosition();
	applyWidth();
	updatePlayUI();
	applyAlignment();
	vscode.postMessage({ type: 'ready' });
})();
