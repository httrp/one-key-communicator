/**
 * OKC App — Main application controller.
 *
 * New flow: Open app → auto-create room → immediately show keyboard.
 * The writer can share a QR code so readers can join.
 * No home screen. Minimal steps.
 */
(function () {
    'use strict';

    // --- State ---
    let currentView = null;
    let currentText = '';
    let roomId = null;
    let mode = 'runner'; // 'runner' or 'phrases'
    let keys = [];
    let phraseButtons = [];

    // --- DOM refs ---
    const $ = (id) => document.getElementById(id);
    const views = {
        write: $('write-view'),
        read: $('read-view'),
        loading: $('loading-view'),
    };

    const textDisplay   = $('textDisplay');
    const connStatus    = $('connStatus');
    const statusDot     = $('statusDot');
    const statusText    = $('statusText');
    const keyboardContainer = $('keyboardContainer');
    const phrasesContainer  = $('phrasesContainer');
    const speedSlider   = $('speedSlider');
    const shareModal    = $('shareModal');
    const qrCanvas      = $('qrCanvas');
    const shareURL      = $('shareURL');
    const settingsPanel = $('settingsPanel');
    const shareHint     = $('shareHint');

    // --- Init ---
    const lang = I18N.init();
    $('appLang').value = lang;

    // =========================================================================
    // ROUTING — hash-based, minimal
    // =========================================================================
    function navigate() {
        const hash = location.hash.slice(1) || '/';
        const parts = hash.split('/').filter(Boolean);

        // Cleanup previous view
        if (currentView === 'write' || currentView === 'read') {
            Runner.stop();
            WS.disconnect();
        }

        hideAll();

        if (parts[0] === 'read' && parts[1]) {
            // Reader mode
            showReadView(parts[1]);
        } else if (parts[0] === 'room' && parts[1]) {
            // Writer mode with existing room
            showWriteView(parts[1]);
        } else {
            // Default: auto-create a room
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

        // Check if we have a recent room stored
        const stored = localStorage.getItem('okc-room');
        if (stored) {
            try {
                const info = JSON.parse(stored);
                // Use stored room if less than 12 hours old
                if (Date.now() - info.ts < 12 * 60 * 60 * 1000) {
                    location.hash = `/room/${info.id}`;
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
            // Show write view anyway with error state
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
        views.write.classList.remove('hidden');
        views.loading.classList.add('hidden');
        views.read.classList.add('hidden');
        connStatus.classList.remove('hidden');

        updateTextDisplay();
        renderKeyboard();
        startRunner();

        WS.connect(id, 'write', onWriterMessage, onConnectionStatus);

        // Show share hint for 8 seconds on first use
        if (!localStorage.getItem('okc-hint-dismissed')) {
            shareHint.classList.remove('hidden');
            setTimeout(() => {
                shareHint.classList.add('hidden');
            }, 8000);
        } else {
            shareHint.classList.add('hidden');
        }
    }

    function renderKeyboard() {
        const lang = I18N.getLang();
        keys = Keyboard.render(keyboardContainer, lang);
        phraseButtons = Keyboard.renderPhrases(phrasesContainer);
    }

    function startRunner() {
        const speed = parseInt(speedSlider.value);
        if (mode === 'runner') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            Runner.start(keys, speed, onKeySelected);
        } else {
            keyboardContainer.classList.add('hidden');
            phrasesContainer.classList.remove('hidden');
            Runner.start(phraseButtons, speed, onPhraseSelected);
        }
    }

    function onKeySelected(value) {
        switch (value) {
            case 'BACKSPACE':
                currentText = currentText.slice(0, -1);
                break;
            case 'NEWLINE':
                currentText += '\n';
                break;
            case 'DONE':
                if (!currentText.endsWith('.') && !currentText.endsWith('!') && !currentText.endsWith('?')) {
                    currentText += '.';
                }
                break;
            default:
                currentText += value.toLowerCase();
                break;
        }
        updateTextDisplay();
        WS.sendText(currentText);
    }

    function onPhraseSelected(value) {
        if (currentText && !currentText.endsWith(' ') && !currentText.endsWith('\n')) {
            currentText += ' ';
        }
        currentText += value;
        updateTextDisplay();
        WS.sendText(currentText);
    }

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
        // Writer might receive status updates in the future
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

        const readerConnStatus = $('readerConnStatus');
        readerConnStatus.classList.remove('hidden');

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
    // EVENT LISTENERS
    // =========================================================================

    // --- Settings panel ---
    $('btnSettings').addEventListener('click', () => {
        settingsPanel.classList.remove('hidden');
    });
    $('btnCloseSettings').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
    });
    $('settingsBackdrop').addEventListener('click', () => {
        settingsPanel.classList.add('hidden');
    });

    // Language change
    $('appLang').addEventListener('change', (e) => {
        I18N.setLang(e.target.value);
        if (currentView === 'write') {
            Runner.stop();
            renderKeyboard();
            startRunner();
        }
    });

    // New room
    $('btnNewRoom').addEventListener('click', async () => {
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

    // --- Clear text ---
    $('btnClear').addEventListener('click', () => {
        currentText = '';
        updateTextDisplay();
        WS.sendClear();
    });

    // --- Speed slider ---
    speedSlider.addEventListener('input', () => {
        Runner.setSpeed(parseInt(speedSlider.value));
    });

    // --- Mode toggle ---
    $('btnMode').addEventListener('click', () => {
        Runner.stop();
        mode = mode === 'runner' ? 'phrases' : 'runner';
        $('modeLabel').setAttribute('data-i18n', mode === 'runner' ? 'mode_keyboard' : 'mode_phrases');
        $('modeLabel').textContent = I18N.t(mode === 'runner' ? 'mode_keyboard' : 'mode_phrases');
        startRunner();
    });

    // --- Share / QR ---
    $('btnShare').addEventListener('click', () => {
        if (!roomId) return;
        const readURL = location.origin + '/app/#/read/' + roomId;
        shareURL.textContent = readURL;
        QRCode.draw(qrCanvas, readURL, 200);
        shareModal.classList.remove('hidden');
    });

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
    });
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) shareModal.classList.add('hidden');
    });

    // --- Share hint dismiss ---
    $('btnDismissHint').addEventListener('click', () => {
        shareHint.classList.add('hidden');
        localStorage.setItem('okc-hint-dismissed', '1');
    });

    // =========================================================================
    // GLOBAL INPUT — ANY key / ANY touch = select
    // =========================================================================
    document.addEventListener('keydown', (e) => {
        if (currentView !== 'write') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
        }

        if (Runner.isActive()) {
            Runner.select();
        }
    });

    document.addEventListener('touchstart', (e) => {
        if (currentView !== 'write') return;
        if (e.target.closest('.toolbar') || e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;

        e.preventDefault();

        if (Runner.isActive()) {
            Runner.select();
        }
    }, { passive: false });

    // Also handle mouse clicks on the text area and keyboard for desktop
    document.addEventListener('mousedown', (e) => {
        if (currentView !== 'write') return;
        if (e.target.closest('.toolbar') || e.target.closest('.writer-header')) return;
        if (e.target.closest('.modal-overlay') || e.target.closest('.settings-panel')) return;
        if (e.target.closest('.share-hint')) return;

        if (Runner.isActive()) {
            Runner.select();
        }
    });

    // =========================================================================
    // ROUTER
    // =========================================================================
    window.addEventListener('hashchange', navigate);
    navigate();

})();
