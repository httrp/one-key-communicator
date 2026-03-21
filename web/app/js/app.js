/**
 * OKC App — Main application controller.
 *
 * Flow:  Open /app/ → auto-create room → keyboard is immediately active.
 *
 * The entire app is controllable with ONE key:
 *   - Keyboard has ⏸ PAUSE and ☰ MENU at the end of every layout
 *   - MENU switches the runner to scan over toolbar actions
 *   - Toolbar has a ⬅ BACK to return to keyboard
 *   - PAUSE dims the screen; one key press resumes
 *
 * Keyboard modes:
 *   "abc"   — classic alphabetical
 *   "smart" — frequency-reordered after each keystroke
 *   "wild"  — letters + word suggestions mixed
 */
(function () {
    'use strict';

    // =========================================================================
    // STATE
    // =========================================================================
    let currentView = null;
    let currentText = '';
    let roomId = null;
    let inputMode = 'keyboard';  // 'keyboard' | 'phrases' | 'toolbar'
    let paused = false;
    let keys = [];
    let phraseButtons = [];

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
    const kbModeLabel       = $('kbModeLabel');

    // =========================================================================
    // INIT
    // =========================================================================
    const lang = I18N.init();
    $('appLang').value = lang;

    // Restore keyboard mode preference
    const savedKbMode = localStorage.getItem('okc-kb-mode');
    if (savedKbMode && ['abc', 'smart', 'wild'].includes(savedKbMode)) {
        Keyboard.setMode(savedKbMode);
    }
    updateKbModeLabel();

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
        views.write.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.read.classList.add('hidden');
        connStatus.classList.remove('hidden');
        pauseOverlay.classList.add('hidden');

        updateTextDisplay();
        renderAndStart();

        WS.connect(id, 'write', onWriterMessage, onConnectionStatus);

        // Share hint on first use
        if (!localStorage.getItem('okc-hint-dismissed')) {
            shareHint.classList.remove('hidden');
            setTimeout(() => shareHint.classList.add('hidden'), 8000);
        } else {
            shareHint.classList.add('hidden');
        }
    }

    // =========================================================================
    // KEYBOARD / PHRASES / TOOLBAR RENDERING
    // =========================================================================
    function renderAndStart() {
        Runner.stop();
        const speed = parseInt(speedSlider.value);

        if (inputMode === 'keyboard') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            keys = Keyboard.render(keyboardContainer, I18N.getLang(), currentText);
            Runner.start(keys, speed, onKeySelected);
        } else if (inputMode === 'phrases') {
            keyboardContainer.classList.add('hidden');
            phrasesContainer.classList.remove('hidden');
            phraseButtons = Keyboard.renderPhrases(phrasesContainer);
            Runner.start(phraseButtons, speed, onPhraseSelected);
        } else if (inputMode === 'toolbar') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            keys = Keyboard.renderToolbar(keyboardContainer);
            Runner.start(keys, speed, onToolbarSelected);
        }
    }

    // =========================================================================
    // KEY SELECTION HANDLERS
    // =========================================================================
    function onKeySelected(value) {
        // Navigation keys
        if (value === 'MENU') {
            inputMode = 'toolbar';
            renderAndStart();
            return;
        }
        if (value === 'PAUSE') {
            enterPause();
            return;
        }

        // Regular key input
        switch (value) {
            case 'BACKSPACE':
                currentText = currentText.slice(0, -1);
                break;
            case 'NEWLINE':
                currentText += '\n';
                break;
            case 'DONE':
                if (currentText && !currentText.endsWith('.') && !currentText.endsWith('!') && !currentText.endsWith('?')) {
                    currentText += '.';
                }
                break;
            default:
                // Could be a letter OR a whole word (wild mode)
                if (value.length > 1 && value === value.toUpperCase()) {
                    // Word suggestion from wild mode — append word
                    const currentWord = SmartKeyboard.getCurrentWord(currentText);
                    // Remove partially typed portion and replace with full word
                    if (currentWord) {
                        currentText = currentText.slice(0, -currentWord.length);
                    }
                    currentText += value.toLowerCase() + ' ';
                } else {
                    currentText += value.toLowerCase();
                }
                break;
        }

        updateTextDisplay();
        WS.sendText(currentText);

        // In smart/wild mode, re-render keyboard with new frequency order
        if (Keyboard.getMode() !== 'abc') {
            renderAndStart();
        }
    }

    function onPhraseSelected(value) {
        if (value === 'TB_BACK') {
            inputMode = 'keyboard';
            renderAndStart();
            return;
        }

        if (currentText && !currentText.endsWith(' ') && !currentText.endsWith('\n')) {
            currentText += ' ';
        }
        currentText += value;
        updateTextDisplay();
        WS.sendText(currentText);
    }

    function onToolbarSelected(value) {
        switch (value) {
            case 'TB_BACK':
                inputMode = 'keyboard';
                renderAndStart();
                break;
            case 'TB_CLEAR':
                currentText = '';
                updateTextDisplay();
                WS.sendClear();
                inputMode = 'keyboard';
                renderAndStart();
                break;
            case 'TB_SHARE':
                Runner.stop();
                openShareModal();
                break;
            case 'TB_SETTINGS':
                Runner.stop();
                settingsPanel.classList.remove('hidden');
                break;
            case 'TB_PHRASES':
                inputMode = 'phrases';
                renderAndStart();
                break;
            case 'TB_MODE':
                cycleKeyboardMode();
                inputMode = 'keyboard';
                renderAndStart();
                break;
            case 'TB_FASTER':
                adjustSpeed(-100);
                // Stay in toolbar
                break;
            case 'TB_SLOWER':
                adjustSpeed(100);
                break;
        }
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
        updateKbModeLabel();
    }

    function updateKbModeLabel() {
        const mode = Keyboard.getMode();
        const labels = { abc: 'ABC', smart: 'Smart', wild: 'Wild' };
        if (kbModeLabel) kbModeLabel.textContent = labels[mode] || 'ABC';
    }

    // =========================================================================
    // SPEED ADJUSTMENT
    // =========================================================================
    function adjustSpeed(delta) {
        let val = parseInt(speedSlider.value) + delta;
        val = Math.max(200, Math.min(2000, val));
        speedSlider.value = val;
        Runner.setSpeed(val);
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

    function onWriterMessage(msg) {
        // Future: status updates
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
            case 'connected':
                statusDot.classList.add('connected');
                statusText.textContent = I18N.t('connected');
                break;
            case 'disconnected':
                statusDot.classList.add('disconnected');
                statusText.textContent = I18N.t('disconnected');
                break;
            case 'reconnecting':
                statusText.textContent = I18N.t('reconnecting');
                break;
        }
    }

    function onReaderConnectionStatus(status) {
        const dot = $('readerStatusDot');
        const text = $('readerStatusText');
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
        }
    }

    // =========================================================================
    // UI EVENT LISTENERS (header buttons — for sighted helpers)
    // =========================================================================

    // Settings panel
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

    // Language change
    $('appLang').addEventListener('change', (e) => {
        I18N.setLang(e.target.value);
        if (currentView === 'write') {
            renderAndStart();
        }
    });

    // Keyboard mode cycling (header button)
    $('btnKbMode').addEventListener('click', () => {
        cycleKeyboardMode();
        if (currentView === 'write' && inputMode === 'keyboard') {
            renderAndStart();
        }
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

    // Clear (header button)
    $('btnClear').addEventListener('click', () => {
        currentText = '';
        updateTextDisplay();
        WS.sendClear();
    });

    // Speed slider
    speedSlider.addEventListener('input', () => {
        Runner.setSpeed(parseInt(speedSlider.value));
    });

    // Pause button (header — for helpers)
    $('btnPause').addEventListener('click', () => {
        if (paused) {
            leavePause();
        } else {
            enterPause();
        }
    });

    // Share (header button)
    $('btnShare').addEventListener('click', () => {
        Runner.stop();
        openShareModal();
    });

    // Share modal buttons
    $('btnCopyURL').addEventListener('click', () => {
        const url = shareURL.textContent;
        navigator.clipboard.writeText(url).then(() => {
            $('btnCopyURL').textContent = I18N.t('copied');
            setTimeout(() => {
                $('btnCopyURL').textContent = I18N.t('copy_link');
            }, 2000);
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

    // Share hint dismiss
    $('btnDismissHint').addEventListener('click', () => {
        shareHint.classList.add('hidden');
        localStorage.setItem('okc-hint-dismissed', '1');
    });

    // =========================================================================
    // GLOBAL INPUT — ANY key / ANY touch / ANY click = select or unpause
    // =========================================================================
    function handleGlobalInput(e) {
        if (currentView !== 'write') return;

        // If paused, ANY input unpauses
        if (paused) {
            e.preventDefault && e.preventDefault();
            leavePause();
            return;
        }

        // Don't capture when in settings/modal/form
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        if (e.target && e.target.closest && (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel'))) return;
        if (e.target && e.target.closest && e.target.closest('.share-hint')) return;

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
        if (e.target.closest('.toolbar') || e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        handleGlobalInput(e);
    }, { passive: false });

    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.toolbar') || e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;
        handleGlobalInput(e);
    });

    // =========================================================================
    // ROUTER
    // =========================================================================
    window.addEventListener('hashchange', navigate);
    navigate();

})();
