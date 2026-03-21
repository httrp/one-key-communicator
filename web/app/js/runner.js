/**
 * Runner — the core input mechanism.
 * A highlight moves across keys; pressing the action key selects the current one.
 */
const Runner = {
    _active: false,
    _index: 0,
    _timer: null,
    _speed: 800,       // ms per step
    _keys: [],         // array of key elements
    _onSelect: null,   // callback(keyValue)

    /**
     * Start the runner.
     * @param {HTMLElement[]} keys - array of key DOM elements
     * @param {number} speed - ms per step
     * @param {function} onSelect - callback when a key is selected
     */
    start(keys, speed, onSelect) {
        this.stop();
        this._keys = keys;
        this._speed = speed;
        this._onSelect = onSelect;
        this._index = 0;
        this._active = true;
        this._highlight();
        this._timer = setInterval(() => this._advance(), this._speed);
    },

    /** Stop the runner */
    stop() {
        this._active = false;
        clearInterval(this._timer);
        this._timer = null;
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

    /** Called when the user presses their key */
    select() {
        if (!this._active || this._keys.length === 0) return;
        const key = this._keys[this._index];
        const value = key.dataset.value;

        // Flash effect
        key.style.transition = 'none';
        key.style.transform = 'scale(1.3)';
        setTimeout(() => {
            key.style.transition = 'all 0.15s';
            key.style.transform = '';
        }, 150);

        if (this._onSelect) this._onSelect(value);
    },

    /** Check if runner is active */
    isActive() {
        return this._active;
    },

    _advance() {
        this._clearHighlight();
        this._index = (this._index + 1) % this._keys.length;
        this._highlight();
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
