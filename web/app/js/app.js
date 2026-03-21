/**
 * One-Key-Communicator — Main application controller.
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
    let inputMode = 'keyboard';  // 'keyboard' | 'toolbar' | 'phrases' | 'punctuation'
    let paused = false;
    let keys = [];
    let readerCount = 0;
    let readerNames = [];

    // Adaptive speed state
    const adaptiveHistory = [];
    const ADAPTIVE_MAX = 20;
    let baseSpeed = 800;

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
    const toolbarModeLabel  = $('toolbarModeLabel');
    const toolbarBack       = $('toolbarBack');

    // =========================================================================
    // INIT
    // =========================================================================
    const lang = I18N.init();
    $('appLang').value = lang;

    // Restore keyboard mode (default: smart)
    const savedKbMode = localStorage.getItem('okc-kb-mode');
    if (savedKbMode && ['abc', 'smart', 'wild'].includes(savedKbMode)) {
        Keyboard.setMode(savedKbMode);
    } else {
        Keyboard.setMode('smart');
    }
    updateModeBadge();

    // Restore speed
    const savedSpeed = localStorage.getItem('okc-speed');
    if (savedSpeed) {
        baseSpeed = parseInt(savedSpeed) || 800;
        speedSlider.value = baseSpeed;
    }

    // Set reader name input placeholder
    const nameInput = $('readerNameInput');
    if (nameInput) nameInput.placeholder = I18N.t('your_name');

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
    // RENDERING — starts Runner on the appropriate set of elements
    // =========================================================================
    function renderAndStart() {
        Runner.stop();
        const speed = getAdaptiveSpeed();

        // Show/hide toolbar back button
        if (toolbarBack) {
            toolbarBack.classList.toggle('hidden', inputMode !== 'toolbar');
        }

        if (inputMode === 'keyboard') {
            keyboardContainer.classList.remove('hidden');
            phrasesContainer.classList.add('hidden');
            keys = Keyboard.render(keyboardContainer, I18N.getLang(), currentText);
            Runner.start(keys, speed, onKeySelected);
        } else if (inputMode === 'toolbar') {
            // Keep keyboard visible but scan toolbar
            keys = Keyboard.getToolbarKeys();
            Runner.start(keys, speed, onToolbarSelected);
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
    // KEY SELECTION HANDLER (main keyboard: letters + space + ⌫ + ☰)
    // =========================================================================
    function onKeySelected(value) {
        switch (value) {
            case 'BACKSPACE':
                if (currentText.length > 0) {
                    currentText = currentText.slice(0, -1);
                    recordAction('backspace');
                }
                break;
            case 'MORE':
                // Switch to toolbar scanning
                inputMode = 'toolbar';
                renderAndStart();
                return;
            default:
                // Letter or word suggestion
                if (value.length > 1 && value === value.toUpperCase() && !/^[.!?,;:'"()\-\u00a1\u00bf\u2026]/.test(value)) {
                    // Word suggestion from wild mode
                    const cw = SmartKeyboard.getCurrentWord(currentText);
                    if (cw) currentText = currentText.slice(0, -cw.length);
                    currentText += autoCase(value.toLowerCase()) + ' ';
                } else if (value === ' ') {
                    currentText += ' ';
                } else {
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

    // =========================================================================
    // TOOLBAR SELECTION HANDLER (action buttons outside keyboard)
    // =========================================================================
    function onToolbarSelected(value) {
        switch (value) {
            case 'TOOLBAR_BACK':
                inputMode = 'keyboard';
                renderAndStart();
                return;
            case 'KB_MODE':
                cycleKeyboardMode();
                updateModeBadge();
                inputMode = 'keyboard';
                renderAndStart();
                return;
            case 'PHRASES':
                inputMode = 'phrases';
                renderAndStart();
                return;
            case 'PUNCT':
                inputMode = 'punctuation';
                renderAndStart();
                return;
            case 'SPEAK':
                speak();
                inputMode = 'keyboard';
                renderAndStart();
                return;
            case 'CLEAR':
                clearText();
                return; // clearText resets to keyboard
            case 'PAUSE':
                enterPause();
                return;
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
        const modes = ['abc', 'smart', 'wild'];
        const idx = modes.indexOf(Keyboard.getMode());
        const next = modes[(idx + 1) % modes.length];
        Keyboard.setMode(next);
        localStorage.setItem('okc-kb-mode', next);
    }

    function updateModeBadge() {
        const mode = Keyboard.getMode();
        if (modeLabel) modeLabel.textContent = mode;
        if (toolbarModeLabel) toolbarModeLabel.textContent = mode;
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
    // READER INFO (count + names from backend)
    // =========================================================================
    function updateReaderInfo(data) {
        readerCount = data.count || 0;
        readerNames = data.names || [];

        if (readerCountEl) readerCountEl.textContent = readerCount;
        if (sidebarReaderCount) sidebarReaderCount.textContent = readerCount;
        if (readerBadge) readerBadge.style.display = readerCount > 0 ? '' : 'none';

        // Update reader list in sidebar
        if (sidebarReaderList) {
            sidebarReaderList.innerHTML = '';
            for (const name of readerNames) {
                const li = document.createElement('li');
                li.className = 'reader-list-item';
                li.innerHTML = '<span class="reader-list-dot"></span>' + (name || I18N.t('anonymous'));
                sidebarReaderList.appendChild(li);
            }
        }
    }

    // =========================================================================
    // DESKTOP SIDEBAR
    // =========================================================================
    function setupSidebar() {
        if (!roomId) return;
        const readURL = location.origin + '/app/#/read/' + roomId;

        if (sidebarQR) QRCode.draw(sidebarQR, readURL, 180);
        if (sidebarURL) sidebarURL.textContent = readURL;
        if (sidebarRoomId) sidebarRoomId.textContent = roomId;
    }

    // =========================================================================
    // WEBSOCKET MESSAGES (writer)
    // =========================================================================
    function onWriterMessage(msg) {
        if (msg.type === 'readers') {
            updateReaderInfo(msg.data);
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
    // READER VIEW — Smart text display
    // =========================================================================
    function showReadView(id) {
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

        WS.connect(id, 'read', onReaderMessage, onReaderConnectionStatus);

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
    // TOOLBAR DIRECT CLICK HANDLERS (for sighted mouse/touch users)
    // =========================================================================
    function handleToolbarAction(value) {
        if (currentView !== 'write') return;
        switch (value) {
            case 'KB_MODE':
                cycleKeyboardMode();
                updateModeBadge();
                renderAndStart();
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
                clearText();
                break;
            case 'PAUSE':
                enterPause();
                break;
        }
    }

    // Attach click handlers to each toolbar button (for direct interaction)
    document.querySelectorAll('#toolbar .toolbar-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            // If toolbar is being scanned by runner, let runner handle it
            if (inputMode === 'toolbar') return;
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
    // ROUTER
    // =========================================================================
    window.addEventListener('hashchange', navigate);
    navigate();

})();
