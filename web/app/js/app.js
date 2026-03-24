/**
 * One-Key Communicator — Main application controller.
 *
 * The entire app is controllable with ONE key:
 *   1. Runner scans through keyboard keys (letters + space + backspace + ☰)
 *   2. Selecting ☰ switches to toolbar scanning (mode, phrases, speak, etc.)
 *   3. Mouse hover pauses runner & highlights; click selects
 *   4. Touch on any key/button selects it directly
 *
 * Features:
 *   - Auto-capitalization (start of sentence, after punctuation)
 *   - Adaptive speed (slows down on errors, speeds up on accuracy)
 *   - Text-to-speech via Web Speech API
 *   - Reader count + names display (via WebSocket)
 *   - Current word preview (large, accessible)
 *   - Desktop sidebar with QR code
 *   - Three keyboard modes: abc / smart / wild (default: smart)
 *   - Smart reader view with word-level display
 *   - Pause/lock overlay
 */
(function () {
    'use strict';

    // =========================================================================
    // STATE
    // =========================================================================
    let currentView = null;
    let currentText = '';
    let roomId = null;
    let roomPIN = null; // PIN for reader access
    let inputMode = 'keyboard';  // 'keyboard' | 'toolbar' | 'phrases' | 'punctuation'
    let paused = false;
    let keys = [];
    let readerCount = 0;
    let readerNames = [];

    // Adaptive speed state
    const adaptiveHistory = [];
    const ADAPTIVE_MAX = 20;
    let baseSpeed = 1000;

    // Reader view state
    let readerFontScale = 1;
    let readerAutoScroll = true;
    let readerViewMode = 'smart'; // 'smart' | 'full'

    // =========================================================================
    // DOM REFS
    // =========================================================================
    const $ = (id) => document.getElementById(id);
    const views = {
        write:   $('write-view'),
        read:    $('read-view'),
        loading: $('loading-view'),
    };

    const textDisplay       = $('textDisplay');
    const connStatus        = $('connStatus');
    const statusDot         = $('statusDot');
    const statusText        = $('statusText');
    const keyboardContainer = $('keyboardContainer');
    const phrasesContainer  = $('phrasesContainer');
    const speedSlider       = $('speedSlider');
    const shareModal        = $('shareModal');
    const qrCanvas          = $('qrCanvas');
    const shareURL          = $('shareURL');
    const settingsPanel     = $('settingsPanel');
    const shareHint         = $('shareHint');
    const pauseOverlay      = $('pauseOverlay');
    const currentWordEl     = $('currentWord');
    const readerBadge       = $('readerBadge');
    const readerCountEl     = $('readerCount');
    const sidebarQR         = $('sidebarQR');
    const sidebarURL        = $('sidebarURL');
    const sidebarReaderCount = $('sidebarReaderCount');
    const sidebarRoomId     = $('sidebarRoomId');
    const sidebarReaderList = $('sidebarReaderList');
    const modeBadge         = $('modeBadge');
    const modeLabel         = $('modeLabel');
    const contextBanner     = $('toolbarContextBanner');

    // =========================================================================
    // INIT
    // =========================================================================
    const lang = I18N.init();
    $('appLang').value = lang;

    // Restore keyboard mode (default: mix)
    const savedKbMode = localStorage.getItem('okc-kb-mode');
    if (savedKbMode && ['abc', 'smart', 'mix'].includes(savedKbMode)) {
        Keyboard.setMode(savedKbMode);
    } else {
        Keyboard.setMode('mix');
    }
    updateModeBadge();

    // Restore numbers toggle
    const savedNumbers = localStorage.getItem('okc-show-numbers');
    Keyboard.setShowNumbers(savedNumbers === 'true');

    // Restore speed
    const savedSpeed = localStorage.getItem('okc-speed');
    if (savedSpeed) {
        baseSpeed = parseInt(savedSpeed) || 1000;
        speedSlider.value = baseSpeed;
    }

    // Restore room duration setting (default: 12 hours)
    const savedRoomDuration = localStorage.getItem('okc-room-duration');
    const roomDurationSelect = $('roomDuration');
    if (roomDurationSelect) {
        roomDurationSelect.value = savedRoomDuration || '12';
    }

    // Set reader name input placeholder
    const nameInput = $('readerNameInput');
    if (nameInput) nameInput.placeholder = I18N.t('your_name');

    // =========================================================================
    // ROUTING
    // =========================================================================
    function navigate() {
        const hash = location.hash.slice(1) || '/';
        // Extract query string from hash (e.g., #/read/abc123?pin=1234)
        const [hashPath, hashQuery] = hash.split('?');
        const parts = hashPath.split('/').filter(Boolean);
        const params = new URLSearchParams(hashQuery || '');

        if (currentView === 'write' || currentView === 'read') {
            Runner.stop();
            WS.disconnect();
        }

        hideAll();

        if (parts[0] === 'read' && parts[1]) {
            const pin = params.get('pin');
            showReadView(parts[1], pin);
        } else if (parts[0] === 'room' && parts[1]) {
            showWriteView(parts[1]);
        } else {
            autoCreateRoom();
        }
    }

    function hideAll() {
        Object.values(views).forEach(v => v.classList.add('hidden'));
        connStatus.classList.add('hidden');
    }

    function showView(name) {
        hideAll();
        views[name].classList.remove('hidden');
        currentView = name;
    }

    // =========================================================================
    // AUTO-CREATE ROOM
    // =========================================================================
    async function autoCreateRoom() {
        showView('loading');

        // Get room duration setting (0 = session only, otherwise hours)
        const durationHours = parseInt(localStorage.getItem('okc-room-duration') || '12', 10);
        
        // Only check stored room if duration > 0 (not "this session")
        if (durationHours > 0) {
            const stored = localStorage.getItem('okc-room');
            if (stored) {
                try {
                    const info = JSON.parse(stored);
                    const maxAge = durationHours * 60 * 60 * 1000;
                    // Check if stored room ID is still fresh
                    if (Date.now() - info.ts < maxAge) {
                        // Verify room still exists on server before using it
                        const checkResp = await fetch('/api/rooms/' + info.id);
                        if (checkResp.ok) {
                            location.hash = '/room/' + info.id;
                            return;
                        } else {
                            // Room was deleted on server, clear localStorage
                            console.log('Stored room no longer exists, creating new one');
                            localStorage.removeItem('okc-room');
                        }
                    }
                } catch (e) {
                    // Parsing error or network issue, clear and create new
                    localStorage.removeItem('okc-room');
                }
            }
        } else {
            // Session only - clear any stored room
            localStorage.removeItem('okc-room');
        }

        try {
            const resp = await fetch('/api/rooms?lang=' + I18N.getLang(), { method: 'POST' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            // Only store if duration > 0
            if (durationHours > 0) {
                localStorage.setItem('okc-room', JSON.stringify({ id: data.id, ts: Date.now() }));
            }
            location.hash = '/room/' + data.id;
        } catch (err) {
            console.error('Failed to create room:', err);
            showView('write');
        }
    }

    // =========================================================================
    // WRITER VIEW
    // =========================================================================
    function showWriteView(id) {
        currentView = 'write';
        roomId = id;
        currentText = '';
        paused = false;
        inputMode = 'keyboard';
        readerCount = 0;
        readerNames = [];
        adaptiveHistory.length = 0;

        views.write.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.read.classList.add('hidden');
        connStatus.classList.remove('hidden');
        pauseOverlay.classList.add('hidden');

        updateTextDisplay();
        updateCurrentWord();
        updateReaderInfo({ count: 0, names: [] });
        updateModeBadge();
        setupSidebar();
        renderAndStart();

        WS.connect(id, 'write', onWriterMessage, onConnectionStatus);

        if (!localStorage.getItem('okc-hint-dismissed')) {
            shareHint.classList.remove('hidden');
            setTimeout(() => shareHint.classList.add('hidden'), 6000);
        } else {
            shareHint.classList.add('hidden');
        }
    }

    // =========================================================================
    // CONTEXT BANNER — shown when in menu/toolbar/modal scan modes so the user
    // always knows which "layer" they are in.
    // =========================================================================
    function showContextBanner(text) {
        if (contextBanner) {
            contextBanner.textContent = text;
            contextBanner.classList.add('visible');
        }
    }

    function hideContextBanner() {
        if (contextBanner) contextBanner.classList.remove('visible');
    }

    /** Brief floating toast message (e.g. for TTS errors). Auto-dismisses after 3s. */
    function showToast(msg) {
        const existing = document.querySelector('.okc-toast');
        if (existing) existing.remove();
        const el = document.createElement('div');
        el.className = 'okc-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }
    // =========================================================================
    // RENDERING — starts Runner on the appropriate set of elements
    // =========================================================================
    function renderAndStart() {
        hideContextBanner();  // always clear banner when returning to keyboard
        Runner.stop();
        const speed = getAdaptiveSpeed();

        if (inputMode === 'keyboard') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            // Render keyboard (letters + space + backspace + menu button)
            keys = Keyboard.render(keyboardContainer, I18N.getLang(), currentText);
            Runner.start(keys, speed, onKeySelected);
        } else if (inputMode === 'phrases') {
            keyboardContainer.classList.add('hidden');
            phrasesContainer.classList.remove('hidden');
            keys = Keyboard.renderPhrases(phrasesContainer);
            Runner.start(keys, speed, onPhraseSelected);
        } else if (inputMode === 'punctuation') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            keys = Keyboard.renderPunctuation(keyboardContainer, I18N.getLang());
            Runner.start(keys, speed, onPunctSelected);
        } else if (inputMode === 'delete') {
            // Delete mode keeps its own rendering (handled in showDeleteOptions)
        }
    }

    // =========================================================================
    // KEY SELECTION HANDLER (keyboard only - no toolbar actions here)
    // =========================================================================
    function onKeySelected(value) {
        // Handle keyboard actions
        switch (value) {
            case 'MENU':
                showToolbarScan();
                return;
            case 'BACKSPACE':
                if (currentText.length > 0) {
                    currentText = currentText.slice(0, -1);
                    recordAction('backspace');
                }
                break;
            default:
                // Letter, number, or word suggestion
                if (value.length > 1 && value === value.toUpperCase() && !/^[.!?,;:'"()\-\u00a1\u00bf\u2026\d]/.test(value)) {
                    // Word suggestion from mix mode
                    const cw = SmartKeyboard.getCurrentWord(currentText);
                    if (cw) currentText = currentText.slice(0, -cw.length);
                    currentText += autoCase(value.toLowerCase()) + ' ';
                    SmartKeyboard.recordUserWord(value);  // Track user word
                } else if (value === ' ') {
                    // Record the completed word before adding space
                    const completedWord = SmartKeyboard.getCurrentWord(currentText);
                    if (completedWord) {
                        SmartKeyboard.recordUserWord(completedWord);
                    }
                    currentText += ' ';
                } else if (/^\d$/.test(value)) {
                    // Number
                    currentText += value;
                } else {
                    currentText += autoCase(value.toLowerCase());
                }
                recordAction('select');
                break;
        }

        updateTextDisplay();
        updateCurrentWord();
        WS.sendText(currentText);

        // In smart/mix mode, re-render for new frequency order
        if (Keyboard.getMode() !== 'abc') {
            renderAndStart();
        }
    }

    // =========================================================================
    // PHRASE SELECTION
    // =========================================================================
    function onPhraseSelected(value) {
        if (value === 'BACK') {
            inputMode = 'keyboard';
            renderAndStart();
            return;
        }
        if (currentText && !currentText.endsWith(' ') && !currentText.endsWith('\n')) {
            currentText += ' ';
        }
        currentText += value;
        recordAction('select');
        updateTextDisplay();
        updateCurrentWord();
        WS.sendText(currentText);
    }

    // =========================================================================
    // PUNCTUATION SELECTION
    // =========================================================================
    function onPunctSelected(value) {
        if (value === 'BACK') {
            inputMode = 'keyboard';
            renderAndStart();
            return;
        }
        currentText += value;
        recordAction('select');
        updateTextDisplay();
        updateCurrentWord();
        WS.sendText(currentText);
    }

    // =========================================================================
    // AUTO-CAPITALIZATION
    // =========================================================================
    function autoCase(char) {
        if (!char || char === ' ') return char;
        if (currentText.length === 0) return char.toUpperCase();
        if (currentText.endsWith('\n')) return char.toUpperCase();
        const trimmed = currentText.trimEnd();
        if (trimmed.length > 0) {
            const last = trimmed[trimmed.length - 1];
            if ('.!?'.includes(last) && currentText.endsWith(' ')) {
                return char.toUpperCase();
            }
        }
        return char;
    }

    // =========================================================================
    // ADAPTIVE SPEED
    // =========================================================================
    function recordAction(type) {
        adaptiveHistory.push(type);
        if (adaptiveHistory.length > ADAPTIVE_MAX) adaptiveHistory.shift();
    }

    function getAdaptiveSpeed() {
        if (adaptiveHistory.length < 5) return baseSpeed;
        const backspaces = adaptiveHistory.filter(a => a === 'backspace').length;
        const rate = backspaces / adaptiveHistory.length;

        let speed = baseSpeed;
        if (rate > 0.35) {
            speed = baseSpeed * (1 + rate);
        } else if (rate < 0.1 && adaptiveHistory.length >= 10) {
            speed = baseSpeed * 0.8;
        }
        return Math.round(Math.max(200, Math.min(2000, speed)));
    }

    // =========================================================================
    // PAUSE MODE
    // =========================================================================
    function enterPause() {
        paused = true;
        Runner.stop();
        pauseOverlay.classList.remove('hidden');
    }

    function leavePause() {
        paused = false;
        pauseOverlay.classList.add('hidden');
        inputMode = 'keyboard';
        renderAndStart();
    }

    // =========================================================================
    // KEYBOARD MODE CYCLING
    // =========================================================================
    function cycleKeyboardMode() {
        const modes = ['abc', 'smart', 'mix'];
        const idx = modes.indexOf(Keyboard.getMode());
        const next = modes[(idx + 1) % modes.length];
        Keyboard.setMode(next);
        localStorage.setItem('okc-kb-mode', next);
    }

    function updateModeBadge() {
        const mode = Keyboard.getMode();
        if (modeLabel) modeLabel.textContent = mode;
    }

    // =========================================================================
    // CLEAR TEXT (with options)
    // =========================================================================
    let deleteMode = false;

    function showDeleteOptions() {
        deleteMode = true;
        inputMode = 'delete';
        const container = keyboardContainer;
        container.innerHTML = '';
        const allKeys = [];

        const options = [
            { label: I18N.t('delete_word') || 'Wort', value: 'DELETE_WORD' },
            { label: I18N.t('delete_sentence') || 'Satz', value: 'DELETE_SENTENCE' },
            { label: I18N.t('delete_paragraph') || 'Absatz', value: 'DELETE_PARAGRAPH' },
            { label: I18N.t('delete_all') || 'Alles', value: 'DELETE_ALL' },
        ];

        const row = document.createElement('div');
        row.className = 'keyboard-row';
        for (const opt of options) {
            const el = document.createElement('div');
            el.className = 'key action-key wide';
            el.textContent = opt.label;
            el.dataset.value = opt.value;
            row.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(row);

        // Back button
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = document.createElement('div');
        backEl.className = 'key action-key extra-wide';
        backEl.textContent = '\u2b05 ' + I18N.t('back');
        backEl.dataset.value = 'BACK';
        backRow.appendChild(backEl);
        allKeys.push(backEl);
        container.appendChild(backRow);

        keys = allKeys;
        Runner.start(keys, getAdaptiveSpeed(), onDeleteOptionSelected);
    }

    function onDeleteOptionSelected(value) {
        deleteMode = false;
        switch (value) {
            case 'DELETE_WORD':
                deleteLastWord();
                break;
            case 'DELETE_SENTENCE':
                deleteLastSentence();
                break;
            case 'DELETE_PARAGRAPH':
                deleteLastParagraph();
                break;
            case 'DELETE_ALL':
                clearText();
                return;
            case 'BACK':
                break;
        }
        inputMode = 'keyboard';
        renderAndStart();
        updateTextDisplay();
        updateCurrentWord();
        WS.sendText(currentText);
    }

    function deleteLastWord() {
        // Remove last word (including trailing space)
        currentText = currentText.trimEnd();
        const match = currentText.match(/\s+\S*$/);
        if (match) {
            currentText = currentText.slice(0, match.index);
        } else {
            currentText = '';  // Only one word, clear all
        }
    }

    function deleteLastSentence() {
        // Remove last sentence (up to and including .!?)
        currentText = currentText.trimEnd();
        const match = currentText.match(/[.!?]\s*[^.!?]*$/);
        if (match && match.index > 0) {
            currentText = currentText.slice(0, match.index + 1);
        } else {
            currentText = '';
        }
    }

    function deleteLastParagraph() {
        // Remove last paragraph (up to newline)
        const newlineIdx = currentText.lastIndexOf('\n');
        if (newlineIdx > 0) {
            currentText = currentText.slice(0, newlineIdx);
        } else {
            currentText = '';
        }
    }

    function clearText() {
        currentText = '';
        updateTextDisplay();
        updateCurrentWord();
        WS.sendClear();
        inputMode = 'keyboard';
        renderAndStart();
    }

    // =========================================================================
    // TOOLBAR SCAN MODE (separate from keyboard)
    // =========================================================================

    function showToolbarScan() {
        Runner.stop();
        inputMode = 'toolbar';
        showContextBanner('\u2630 Men\u00fc');

        // Render toolbar buttons in keyboard container
        keys = Keyboard.renderToolbar(keyboardContainer);
        const speed = getAdaptiveSpeed();

        // Grace delay = 1.5× scan speed: user has time to read the menu
        // before any keypress is accepted. Critical for accidental input prevention.
        Runner.start(keys, speed, onToolbarSelected, speed * 1.5);
    }

    function onToolbarSelected(value) {
        switch (value) {
            case 'KB_MODE':
                showKbModeScan();
                return;
            case 'PHRASES':
                inputMode = 'phrases';
                renderAndStart();
                return;
            case 'SPEAK':
                speak();
                showToolbarScan();
                return;
            case 'CLEAR':
                showDeleteOptions();
                return;
            case 'MORE':
                showToolbarMoreScan();
                return;
            case 'BACK':
                inputMode = 'keyboard';
                renderAndStart();
                return;
        }
    }

    function showKbModeScan() {
        Runner.stop();
        inputMode = 'kb-mode';
        showContextBanner('🔠 Tastatur-Modus');
        keys = Keyboard.renderKbMode(keyboardContainer, Keyboard.getMode());
        const speed = getAdaptiveSpeed();
        Runner.start(keys, speed, onKbModeScanSelected, speed * 1.5);
    }

    function onKbModeScanSelected(value) {
        if (['abc', 'smart', 'mix'].includes(value)) {
            Keyboard.setMode(value);
            localStorage.setItem('okc-kb-mode', value);
            updateModeBadge();
        }
        // BACK or after mode selection: return to primary toolbar
        showToolbarScan();
    }

    function showToolbarMoreScan() {
        Runner.stop();
        inputMode = 'toolbar-more';
        showContextBanner('\u2630 Mehr');
        keys = Keyboard.renderToolbarMore(keyboardContainer);
        const speed = getAdaptiveSpeed();
        Runner.start(keys, speed, onToolbarMoreSelected, speed * 1.5);
    }

    function onToolbarMoreSelected(value) {
        switch (value) {
            case 'PUNCT':
                inputMode = 'punctuation';
                renderAndStart();
                return;
            case 'PAUSE':
                enterPause();
                return;
            case 'SETTINGS':
                showSettingsScan();
                return;
            case 'SHARE':
                showShareScan();
                return;
            case 'HELP':
                showHelpScan();
                return;
            case 'EXIT':
                showExitConfirm();
                return;
            case 'BACK':
                showToolbarScan();  // back to primary toolbar, not keyboard
                return;
        }
    }

    // =========================================================================
    // MODAL SCAN MODES (Settings, Share, Help)
    // =========================================================================

    function updateSettingsIndicators() {
        // Update speed indicator
        const speedFill = $('speedFill');
        const speedValue = $('speedValue');
        if (speedFill && speedValue) {
            // Speed range: 200ms (fast) to 2000ms (slow)
            // Fill percentage: 100% at 200ms (fastest), 0% at 2000ms (slowest)
            const percentage = Math.round(((2000 - baseSpeed) / 1800) * 100);
            speedFill.style.width = percentage + '%';
            speedValue.textContent = (baseSpeed / 1000).toFixed(1) + 's';
        }

        // Update dark mode button state
        const darkIcon = $('darkIcon');
        const darkStatus = $('darkStatus');
        const isDark = document.documentElement.dataset.theme === 'dark';
        if (darkIcon) darkIcon.textContent = isDark ? '☀️' : '🌙';
        if (darkStatus) darkStatus.textContent = isDark ? I18N.t('mode_light') : I18N.t('mode_dark');

        // Update numbers button state
        const numbersIcon = $('numbersIcon');
        const numbersStatus = $('numbersStatus');
        const showNums = $('numbersToggle').checked;
        if (numbersIcon) numbersIcon.textContent = showNums ? '🔢' : '🔠';
        if (numbersStatus) numbersStatus.textContent = showNums ? I18N.t('numbers_on') : I18N.t('numbers_off');
    }

    function showSettingsScan() {
        Runner.stop();
        settingsPanel.classList.remove('hidden');
        inputMode = 'settings';
        showContextBanner('\u2699\ufe0f Einstellungen');

        updateSettingsIndicators();

        const scanArea = $('settingsScanArea');
        const scanBtns = Array.from(scanArea.querySelectorAll('.scan-btn'));
        const speed = getAdaptiveSpeed();

        // Grace delay prevents immediately acting on the first scan-btn
        // (BACK) when the user accidentally opened settings.
        Runner.start(scanBtns, speed, onSettingsScanSelected, speed * 1.5);
    }

    function onSettingsScanSelected(value) {
        switch (value) {
            case 'SPEED_UP':
                // Decrease interval = faster
                baseSpeed = Math.max(200, baseSpeed - 100);
                localStorage.setItem('okc-speed', baseSpeed);
                speedSlider.value = baseSpeed;
                Runner.setSpeed(baseSpeed);
                // Stay in settings mode, restart scan
                showSettingsScan();
                return;
            case 'SPEED_DOWN':
                // Increase interval = slower
                baseSpeed = Math.min(2000, baseSpeed + 100);
                localStorage.setItem('okc-speed', baseSpeed);
                speedSlider.value = baseSpeed;
                Runner.setSpeed(baseSpeed);
                showSettingsScan();
                return;
            case 'TOGGLE_DARK':
                const darkToggle = $('darkModeToggle');
                darkToggle.checked = !darkToggle.checked;
                document.documentElement.dataset.theme = darkToggle.checked ? 'dark' : 'light';
                localStorage.setItem('okc-dark-mode', darkToggle.checked);
                showSettingsScan();
                return;
            case 'TOGGLE_NUMBERS':
                const numToggle = $('numbersToggle');
                numToggle.checked = !numToggle.checked;
                Keyboard.setShowNumbers(numToggle.checked);
                localStorage.setItem('okc-show-numbers', numToggle.checked);
                showSettingsScan();
                return;
            case 'BACK':
                break;
        }
        // Return to toolbar-more submenu (settings is only accessible from there)
        settingsPanel.classList.add('hidden');
        showToolbarMoreScan();
    }

    function showShareScan() {
        Runner.stop();
        openShareModal();
        inputMode = 'share';
        showContextBanner('\U0001f517 Teilen');

        const scanArea = $('shareScanArea');
        const scanBtns = Array.from(scanArea.querySelectorAll('.scan-btn'));
        const speed = getAdaptiveSpeed();

        Runner.start(scanBtns, speed, onShareScanSelected, speed * 1.5);
    }

    function onShareScanSelected(value) {
        switch (value) {
            case 'COPY_LINK':
                const url = getReadURL();
                navigator.clipboard.writeText(url).then(() => {
                    const copyBtn = $('btnCopyURL');
                    const oldText = copyBtn.textContent;
                    copyBtn.textContent = I18N.t('copied') || 'Kopiert!';
                    setTimeout(() => { copyBtn.textContent = oldText; }, 1500);
                });
                showShareScan();  // Stay in share mode
                return;
            case 'BACK':
                break;
        }
        // Close modal and return to toolbar-more submenu
        shareModal.classList.add('hidden');
        showToolbarMoreScan();
    }

    function showHelpScan() {
        Runner.stop();
        $('helpModal').classList.remove('hidden');
        inputMode = 'help';
        showContextBanner('\u2753 Hilfe');

        const scanArea = $('helpScanArea');
        const scanBtns = Array.from(scanArea.querySelectorAll('.scan-btn'));
        const speed = getAdaptiveSpeed();

        Runner.start(scanBtns, speed, onHelpScanSelected, speed * 1.5);
    }

    function onHelpScanSelected(value) {
        // Only BACK option
        $('helpModal').classList.add('hidden');
        showToolbarMoreScan();
    }

    // =========================================================================
    // EXIT CONFIRMATION
    // =========================================================================
    function showExitConfirm() {
        Runner.stop();
        $('exitModal').classList.remove('hidden');
        inputMode = 'exit';
        showContextBanner('\u26a0\ufe0f Beenden?');

        const scanArea = $('exitScanArea');
        const scanBtns = Array.from(scanArea.querySelectorAll('.scan-btn'));
        const speed = getAdaptiveSpeed();

        // Extra long grace for destructive action: 2× scan speed.
        // BACK is scan position 0 (first highlighted), CONFIRM_EXIT is second.
        // User must consciously wait past the grace period AND past BACK.
        Runner.start(scanBtns, speed, onExitScanSelected, speed * 2);
    }

    function onExitScanSelected(value) {
        $('exitModal').classList.add('hidden');
        if (value === 'CONFIRM_EXIT') {
            // Same logic as btnEndSession click
            if (roomId) {
                fetch('/api/rooms/' + roomId, { method: 'DELETE' }).catch(() => {});
            }
            WS.disconnect();
            localStorage.removeItem('okc-room-id');
            localStorage.removeItem('okc-pin');
            window.location.reload();
        } else {
            showToolbarMoreScan();  // BACK from exit confirm returns to toolbar-more
        }
    }

    // =========================================================================
    // TEXT-TO-SPEECH
    // =========================================================================
    function speak() {
        if (!currentText.trim()) return;
        if (!('speechSynthesis' in window)) {
            showToast(I18N.t('tts_unsupported') || 'Sprachausgabe nicht verfügbar');
            return;
        }

        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(currentText);
        const langMap = {
            de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
            it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR'
        };
        utt.lang = langMap[I18N.getLang()] || 'de-DE';
        utt.rate = 0.9;

        // Chrome bug: speechSynthesis stops after ~15s unless periodically resumed
        const resumeHack = setInterval(() => {
            if (!window.speechSynthesis.speaking) { clearInterval(resumeHack); return; }
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }, 10000);
        utt.onend = () => clearInterval(resumeHack);
        utt.onerror = (e) => {
            clearInterval(resumeHack);
            if (e.error !== 'interrupted') {
                showToast(I18N.t('tts_error') || 'Sprachausgabe fehlgeschlagen');
            }
        };

        window.speechSynthesis.speak(utt);
    }

    // =========================================================================
    // TEXT DISPLAY
    // =========================================================================
    function updateTextDisplay() {
        const escaped = currentText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        textDisplay.innerHTML = escaped + '<span class="cursor"></span>';
        textDisplay.scrollTop = textDisplay.scrollHeight;
    }

    // =========================================================================
    // CURRENT WORD PREVIEW
    // =========================================================================
    function updateCurrentWord() {
        const word = SmartKeyboard.getCurrentWord(currentText);
        if (currentWordEl) {
            currentWordEl.textContent = word || '';
        }
    }

    // =========================================================================
    // READER INFO (count + names from backend)
    // =========================================================================
    function updateReaderInfo(data) {
        readerCount = data.count || 0;
        readerNames = data.names || [];
        const readers = data.readers || [];

        if (readerCountEl) readerCountEl.textContent = readerCount;
        if (sidebarReaderCount) sidebarReaderCount.textContent = readerCount;
        if (readerBadge) readerBadge.style.display = readerCount > 0 ? '' : 'none';

        // Update reader list in sidebar with extended info
        if (sidebarReaderList) {
            sidebarReaderList.innerHTML = '';
            for (const reader of readers) {
                const li = document.createElement('li');
                const isLocal = reader.isLocal;
                li.className = 'reader-list-item' + (isLocal ? '' : ' reader-remote');
                
                // Device icon
                const deviceIcon = getDeviceIcon(reader.deviceType);
                
                // Network status
                const networkLabel = isLocal ? I18N.t('reader_local') : I18N.t('reader_remote');
                
                li.innerHTML = 
                    '<span class="reader-list-dot' + (isLocal ? '' : ' remote') + '"></span>' +
                    '<span class="reader-name">' + (reader.name || I18N.t('anonymous')) + '</span>' +
                    '<span class="reader-meta">' + deviceIcon + ' · ' + networkLabel + '</span>';
                sidebarReaderList.appendChild(li);
            }
            // Fallback for old data format (just names)
            if (readers.length === 0 && readerNames.length > 0) {
                for (const name of readerNames) {
                    const li = document.createElement('li');
                    li.className = 'reader-list-item';
                    li.innerHTML = '<span class="reader-list-dot"></span>' + (name || I18N.t('anonymous'));
                    sidebarReaderList.appendChild(li);
                }
            }
        }
    }

    // Get device icon based on device type
    function getDeviceIcon(deviceType) {
        switch (deviceType) {
            case 'desktop': return '💻';
            case 'tablet': return '📱';
            case 'mobile': return '📱';
            default: return '📟';
        }
    }

    // =========================================================================
    // DESKTOP SIDEBAR
    // =========================================================================
    function setupSidebar() {
        if (!roomId) return;
        const readURL = getReadURL();

        if (sidebarQR) QRCode.draw(sidebarQR, readURL, 180);
        if (sidebarURL) sidebarURL.textContent = readURL;
        if (sidebarRoomId) sidebarRoomId.textContent = roomId;
        
        // Update PIN display
        const pinDisplay = $('sidebarPIN');
        if (pinDisplay && roomPIN) {
            pinDisplay.textContent = roomPIN;
            pinDisplay.parentElement.classList.remove('hidden');
        }
    }

    // =========================================================================
    // WEBSOCKET MESSAGES (writer)
    // =========================================================================
    function onWriterMessage(msg) {
        if (msg.type === 'readers') {
            updateReaderInfo(msg.data);
        } else if (msg.type === 'text') {
            // Server sends existing text on connect (e.g., after page refresh)
            // Only restore if our local text is empty
            if (currentText === '' && msg.data) {
                currentText = msg.data;
                textDisplay.textContent = currentText;
                textDisplay.classList.remove('empty');
                WS.sendText(currentText); // Ensure sync
            }
        } else if (msg.type === 'pin') {
            // Server sends room PIN on connect
            roomPIN = msg.data;
            updatePINDisplay();
            setupSidebar(); // Re-render sidebar with updated PIN
        } else if (msg.type === 'room_info') {
            // Server sends room creation time
            updateRoomInfo(msg.data);
        }
    }

    // Update room creation time display
    function updateRoomInfo(info) {
        const sidebarRoomTime = $('sidebarRoomTime');
        if (sidebarRoomTime && info.createdAt) {
            const created = new Date(info.createdAt * 1000);
            const now = new Date();
            const diff = now - created;
            
            // Format relative time
            let timeText;
            if (diff < 60000) { // < 1 minute
                timeText = I18N.t('just_now');
            } else if (diff < 3600000) { // < 1 hour
                const mins = Math.floor(diff / 60000);
                timeText = I18N.t('created_minutes_ago').replace('{n}', mins);
            } else if (diff < 86400000) { // < 1 day
                const hours = Math.floor(diff / 3600000);
                timeText = I18N.t('created_hours_ago').replace('{n}', hours);
            } else {
                timeText = I18N.t('created_at') + ' ' + created.toLocaleDateString();
            }
            sidebarRoomTime.textContent = timeText;
        }
    }

    // Update PIN display in UI
    function updatePINDisplay() {
        const sidebarPINSection = $('sidebarPINSection');
        const sidebarPIN = $('sidebarPIN');
        const sharePINSection = $('sharePINSection');
        const sharePIN = $('sharePIN');
        
        if (sidebarPINSection && sidebarPIN && roomPIN) {
            sidebarPIN.textContent = roomPIN;
            sidebarPINSection.style.display = '';
        }
        if (sharePINSection && sharePIN && roomPIN) {
            sharePIN.textContent = roomPIN;
            sharePINSection.style.display = '';
        }
    }

    // Build read URL with PIN
    function getReadURL() {
        if (!roomId) return '';
        let url = location.origin + '/app/#/read/' + roomId;
        if (roomPIN) {
            url += '?pin=' + roomPIN;
        }
        return url;
    }

    // =========================================================================
    // SHARE MODAL
    // =========================================================================
    function openShareModal() {
        if (!roomId) return;
        const readURL = getReadURL();
        shareURL.textContent = readURL;
        QRCode.draw(qrCanvas, readURL, 200);
        
        // Show PIN prominently
        const sharePinDisplay = $('sharePIN');
        if (sharePinDisplay && roomPIN) {
            sharePinDisplay.textContent = roomPIN;
            sharePinDisplay.parentElement.classList.remove('hidden');
        }
        
        shareModal.classList.remove('hidden');
    }

    // =========================================================================
    // READER VIEW — Smart text display
    // =========================================================================
    function showReadView(id, pin = null) {
        currentView = 'read';
        roomId = id;
        views.read.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.write.classList.add('hidden');

        $('readerConnStatus').classList.remove('hidden');

        const lastWord = $('readerLastWord');
        const recent = $('readerRecentWords');
        const full = $('readerFullText');

        if (lastWord) lastWord.textContent = '';
        if (recent) recent.textContent = '';
        if (full) {
            full.innerHTML = '<span class="reader-empty-text">' + I18N.t('waiting') + '</span>';
            full.classList.add('empty');
        }

        // Restore reader settings
        const savedFontScale = localStorage.getItem('okc-reader-font');
        if (savedFontScale) readerFontScale = parseFloat(savedFontScale) || 1;
        applyReaderFontScale();

        const savedAutoScroll = localStorage.getItem('okc-reader-scroll');
        readerAutoScroll = savedAutoScroll !== 'false';
        updateAutoScrollBtn();

        // Restore view mode
        const savedViewMode = localStorage.getItem('okc-reader-view');
        if (savedViewMode === 'full') {
            readerViewMode = 'full';
            applyReaderViewMode();
        }

        WS.connect(id, 'read', onReaderMessage, onReaderConnectionStatus, pin);

        // Send saved name
        const savedName = localStorage.getItem('okc-reader-name');
        const nameInput = $('readerNameInput');
        if (savedName && nameInput) {
            nameInput.value = savedName;
            // Send name after connection is established (slight delay)
            setTimeout(() => WS.sendName(savedName), 500);
        }
    }

    function onReaderMessage(msg) {
        if (msg.type !== 'text') return;

        const lastWordEl = $('readerLastWord');
        const recentEl = $('readerRecentWords');
        const fullEl = $('readerFullText');

        if (msg.data) {
            if (fullEl) fullEl.classList.remove('empty');

            const realWords = msg.data.trim().split(/\s+/);

            if (lastWordEl) {
                lastWordEl.textContent = realWords.length > 0 ? realWords[realWords.length - 1] : '';
            }

            if (recentEl) {
                const recentSlice = realWords.slice(Math.max(0, realWords.length - 6), realWords.length - 1);
                recentEl.textContent = recentSlice.join(' ');
            }

            if (fullEl) {
                fullEl.textContent = msg.data;
                if (readerAutoScroll) {
                    fullEl.scrollTop = fullEl.scrollHeight;
                }
            }
        } else {
            if (lastWordEl) lastWordEl.textContent = '';
            if (recentEl) recentEl.textContent = '';
            if (fullEl) {
                fullEl.innerHTML = '<span class="reader-empty-text">' + I18N.t('waiting') + '</span>';
                fullEl.classList.add('empty');
            }
        }
    }

    function applyReaderFontScale() {
        const fullEl = $('readerFullText');
        if (fullEl) {
            fullEl.style.fontSize = (1.2 * readerFontScale) + 'rem';
        }
    }

    function updateAutoScrollBtn() {
        const btn = $('btnAutoScroll');
        if (btn) btn.classList.toggle('active', readerAutoScroll);
    }

    function applyReaderViewMode() {
        const lastWord = $('readerLastWord');
        const recent = $('readerRecentWords');
        const full = $('readerFullText');
        const viewBtn = $('btnReaderViewToggle');

        if (readerViewMode === 'full') {
            // Full text mode — hide word break-down, show only full text
            if (lastWord) lastWord.style.display = 'none';
            if (recent) recent.style.display = 'none';
            if (full) full.style.fontSize = (1.8 * readerFontScale) + 'rem';
        } else {
            // Smart mode — show word break-down
            if (lastWord) lastWord.style.display = '';
            if (recent) recent.style.display = '';
            applyReaderFontScale();
        }
    }

    // =========================================================================
    // CONNECTION STATUS
    // =========================================================================
    function onConnectionStatus(status) {
        statusDot.className = 'status-dot';
        switch (status) {
            case 'connected':    statusDot.classList.add('connected'); statusText.textContent = I18N.t('connected'); break;
            case 'disconnected': statusDot.classList.add('disconnected'); statusText.textContent = I18N.t('disconnected'); break;
            case 'reconnecting': statusText.textContent = I18N.t('reconnecting'); break;
        }
    }

    function onReaderConnectionStatus(status, errorData) {
        const dot = $('readerStatusDot');
        const text = $('readerStatusText');
        const fullEl = $('readerFullText');
        
        dot.className = 'status-dot';
        switch (status) {
            case 'connected':    
                dot.classList.add('connected'); 
                text.textContent = I18N.t('connected'); 
                break;
            case 'disconnected': 
                dot.classList.add('disconnected'); 
                text.textContent = I18N.t('disconnected'); 
                break;
            case 'reconnecting': 
                text.textContent = I18N.t('reconnecting'); 
                break;
            case 'error':
                dot.classList.add('disconnected');
                if (errorData === 'room_not_found') {
                    text.textContent = I18N.t('error_room_not_found') || 'Raum nicht gefunden';
                    if (fullEl) {
                        fullEl.innerHTML = '<span class="reader-empty-text">' + 
                            (I18N.t('error_room_not_found_desc') || 'Dieser Raum existiert nicht mehr. Bitte fordere einen neuen Link an.') + 
                            '</span>';
                        fullEl.classList.add('empty');
                    }
                } else if (errorData === 'invalid_pin') {
                    text.textContent = I18N.t('error_invalid_pin') || 'Ungültige PIN';
                    if (fullEl) {
                        fullEl.innerHTML = '<span class="reader-empty-text">' + 
                            (I18N.t('error_invalid_pin_desc') || 'Die PIN ist ungültig. Bitte prüfe den Link oder frage nach der korrekten PIN.') + 
                            '</span>';
                        fullEl.classList.add('empty');
                    }
                } else {
                    text.textContent = I18N.t('connection_error') || 'Verbindungsfehler';
                }
                break;
        }
    }

    // =========================================================================
    // TOOLBAR DIRECT CLICK HANDLERS (for sighted mouse/touch users)
    // =========================================================================
    function handleToolbarAction(value) {
        if (currentView !== 'write') return;
        switch (value) {
            case 'KB_MODE':
                showKbModeScan();
                break;
            case 'PHRASES':
                inputMode = 'phrases';
                renderAndStart();
                break;
            case 'PUNCT':
                inputMode = 'punctuation';
                renderAndStart();
                break;
            case 'SPEAK':
                speak();
                break;
            case 'CLEAR':
                showDeleteOptions();
                break;
            case 'PAUSE':
                enterPause();
                break;
            case 'SHARE':
                showShareScan();
                break;
            case 'SETTINGS':
                showSettingsScan();
                break;
            case 'HELP':
                showHelpScan();
                break;
        }
    }

    // Attach click handlers to each toolbar button (for direct interaction)
    document.querySelectorAll('#toolbar .toolbar-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            handleToolbarAction(btn.dataset.value);
        });
    });

    // =========================================================================
    // UI EVENT LISTENERS (header buttons)
    // =========================================================================

    // Settings
    $('btnSettings').addEventListener('click', function() {
        Runner.stop();
        settingsPanel.classList.remove('hidden');
    });
    $('btnCloseSettings').addEventListener('click', function() {
        settingsPanel.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });
    $('settingsBackdrop').addEventListener('click', function() {
        settingsPanel.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });

    // Language
    $('appLang').addEventListener('change', function(e) {
        I18N.setLang(e.target.value);
        if (nameInput) nameInput.placeholder = I18N.t('your_name');
        if (currentView === 'write') renderAndStart();
    });

    // Speed (manual override resets adaptive)
    speedSlider.addEventListener('input', function() {
        baseSpeed = parseInt(speedSlider.value);
        localStorage.setItem('okc-speed', baseSpeed);
        adaptiveHistory.length = 0;
        Runner.setSpeed(baseSpeed);
    });

    // Room duration
    $('roomDuration').addEventListener('change', function(e) {
        localStorage.setItem('okc-room-duration', e.target.value);
    });

    // New room
    $('btnNewRoom').addEventListener('click', function() {
        settingsPanel.classList.add('hidden');
        localStorage.removeItem('okc-room');
        location.hash = '/';
    });

    // Join room
    $('btnJoinRoom').addEventListener('click', function() {
        const code = $('joinRoomInput').value.trim();
        if (code) {
            settingsPanel.classList.add('hidden');
            location.hash = '/read/' + code;
        }
    });

    // End session - delete room and start fresh
    $('btnEndSession').addEventListener('click', function() {
        if (!roomId) return;
        if (!confirm(I18N.t('end_session_confirm'))) return;
        
        // Delete room on server
        fetch('/api/rooms/' + roomId, { method: 'DELETE' })
            .catch(() => {});  // Ignore errors
        
        // Clear local state
        localStorage.removeItem('okc-room');
        WS.disconnect();
        
        settingsPanel.classList.add('hidden');
        location.hash = '/';
    });

    // TTS button
    $('btnTTS').addEventListener('click', speak);

    // Share (header, opens modal on mobile)
    $('btnShare').addEventListener('click', function() {
        Runner.stop();
        openShareModal();
    });

    // Share modal buttons
    $('btnCopyURL').addEventListener('click', function() {
        var url = shareURL.textContent;
        navigator.clipboard.writeText(url).then(function() {
            $('btnCopyURL').textContent = I18N.t('copied');
            setTimeout(function() { $('btnCopyURL').textContent = I18N.t('copy_link'); }, 2000);
        });
    });
    $('btnCloseModal').addEventListener('click', function() {
        shareModal.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });
    shareModal.addEventListener('click', function(e) {
        if (e.target === shareModal) {
            shareModal.classList.add('hidden');
            if (currentView === 'write' && !paused) renderAndStart();
        }
    });

    // Sidebar copy button
    var btnSideCopy = $('btnSidebarCopy');
    if (btnSideCopy) {
        btnSideCopy.addEventListener('click', function() {
            var url = sidebarURL ? sidebarURL.textContent : '';
            if (url) {
                navigator.clipboard.writeText(url).then(function() {
                    btnSideCopy.textContent = I18N.t('copied');
                    setTimeout(function() { btnSideCopy.textContent = I18N.t('copy_link'); }, 2000);
                });
            }
        });
    }

    // Share hint dismiss
    $('btnDismissHint').addEventListener('click', function() {
        shareHint.classList.add('hidden');
        localStorage.setItem('okc-hint-dismissed', '1');
    });

    // =========================================================================
    // READER VIEW CONTROLS
    // =========================================================================

    // Reader name input
    var readerNameEl = $('readerNameInput');
    if (readerNameEl) {
        readerNameEl.addEventListener('change', function() {
            var name = readerNameEl.value.trim().slice(0, 20);
            localStorage.setItem('okc-reader-name', name);
            WS.sendName(name);
        });
        readerNameEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') readerNameEl.blur();
        });
    }

    // Font size controls
    var btnFontSmaller = $('btnFontSmaller');
    var btnFontLarger = $('btnFontLarger');
    if (btnFontSmaller) {
        btnFontSmaller.addEventListener('click', function() {
            readerFontScale = Math.max(0.6, readerFontScale - 0.15);
            localStorage.setItem('okc-reader-font', readerFontScale);
            applyReaderFontScale();
            if (readerViewMode === 'full') applyReaderViewMode();
        });
    }
    if (btnFontLarger) {
        btnFontLarger.addEventListener('click', function() {
            readerFontScale = Math.min(2.5, readerFontScale + 0.15);
            localStorage.setItem('okc-reader-font', readerFontScale);
            applyReaderFontScale();
            if (readerViewMode === 'full') applyReaderViewMode();
        });
    }

    // Auto-scroll toggle
    var btnAutoScroll = $('btnAutoScroll');
    if (btnAutoScroll) {
        btnAutoScroll.addEventListener('click', function() {
            readerAutoScroll = !readerAutoScroll;
            localStorage.setItem('okc-reader-scroll', readerAutoScroll);
            updateAutoScrollBtn();
        });
    }

    // View mode toggle (smart vs full)
    var btnViewToggle = $('btnReaderViewToggle');
    if (btnViewToggle) {
        btnViewToggle.addEventListener('click', function() {
            readerViewMode = readerViewMode === 'smart' ? 'full' : 'smart';
            localStorage.setItem('okc-reader-view', readerViewMode);
            applyReaderViewMode();
        });
    }

    // =========================================================================
    // GLOBAL INPUT — single key / touch / click
    // =========================================================================
    function handleGlobalInput(e) {
        if (currentView !== 'write') return;

        // If paused, ANY input unpauses
        if (paused) {
            e.preventDefault && e.preventDefault();
            leavePause();
            return;
        }

        // Don't capture form inputs or overlays
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        if (e.target && e.target.closest && (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel'))) return;
        if (e.target && e.target.closest && e.target.closest('.share-hint')) return;
        if (e.target && e.target.closest && e.target.closest('.writer-header')) return;
        if (e.target && e.target.closest && e.target.closest('.toolbar')) return;

        if (e.type === 'keydown') {
            if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }
        if (e.type === 'touchstart') e.preventDefault();

        if (Runner.isActive()) {
            Runner.select();
        }
    }

    document.addEventListener('keydown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        
        // Exclude system/navigation keys that shouldn't trigger the Runner
        const excludedKeys = [
            'Escape', 'Tab',
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
            'Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
            'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
            'ContextMenu', 'PrintScreen', 'Pause'
        ];
        if (excludedKeys.includes(e.key)) return;
        // Ignore keys with Ctrl/Alt/Meta modifiers (browser shortcuts)
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        
        handleGlobalInput(e);
    });

    document.addEventListener('touchstart', function(e) {
        if (e.target.closest('.key') || e.target.closest('.phrase-btn') || e.target.closest('.toolbar-btn')) return;
        if (e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        if (e.target.closest('.writer-sidebar')) return;
        if (e.target.closest('.toolbar')) return;
        handleGlobalInput(e);
    }, { passive: false });

    document.addEventListener('mousedown', function(e) {
        if (e.target.closest('.key') || e.target.closest('.phrase-btn') || e.target.closest('.toolbar-btn')) return;
        if (e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        if (e.target.closest('.writer-sidebar')) return;
        if (e.target.closest('.toolbar')) return;
        handleGlobalInput(e);
    });

    // =========================================================================
    // HELP MODAL
    // =========================================================================
    const helpModal = $('helpModal');
    const btnHelp = $('btnHelp');
    const btnCloseHelp = $('btnCloseHelp');

    if (btnHelp) {
        btnHelp.addEventListener('click', function() {
            Runner.stop();
            helpModal.classList.remove('hidden');
        });
    }
    if (btnCloseHelp) {
        btnCloseHelp.addEventListener('click', function() {
            helpModal.classList.add('hidden');
            if (currentView === 'write' && !paused) renderAndStart();
        });
    }
    if (helpModal) {
        helpModal.addEventListener('click', function(e) {
            if (e.target === helpModal) {
                helpModal.classList.add('hidden');
                if (currentView === 'write' && !paused) renderAndStart();
            }
        });
    }

    // =========================================================================
    // DARK MODE
    // =========================================================================
    const darkModeToggle = $('darkModeToggle');
    const savedDarkMode = localStorage.getItem('okc-dark-mode');
    if (savedDarkMode === 'true') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (darkModeToggle) darkModeToggle.checked = true;
    }
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', function() {
            if (darkModeToggle.checked) {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('okc-dark-mode', 'true');
            } else {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('okc-dark-mode', 'false');
            }
        });
    }

    // =========================================================================
    // NUMBERS TOGGLE
    // =========================================================================
    const numbersToggle = $('numbersToggle');
    if (numbersToggle) {
        numbersToggle.checked = Keyboard.getShowNumbers();
        numbersToggle.addEventListener('change', function() {
            Keyboard.setShowNumbers(numbersToggle.checked);
            localStorage.setItem('okc-show-numbers', numbersToggle.checked);
            if (currentView === 'write' && !paused) renderAndStart();
        });
    }

    // =========================================================================
    // ROUTER
    // =========================================================================
    window.addEventListener('hashchange', navigate);
    navigate();

})();
