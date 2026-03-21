/**
 * Keyboard — renders the on-screen keyboard and quick phrases.
 *
 * Supports three keyboard modes:
 *   "abc"   — Standard alphabetical layout
 *   "smart" — Letters reordered by bigram frequency after each keystroke
 *   "wild"  — Letters + word suggestions mixed
 *
 * Navigation keys added to every mode so the entire app
 * can be operated with a single key:
 *   ☰ MENU    — switch to toolbar scanning
 *   ⏸ PAUSE   — enter pause/lock mode
 */
const Keyboard = {

    /** Current keyboard mode: 'abc', 'smart', 'wild' */
    _mode: 'abc',

    /** Language-specific keyboard base layouts (alphabetical) */
    layouts: {
        de: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','Ä','Ö','Ü','ß'],
        en: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
        fr: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','É','È','Ê','Ë','À','Ç','Ù','Ô','Î'],
        es: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','Á','É','Í','Ó','Ú','Ñ','Ü'],
        it: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','À','È','É','Ì','Ò','Ù'],
        nl: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'],
        pl: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','Ą','Ć','Ę','Ł','Ń','Ó','Ś','Ź','Ż'],
        tr: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','Ç','Ğ','İ','Ö','Ş','Ü'],
    },

    /** Punctuation per language */
    punctuation: {
        de: ['.','!','?',','],
        en: ['.','!','?',',','\'','-'],
        fr: ['.','!','?',',','\''],
        es: ['.','!','?',',','¡','¿'],
        it: ['.','!','?',',','\''],
        nl: ['.','!','?',',','\'','-'],
        pl: ['.','!','?',','],
        tr: ['.','!','?',','],
    },

    /** Special key display and values */
    specialKeys: {
        '⎵':  { display: '␣',  css: 'extra-wide', value: ' ' },
        '⌫':  { display: '⌫',  css: 'wide',       value: 'BACKSPACE' },
        '↵':  { display: '↵',  css: 'wide',       value: 'NEWLINE' },
        '✓':  { display: '✓',  css: 'wide',       value: 'DONE' },
        '☰':  { display: '☰',  css: 'wide nav-key', value: 'MENU' },
        '⏸':  { display: '⏸',  css: 'wide nav-key pause-key', value: 'PAUSE' },
    },

    /** Set the keyboard mode */
    setMode(mode) {
        this._mode = mode;
    },

    /** Get current mode */
    getMode() {
        return this._mode;
    },

    /**
     * Render keyboard with current mode.
     * @param {HTMLElement} container
     * @param {string} lang
     * @param {string} currentText - text typed so far (for smart/wild modes)
     * @returns {HTMLElement[]} flat array of key elements for the Runner
     */
    render(container, lang, currentText) {
        container.innerHTML = '';

        let letters;
        let wordBtns = [];

        if (this._mode === 'smart' || this._mode === 'wild') {
            // Get the last typed character for bigram lookup
            const currentWord = SmartKeyboard.getCurrentWord(currentText || '');
            const lastChar = currentWord ? currentWord[currentWord.length - 1] : '';
            const ordered = SmartKeyboard.getOrderedLetters(lang, lastChar);

            // Filter to only letters available in this language
            const langLetters = new Set(this.layouts[lang] || this.layouts.en);
            letters = [];
            const seen = new Set();
            for (const ch of ordered) {
                if (langLetters.has(ch) && !seen.has(ch)) {
                    letters.push(ch);
                    seen.add(ch);
                }
            }
            // Add any remaining language-specific chars (umlauts, accents)
            for (const ch of (this.layouts[lang] || this.layouts.en)) {
                if (!seen.has(ch)) {
                    letters.push(ch);
                    seen.add(ch);
                }
            }

            // Wild mode: get word suggestions
            if (this._mode === 'wild') {
                wordBtns = SmartKeyboard.getWordSuggestions(lang, currentWord);
            }
        } else {
            // ABC mode: plain alphabetical
            letters = [...(this.layouts[lang] || this.layouts.en)];
        }

        const punct = this.punctuation[lang] || this.punctuation.en;
        const allKeys = [];

        // --- Word suggestions row (wild mode only) ---
        if (wordBtns.length > 0) {
            const wordRow = document.createElement('div');
            wordRow.className = 'keyboard-row word-row';
            for (const word of wordBtns) {
                const el = this._createKey(word, word, 'word-key');
                wordRow.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(wordRow);
        }

        // --- Letter rows (adaptive row size) ---
        const perRow = window.innerWidth < 480 ? 7 : 9;
        for (let i = 0; i < letters.length; i += perRow) {
            const rowEl = document.createElement('div');
            rowEl.className = 'keyboard-row';
            const slice = letters.slice(i, i + perRow);
            for (const ch of slice) {
                const el = this._createKey(ch, ch, 'key');
                rowEl.appendChild(el);
                allKeys.push(el);
            }
            container.appendChild(rowEl);
        }

        // --- Punctuation row ---
        const punctRow = document.createElement('div');
        punctRow.className = 'keyboard-row';
        for (const p of punct) {
            const el = this._createKey(p, p, 'key');
            punctRow.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(punctRow);

        // --- Action row: Space, Backspace, Newline, Done ---
        const actionRow = document.createElement('div');
        actionRow.className = 'keyboard-row';
        for (const sym of ['⎵', '⌫', '↵', '✓']) {
            const spec = this.specialKeys[sym];
            const el = this._createKey(spec.display, spec.value, 'key ' + spec.css);
            actionRow.appendChild(el);
            allKeys.push(el);
        }
        container.appendChild(actionRow);

        // --- Navigation row: Pause, Menu ---
        const navRow = document.createElement('div');
        navRow.className = 'keyboard-row nav-row';
        for (const sym of ['⏸', '☰']) {
            const spec = this.specialKeys[sym];
            const el = this._createKey(spec.display, spec.value, 'key ' + spec.css);
            actionRow.appendChild(el);
            allKeys.push(el);
        }
        // nav row keys are added to action row to keep compact

        return allKeys;
    },

    /**
     * Render toolbar actions as scannable keys.
     * Called when user selects ☰ MENU from keyboard.
     * @param {HTMLElement} container
     * @returns {HTMLElement[]}
     */
    renderToolbar(container) {
        container.innerHTML = '';
        const allKeys = [];

        const actions = [
            { label: I18N.t('tb_clear'),    value: 'TB_CLEAR',    icon: '🗑' },
            { label: I18N.t('tb_share'),    value: 'TB_SHARE',    icon: '📤' },
            { label: I18N.t('tb_settings'), value: 'TB_SETTINGS', icon: '⚙' },
            { label: I18N.t('tb_phrases'),  value: 'TB_PHRASES',  icon: '💬' },
            { label: I18N.t('tb_mode'),     value: 'TB_MODE',     icon: '🔤' },
            { label: I18N.t('tb_speed_up'), value: 'TB_FASTER',   icon: '⏩' },
            { label: I18N.t('tb_speed_dn'), value: 'TB_SLOWER',   icon: '⏪' },
            { label: I18N.t('tb_back'),     value: 'TB_BACK',     icon: '⬅' },
        ];

        const grid = document.createElement('div');
        grid.className = 'toolbar-grid';

        for (const act of actions) {
            const el = document.createElement('div');
            el.className = 'key toolbar-key';
            el.dataset.value = act.value;
            el.innerHTML = '<span class="tb-icon">' + act.icon + '</span><span class="tb-label">' + act.label + '</span>';
            grid.appendChild(el);
            allKeys.push(el);
        }

        container.appendChild(grid);
        return allKeys;
    },

    /**
     * Render quick phrases.
     * @param {HTMLElement} container
     * @returns {HTMLElement[]}
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

        // Add a "back" button at the end
        const backBtn = document.createElement('button');
        backBtn.className = 'phrase-btn nav-key';
        backBtn.textContent = '⬅ ' + I18N.t('tb_back');
        backBtn.dataset.value = 'TB_BACK';
        grid.appendChild(backBtn);
        allBtns.push(backBtn);

        container.appendChild(grid);
        return allBtns;
    },

    /** Helper: create a key element */
    _createKey(display, value, cssClass) {
        const el = document.createElement('div');
        el.className = cssClass;
        el.textContent = display;
        el.dataset.value = value;
        return el;
    },
};
