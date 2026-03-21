/**
 * Keyboard — renders the on-screen keyboard.
 *
 * Three keyboard modes:
 *   "abc"   — Alphabetical, space first
 *   "smart" — Frequency-reordered, space promoted when word is long enough
 *   "wild"  — Letters + word suggestions, space promoted
 *
 * The keyboard renders ALL interactive elements in one flat list:
 *   letters → space → backspace → action buttons (clear, mode, phrases, speak, punct, pause)
 *
 * This means the Runner scans through everything in one pass —
 * no separate toolbar/menu mode needed.
 */
const Keyboard = {

    _mode: 'abc',

    /** Language-specific letter layouts (alphabetical) */
    layouts: {
        de: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split(''),
        en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        fr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÉÈÊÀÇÙÔ'.split(''),
        es: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ'.split(''),
        it: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÈÉÌÒÙ'.split(''),
        nl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
        pl: 'ABCDEFGHIJKLMNOPQRSTUVWXYZĄĆĘŁŃÓŚŹŻ'.split(''),
        tr: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİÖŞÜ'.split(''),
    },

    /** Punctuation characters per language */
    punctuation: {
        de: ['.','!','?',',',':',';','"','(',')','-','...'],
        en: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        fr: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        es: ['.','!','?',',',':',';','"','(',')','-','¡','¿','...'],
        it: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        nl: ['.','!','?',',',':',';','"','\'','(',')','-','...'],
        pl: ['.','!','?',',',':',';','"','(',')','-','...'],
        tr: ['.','!','?',',',':',';','"','(',')','-','...'],
    },

    /** Action buttons rendered inline with keyboard */
    actions: [
        { id: 'BACKSPACE', icon: '⌫',  label: '' },
        { id: 'CLEAR',     icon: '🗑',  labelKey: 'clear' },
        { id: 'KB_MODE',   icon: '🔤',  labelKey: 'mode_keyboard' },
        { id: 'PHRASES',   icon: '💬',  labelKey: 'mode_phrases' },
        { id: 'PUNCT',     icon: '#?!', label: '' },
        { id: 'SPEAK',     icon: '🔊',  labelKey: 'speak' },
        { id: 'PAUSE',     icon: '⏸',   labelKey: 'pause' },
    ],

    setMode(mode) { this._mode = mode; },
    getMode() { return this._mode; },

    /**
     * Render main keyboard.
     * Returns flat array of all scannable elements.
     */
    render(container, lang, currentText) {
        container.innerHTML = '';
        const allKeys = [];
        let letters;
        const currentWord = SmartKeyboard.getCurrentWord(currentText || '');
        const lastChar = currentWord ? currentWord[currentWord.length - 1] : '';

        // --- Determine letter order ---
        if (this._mode === 'smart' || this._mode === 'wild') {
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

        // --- Word suggestions row (wild mode) ---
        if (this._mode === 'wild') {
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

        // --- Space positioning ---
        const promoteSpace = (this._mode !== 'abc')
            ? SmartKeyboard.shouldPromoteSpace(lang, currentWord)
            : true;  // ABC mode: space always first

        // If promoting space, add it before letters
        if (promoteSpace) {
            const spaceRow = document.createElement('div');
            spaceRow.className = 'keyboard-row';
            const spaceEl = this._createKey('␣', ' ', 'key space-key extra-wide');
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
            const spaceEl = this._createKey('␣', ' ', 'key space-key extra-wide');
            spaceRow.appendChild(spaceEl);
            allKeys.push(spaceEl);
            container.appendChild(spaceRow);
        }

        // --- Action row ---
        const actionRow = document.createElement('div');
        actionRow.className = 'keyboard-row';
        for (const act of this.actions) {
            const label = act.labelKey ? I18N.t(act.labelKey) : act.label;
            const isPause = act.id === 'PAUSE';
            const css = 'key action-key' + (isPause ? ' pause-key' : '') + ' wide';
            const el = document.createElement('div');
            el.className = css;
            el.dataset.value = act.id;
            if (label) {
                el.innerHTML = '<span class="action-icon">' + act.icon + '</span><span class="action-label">' + label + '</span>';
            } else {
                el.innerHTML = '<span class="action-icon">' + act.icon + '</span>';
            }
            actionRow.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(actionRow);

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
        const backEl = this._createKey('⬅ ' + I18N.t('back'), 'BACK', 'key action-key extra-wide');
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
        back.textContent = '⬅ ' + I18N.t('back');
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
