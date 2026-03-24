# One-Key-Communicator (OKC)

**Open-source communication for people who can only press a single key.**

OKC is a lightweight web app that lets a person communicate by pressing just one button — any button, any sensor, any switch. A "runner" scans across letters on screen; pressing the key selects the current letter. The text appears in real-time on the screens of everyone in the room.

## Why?

Millions of people live with conditions (ALS, muscular dystrophy, locked-in syndrome, severe cerebral palsy, …) that make speaking and typing nearly impossible. Existing assistive communication tools are often expensive, proprietary, or complex. OKC is **free, open-source, and radically simple**.

## How it works

1. **Open OKC** on a tablet or phone — no account, no installation needed.
2. **Create a room** with one tap. You get a link and a QR code.
3. **Family/caregivers scan the QR code** on their phone or TV — they see what you type, live.
4. **Press your key** (spacebar, a USB button, a head switch, a sip-and-puff sensor — anything that sends a signal) to select letters as the runner highlights them.
5. **Communicate.** That's it.

## Core Principles

- **One key is enough.** Everything works with a single input.
- **Zero setup for readers.** Scan a QR code → see text. No app, no account.
- **Works on any device.** Phone, tablet, laptop, TV — if it has a browser, it works.
- **Radically simple.** An 80-year-old couple with no tech experience must be able to use this without help.
- **Privacy by default.** No accounts, no tracking. Rooms auto-delete. Communication stays between you and your people.
- **Self-hostable.** One binary, one command. Anyone technical can run their own instance.
- **Multi-language.** German, English, French, Spanish, Italian, Dutch, Polish, Turkish — and easy to add more.

## Architecture

```
┌─────────────────────────────────────┐
│        Single Go Binary (~10 MB)    │
│  ┌───────────┐  ┌────────────────┐  │
│  │ HTTP + WS │  │ Room Manager   │  │
│  │ Server    │  │ (in-memory +   │  │
│  │           │  │  SQLite backup)│  │
│  └─────┬─────┘  └───────┬────────┘  │
│        │                │           │
│  ┌─────┴────────────────┴────────┐  │
│  │  Embedded Static Files        │  │
│  │  (HTML, CSS, JS — no npm)     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

**No Node.js. No npm. No build step for the frontend.** Plain HTML, CSS, and vanilla JavaScript — embedded directly into the Go binary.

## Quick Start (Self-Hosting)

```bash
# Download the latest release
curl -L https://github.com/you/one-key-communicator/releases/latest/download/okc-linux-amd64 -o okc
chmod +x okc

# Run it
./okc
# → Listening on http://localhost:8090

# Or with options
./okc --port 8090 --base-url https://okc.example.com
```

### With Docker

```bash
docker run -p 8090:8090 -v okc-data:/data ghcr.io/you/one-key-communicator
```

### With Docker Compose (recommended for production)

```yaml
services:
  okc:
    image: ghcr.io/you/one-key-communicator
    ports:
      - "8090:8090"
    volumes:
      - okc-data:/data
    environment:
      - OKC_BASE_URL=https://app.okc.example.com
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    restart: unless-stopped

volumes:
  okc-data:
  caddy-data:
```

## URL Structure

| URL | Purpose |
|-----|---------|
| `https://okc.example.com` | Landing page — explains what OKC is |
| `https://app.okc.example.com` | The app — create/join rooms |
| `https://app.okc.example.com/room/abc123` | Writer view (the person communicating) |
| `https://app.okc.example.com/read/abc123` | Reader view (family, caregivers) |

For simple single-domain setups, everything runs on one domain:
| `https://okc.example.com/` | Landing page |
| `https://okc.example.com/app` | App |
| `https://okc.example.com/app/room/abc123` | Writer |
| `https://okc.example.com/app/read/abc123` | Reader |

## Input Modes

1. **Runner (default):** A highlight moves across the alphabet. Press your key to select. Simple, reliable, works for everyone.
2. **Smart Runner:** Letters reorder based on what's likely next (language-aware frequency). Fewer presses needed.
3. **Word Suggestions:** After 2-3 letters, common words appear. Select one to complete instantly.
4. **Quick Phrases:** Pre-configured sentences for common needs: "I'm thirsty", "I need help", "Yes", "No", "I love you". One press each.
5. **Situation Boards:** Themed phrase sets — Meals, Hygiene, Pain, Emotions, General.

## Security

OKC is designed so that sensitive communication data stays private, even if someone gains access to the database file.

| Measure | Details |
|---|---|
| **Content encryption** | Message text is encrypted with AES-256-GCM before being stored in SQLite. The key is derived per-room (`HMAC-SHA256(serverSecret, roomID)`). |
| **PIN encryption** | Room PINs are encrypted with AES-256-GCM using the server secret. |
| **Server secret** | 32-byte random key, generated on first run, stored at `data/.secret` (mode 0600). |
| **Random IDs & PINs** | Room IDs (12 hex chars) and PINs (6 digits) are generated with `crypto/rand` — no `math/rand`. |
| **Auto-delete** | Room text is cleared after 24 h of inactivity; the room record is deleted shortly after. |
| **Brute-force protection** | PIN verification: 10 attempts/min/IP. Room creation: 30/min/IP. |
| **PIN handling** | Reader links contain no PIN. PIN is entered in-app and exchanged for a short-lived read token. |
| **Owner-only destructive actions** | Room deletion requires a writer token issued on room creation (not shared with readers). |
| **Security headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, full `Content-Security-Policy`. |
| **CORS** | `Access-Control-Allow-Origin` is set to your configured `base-url`, not `*`. |
| **Transport** | TLS is handled by Caddy (in the recommended setup) — all traffic runs over HTTPS/WSS. |
| **Stats endpoint** | `/api/stats` can be protected with a bearer token via `OKC_STATS_TOKEN` (Authorization header only). |
| **No accounts / no tracking** | No user data is collected. No cookies. No analytics. |

### Important caveat on data-at-rest

Encryption protects against someone reading the raw SQLite file but **not** against a compromised server process — the decryption key lives in memory. OKC is designed for synchronous, ephemeral communication; treat it accordingly. Do not store sensitive long-term information.

## Tech Stack

- **Backend:** Go standard library + 2 dependencies (WebSocket, SQLite)
- **Frontend:** Vanilla HTML + CSS + JS (no framework, no build step)
- **Database:** SQLite (embedded, zero-config)
- **Deployment:** Single binary, Docker, or any cloud provider

## Project Structure

```
one-key-communicator/
├── cmd/okc/main.go           # Entry point
├── internal/
│   ├── server/               # HTTP server, routes, middleware
│   ├── room/                 # Room management, WebSocket hub
│   ├── storage/              # SQLite persistence
│   └── config/               # Configuration
├── web/
│   ├── landing/              # Landing page (static HTML)
│   │   ├── index.html
│   │   └── style.css
│   └── app/                  # The OKC app
│       ├── index.html        # App shell
│       ├── css/
│       │   └── style.css     # All styles
│       ├── js/
│       │   ├── app.js        # App initialization
│       │   ├── router.js     # Simple hash router
│       │   ├── ws.js         # WebSocket client
│       │   ├── runner.js     # Runner keyboard logic
│       │   ├── keyboard.js   # Keyboard layout + rendering
│       │   ├── i18n.js       # Translation system
│       │   └── qrcode.js     # Minimal QR code generator
│       └── i18n/
│           ├── de.json
│           ├── en.json
│           ├── fr.json
│           ├── es.json
│           ├── it.json
│           ├── nl.json
│           ├── pl.json
│           └── tr.json
├── config.example.yaml
├── Dockerfile
├── Makefile
├── LICENSE
└── README.md
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

GPLv3 — see [LICENSE](LICENSE).
