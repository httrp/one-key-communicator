/**
 * SmartKeyboard — Frequency-based letter ordering.
 *
 * Uses bigram frequencies (which letter follows which) to reorder the keyboard
 * so the most likely next letter is scanned first. Similar to T9 / Smart TV input.
 *
 * Also handles intelligent space positioning:
 *   - In smart/mix modes, space is promoted when a word boundary is likely.
 *
 * User word tracking:
 *   - Remembers frequently used words and suggests them in mix mode.
 */
const SmartKeyboard = {

    // User word frequency storage key
    _userWordsKey: 'okc-user-words',
    _maxUserWords: 100,

    // =========================================================================
    // LETTER FREQUENCY DATA (unigram — used for first letter / after space)
    // =========================================================================
    unigram: {
        de: 'EISNRATDHULCGMOBWFKZPVJYXQ',
        en: 'ETAOINSRHLDCUMFPGWYBVKXJQZ',
        fr: 'ESAITNRULODCMPVQGFBHJXYZWK',
        es: 'EAOSRNIDLCTUMPBGVYQHFZJXWK',
        it: 'EAIONLRTSCDUPMVGHFBZQWXYJK',
        nl: 'ENATIRODSLGHVKMUBPWJCZFXYQ',
        pl: 'IAEOZNSWRCYDKPMTLJUGHBFQVX',
        tr: 'AEINRLKDMYSTUOBCHGZPVFJWXQ',
    },

    // =========================================================================
    // BIGRAM TABLES — Top followers for each letter
    // =========================================================================
    bigrams: {
        de: {
            A: 'NULSRTBCMGDEFKHIPWZ',
            B: 'EIRAOUSTLBNDHGKWC',
            C: 'HKEIAOUSTRL',
            D: 'EIAOUSRNTHDBGWLMK',
            E: 'RNISLTBHGDMCKWUAFP',
            F: 'EATRIOUFLSNGHBWDK',
            G: 'EIRAOUSTLNBGHWDK',
            H: 'EIAOURNLTSM',
            I: 'NETSCLEGDMRBAKHFOUW',
            J: 'AEUIOJRHNT',
            K: 'AEIOTULRNSHK',
            L: 'EIALOUSTDNBRGF',
            M: 'EIAOMNTPUSLRB',
            N: 'EDGISTNAUOKBFZCRWLHM',
            O: 'NRDLMBCHSPGFTKEAUWV',
            P: 'REAIOFLHSTUP',
            Q: 'U',
            R: 'EIAODUSTNBGHKWLM',
            S: 'TCEIHPASOKLNUWBDGMR',
            T: 'EIRAZHOUSTLW',
            U: 'NRSCTELBMFGDAKHP',
            V: 'OEIAURW',
            W: 'AEIOURN',
            X: 'EIPT',
            Y: 'SMEANPRL',
            Z: 'UWEIAOZLRT',
        },
        en: {
            A: 'NLTRSDCBMKGPIVYWFXHE',
            B: 'ELOAIURYBST',
            C: 'OEHAKTILRUCS',
            D: 'EIAOSURLYNWG',
            E: 'RNDSTALCVMXPWFGHOBI',
            F: 'OIRATELFUS',
            G: 'EHROAIULSNTG',
            H: 'EIOARUYST',
            I: 'NTSCELODGMVRAFKBP',
            J: 'UOEAI',
            K: 'EINSOAW',
            L: 'EIALOYUDLSTF',
            M: 'EAIOUPBNSM',
            N: 'GDETISOACKN',
            O: 'NFURTMWDLSPVKCGBIA',
            P: 'EROALIHUPTS',
            Q: 'U',
            R: 'EIAOSMTYDNULK',
            S: 'TEHOISALCUPKWM',
            T: 'HIOEARSULTYW',
            U: 'RNSTLCPGBEMI',
            V: 'EIAO',
            W: 'AIOEHNRS',
            X: 'PTICEA',
            Y: 'SOETAMIWLP',
            Z: 'EAIZO',
        },
        fr: {
            A: 'NITRSLUCBPMDVGEFX',
            B: 'LAEIROSUT',
            C: 'OEAHITULRSQ',
            D: 'EIAORUS',
            E: 'SNRTLDCMPVUFAXEQGBI',
            F: 'AEIROFLU',
            G: 'ERANILU',
            H: 'EOAIUYRS',
            I: 'NETLSROCADQMVFGB',
            J: 'OEUAI',
            K: 'AI',
            L: 'EIALOUSPT',
            M: 'EAIOPBMNUL',
            N: 'ETDSCOIAGUN',
            O: 'NURFMTILSDCPBGVEA',
            P: 'REAOLHIUPS',
            Q: 'U',
            R: 'EIAOSMTNDURL',
            S: 'ETIOSUPQCAL',
            T: 'EIAORUSYTH',
            U: 'RNSETXLCIPDMAG',
            V: 'EAIOR',
            W: 'AIO',
            X: 'EITPCA',
            Y: 'AESMON',
            Z: 'AEIZO',
        },
        es: {
            A: 'RNLSDCBMTPGVQUFIE',
            B: 'LAIREOUS',
            C: 'OEIAHUTLRS',
            D: 'EIAORUS',
            E: 'SNRLCMDTAPVGXFQB',
            F: 'EIAOURL',
            G: 'UEARILO',
            H: 'AEIOU',
            I: 'ENSOCDALTMRVGBF',
            J: 'AOIEU',
            K: 'AEI',
            L: 'EIAOLUSTD',
            M: 'EIAOUBPN',
            N: 'ETDOSIACGU',
            O: 'NRSDCLMPBGFTVE',
            P: 'REOAIULHS',
            Q: 'U',
            R: 'EIAOSMTNDURL',
            S: 'ETIOAUPCSL',
            T: 'REIAOUSH',
            U: 'ESNRALCTDM',
            V: 'EIAOR',
            W: 'AIO',
            X: 'EITPCA',
            Y: 'AEO',
            Z: 'AEIO',
        },
    },

    // =========================================================================
    // WORD SUGGESTION TABLES (for wild mode)
    // =========================================================================
    wordSuggestions: {
        de: {
            '': ['ICH','DU','JA','NEIN','BITTE','DANKE','HILFE','HALLO'],
            'I': ['ICH','IST','IM','IN','IMMER'],
            'IC': ['ICH'],
            'D': ['DAS','DER','DIE','DU','DANKE','DOCH','DENN'],
            'DA': ['DAS','DANKE','DANN','DA','DAMIT'],
            'DI': ['DIE','DIES','DIR','DICH'],
            'E': ['EIN','ES','EINE','EINER'],
            'EI': ['EIN','EINE','EINER'],
            'N': ['NICHT','NEIN','NOCH','NUR','NACH'],
            'NI': ['NICHT','NIE','NICHTS'],
            'W': ['WIR','WAS','WIE','WILL','WEIL','WASSER'],
            'WA': ['WAS','WASSER','WARM','WANN'],
            'H': ['HABE','HABEN','HILFE','HALLO','HUNGER'],
            'HA': ['HABE','HABEN','HALLO','HUNGER'],
            'HI': ['HILFE','HIER','HIN'],
            'B': ['BIN','BITTE','BRAUCHE'],
            'BI': ['BIN','BITTE','BIS'],
            'BR': ['BRAUCHE','BRAUCH'],
            'M': ['MIR','MICH','MEIN','MIT','MEHR'],
            'MI': ['MIR','MICH','MIT'],
            'S': ['SIND','SIE','SCHMERZEN','SCHLECHT'],
            'SC': ['SCHMERZEN','SCHLECHT','SCHON'],
            'J': ['JA'],
            'K': ['KANN','KALT','KEIN'],
            'G': ['GUT','GERNE','GEHEN'],
            'L': ['LIEBE','LICHT'],
            'LI': ['LIEBE','LICHT'],
            'F': ['FERNSEHER','FEIN'],
            'T': ['TOILETTE','TUT'],
            'TO': ['TOILETTE'],
            'A': ['AUCH','AUS','ABER'],
        },
        en: {
            '': ['I','YES','NO','PLEASE','THANKS','HELP','HELLO','WATER'],
            'I': ['I'],
            'Y': ['YES','YOU','YOUR'],
            'YE': ['YES'],
            'N': ['NO','NEED','NOT','NOW'],
            'NO': ['NO','NOT','NOW'],
            'NE': ['NEED','NEVER'],
            'P': ['PLEASE','PAIN'],
            'PL': ['PLEASE'],
            'PA': ['PAIN'],
            'T': ['THE','THANK','THANKS','TIRED','THAT','THIS','THIRSTY'],
            'TH': ['THE','THANK','THANKS','THAT','THIS','THIRSTY'],
            'H': ['HELP','HELLO','HAVE','HOT','HUNGRY','HURT'],
            'HE': ['HELP','HELLO'],
            'HU': ['HUNGRY','HURT'],
            'W': ['WANT','WATER','WHAT','WHERE','WITH'],
            'WA': ['WANT','WATER','WARM'],
            'C': ['CAN','COLD','COME'],
            'CO': ['COLD','COME'],
            'L': ['LOVE','LIGHT','LIKE'],
            'LO': ['LOVE'],
            'LI': ['LIGHT','LIKE'],
            'B': ['BATHROOM','BED'],
            'BA': ['BATHROOM'],
            'F': ['FEEL','FINE','FOOD'],
            'FE': ['FEEL'],
        },
        fr: {
            '': ['OUI','NON','MERCI','AIDE','BONJOUR','EAU','FAIM'],
            'O': ['OUI'],
            'N': ['NON'],
            'M': ['MERCI','MAL'],
            'ME': ['MERCI'],
            'A': ['AIDE','AVOIR'],
            'AI': ['AIDE'],
            'B': ['BONJOUR','BESOIN','BOIRE'],
            'E': ['EAU','EST'],
            'F': ['FAIM','FROID','FATIGUE'],
            'J': ['JE'],
        },
        es: {
            '': ['SI','NO','GRACIAS','AYUDA','HOLA','AGUA','DOLOR'],
            'S': ['SI'],
            'N': ['NO','NECESITO'],
            'G': ['GRACIAS'],
            'A': ['AYUDA','AGUA'],
            'H': ['HOLA','HAMBRE'],
            'D': ['DOLOR'],
        },
    },

    // =========================================================================
    // AVERAGE WORD LENGTH BY LANGUAGE (for smart space positioning)
    // =========================================================================
    avgWordLen: { de: 5, en: 4, fr: 5, es: 5, it: 5, nl: 5, pl: 6, tr: 6 },

    /**
     * Get ordered letters based on bigram frequency.
     * @param {string} lang
     * @param {string} lastChar - the last typed character (uppercase)
     * @returns {string[]} ordered letter array
     */
    getOrderedLetters(lang, lastChar) {
        // If we have bigram data for this language and letter, use it
        const langBigrams = this.bigrams[lang];
        if (langBigrams && lastChar && langBigrams[lastChar.toUpperCase()]) {
            return langBigrams[lastChar.toUpperCase()].split('');
        }
        // Fallback: unigram frequency
        const freq = this.unigram[lang] || this.unigram.en;
        return freq.split('');
    },

    /**
     * Extract the current (partially typed) word from text.
     * @param {string} text
     * @returns {string}
     */
    getCurrentWord(text) {
        if (!text) return '';
        const match = text.match(/[a-zA-ZäöüÄÖÜßàáâãéèêëìíîïòóôõùúûüñçğışÁÉÍÓÚÑĄĆĘŁŃŚŹŻ]+$/);
        return match ? match[0] : '';
    },

    /**
     * Determine if space should be promoted (placed early in scan order).
     * Based on current word length vs average word length for language.
     * @param {string} lang
     * @param {string} currentWord
     * @returns {boolean}
     */
    shouldPromoteSpace(lang, currentWord) {
        if (!currentWord || currentWord.length === 0) return false;
        const avg = this.avgWordLen[lang] || 5;
        // Promote space when current word is at or above average length
        return currentWord.length >= avg - 1;
    },

    // =========================================================================
    // USER WORD FREQUENCY TRACKING
    // =========================================================================

    /**
     * Get stored user words with frequencies.
     * @returns {Object} { word: count }
     */
    getUserWords() {
        try {
            const stored = localStorage.getItem(this._userWordsKey);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            return {};
        }
    },

    /**
     * Record a word the user typed (called when word is completed).
     * @param {string} word
     */
    recordUserWord(word) {
        if (!word || word.length < 2) return;
        const normalized = word.toUpperCase().trim();
        if (!/^[A-ZÄÖÜÉÈÊÀÇÙÔÁÍÓÚÑĄĆĘŁŃŚŹŻ]+$/.test(normalized)) return;
        
        const words = this.getUserWords();
        words[normalized] = (words[normalized] || 0) + 1;
        
        // Prune to max words (keep most frequent)
        const entries = Object.entries(words);
        if (entries.length > this._maxUserWords) {
            entries.sort((a, b) => b[1] - a[1]);
            const pruned = Object.fromEntries(entries.slice(0, this._maxUserWords));
            localStorage.setItem(this._userWordsKey, JSON.stringify(pruned));
        } else {
            localStorage.setItem(this._userWordsKey, JSON.stringify(words));
        }
    },

    /**
     * Get word suggestions including user's frequent words.
     * @param {string} lang
     * @param {string} currentWord
     * @returns {string[]} up to 6 word suggestions (user words first)
     */
    getWordSuggestions(lang, currentWord) {
        const table = this.wordSuggestions[lang] || this.wordSuggestions.en || {};
        const prefix = (currentWord || '').toUpperCase();
        
        // Get user's frequent words matching prefix
        const userWords = this.getUserWords();
        const userMatches = Object.entries(userWords)
            .filter(([word]) => prefix.length === 0 || word.startsWith(prefix))
            .sort((a, b) => b[1] - a[1])  // Sort by frequency
            .map(([word]) => word)
            .slice(0, 3);  // Max 3 user words
        
        // Get built-in suggestions
        let builtIn = [];
        for (let len = prefix.length; len >= 0; len--) {
            const key = prefix.slice(0, len);
            if (table[key]) {
                const filtered = prefix.length > 0
                    ? table[key].filter(w => w.startsWith(prefix))
                    : table[key];
                if (filtered.length > 0) {
                    builtIn = filtered;
                    break;
                }
                builtIn = table[key];
                break;
            }
        }

        // Merge: user words first, then built-in (deduplicated)
        const seen = new Set(userMatches);
        const merged = [...userMatches];
        for (const w of builtIn) {
            if (!seen.has(w) && merged.length < 6) {
                merged.push(w);
                seen.add(w);
            }
        }
        return merged;
    },

    /**
     * Clear user word history.
     */
    clearUserWords() {
        localStorage.removeItem(this._userWordsKey);
    },
};
