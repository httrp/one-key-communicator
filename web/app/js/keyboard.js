/**
 * Keyboard — renders the on-screen keyboard and quick phrases.
 */
const Keyboard = {
    /** Language-specific keyboard layouts */
    layouts: {
        de: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['Ä','Ö','Ü','ß','.','!','?',','],
            ['⎵','⌫','↵','✓']
        ],
        en: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['.','!','?',',','\'','-'],
            ['⎵','⌫','↵','✓']
        ],
        fr: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['É','È','Ê','Ë','À','Ç','Ù','Ô','Î'],
            ['.','!','?',',','\''],
            ['⎵','⌫','↵','✓']
        ],
        es: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['Á','É','Í','Ó','Ú','Ñ','Ü','¡','¿'],
            ['.','!','?',','],
            ['⎵','⌫','↵','✓']
        ],
        it: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['À','È','É','Ì','Ò','Ù'],
            ['.','!','?',',','\''],
            ['⎵','⌫','↵','✓']
        ],
        nl: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['.','!','?',',','\'','-'],
            ['⎵','⌫','↵','✓']
        ],
        pl: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['Ą','Ć','Ę','Ł','Ń','Ó','Ś','Ź','Ż'],
            ['.','!','?',','],
            ['⎵','⌫','↵','✓']
        ],
        tr: [
            ['A','B','C','D','E','F','G','H','I'],
            ['J','K','L','M','N','O','P','Q','R'],
            ['S','T','U','V','W','X','Y','Z'],
            ['Ç','Ğ','İ','Ö','Ş','Ü'],
            ['.','!','?',','],
            ['⎵','⌫','↵','✓']
        ],
    },

    /** Special key display names and CSS classes */
    specialKeys: {
        '⎵': { display: '⎵', class: 'extra-wide', value: ' ' },
        '⌫': { display: '⌫', class: 'wide', value: 'BACKSPACE' },
        '↵': { display: '↵', class: 'wide', value: 'NEWLINE' },
        '✓': { display: '✓', class: 'wide', value: 'DONE' },
    },

    /**
     * Render keyboard into container.
     * @param {HTMLElement} container
     * @param {string} lang
     * @returns {HTMLElement[]} flat array of key elements for the Runner
     */
    render(container, lang) {
        container.innerHTML = '';
        const layout = this.layouts[lang] || this.layouts.en;
        const allKeys = [];

        for (const row of layout) {
            const rowEl = document.createElement('div');
            rowEl.className = 'keyboard-row';

            for (const key of row) {
                const keyEl = document.createElement('div');
                const special = this.specialKeys[key];

                keyEl.className = 'key';
                if (special) {
                    keyEl.textContent = special.display;
                    keyEl.dataset.value = special.value;
                    if (special.class) keyEl.classList.add(special.class);
                } else {
                    keyEl.textContent = key;
                    keyEl.dataset.value = key;
                }

                rowEl.appendChild(keyEl);
                allKeys.push(keyEl);
            }

            container.appendChild(rowEl);
        }

        return allKeys;
    },

    /**
     * Render quick phrases into container.
     * @param {HTMLElement} container
     * @returns {HTMLElement[]} array of phrase button elements
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

        container.appendChild(grid);
        return allBtns;
    }
};
