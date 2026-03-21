/**
 * SmartKeyboard — Frequency-based letter ordering.
 *
 * Uses bigram frequencies (which letter follows which) to reorder the keyboard
 * so the most likely next letter is scanned first. Similar to T9 / Smart TV input.
 *
 * Three keyboard modes:
 *   "abc"   — Standard alphabetical layout (original)
 *   "smart" — Letters reordered by frequency after each keystroke
 *   "wild"  — Letters + word completions mixed together
 */
const SmartKeyboard = {

    // =========================================================================
    // LETTER FREQUENCY DATA (unigram — used for first letter / after space)
    // Source: approximate from large corpora, normalized.
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
    // BIGRAM TABLES — Top followers for each letter (most likely first)
    // Only top 8-10 are listed; remaining letters keep frequency order.
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
            R: 'EIADONSTUCLBRMGHWFKP',
            S: 'TCIEASOPHUKNLGBDMWFR',
            T: 'EIAZHORSUTLBNWGM',
            U: 'NRSCETMLFDAGBHIKPW',
            V: 'EOIAULRSN',
            W: 'AEIOURSN',
            X: 'EIAPTUO',
            Y: 'SETPNMCLAI',
            Z: 'UWEIAOTLRS',
        },
        en: {
            A: 'NLTRSDCIBMGPKVYWFU',
            B: 'ELOUAYRITSB',
            C: 'OEHAKTRIULCS',
            D: 'IEAOSUYRNLGDTMWBHF',
            E: 'RNSDTALCXMVPGFWIBOH',
            F: 'OEIRATULFSY',
            G: 'EHIRASOUTLN',
            H: 'EAIORTUSYN',
            I: 'NTSCOLERDGMFAVKBPW',
            J: 'UOAEI',
            K: 'EINSAYO',
            L: 'ELIAYOUDSFT',
            M: 'EAOIUPYSBMN',
            N: 'GDETSICAOKNYLUFWM',
            O: 'NFRUTMWLSDPCKBVGE',
            P: 'EAROILHPUTS',
            Q: 'U',
            R: 'EIOASYTUNDLCMRGKWB',
            S: 'TOEHSIAPUCKLNMWB',
            T: 'HIOEARSUYTLWN',
            U: 'RSTLNCDMEPGBATISF',
            V: 'EIAO',
            W: 'AIHEONSR',
            X: 'PTICEA',
            Y: 'SETAOI',
            Z: 'AEIZO',
        },
        fr: {
            A: 'NITRULSVCDBMPFGEK',
            B: 'RLEOAIUST',
            C: 'OEHAITRUSL',
            D: 'EIAOURSNL',
            E: 'SNRTLMDCPFXUVAGBIO',
            F: 'AOIERULFST',
            G: 'RNEIAOULS',
            H: 'AEIOUY',
            I: 'NETLSOCDQRMAFVPGB',
            J: 'OEAIU',
            K: 'AEIOU',
            L: 'EIALOUS',
            M: 'EAIOUPBMN',
            N: 'EDTSICANOGUFRLM',
            O: 'NMURITSLCPDBFGKVEW',
            P: 'REAIOLUSHT',
            Q: 'U',
            R: 'EIAONSTUCDLRMG',
            S: 'TEIOAPUCHSLND',
            T: 'EIAORUSHTL',
            U: 'RNESLITDCXPAMGVBF',
            V: 'EOIAUR',
            W: 'AEIOU',
            X: 'IEPTCA',
            Y: 'SETAON',
            Z: 'AEIO',
        },
        es: {
            A: 'NRDLSCBMPTGUVFIJ',
            B: 'RLEIAOUST',
            C: 'OEIAHUTRL',
            D: 'EIAOUSNRL',
            E: 'SNRLCDTMPFXVAGBO',
            F: 'IEAROUL',
            G: 'RUEIAOL',
            H: 'AEIOUY',
            I: 'NEOTSCDALRMGVBF',
            J: 'OAEU',
            K: 'AEIOU',
            L: 'EIAOLUS',
            M: 'EAIOUPBN',
            N: 'EDTSIOCAUGFL',
            O: 'NSDRLCMPBTGFVEK',
            P: 'REAIOULST',
            Q: 'U',
            R: 'EIAONSTUCDLMRG',
            S: 'TEIAOPUCHSLD',
            T: 'EIAROUSHTL',
            U: 'NRESLTCDAMGPVB',
            V: 'EOIA',
            W: 'AEIOU',
            X: 'IEPTCA',
            Y: 'AEOSN',
            Z: 'AEIO',
        },
    },

    // =========================================================================
    // COMMON WORD PREFIXES — for wild mode word suggestions
    // Top frequent short words + longer completions per language
    // =========================================================================
    wordSuggestions: {
        de: {
            '': ['ICH','DU','WIR','JA','NEIN','DANKE','BITTE','HALLO','HILFE','GUT'],
            'I': ['ICH','IST','IN','IM','IMMER'],
            'IC': ['ICH'],
            'D': ['DU','DAS','DIE','DER','DANKE','DANN','DOCH'],
            'DA': ['DAS','DANKE','DANN','DARF'],
            'DAN': ['DANKE','DANN'],
            'W': ['WIR','WAS','WO','WIE','WILL','WASSER'],
            'WA': ['WAS','WASSER','WARM','WANN'],
            'B': ['BITTE','BIN','BRAUCHE'],
            'BI': ['BITTE','BIN'],
            'H': ['HALLO','HILFE','HABE','HUNGER'],
            'HI': ['HILFE','HIER'],
            'N': ['NEIN','NICHT','NOCH','NACH'],
            'NE': ['NEIN'],
            'J': ['JA'],
            'G': ['GUT','GEHE','GERN'],
            'S': ['SCHMERZEN','SCHLECHT','SIE','SIND'],
            'SC': ['SCHMERZEN','SCHLECHT','SCHON'],
            'M': ['MIR','MICH','MÖCHTE','MÜDE'],
            'MÖ': ['MÖCHTE'],
            'L': ['LIEBE','LICHT'],
            'LI': ['LIEBE','LICHT'],
            'T': ['TOILETTE','TUT'],
            'TO': ['TOILETTE'],
            'K': ['KALT','KANN','KOMMEN'],
            'KA': ['KALT','KANN'],
            'F': ['FERNSEHER','FERTIG'],
            'FE': ['FERNSEHER','FERTIG'],
        },
        en: {
            '': ['I','YOU','YES','NO','THANK','PLEASE','HELP','HELLO','GOOD','WATER'],
            'I': ['I'],
            'Y': ['YES','YOU'],
            'YE': ['YES'],
            'YO': ['YOU'],
            'N': ['NO','NEED','NOT'],
            'NO': ['NO','NOT'],
            'T': ['THANK','THE','TIRED','THIRSTY','TV','TOILET'],
            'TH': ['THANK','THE','THIRSTY'],
            'THA': ['THANK'],
            'P': ['PLEASE','PAIN'],
            'PL': ['PLEASE'],
            'H': ['HELP','HELLO','HOT','HUNGRY','HAPPY'],
            'HE': ['HELP','HELLO'],
            'HEL': ['HELP','HELLO'],
            'W': ['WATER','WANT','WARM'],
            'WA': ['WATER','WANT','WARM'],
            'G': ['GOOD','GO'],
            'GO': ['GOOD','GO'],
            'L': ['LOVE','LIGHT'],
            'LO': ['LOVE'],
            'LI': ['LIGHT'],
            'C': ['COLD','COME'],
            'CO': ['COLD','COME'],
            'B': ['BATHROOM','BAD'],
            'BA': ['BATHROOM','BAD'],
        },
        fr: {
            '': ['OUI','NON','MERCI','AIDE','BONJOUR','EAU','BIEN','MAL','FAIM'],
            'O': ['OUI'],
            'N': ['NON'],
            'M': ['MERCI','MAL','MANGER'],
            'ME': ['MERCI'],
            'A': ['AIDE','AMOUR'],
            'AI': ['AIDE'],
            'B': ['BONJOUR','BIEN','BOIRE'],
            'BO': ['BONJOUR','BOIRE'],
            'E': ['EAU'],
            'EA': ['EAU'],
        },
        es: {
            '': ['SI','NO','GRACIAS','AYUDA','HOLA','AGUA','BIEN','DOLOR','HAMBRE'],
            'S': ['SI'],
            'N': ['NO','NECESITO'],
            'G': ['GRACIAS'],
            'GR': ['GRACIAS'],
            'A': ['AYUDA','AGUA','AMOR'],
            'AY': ['AYUDA'],
            'AG': ['AGUA'],
            'H': ['HOLA','HAMBRE'],
            'HO': ['HOLA'],
        },
    },

    /**
     * Get ordered letters based on what was typed so far.
     * @param {string} lang - language code
     * @param {string} lastChar - the last character typed (or '' for start of word)
     * @returns {string[]} ordered letters, most likely first
     */
    getOrderedLetters(lang, lastChar) {
        const base = this.unigram[lang] || this.unigram.en;
        const upper = lastChar.toUpperCase();

        // If we have bigram data, use it
        const langBigrams = this.bigrams[lang] || this.bigrams.en;
        if (upper && langBigrams[upper]) {
            const followers = langBigrams[upper];
            // Start with the bigram-ordered followers, then add remaining in unigram order
            const ordered = [];
            const seen = new Set();
            for (const ch of followers) {
                ordered.push(ch);
                seen.add(ch);
            }
            for (const ch of base) {
                if (!seen.has(ch)) {
                    ordered.push(ch);
                }
            }
            return ordered;
        }

        // Fall back to unigram frequency
        return base.split('');
    },

    /**
     * Get word suggestions for wild mode.
     * @param {string} lang - language code
     * @param {string} currentWord - the word being typed so far
     * @returns {string[]} suggested words (max 4)
     */
    getWordSuggestions(lang, currentWord) {
        const langWords = this.wordSuggestions[lang] || this.wordSuggestions.en || {};
        const prefix = currentWord.toUpperCase();

        // Try exact prefix match first, then shorten
        for (let i = prefix.length; i >= 0; i--) {
            const key = prefix.slice(0, i);
            if (langWords[key]) {
                // Filter to those that match the current prefix
                const matches = langWords[key].filter(w => w.startsWith(prefix));
                if (matches.length > 0) return matches.slice(0, 4);
            }
        }

        // Fallback: common words
        return (langWords[''] || []).slice(0, 4);
    },

    /**
     * Extract the current incomplete word from the text.
     * @param {string} text - full text typed so far
     * @returns {string} the current word being typed
     */
    getCurrentWord(text) {
        if (!text) return '';
        // Find last word boundary (space, newline, or punctuation)
        const match = text.match(/[a-zA-ZäöüÄÖÜßéèêëàçùôîáíóúñ]+$/i);
        return match ? match[0] : '';
    }
};
