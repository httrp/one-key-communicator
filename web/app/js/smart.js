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
            '': ['ICH','DU','JA','NEIN','BITTE','DANKE','HILFE','GUT'],
            'I': ['ICH','IST','IM','IN','IMMER'],
            'IC': ['ICH'],
            'D': ['DAS','DER','DIE','DU','DANKE','DOCH','DENN'],
            'DA': ['DAS','DANKE','DANN','DA','DAMIT'],
            'DI': ['DIE','DIES','DIR','DICH'],
            'E': ['EIN','ES','EINE','EINER','ESSEN'],
            'EI': ['EIN','EINE','EINER'],
            'N': ['NICHT','NEIN','NOCH','NUR','NACH'],
            'NI': ['NICHT','NIE','NICHTS'],
            'W': ['WIR','WAS','WIE','WILL','WEIL','WASSER','WARM'],
            'WA': ['WAS','WASSER','WARM','WANN'],
            'H': ['HABE','HABEN','HILFE','HUNGER','HEUTE'],
            'HA': ['HABE','HABEN','HUNGER'],
            'HI': ['HILFE','HIER','HIN'],
            'B': ['BIN','BITTE','BRAUCHE','BESSER','BETT'],
            'BI': ['BIN','BITTE','BIS'],
            'BR': ['BRAUCHE','BRAUCH'],
            'BE': ['BESSER','BETT'],
            'M': ['MIR','MICH','MEIN','MIT','MEHR','MOMENT','MEDIKAMENTE'],
            'MI': ['MIR','MICH','MIT'],
            'MO': ['MOMENT','MORGEN'],
            'ME': ['MEHR','MEDIKAMENTE'],
            'S': ['SIND','SIE','SCHMERZEN','SCHLECHT','SETZEN'],
            'SC': ['SCHMERZEN','SCHLECHT','SCHON'],
            'SE': ['SETZEN'],
            'J': ['JA','JETZT'],
            'K': ['KANN','KALT','KEIN','KOMMEN','KOPF'],
            'KO': ['KOMMEN','KOPF'],
            'G': ['GUT','GERNE','GEHEN','GEHT'],
            'GE': ['GERNE','GEHEN','GEHT'],
            'L': ['LIEBE','LICHT','LIEGEN','LEGEN'],
            'LI': ['LIEBE','LICHT','LIEGEN'],
            'LE': ['LEGEN'],
            'F': ['FERNSEHER','FEIN','FERTIG'],
            'FE': ['FERNSEHER','FERTIG'],
            'T': ['TOILETTE','TUT','TRINKEN'],
            'TO': ['TOILETTE'],
            'TR': ['TRINKEN'],
            'A': ['AUCH','AUS','ABER','ALLES','AUFSTEHEN'],
            'AU': ['AUCH','AUS','AUFSTEHEN'],
            'AL': ['ALLES'],
            'O': ['OKAY','OB'],
            'R': ['RUHE','RUFEN'],
            'Z': ['ZU','ZURÜCK'],
        },
        en: {
            '': ['I','YES','NO','PLEASE','THANKS','HELP','OKAY','WATER'],
            'I': ['I','IN','IT','IS'],
            'Y': ['YES','YOU','YOUR'],
            'YE': ['YES'],
            'N': ['NO','NEED','NOT','NOW','NURSE'],
            'NO': ['NO','NOT','NOW'],
            'NE': ['NEED','NEVER'],
            'P': ['PLEASE','PAIN','PILLOW'],
            'PL': ['PLEASE'],
            'PA': ['PAIN'],
            'T': ['THE','THANK','THANKS','TIRED','THAT','THIS','THIRSTY','TV'],
            'TH': ['THE','THANK','THANKS','THAT','THIS','THIRSTY'],
            'TI': ['TIRED','TIME'],
            'H': ['HELP','HELLO','HAVE','HOT','HUNGRY','HURT','HOME'],
            'HE': ['HELP','HELLO'],
            'HU': ['HUNGRY','HURT'],
            'HO': ['HOT','HOME'],
            'W': ['WANT','WATER','WHAT','WHERE','WITH','WAIT'],
            'WA': ['WANT','WATER','WARM','WAIT'],
            'C': ['CAN','COLD','COME','CALL'],
            'CO': ['COLD','COME'],
            'CA': ['CAN','CALL'],
            'L': ['LOVE','LIGHT','LIKE','LIE','LOUD'],
            'LO': ['LOVE','LOUD'],
            'LI': ['LIGHT','LIKE','LIE'],
            'B': ['BATHROOM','BED','BLANKET','BETTER'],
            'BA': ['BATHROOM'],
            'BE': ['BED','BETTER'],
            'BL': ['BLANKET'],
            'F': ['FEEL','FINE','FOOD','FAMILY'],
            'FE': ['FEEL'],
            'FO': ['FOOD'],
            'M': ['ME','MORE','MEDICINE','MOVE'],
            'ME': ['ME','MEDICINE'],
            'MO': ['MORE','MOVE'],
            'S': ['SIT','SLEEP','STOP','SORRY'],
            'SI': ['SIT'],
            'SL': ['SLEEP'],
            'O': ['OKAY','ON','OFF'],
            'OK': ['OKAY'],
            'D': ['DOCTOR','DOWN','DRINK'],
            'DO': ['DOCTOR','DOWN'],
            'DR': ['DRINK'],
        },
        fr: {
            '': ['OUI','NON','MERCI','AIDE','BONJOUR','EAU','BIEN'],
            'O': ['OUI'],
            'N': ['NON','NOIR'],
            'M': ['MERCI','MAL','MANGER','MOMENT'],
            'ME': ['MERCI'],
            'MA': ['MAL','MANGER'],
            'A': ['AIDE','AVOIR','ASSEOIR','ATTENDRE'],
            'AI': ['AIDE'],
            'AS': ['ASSEOIR'],
            'AT': ['ATTENDRE'],
            'B': ['BONJOUR','BESOIN','BOIRE','BIEN'],
            'BO': ['BONJOUR','BOIRE'],
            'BE': ['BESOIN'],
            'BI': ['BIEN'],
            'E': ['EAU','EST'],
            'F': ['FAIM','FROID','FATIGUE','FAMILLE'],
            'FA': ['FAIM','FATIGUE','FAMILLE'],
            'FR': ['FROID'],
            'J': ['JE'],
            'D': ['DORMIR','DOULEUR','DOCTEUR'],
            'DO': ['DORMIR','DOULEUR','DOCTEUR'],
            'C': ['CHAUD','COUCHER'],
            'CH': ['CHAUD'],
            'CO': ['COUCHER'],
            'L': ['LUMIERE','LIT'],
            'LU': ['LUMIERE'],
            'LI': ['LIT'],
            'T': ['TOILETTES','TELE','TOUT'],
            'TO': ['TOILETTES','TOUT'],
            'TE': ['TELE'],
        },
        es: {
            '': ['SI','NO','GRACIAS','AYUDA','HOLA','AGUA','BIEN'],
            'S': ['SI','SENTARSE'],
            'SE': ['SENTARSE'],
            'N': ['NO','NECESITO'],
            'NE': ['NECESITO'],
            'G': ['GRACIAS'],
            'A': ['AYUDA','AGUA','ACOSTARME'],
            'AY': ['AYUDA'],
            'AG': ['AGUA'],
            'AC': ['ACOSTARME'],
            'H': ['HOLA','HAMBRE'],
            'HA': ['HAMBRE'],
            'D': ['DOLOR','DOCTOR','DORMIR'],
            'DO': ['DOLOR','DOCTOR','DORMIR'],
            'F': ['FRIO','FAMILIA'],
            'FR': ['FRIO'],
            'FA': ['FAMILIA'],
            'C': ['CALOR','CAMA','COMER'],
            'CA': ['CALOR','CAMA','COMER'],
            'M': ['MEDICINA','MAS','MOMENTO'],
            'ME': ['MEDICINA'],
            'MO': ['MOMENTO'],
            'MA': ['MAS'],
            'L': ['LUZ'],
            'T': ['TELEVISION','TODO'],
            'TE': ['TELEVISION'],
            'TO': ['TODO'],
            'B': ['BANO','BIEN'],
            'BA': ['BANO'],
            'BI': ['BIEN'],
        },
        it: {
            '': ['SI','NO','GRAZIE','AIUTO','CIAO','ACQUA','BENE'],
            'S': ['SI','SEDERMI','STANCO'],
            'SE': ['SEDERMI'],
            'ST': ['STANCO'],
            'N': ['NO','NON'],
            'G': ['GRAZIE'],
            'A': ['AIUTO','ACQUA','AMO'],
            'AI': ['AIUTO'],
            'AC': ['ACQUA'],
            'AM': ['AMO'],
            'C': ['CIAO','CALDO','CASA'],
            'CI': ['CIAO'],
            'CA': ['CALDO','CASA'],
            'F': ['FAME','FREDDO','FAMIGLIA'],
            'FA': ['FAME','FAMIGLIA'],
            'FR': ['FREDDO'],
            'D': ['DOLORE','DORMIRE','DOTTORE'],
            'DO': ['DOLORE','DORMIRE','DOTTORE'],
            'M': ['MEDICINA','MOMENTO','MALE'],
            'ME': ['MEDICINA'],
            'MO': ['MOMENTO'],
            'MA': ['MALE'],
            'L': ['LUCE','LETTO'],
            'LU': ['LUCE'],
            'LE': ['LETTO'],
            'B': ['BAGNO','BENE'],
            'BA': ['BAGNO'],
            'BE': ['BENE'],
            'T': ['TV','TUTTO'],
        },
        nl: {
            '': ['JA','NEE','DANK','HELP','HALLO','WATER','GOED'],
            'J': ['JA'],
            'N': ['NEE','NIET'],
            'D': ['DANK','DORST'],
            'DA': ['DANK'],
            'DO': ['DORST'],
            'H': ['HELP','HALLO','HONGER','HEET'],
            'HE': ['HELP','HEET'],
            'HO': ['HONGER'],
            'W': ['WATER','WARM','WC'],
            'WA': ['WATER','WARM'],
            'G': ['GOED'],
            'K': ['KOUD','KOM'],
            'KO': ['KOUD','KOM'],
            'P': ['PIJN'],
            'M': ['MOE','MEDICIJN','MOMENT'],
            'MO': ['MOE','MOMENT'],
            'ME': ['MEDICIJN'],
            'L': ['LICHT','LIGGEN','LIEFDE'],
            'LI': ['LICHT','LIGGEN','LIEFDE'],
            'Z': ['ZITTEN'],
            'B': ['BED'],
            'T': ['TV','TOILET'],
            'TO': ['TOILET'],
        },
        pl: {
            '': ['TAK','NIE','DZIEKUJE','POMOC','CZESC','WODA','DOBRZE'],
            'T': ['TAK','TOALETA','TV'],
            'TA': ['TAK'],
            'TO': ['TOALETA'],
            'N': ['NIE'],
            'D': ['DZIEKUJE','DOBRZE','DOKTOR'],
            'DZ': ['DZIEKUJE'],
            'DO': ['DOBRZE','DOKTOR'],
            'P': ['POMOC','PROSZE','PIJE'],
            'PO': ['POMOC'],
            'PR': ['PROSZE'],
            'C': ['CZESC','CHCE','CIEPLO','ZIMNO'],
            'CZ': ['CZESC'],
            'CH': ['CHCE'],
            'CI': ['CIEPLO'],
            'ZI': ['ZIMNO'],
            'W': ['WODA'],
            'B': ['BOL','BED'],
            'BO': ['BOL'],
            'L': ['LEK','LEZE','SWIATLO'],
            'LE': ['LEK','LEZE'],
            'S': ['SIEDZIEC','SWIATLO','SPI'],
            'SI': ['SIEDZIEC'],
            'SW': ['SWIATLO'],
            'G': ['GLODNY'],
            'K': ['KOCHAM'],
            'M': ['MOMENT','MEDYCYNA'],
            'MO': ['MOMENT'],
            'ME': ['MEDYCYNA'],
            'Z': ['ZMECZONY','ZIMNO'],
            'ZM': ['ZMECZONY'],
        },
        tr: {
            '': ['EVET','HAYIR','TESEKKUR','YARDIM','MERHABA','SU','IYI'],
            'E': ['EVET'],
            'H': ['HAYIR','HASTA'],
            'HA': ['HAYIR','HASTA'],
            'T': ['TESEKKUR','TV','TUVALET'],
            'TE': ['TESEKKUR'],
            'TU': ['TUVALET'],
            'Y': ['YARDIM','YEMEK','YATMAK'],
            'YA': ['YARDIM','YATMAK'],
            'YE': ['YEMEK'],
            'M': ['MERHABA','MOMENT'],
            'ME': ['MERHABA'],
            'MO': ['MOMENT'],
            'S': ['SU','SICAK','SEVIYORUM','SOGUK'],
            'SI': ['SICAK'],
            'SE': ['SEVIYORUM'],
            'SO': ['SOGUK'],
            'A': ['AC','AGRI'],
            'AC': ['AC'],
            'AG': ['AGRI'],
            'I': ['IYI','ISIK','ILAC'],
            'IS': ['ISIK'],
            'IL': ['ILAC'],
            'D': ['DOKTOR'],
            'U': ['UYUMAK','UZANMAK'],
            'UY': ['UYUMAK'],
            'UZ': ['UZANMAK'],
            'O': ['OTURMAK'],
            'K': ['KOTU'],
            'Y': ['YORGUN'],
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
