/**
 * Keyboard — renders the on-screen keyboard.
 *
 * Three keyboard modes:
 *   "abc"   — Alphabetical, space first
 *   "smart" — Frequency-reordered, space promoted when word is long enough
 *   "wild"  — Letters + word suggestions, space promoted
 *
 * The keyboard renders ONLY letter/word keys:
 *   word suggestions (wild) → space → letters → backspace → ☰ More
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

        // --- Word suggestions row (mix mode) ---
        if (this._mode === 'mix') {
            const words = SmartKeyboard.getWordSuggestions(lang, currentWord);
            if (words.length > 0) {
                const row = document.createElement('div');
                row.className = 'keyboard-row word-row';
                for (const w of words) {
                    const el = this._createKey(w, w, 'key word-key');
                    row.appendChild(el);
                    allKeys.push(el);
                }
                container.appendChild(row);
            }
        }

        // --- Numbers row (if enabled) ---
        if (this._showNumbers) {
            const numRow = document.createElement('div');
            numRow.className = 'keyboard-row';
            for (const n of this.numbers) {
                const el = this._createKey(n, n, 'key number-key');
                numRow.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(numRow);
        }

        // --- Space positioning ---
        const promoteSpace = (this._mode !== 'abc')
            ? SmartKeyboard.shouldPromoteSpace(lang, currentWord)
            : true;  // ABC mode: space always first

        // If promoting space, add it before letters
        if (promoteSpace) {
            const spaceRow = document.createElement('div');
            spaceRow.className = 'keyboard-row';
            const spaceEl = this._createKey('\u2423', ' ', 'key space-key extra-wide');
            spaceRow.appendChild(spaceEl);
            allKeys.push(spaceEl);
            container.appendChild(spaceRow);
        }

        // --- Letter rows ---
        const perRow = this._getKeysPerRow();
        for (let i = 0; i < letters.length; i += perRow) {
            const row = document.createElement('div');
            row.className = 'keyboard-row';
            for (const ch of letters.slice(i, i + perRow)) {
                const el = this._createKey(ch, ch, 'key');
                row.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(row);
        }

        // If not promoting space, add it after letters
        if (!promoteSpace) {
            const spaceRow = document.createElement('div');
            spaceRow.className = 'keyboard-row';
            const spaceEl = this._createKey('\u2423', ' ', 'key space-key extra-wide');
            spaceRow.appendChild(spaceEl);
            allKeys.push(spaceEl);
            container.appendChild(spaceRow);
        }

        // --- Bottom row: Backspace + Menu ---
        const bottomRow = document.createElement('div');
        bottomRow.className = 'keyboard-row';

        const bsEl = this._createKey('\u232b', 'BACKSPACE', 'key action-key wide');
        bottomRow.appendChild(bsEl);
        allKeys.push(bsEl);

        const menuEl = this._createKey('\u2630 Menü', 'MENU', 'key action-key wide');
        bottomRow.appendChild(menuEl);
        allKeys.push(menuEl);

        container.appendChild(bottomRow);

        return allKeys;
    },

    /**
     * Render toolbar as scannable buttons (separate mode).
     * Returns flat array of toolbar elements + back button.
     */
    renderToolbar(container) {
        container.innerHTML = '';
        const allKeys = [];

        const toolbarBtns = [
            { icon: '🔠', label: 'Mode', value: 'KB_MODE' },
            { icon: '💬', label: 'Sätze', value: 'PHRASES' },
            { icon: '#?!', label: '', value: 'PUNCT' },
            { icon: '🔊', label: 'Vorlesen', value: 'SPEAK' },
            { icon: '🗑', label: 'Löschen', value: 'CLEAR' },
            { icon: '⏸', label: 'Pause', value: 'PAUSE' },
            { icon: '🔗', label: 'Teilen', value: 'SHARE' },
            { icon: '⚙', label: 'Tempo', value: 'SETTINGS' },
            { icon: '?', label: 'Hilfe', value: 'HELP' },
        ];

        // Create rows of 3 buttons each
        for (let i = 0; i < toolbarBtns.length; i += 3) {
            const row = document.createElement('div');
            row.className = 'keyboard-row';
            for (const btn of toolbarBtns.slice(i, i + 3)) {
                const el = document.createElement('div');
                el.className = 'key action-key wide toolbar-scan-btn';
                el.innerHTML = `<span class="toolbar-scan-icon">${btn.icon}</span>` +
                               (btn.label ? `<span class="toolbar-scan-label">${btn.label}</span>` : '');
                el.dataset.value = btn.value;
                row.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(row);
        }

        // Back button
        const backRow = document.createElement('div');
        backRow.className = 'keyboard-row';
        const backEl = this._createKey('\u2b05 Zurück', 'BACK', 'key action-key extra-wide');
        backRow.appendChild(backEl);
        allKeys.push(backEl);
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
