// @ts-check

/**
 * Teleprompter webview script.
 * Settings are persisted via vscode.getState()/setState() so they survive
 * panel close and VS Code restarts.
 */
(function () {
	// @ts-ignore — acquireVsCodeApi is injected by VS Code
	const vscode = acquireVsCodeApi();

	// --- DOM Elements ---
	const container = /** @type {HTMLElement} */ (document.getElementById('teleprompter-container'));
	const dialogueArea = /** @type {HTMLElement} */ (document.getElementById('dialogue-area'));
	const toolbar = /** @type {HTMLElement} */ (document.getElementById('toolbar'));
	const toolbarTrigger = /** @type {HTMLElement} */ (document.getElementById('toolbar-trigger'));
	const bottomBar = /** @type {HTMLElement} */ (document.getElementById('bottom-bar'));
	const bottomTrigger = /** @type {HTMLElement} */ (document.getElementById('bottom-trigger'));

	// Toolbar controls
	const widthSlider = /** @type {HTMLInputElement} */ (document.getElementById('width-slider'));
	const widthValue = /** @type {HTMLElement} */ (document.getElementById('width-value'));
	const btnWidthDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-width-down'));
	const btnWidthUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-width-up'));
	const btnSizeDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-down'));
	const btnSizeUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-size-up'));
	const fontSizeValue = /** @type {HTMLElement} */ (document.getElementById('font-size-value'));
	const fontSelect = /** @type {HTMLSelectElement} */ (document.getElementById('font-select'));
	const mirrorToggle = /** @type {HTMLInputElement} */ (document.getElementById('mirror-toggle'));
	const guideSlider = /** @type {HTMLInputElement} */ (document.getElementById('guide-slider'));
	const guideValue = /** @type {HTMLElement} */ (document.getElementById('guide-value'));
	const btnGuideDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-guide-down'));
	const btnGuideUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-guide-up'));

	// Alignment buttons
	const btnAlignLeft = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-left'));
	const btnAlignCenter = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-center'));
	const btnAlignRight = /** @type {HTMLButtonElement} */ (document.getElementById('btn-align-right'));

	// Bottom bar controls
	const btnPlayMain = /** @type {HTMLButtonElement} */ (document.getElementById('btn-play-main'));
	const bottomSpeedSlider = /** @type {HTMLInputElement} */ (document.getElementById('bottom-speed-slider'));
	const bottomSpeedValue = /** @type {HTMLElement} */ (document.getElementById('bottom-speed-value'));
	const btnSpeedDown = /** @type {HTMLButtonElement} */ (document.getElementById('btn-speed-down'));
	const btnSpeedUp = /** @type {HTMLButtonElement} */ (document.getElementById('btn-speed-up'));
	const statusDot = /** @type {HTMLElement} */ (document.getElementById('status-dot'));
	const statusText = /** @type {HTMLElement} */ (document.getElementById('status-text'));
	const blockCount = /** @type {HTMLElement} */ (document.getElementById('block-count'));

	// --- State (with defaults) ---
	let isScrolling = false;
	let scrollSpeed = 20;
	let fontSize = 32;
	let fontFamily = "'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace";
	let textWidth = 600;
	let textAlign = 'left';
	let guidePosition = 35;
	let isMirrored = false;
	/** @type {string[]} */
	let hiddenCharacters = [];
	let lastFrameTime = 0;
	let animationId = 0;
	let totalBlocks = 0;

	// Sub-pixel scroll accumulator (scrollTop rounds to int, fractional px get lost)
	let scrollAccumulator = 0;

	// Wheel override
	let wheelPauseTimer = 0;
	let wasScrollingBeforeWheel = false;

	// Edit debounce timers per block
	/** @type {Map<number, number>} */
	const editTimers = new Map();

	// --- Settings persistence ---

	function saveState() {
		vscode.setState({
			scrollSpeed,
			fontSize,
			fontFamily,
			textWidth,
			textAlign,
			guidePosition,
			isMirrored,
		});
	}

	function loadState() {
		const state = vscode.getState();
		if (!state) { return; }
		if (state.scrollSpeed !== undefined) { scrollSpeed = state.scrollSpeed; }
		if (state.fontSize !== undefined) { fontSize = state.fontSize; }
		if (state.fontFamily !== undefined) { fontFamily = state.fontFamily; }
		if (state.textWidth !== undefined) { textWidth = state.textWidth; }
		if (state.textAlign !== undefined) { textAlign = state.textAlign; }
		if (state.guidePosition !== undefined) { guidePosition = state.guidePosition; }
		if (state.isMirrored !== undefined) { isMirrored = state.isMirrored; }
	}

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
		saveState();
	}

	// --- Auto-scroll ---

	function startScroll() {
		if (isScrolling) { return; }
		isScrolling = true;
		scrollAccumulator = 0;
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

		// Accumulate fractional pixels so low speeds still scroll
		scrollAccumulator += scrollSpeed * elapsed;
		if (scrollAccumulator >= 1) {
			const whole = Math.floor(scrollAccumulator);
			scrollAccumulator -= whole;
			container.scrollTop += whole;
		}

		if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
			stopScroll();
			return;
		}
		animationId = requestAnimationFrame(scrollFrame);
	}

	// --- Toolbar visibility (hidden by default, hover to reveal) ---
	let toolbarHideTimer = 0;

	function showToolbar() {
		toolbar.classList.add('visible');
		clearTimeout(toolbarHideTimer);
	}
	function hideToolbar() {
		toolbar.classList.remove('visible');
	}
	function scheduleHideToolbar() {
		clearTimeout(toolbarHideTimer);
		toolbarHideTimer = setTimeout(hideToolbar, 600);
	}

	toolbarTrigger.addEventListener('mouseenter', showToolbar);
	toolbar.addEventListener('mouseenter', () => { showToolbar(); clearTimeout(toolbarHideTimer); });
	toolbar.addEventListener('mouseleave', scheduleHideToolbar);
	toolbarTrigger.addEventListener('mouseleave', scheduleHideToolbar);

	// --- Bottom bar visibility (hidden by default, hover to reveal) ---
	let bottomHideTimer = 0;

	function showBottomBar() {
		bottomBar.classList.add('visible');
		clearTimeout(bottomHideTimer);
	}
	function hideBottomBar() {
		bottomBar.classList.remove('visible');
	}
	function scheduleHideBottomBar() {
		clearTimeout(bottomHideTimer);
		bottomHideTimer = setTimeout(hideBottomBar, 600);
	}

	bottomTrigger.addEventListener('mouseenter', showBottomBar);
	bottomBar.addEventListener('mouseenter', () => { showBottomBar(); clearTimeout(bottomHideTimer); });
	bottomBar.addEventListener('mouseleave', scheduleHideBottomBar);
	bottomTrigger.addEventListener('mouseleave', scheduleHideBottomBar);

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

			const nameEl = document.createElement('div');
			nameEl.className = 'character-name';
			nameEl.textContent = block.characterName;
			const baseName = block.characterName.replace(/\s*\(.*?\)\s*$/, '').trim().toUpperCase();
			if (hiddenCharacters.includes(baseName)) { nameEl.classList.add('hidden'); }
			wrapper.appendChild(nameEl);

			if (block.parenthetical) {
				const parenEl = document.createElement('div');
				parenEl.className = 'parenthetical';
				parenEl.textContent = block.parenthetical;
				wrapper.appendChild(parenEl);
			}

			const textEl = document.createElement('div');
			textEl.className = 'dialogue-text';
			textEl.contentEditable = 'true';
			textEl.spellcheck = true;
			textEl.dataset.blockId = String(block.id);
			textEl.textContent = block.dialogueText;
			textEl.addEventListener('input', () => onDialogueEdit(block.id, textEl));
			wrapper.appendChild(textEl);
			dialogueArea.appendChild(wrapper);
		}

		container.scrollTop = scrollTop;
		applyAll();
	}

	/** @param {number} blockId @param {HTMLElement} el */
	function onDialogueEdit(blockId, el) {
		const t = editTimers.get(blockId);
		if (t) { clearTimeout(t); }
		editTimers.set(blockId, setTimeout(() => {
			editTimers.delete(blockId);
			vscode.postMessage({ type: 'edit', blockId, newText: el.innerText });
		}, 500));
	}

	/** @param {number} blockId */
	function flashSaved(blockId) {
		const el = dialogueArea.querySelector(`.dialogue-text[data-block-id="${blockId}"]`);
		if (el) { el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 800); }
	}

	// --- Display settings ---

	function applyAll() {
		applyFontSettings();
		applyWidth();
		applyAlignment();
		applyGuidePosition();
		applySpeed();
		applyMirror();
	}

	function applyFontSettings() {
		dialogueArea.style.fontSize = fontSize + 'px';
		dialogueArea.style.fontFamily = fontFamily;
		fontSizeValue.textContent = String(fontSize);
		// Sync font selector
		for (const opt of fontSelect.options) {
			if (opt.value === fontFamily) { opt.selected = true; break; }
		}
	}

	function applyWidth() {
		dialogueArea.style.maxWidth = textWidth + 'px';
		widthValue.textContent = String(textWidth);
		widthSlider.value = String(textWidth);
	}

	function applyAlignment() {
		dialogueArea.style.textAlign = textAlign;
		btnAlignLeft.classList.toggle('active', textAlign === 'left');
		btnAlignCenter.classList.toggle('active', textAlign === 'center');
		btnAlignRight.classList.toggle('active', textAlign === 'right');
	}

	function applySpeed() {
		bottomSpeedValue.textContent = String(scrollSpeed);
		bottomSpeedSlider.value = String(scrollSpeed);
	}

	function applyMirror() {
		container.classList.toggle('mirrored', isMirrored);
		mirrorToggle.checked = isMirrored;
	}

	function setFontSize(/** @type {number} */ size) {
		fontSize = Math.max(16, Math.min(72, size));
		applyFontSettings();
		saveState();
	}

	function setFontFamily(/** @type {string} */ family) {
		fontFamily = family;
		applyFontSettings();
		saveState();
	}

	function setScrollSpeed(/** @type {number} */ speed) {
		scrollSpeed = Math.max(0, Math.min(100, speed));
		applySpeed();
		saveState();
	}

	function setTextWidth(/** @type {number} */ width) {
		textWidth = Math.max(200, Math.min(1200, width));
		applyWidth();
		saveState();
	}

	function setTextAlign(/** @type {string} */ align) {
		textAlign = align;
		applyAlignment();
		saveState();
	}

	// --- Event Listeners ---

	// Bottom bar
	btnPlayMain.addEventListener('click', toggleScroll);
	bottomSpeedSlider.addEventListener('input', () => setScrollSpeed(parseInt(bottomSpeedSlider.value, 10)));
	btnSpeedDown.addEventListener('click', () => setScrollSpeed(scrollSpeed - 5));
	btnSpeedUp.addEventListener('click', () => setScrollSpeed(scrollSpeed + 5));

	// Toolbar: width with +/-
	widthSlider.addEventListener('input', () => setTextWidth(parseInt(widthSlider.value, 10)));
	btnWidthDown.addEventListener('click', () => setTextWidth(textWidth - 50));
	btnWidthUp.addEventListener('click', () => setTextWidth(textWidth + 50));

	// Toolbar: guide with +/-
	guideSlider.addEventListener('input', () => setGuidePosition(parseInt(guideSlider.value, 10)));
	btnGuideDown.addEventListener('click', () => setGuidePosition(guidePosition - 5));
	btnGuideUp.addEventListener('click', () => setGuidePosition(guidePosition + 5));

	// Toolbar: font size
	btnSizeDown.addEventListener('click', () => setFontSize(fontSize - 2));
	btnSizeUp.addEventListener('click', () => setFontSize(fontSize + 2));

	// Toolbar: font family
	fontSelect.addEventListener('change', () => setFontFamily(fontSelect.value));

	// Toolbar: alignment
	btnAlignLeft.addEventListener('click', () => setTextAlign('left'));
	btnAlignCenter.addEventListener('click', () => setTextAlign('center'));
	btnAlignRight.addEventListener('click', () => setTextAlign('right'));

	// Toolbar: mirror
	mirrorToggle.addEventListener('change', () => {
		isMirrored = mirrorToggle.checked;
		applyMirror();
		saveState();
	});

	// Spacebar
	document.addEventListener('keydown', (e) => {
		if (e.code === 'Space' && e.target === document.body) {
			e.preventDefault();
			toggleScroll();
		}
	});

	// Mouse wheel
	container.addEventListener('wheel', () => {
		if (isScrolling) { wasScrollingBeforeWheel = true; stopScroll(); }
		clearTimeout(wheelPauseTimer);
		wheelPauseTimer = setTimeout(() => {
			if (wasScrollingBeforeWheel) { wasScrollingBeforeWheel = false; startScroll(); }
		}, 3000);
	}, { passive: true });

	// --- Messages from extension host ---

	window.addEventListener('message', (event) => {
		const msg = event.data;
		switch (msg.type) {
			case 'updateBlocks':
				hiddenCharacters = msg.hiddenCharacters || [];
				renderBlocks(msg.blocks);
				break;
			case 'updateSettings':
				// Only apply from host if we don't have saved local state
				if (!vscode.getState()) {
					setFontSize(msg.fontSize);
					setFontFamily(msg.fontFamily);
					setScrollSpeed(msg.scrollSpeed);
				}
				hiddenCharacters = msg.hiddenCharacters || [];
				break;
			case 'editConfirm':
				flashSaved(msg.blockId);
				break;
		}
	});

	// --- Init ---

	loadState();
	applyAll();
	updatePlayUI();
	vscode.postMessage({ type: 'ready' });
})();
