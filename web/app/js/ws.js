/**
 * WebSocket client for OKC.
 * Handles connection, reconnection, and message passing.
 */
const WS = {
    _ws: null,
    _roomId: null,
    _role: null,
    _readToken: null,
    _onMessage: null,
    _onStatus: null,
    _reconnectTimer: null,
    _reconnectDelay: 1000,
    _permanentError: false, // Set to true if we should stop reconnecting

    /**
     * Connect to a room.
     * @param {string} roomId
     * @param {string} role - "write" or "read"
     * @param {function} onMessage - callback({type, data})
     * @param {function} onStatus - callback("connected"|"disconnected"|"reconnecting"|"error")
     * @param {string} [readToken] - optional short-lived read token for readers
     */
    connect(roomId, role, onMessage, onStatus, readToken = null) {
        this._roomId = roomId;
        this._role = role;
        this._readToken = readToken;
        this._onMessage = onMessage;
        this._onStatus = onStatus;
        this._permanentError = false;
        this._doConnect();
    },

    _doConnect() {
        if (this._permanentError) return;
        
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
        }

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let url = `${proto}//${location.host}/ws/${this._roomId}/${this._role}`;
        if (this._readToken) {
            url += `?token=${encodeURIComponent(this._readToken)}`;
        }

        this._ws = new WebSocket(url);

        this._ws.onopen = () => {
            this._reconnectDelay = 1000;
            if (this._onStatus) this._onStatus('connected');
        };

        this._ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                
                // Handle error messages
                if (msg.type === 'error') {
                    this._permanentError = true;
                    if (this._onStatus) this._onStatus('error', msg.data);
                    return;
                }
                
                if (this._onMessage) this._onMessage(msg);
            } catch (err) {
                console.error('WS parse error:', err);
            }
        };

        this._ws.onclose = () => {
            if (this._permanentError) {
                // Don't reconnect on permanent errors (invalid PIN, room not found)
                return;
            }
            if (this._onStatus) this._onStatus('disconnected');
            this._scheduleReconnect();
        };

        this._ws.onerror = () => {
            // onclose will fire after this
        };
    },

    /** Send a text update (writer only) */
    sendText(text) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'text', data: text }));
        }
    },

    /** Send clear command */
    sendClear() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'clear' }));
        }
    },

    /** Send reader display name */
    sendName(name) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'name', data: name }));
        }
    },

    /** Disconnect */
    disconnect() {
        clearTimeout(this._reconnectTimer);
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
    },

    _scheduleReconnect() {
        if (this._onStatus) this._onStatus('reconnecting');
        this._reconnectTimer = setTimeout(() => {
            this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 10000);
            this._doConnect();
        }, this._reconnectDelay);
    }
};
