/**
 * Runner — the core single-key input mechanism.
 *
 * A highlight moves across keys; pressing the action key selects the current one.
 *
 * Interaction modes (all co-exist):
 *   1. Auto-scan: highlight advances at interval (for switch/single-key users)
 *   2. Mouse hover: pauses auto-scan, highlights hovered key; click selects
 *   3. Touch: tap any key directly to select it
 *   4. Keyboard: any keypress selects current highlighted key
 */
const Runner = {
    _active: false,
    _index: 0,
    _timer: null,
    _speed: 1000,
    _keys: [],
    _onSelect: null,
    _hoverPaused: false,
    _firstKeyDelay: 2.0,  // Multiplier for first key delay (restart pause)
    _resetAfterSelect: true,  // Reset to first key after selection
    _inputEnabled: false,  // Prevents accidental input on page load
    _inputDelayMs: 600,  // Grace period before accepting input

    /**
     * Start the runner.
     * @param {HTMLElement[]} keys - array of key DOM elements
     * @param {number} speed - ms per step
     * @param {function} onSelect - callback(keyValue)
     */
    /**
     * @param {HTMLElement[]} keys
     * @param {number} speed - ms per step
     * @param {function} onSelect - callback(keyValue)
     * @param {number} [inputGraceMs] - override the default input grace period (ms).
     *   Pass a larger value (e.g. speed * 1.5) when transitioning into modal/menu
     *   contexts so the user has time to read the new screen before input is accepted.
     */
    start(keys, speed, onSelect, inputGraceMs) {
        this.stop();
        this._keys = keys;
        this._speed = speed;
        this._onSelect = onSelect;
        this._index = 0;
        this._active = true;
        this._hoverPaused = false;
        this._inputEnabled = false;  // Start with input disabled
        this._highlight();
        this._timer = setInterval(() => this._advance(), this._speed);
        this._attachInteraction();
        // Enable input after grace period — overridable per-context to prevent
        // accidental selections when switching between keyboard/menu/modal modes.
        const grace = inputGraceMs !== undefined ? inputGraceMs : this._inputDelayMs;
        setTimeout(() => { this._inputEnabled = true; }, grace);
    },

    /** Stop the runner and clean up */
    stop() {
        this._active = false;
        clearInterval(this._timer);
        this._timer = null;
        this._hoverPaused = false;
        this._clearHighlight();
    },

    /** Update speed without restarting */
    setSpeed(speed) {
        this._speed = speed;
        if (this._active) {
            clearInterval(this._timer);
            this._timer = setInterval(() => this._advance(), this._speed);
        }
    },

    /** Get current speed */
    getSpeed() {
        return this._speed;
    },

    /** Called when the user presses their single key (auto-scan mode) */
    select() {
        if (!this._active || this._keys.length === 0) return;
        if (!this._inputEnabled) return;  // Ignore input during grace period
        const key = this._keys[this._index];
        const value = key.dataset.value;

        // Flash effect
        key.style.transition = 'none';
        key.style.transform = 'scale(1.25)';
        setTimeout(() => {
            key.style.transition = 'all 0.12s';
            key.style.transform = '';
        }, 120);

        // Reset to first key after selection
        if (this._resetAfterSelect) {
            this._clearHighlight();
            this._index = 0;
            this._highlight();
            // Restart timer to give extra time on first key
            clearInterval(this._timer);
            this._timer = setTimeout(() => {
                this._advance();
                this._timer = setInterval(() => this._advance(), this._speed);
            }, this._speed * this._firstKeyDelay);
        }

        if (this._onSelect) this._onSelect(value);
    },

    /** Check if runner is active */
    isActive() {
        return this._active;
    },

    /** Attach mouse/touch interaction to each key element */
    _attachInteraction() {
        for (let i = 0; i < this._keys.length; i++) {
            const key = this._keys[i];

            // Mouse hover: pause auto-scan, highlight this key
            key._rkEnter = () => {
                if (!this._active) return;
                this._hoverPaused = true;
                this._clearHighlight();
                this._index = i;
                this._highlight();
            };
            key._rkLeave = () => {
                this._hoverPaused = false;
            };
            // Direct click
            key._rkClick = (e) => {
                e.stopPropagation();
                if (!this._active) return;
                this._clearHighlight();
                this._index = i;
                this._highlight();
                this.select();
            };
            // Direct touch
            key._rkTouch = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!this._active) return;
                this._clearHighlight();
                this._index = i;
                this._highlight();
                this.select();
            };

            key.addEventListener('mouseenter', key._rkEnter);
            key.addEventListener('mouseleave', key._rkLeave);
            key.addEventListener('click', key._rkClick);
            key.addEventListener('touchstart', key._rkTouch, { passive: false });
        }
    },

    _advance() {
        if (this._hoverPaused) return;
        this._clearHighlight();
        this._index = (this._index + 1) % this._keys.length;
        this._highlight();
        
        // Adjust timer speed for first key (longer pause)
        if (this._index === 0 && this._firstKeyDelay > 1) {
            clearInterval(this._timer);
            this._timer = setTimeout(() => {
                this._advance();
                this._timer = setInterval(() => this._advance(), this._speed);
            }, this._speed * this._firstKeyDelay);
        }
    },

    _highlight() {
        if (this._keys[this._index]) {
            this._keys[this._index].classList.add('active');
        }
    },

    _clearHighlight() {
        if (this._keys[this._index]) {
            this._keys[this._index].classList.remove('active');
        }
    }
};
