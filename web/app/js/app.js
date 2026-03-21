/**
 * OKC App — Main application controller.
 * Hash-based routing, no dependencies.
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
        home: $('home-view'),
        write: $('write-view'),
        read: $('read-view'),
    };
    const textDisplay = $('textDisplay');
    const connStatus = $('connStatus');
    const statusDot = $('statusDot');
    const statusText = $('statusText');
    const keyboardContainer = $('keyboardContainer');
    const phrasesContainer = $('phrasesContainer');
    const speedSlider = $('speedSlider');
    const shareModal = $('shareModal');
    const qrCanvas = $('qrCanvas');
    const shareURL = $('shareURL');

    // --- Init ---
    const lang = I18N.init();
    $('appLang').value = lang;

    // --- Routing ---
    function navigate() {
        const hash = location.hash.slice(1) || '/';
        const parts = hash.split('/').filter(Boolean);

        // Cleanup previous view
        if (currentView === 'write' || currentView === 'read') {
            Runner.stop();
            WS.disconnect();
        }

        // Hide all views
        Object.values(views).forEach(v => v.classList.add('hidden'));
        connStatus.classList.add('hidden');

        if (parts[0] === 'room' && parts[1]) {
            showWriteView(parts[1]);
        } else if (parts[0] === 'read' && parts[1]) {
            showReadView(parts[1]);
        } else {
            showHomeView();
        }
    }

    // --- Home ---
    function showHomeView() {
        currentView = 'home';
        views.home.classList.remove('hidden');
    }

    // --- Writer ---
    function showWriteView(id) {
        currentView = 'write';
        roomId = id;
        currentText = '';
        views.write.classList.remove('hidden');
        connStatus.classList.remove('hidden');

        updateTextDisplay();
        renderKeyboard();
        startRunner();

        WS.connect(id, 'write', onWriterMessage, onConnectionStatus);
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
                // Could trigger a special action; for now, just add a period
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
        // Render text with cursor
        const escaped = currentText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        textDisplay.innerHTML = escaped + '<span class="cursor"></span>';
        // Auto-scroll to bottom
        textDisplay.scrollTop = textDisplay.scrollHeight;
    }

    function onWriterMessage(msg) {
        // Writer might receive status updates in the future
    }

    // --- Reader ---
    function showReadView(id) {
        currentView = 'read';
        roomId = id;
        views.read.classList.remove('hidden');
        connStatus.classList.remove('hidden');

        const readerText = $('readerText');
        readerText.textContent = I18N.t('waiting');
        readerText.classList.add('empty');

        WS.connect(id, 'read', onReaderMessage, onConnectionStatus);
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

    // --- Connection status ---
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

    // --- Event listeners ---

    // Create room
    $('btnCreateRoom').addEventListener('click', async () => {
        try {
            const resp = await fetch(`/api/rooms?lang=${I18N.getLang()}`, { method: 'POST' });
            const data = await resp.json();
            location.hash = `/room/${data.id}`;
        } catch (err) {
            console.error('Failed to create room:', err);
        }
    });

    // Join room
    $('btnJoinRoom').addEventListener('click', () => {
        const code = prompt(I18N.t('join_prompt'));
        if (code && code.trim()) {
            location.hash = `/read/${code.trim()}`;
        }
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

    // Clear text
    $('btnClear').addEventListener('click', () => {
        currentText = '';
        updateTextDisplay();
        WS.sendClear();
    });

    // Speed slider
    speedSlider.addEventListener('input', () => {
        Runner.setSpeed(parseInt(speedSlider.value));
    });

    // Mode toggle
    $('btnMode').addEventListener('click', () => {
        Runner.stop();
        mode = mode === 'runner' ? 'phrases' : 'runner';
        $('btnMode').setAttribute('data-i18n', mode === 'runner' ? 'mode_runner' : 'mode_phrases');
        $('btnMode').textContent = I18N.t(mode === 'runner' ? 'mode_runner' : 'mode_phrases');
        startRunner();
    });

    // Share / QR
    $('btnShare').addEventListener('click', () => {
        if (!roomId) return;
        const readURL = `${location.origin}/app#/read/${roomId}`;
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

    // --- Global key handler: ANY key triggers the runner selection ---
    document.addEventListener('keydown', (e) => {
        if (currentView !== 'write') return;
        // Don't capture when typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Prevent default for spacebar (scroll) and others
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
        }

        // Any key press triggers selection
        if (Runner.isActive()) {
            Runner.select();
        }
    });

    // Touch handler: tap anywhere on the screen to select
    document.addEventListener('touchstart', (e) => {
        if (currentView !== 'write') return;
        // Don't capture toolbar buttons
        if (e.target.closest('.writer-toolbar') || e.target.closest('.app-header')) return;
        if (e.target.closest('.modal-overlay')) return;

        e.preventDefault();

        if (Runner.isActive()) {
            Runner.select();
        }
    }, { passive: false });

    // --- Router ---
    window.addEventListener('hashchange', navigate);
    navigate(); // Initial route

})();
