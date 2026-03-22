# Deployment Guide

## Quick Start

### 1. Hetzner Server erstellen

1. Gehe zu [Hetzner Cloud Console](https://console.hetzner.cloud)
2. Neues Projekt → "one-key-communicator"
3. Server hinzufügen:
   - **Location:** Falkenstein (fsn1) oder Nürnberg (nbg1)
   - **Image:** Ubuntu 24.04
   - **Type:** CX22 (4,85€/Monat)
   - **SSH Key:** Deinen öffentlichen Key hinzufügen
   - **Name:** `okc-prod`

### 2. Domain konfigurieren

Bei deinem Domain-Registrar (INWX, Cloudflare, etc.):

```
A     @       → [DEINE_SERVER_IP]
A     www     → [DEINE_SERVER_IP]
```

### 3. Server einrichten

```bash
# SSH auf den Server
ssh root@DEINE_SERVER_IP

# Setup-Script ausführen
curl -sSL https://raw.githubusercontent.com/httrp/one-key-communicator/main/scripts/server-setup.sh | bash

# SSH Key für deploy User hinzufügen
echo "DEIN_PUBLIC_SSH_KEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# Caddy konfigurieren
nano /etc/caddy/Caddyfile
# Inhalt von deploy/Caddyfile.production kopieren und Domain anpassen

# Caddy neustarten
systemctl reload caddy
```

### 4. GitHub Secrets einrichten

Repository → Settings → Secrets and variables → Actions → New repository secret

| Secret | Wert |
|--------|------|
| `SERVER_HOST` | Deine Server-IP (z.B. `123.45.67.89`) |
| `SERVER_USER` | `deploy` |
| `SSH_KEY` | Dein **privater** SSH Key (der zum public Key passt) |

### 5. Erstes Deployment

Push auf `main` triggert automatisch das Deployment:

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

Oder manuell: GitHub → Actions → "Deploy to Hetzner" → "Run workflow"

---

## Architektur

```
Internet
    │
    ▼
┌─────────────────┐
│  Caddy          │  :443 (HTTPS)
│  Reverse Proxy  │  Auto SSL via Let's Encrypt
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  OKC Server     │  :8090
│  (Go Binary)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite DB      │
│  /opt/okc/data/ │
└─────────────────┘
```

## Wartung

### Logs anzeigen

```bash
# App Logs
journalctl -u okc -f

# Caddy Logs
journalctl -u caddy -f
tail -f /var/log/caddy/okc-access.log
```

### Service neustarten

```bash
sudo systemctl restart okc
```

### Datenbank-Backup

```bash
# Backup erstellen
sqlite3 /opt/okc/data/okc.db ".backup /tmp/okc-backup.db"

# Lokal herunterladen
scp deploy@SERVER:/tmp/okc-backup.db ./
```

### Server-Status

```bash
# Service Status
systemctl status okc

# Ressourcen
htop

# Disk Space
df -h
```

## Kosten

| Posten | Monatlich |
|--------|-----------|
| Hetzner CX22 | 4,85€ |
| Domain (.de) | ~0,50€ |
| SSL | kostenlos |
| **Total** | **~5,35€** |

## Troubleshooting

### Deployment schlägt fehl

1. Prüfe GitHub Actions Logs
2. SSH-Verbindung testen: `ssh deploy@SERVER`
3. Service Status: `systemctl status okc`

### WebSockets funktionieren nicht

Caddy-Config prüfen — WebSocket-Header müssen durchgereicht werden.

### SSL-Zertifikat fehlt

```bash
# Caddy Logs prüfen
journalctl -u caddy | grep -i error

# DNS prüfen (muss auf Server-IP zeigen)
dig YOUR_DOMAIN.de
```
