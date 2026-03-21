/**
 * One-Key-Communicator — Main application controller.
 *
 * The entire app is controllable with ONE key:
 *   1. Runner scans through keyboard keys + inline action buttons
 *   2. Mouse hover pauses runner & highlights; click selects
 *   3. Touch on any key selects it directly
 *
 * Features:
 *   - Auto-capitalization (start of sentence, after punctuation)
 *   - Adaptive speed (slows down on errors, speeds up on accuracy)
 *   - Text-to-speech via Web Speech API
 *   - Reader count display (via WebSocket)
 *   - Current word preview (large, accessible)
 *   - Desktop sidebar with QR code
 *   - Three keyboard modes: abc / smart / wild
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
    let inputMode = 'keyboard';  // 'keyboard' | 'phrases' | 'punctuation'
    let paused = false;
    let keys = [];
    let readerCount = 0;

    // Adaptive speed state
    const adaptiveHistory = [];
    const ADAPTIVE_MAX = 20;
    let baseSpeed = 800;

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

    // =========================================================================
    // INIT
    // =========================================================================
    const lang = I18N.init();
    $('appLang').value = lang;

    // Restore keyboard mode
    const savedKbMode = localStorage.getItem('okc-kb-mode');
    if (savedKbMode && ['abc', 'smart', 'wild'].includes(savedKbMode)) {
        Keyboard.setMode(savedKbMode);
    }

    // Restore speed
    const savedSpeed = localStorage.getItem('okc-speed');
    if (savedSpeed) {
        baseSpeed = parseInt(savedSpeed) || 800;
        speedSlider.value = baseSpeed;
    }

    // =========================================================================
    // ROUTING
    // =========================================================================
    function navigate() {
        const hash = location.hash.slice(1) || '/';
        const parts = hash.split('/').filter(Boolean);

        if (currentView === 'write' || currentView === 'read') {
            Runner.stop();
            WS.disconnect();
        }

        hideAll();

        if (parts[0] === 'read' && parts[1]) {
            showReadView(parts[1]);
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

        const stored = localStorage.getItem('okc-room');
        if (stored) {
            try {
                const info = JSON.parse(stored);
                if (Date.now() - info.ts < 12 * 60 * 60 * 1000) {
                    location.hash = '/room/' + info.id;
                    return;
                }
            } catch (e) { /* ignore */ }
        }

        try {
            const resp = await fetch('/api/rooms?lang=' + I18N.getLang(), { method: 'POST' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            localStorage.setItem('okc-room', JSON.stringify({ id: data.id, ts: Date.now() }));
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
        adaptiveHistory.length = 0;

        views.write.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.read.classList.add('hidden');
        connStatus.classList.remove('hidden');
        pauseOverlay.classList.add('hidden');

        updateTextDisplay();
        updateCurrentWord();
        updateReaderCount(0);
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
    // RENDERING
    // =========================================================================
    function renderAndStart() {
        Runner.stop();
        const speed = getAdaptiveSpeed();

        if (inputMode === 'keyboard') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
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
        }
    }

    // =========================================================================
    // KEY SELECTION HANDLER (main keyboard)
    // =========================================================================
    function onKeySelected(value) {
        // Action keys
        switch (value) {
            case 'PAUSE':   enterPause(); return;
            case 'CLEAR':   clearText(); return;
            case 'KB_MODE': cycleKeyboardMode(); renderAndStart(); return;
            case 'PHRASES': inputMode = 'phrases'; renderAndStart(); return;
            case 'PUNCT':   inputMode = 'punctuation'; renderAndStart(); return;
            case 'SPEAK':   speak(); return;
            case 'BACKSPACE':
                if (currentText.length > 0) {
                    currentText = currentText.slice(0, -1);
                    recordAction('backspace');
                }
                break;
            default:
                // Letter or word suggestion
                if (value.length > 1 && value === value.toUpperCase() && !/^[.!?,;:'"()\-¡¿…]/.test(value)) {
                    // Word suggestion from wild mode
                    const cw = SmartKeyboard.getCurrentWord(currentText);
                    if (cw) currentText = currentText.slice(0, -cw.length);
                    currentText += autoCase(value.toLowerCase()) + ' ';
                } else if (value === ' ') {
                    currentText += ' ';
                } else {
                    // Single letter — apply auto-capitalization
                    currentText += autoCase(value.toLowerCase());
                }
                recordAction('select');
                break;
        }

        updateTextDisplay();
        updateCurrentWord();
        WS.sendText(currentText);

        // In smart/wild mode, re-render for new frequency order
        if (Keyboard.getMode() !== 'abc') {
            renderAndStart();
        }
    }

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
        // Capitalize at start of text
        if (currentText.length === 0) return char.toUpperCase();
        // Capitalize after newline
        if (currentText.endsWith('\n')) return char.toUpperCase();
        // Capitalize after sentence-ending punctuation + space
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
            // Many errors — slow down (up to 40%)
            speed = baseSpeed * (1 + rate);
        } else if (rate < 0.1 && adaptiveHistory.length >= 10) {
            // Very accurate — speed up (up to 20%)
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
        renderAndStart();
    }

    // =========================================================================
    // KEYBOARD MODE CYCLING
    // =========================================================================
    function cycleKeyboardMode() {
        const modes = ['abc', 'smart', 'wild'];
        const idx = modes.indexOf(Keyboard.getMode());
        const next = modes[(idx + 1) % modes.length];
        Keyboard.setMode(next);
        localStorage.setItem('okc-kb-mode', next);
    }

    // =========================================================================
    // CLEAR TEXT
    // =========================================================================
    function clearText() {
        currentText = '';
        updateTextDisplay();
        updateCurrentWord();
        WS.sendClear();
        inputMode = 'keyboard';
        renderAndStart();
    }

    // =========================================================================
    // TEXT-TO-SPEECH
    // =========================================================================
    function speak() {
        if (!currentText.trim()) return;
        if (!('speechSynthesis' in window)) return;

        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(currentText);
        const langMap = {
            de: 'de-DE', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
            it: 'it-IT', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR'
        };
        utt.lang = langMap[I18N.getLang()] || 'de-DE';
        utt.rate = 0.9;
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
    // READER COUNT
    // =========================================================================
    function updateReaderCount(count) {
        readerCount = count;
        if (readerCountEl) readerCountEl.textContent = count;
        if (sidebarReaderCount) sidebarReaderCount.textContent = count;
        // Show/hide badge based on count
        if (readerBadge) {
            readerBadge.style.display = count > 0 ? '' : 'none';
        }
    }

    // =========================================================================
    // DESKTOP SIDEBAR
    // =========================================================================
    function setupSidebar() {
        if (!roomId) return;
        const readURL = location.origin + '/app/#/read/' + roomId;

        // QR code in sidebar
        if (sidebarQR) {
            QRCode.draw(sidebarQR, readURL, 180);
        }
        if (sidebarURL) {
            sidebarURL.textContent = readURL;
        }
        if (sidebarRoomId) {
            sidebarRoomId.textContent = roomId;
        }
    }

    // =========================================================================
    // WEBSOCKET MESSAGES
    // =========================================================================
    function onWriterMessage(msg) {
        if (msg.type === 'readers') {
            updateReaderCount(parseInt(msg.data) || 0);
        }
    }

    // =========================================================================
    // SHARE MODAL
    // =========================================================================
    function openShareModal() {
        if (!roomId) return;
        const readURL = location.origin + '/app/#/read/' + roomId;
        shareURL.textContent = readURL;
        QRCode.draw(qrCanvas, readURL, 200);
        shareModal.classList.remove('hidden');
    }

    // =========================================================================
    // READER VIEW
    // =========================================================================
    function showReadView(id) {
        currentView = 'read';
        roomId = id;
        views.read.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.write.classList.add('hidden');

        $('readerConnStatus').classList.remove('hidden');
        const readerText = $('readerText');
        readerText.textContent = I18N.t('waiting');
        readerText.classList.add('empty');

        WS.connect(id, 'read', onReaderMessage, onReaderConnectionStatus);
    }

    function onReaderMessage(msg) {
        const readerText = $('readerText');
        if (msg.type === 'text') {
            if (msg.data) {
                readerText.textContent = msg.data;
                readerText.classList.remove('empty');
            } else {
                readerText.textContent = I18N.t('waiting');
                readerText.classList.add('empty');
            }
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

    function onReaderConnectionStatus(status) {
        const dot = $('readerStatusDot');
        const text = $('readerStatusText');
        dot.className = 'status-dot';
        switch (status) {
            case 'connected':    dot.classList.add('connected'); text.textContent = I18N.t('connected'); break;
            case 'disconnected': dot.classList.add('disconnected'); text.textContent = I18N.t('disconnected'); break;
            case 'reconnecting': text.textContent = I18N.t('reconnecting'); break;
        }
    }

    // =========================================================================
    // UI EVENT LISTENERS (header buttons — for sighted helpers / mouse / touch)
    // =========================================================================

    // Settings
    $('btnSettings').addEventListener('click', () => {
        Runner.stop();
        settingsPanel.classList.remove('hidden');
    });
    $('btnCloseSettings').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });
    $('settingsBackdrop').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });

    // Language
    $('appLang').addEventListener('change', (e) => {
        I18N.setLang(e.target.value);
        if (currentView === 'write') renderAndStart();
    });

    // Speed (manual override resets adaptive)
    speedSlider.addEventListener('input', () => {
        baseSpeed = parseInt(speedSlider.value);
        localStorage.setItem('okc-speed', baseSpeed);
        adaptiveHistory.length = 0;
        Runner.setSpeed(baseSpeed);
    });

    // New room
    $('btnNewRoom').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
        localStorage.removeItem('okc-room');
        location.hash = '/';
    });

    // Join room
    $('btnJoinRoom').addEventListener('click', () => {
        const code = $('joinRoomInput').value.trim();
        if (code) {
            settingsPanel.classList.add('hidden');
            location.hash = '/read/' + code;
        }
    });

    // TTS button
    $('btnTTS').addEventListener('click', speak);

    // Share (header, opens modal on mobile; on desktop sidebar is always visible)
    $('btnShare').addEventListener('click', () => {
        Runner.stop();
        openShareModal();
    });

    // Share modal buttons
    $('btnCopyURL').addEventListener('click', () => {
        const url = shareURL.textContent;
        navigator.clipboard.writeText(url).then(() => {
            $('btnCopyURL').textContent = I18N.t('copied');
            setTimeout(() => $('btnCopyURL').textContent = I18N.t('copy_link'), 2000);
        });
    });
    $('btnCloseModal').addEventListener('click', () => {
        shareModal.classList.add('hidden');
        if (currentView === 'write' && !paused) renderAndStart();
    });
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.add('hidden');
            if (currentView === 'write' && !paused) renderAndStart();
        }
    });

    // Sidebar copy button
    const btnSideCopy = $('btnSidebarCopy');
    if (btnSideCopy) {
        btnSideCopy.addEventListener('click', () => {
            const url = sidebarURL ? sidebarURL.textContent : '';
            if (url) {
                navigator.clipboard.writeText(url).then(() => {
                    btnSideCopy.textContent = I18N.t('copied');
                    setTimeout(() => btnSideCopy.textContent = I18N.t('copy_link'), 2000);
                });
            }
        });
    }

    // Share hint dismiss
    $('btnDismissHint').addEventListener('click', () => {
        shareHint.classList.add('hidden');
        localStorage.setItem('okc-hint-dismissed', '1');
    });

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
        // Don't capture clicks on header buttons
        if (e.target && e.target.closest && e.target.closest('.writer-header')) return;

        if (e.type === 'keydown') {
            if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
        }
        if (e.type === 'touchstart') e.preventDefault();

        if (Runner.isActive()) {
            Runner.select();
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        handleGlobalInput(e);
    });

    document.addEventListener('touchstart', (e) => {
        // Let clicks on specific keys be handled by Runner's per-key touch handlers
        if (e.target.closest('.key') || e.target.closest('.phrase-btn')) return;
        if (e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        if (e.target.closest('.writer-sidebar')) return;
        handleGlobalInput(e);
    }, { passive: false });

    document.addEventListener('mousedown', (e) => {
        // Let clicks on specific keys be handled by Runner's per-key click handlers
        if (e.target.closest('.key') || e.target.closest('.phrase-btn')) return;
        if (e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        if (e.target.closest('.writer-sidebar')) return;
        handleGlobalInput(e);
    });

    // =========================================================================
    // ROUTER
    // =========================================================================
    window.addEventListener('hashchange', navigate);
    navigate();

})();
