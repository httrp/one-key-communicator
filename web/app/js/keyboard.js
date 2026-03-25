/**
 * Keyboard — renders the on-screen keyboard.
 *
 * Three keyboard modes:
 *   "abc"   — Alphabetical
 *   "smart" — Frequency-reordered
 *   "wild"  — Letters + word suggestions
 *
 * The keyboard renders in one compact flow:
 *   word suggestions (wild) → letters/numbers → space → backspace → ☰ More
 *
 * Action buttons (clear, mode, phrases, speak, punct, pause) live in
 * the toolbar above the keyboard. The Runner scans them separately
 * when ☰ is selected.
 */
const Keyboard = {

    _mode: 'mix',  // Default to mix (letters + word suggestions)
    _showNumbers: false,  // Toggle for numbers row

    /** Number row */
    numbers: '1234567890'.split(''),

    /** Language-specific letter layouts (alphabetical) */
    layouts: {
        de: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00dc'.split(''),
        en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        fr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c9\u00c8\u00ca\u00c0\u00c7\u00d9\u00d4'.split(''),
        es: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c1\u00c9\u00cd\u00d3\u00da\u00d1'.split(''),
        it: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c0\u00c8\u00c9\u00cc\u00d2\u00d9'.split(''),
        nl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        pl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b'.split(''),
        tr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c7\u011e\u0130\u00d6\u015e\u00dc'.split(''),
    },

    /** Punctuation characters per language */
    punctuation: {
        de: ['.','!','?',',',':',';','"','(',')','-','...'],
        en: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        fr: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        es: ['.','!','?',',',':',';','"','(',')','-','\u00a1','\u00bf','...'],
        it: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        nl: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        pl: ['.','!','?',',',':',';','"','(',')','-','...'],
        tr: ['.','!','?',',',':',';','"','(',')','-','...'],
    },

    setMode(mode) { this._mode = mode; },
    getMode() { return this._mode; },
    setShowNumbers(show) { this._showNumbers = show; },
    getShowNumbers() { return this._showNumbers; },

    /**
     * Render main keyboard (letters + space + backspace + ☰).
     * Returns flat array of all scannable elements.
     */
    render(container, lang, currentText) {
        container.innerHTML = '';
        const allKeys = [];
        let letters;
        const currentWord = SmartKeyboard.getCurrentWord(currentText || '');
        const lastChar = currentWord ? currentWord[currentWord.length - 1] : '';
        const flowRow = document.createElement('div');
        flowRow.className = 'keyboard-row keyboard-flow';

        // --- Determine letter order ---
        if (this._mode === 'smart' || this._mode === 'mix') {
            const ordered = SmartKeyboard.getOrderedLetters(lang, lastChar);
            const langLetters = new Set(this.layouts[lang] || this.layouts.en);
            letters = [];
            const seen = new Set();
            for (const ch of ordered) {
                if (langLetters.has(ch) && !seen.has(ch)) { letters.push(ch); seen.add(ch); }
            }
            for (const ch of (this.layouts[lang] || this.layouts.en)) {
                if (!seen.has(ch)) { letters.push(ch); seen.add(ch); }
            }
        } else {
            letters = [...(this.layouts[lang] || this.layouts.en)];
        }

        // --- Word suggestions (mix mode) ---
        if (this._mode === 'mix') {
            const words = SmartKeyboard.getWordSuggestions(lang, currentWord);
            if (words.length > 0) {
                for (const w of words) {
                    const el = this._createKey(w, w, 'key word-key');
                    flowRow.appendChild(el);
                    allKeys.push(el);
                }
            }
        }

        // --- Letters ---
        for (const ch of letters) {
            const el = this._createKey(ch, ch, 'key');
            flowRow.appendChild(el);
            allKeys.push(el);
        }

        // --- Numbers (optional) ---
        if (this._showNumbers) {
            for (const n of this.numbers) {
                const el = this._createKey(n, n, 'key number-key');
                flowRow.appendChild(el);
                allKeys.push(el);
            }
        }

        // --- Space + Backspace + Menu ---
        const spaceEl = this._createKey('\u2423', ' ', 'key space-key extra-wide');
        flowRow.appendChild(spaceEl);
        allKeys.push(spaceEl);

        const bsEl = this._createKey('\u232b', 'BACKSPACE', 'key action-key wide');
        flowRow.appendChild(bsEl);
        allKeys.push(bsEl);

        const menuEl = this._createKey('\u2630 Menü', 'MENU', 'key action-key wide');
        flowRow.appendChild(menuEl);
        allKeys.push(menuEl);

        container.appendChild(flowRow);

        return allKeys;
    },

    /**
     * Render primary toolbar (max 6 scannable items).
     * Only the most-used actions appear here; less-used ones are behind MORE.
     * Returns flat array with BACK at position 0 (first scanned = instant exit).
     */
    renderToolbar(container) {
        container.innerHTML = '';
        const allKeys = [];

        // Primary toolbar: only the 5 most-used actions + MORE for the rest.
        // Kept intentionally flat (no section headers) to reduce visual noise.
        const primaryButtons = [
            { icon: '🔊', label: 'Vorlesen',   value: 'SPEAK'   },
            { icon: '🗑️', label: 'Löschen',    value: 'CLEAR'   },
            { icon: '🔠', label: 'Tastatur',   value: 'KB_MODE' },
            { icon: '💬', label: 'Sätze',      value: 'PHRASES' },
            { icon: '#?!', label: 'Zeichen',   value: 'PUNCT'   },
            { icon: '⚙️', label: 'Mehr …',     value: 'MORE'    },
        ];

        const row = document.createElement('div');
        row.className = 'keyboard-row toolbar-row';
        for (const btn of primaryButtons) {
            const el = document.createElement('div');
            el.className = 'key action-key wide toolbar-scan-btn';
            el.innerHTML = `<span class="toolbar-scan-icon">${btn.icon}</span>` +
                           `<span class="toolbar-scan-label">${btn.label}</span>`;
            el.dataset.value = btn.value;
            row.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(row);

        // Back button — always first scanned (unshift), rendered at bottom for visual clarity.
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = document.createElement('div');
        backEl.className = 'key action-key extra-wide toolbar-back-btn';
        backEl.innerHTML = '<span class="toolbar-scan-icon">⬅️</span><span class="toolbar-scan-label">Zurück</span>';
        backEl.dataset.value = 'BACK';
        backRow.appendChild(backEl);
        allKeys.unshift(backEl);  // position 0: one press exits the menu immediately
        container.appendChild(backRow);

        return allKeys;
    },

    /**
     * Render keyboard mode selection submenu (abc / smart / mix).
     * BACK returns to the primary toolbar.
     */
    renderKbMode(container, currentMode) {
        container.innerHTML = '';
        const allKeys = [];

        const modes = [
            { value: 'abc',   icon: 'A–Z',  label: 'Alphabetisch' },
            { value: 'smart', icon: '★',    label: 'Smart (häufig)' },
            { value: 'mix',   icon: 'A★',   label: 'Mix-Modus'    },
        ];

        const row = document.createElement('div');
        row.className = 'keyboard-row toolbar-row';
        for (const m of modes) {
            const el = document.createElement('div');
            el.className = 'key action-key wide toolbar-scan-btn' +
                           (m.value === currentMode ? ' toolbar-active-btn' : '');
            el.innerHTML = `<span class="toolbar-scan-icon">${m.icon}</span>` +
                           `<span class="toolbar-scan-label">${m.label}</span>`;
            el.dataset.value = m.value;
            row.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(row);

        // BACK — returns to primary toolbar, always first scanned
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = document.createElement('div');
        backEl.className = 'key action-key extra-wide toolbar-back-btn';
        backEl.innerHTML = '<span class="toolbar-scan-icon">⬅️</span><span class="toolbar-scan-label">Zurück</span>';
        backEl.dataset.value = 'BACK';
        backRow.appendChild(backEl);
        allKeys.unshift(backEl);
        container.appendChild(backRow);

        return allKeys;
    },

    /**
     * Render secondary toolbar ("Mehr") with less-used actions.
     * EXIT lives here to prevent accidental session termination.
     * BACK returns to the primary toolbar (not directly to keyboard).
     */
    renderToolbarMore(container) {
        container.innerHTML = '';
        const allKeys = [];

        const moreButtons = [
            { icon: '⏸️', label: 'Pause',     value: 'PAUSE'    },
            { icon: '⏱️', label: 'Tempo',     value: 'SETTINGS' },
            { icon: '🔗', label: 'Teilen',    value: 'SHARE'    },
            { icon: '❓', label: 'Hilfe',     value: 'HELP'     },
            { icon: '🚪', label: 'Beenden',   value: 'EXIT'     },
        ];

        const row = document.createElement('div');
        row.className = 'keyboard-row toolbar-row';
        for (const btn of moreButtons) {
            const el = document.createElement('div');
            el.className = 'key action-key wide toolbar-scan-btn' +
                           (btn.value === 'EXIT' ? ' toolbar-exit-btn' : '');
            el.innerHTML = `<span class="toolbar-scan-icon">${btn.icon}</span>` +
                           `<span class="toolbar-scan-label">${btn.label}</span>`;
            el.dataset.value = btn.value;
            row.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(row);

        // BACK — returns to primary toolbar, always first scanned
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = document.createElement('div');
        backEl.className = 'key action-key extra-wide toolbar-back-btn';
        backEl.innerHTML = '<span class="toolbar-scan-icon">⬅️</span><span class="toolbar-scan-label">Zurück</span>';
        backEl.dataset.value = 'BACK';
        backRow.appendChild(backEl);
        allKeys.unshift(backEl);
        container.appendChild(backRow);

        return allKeys;
    },

    /**
     * Render punctuation page.
     */
    renderPunctuation(container, lang) {
        container.innerHTML = '';
        const allKeys = [];
        const punct = this.punctuation[lang] || this.punctuation.en;

        const perRow = this._getKeysPerRow();
        for (let i = 0; i < punct.length; i += perRow) {
            const row = document.createElement('div');
            row.className = 'keyboard-row';
            for (const ch of punct.slice(i, i + perRow)) {
                const el = this._createKey(ch, ch, 'key wide');
                row.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(row);
        }

        // Back button
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = this._createKey('\u2b05 ' + I18N.t('back'), 'BACK', 'key action-key extra-wide');
        backRow.appendChild(backEl);
        allKeys.push(backEl);
        container.appendChild(backRow);

        return allKeys;
    },

    /**
     * Render quick phrases.
     */
    renderPhrases(container) {
        container.innerHTML = '';
        const phrases = I18N.getPhrases();
        const grid = document.createElement('div');
        grid.className = 'quick-phrases-grid';
        const allBtns = [];

        for (const phrase of phrases) {
            const btn = document.createElement('button');
            btn.className = 'phrase-btn';
            btn.textContent = phrase;
            btn.dataset.value = phrase;
            grid.appendChild(btn);
            allBtns.push(btn);
        }

        // Back button
        const back = document.createElement('button');
        back.className = 'phrase-btn';
        back.textContent = '\u2b05 ' + I18N.t('back');
        back.dataset.value = 'BACK';
        grid.appendChild(back);
        allBtns.push(back);

        container.appendChild(grid);
        return allBtns;
    },

    /** Helper: create a key element */
    _createKey(display, value, css) {
        const el = document.createElement('div');
        el.className = css;
        el.textContent = display;
        el.dataset.value = value;
        return el;
    },

    /** Get keys per row based on CSS variable */
    _getKeysPerRow() {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--keys-per-row');
        return parseInt(v) || 9;
    },
};
