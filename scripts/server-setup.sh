#!/bin/bash
# Server Setup Script for One-Key-Communicator
# Run this ONCE on a fresh Ubuntu 24.04 server
#
# Usage: ssh root@your-server 'bash -s' < scripts/server-setup.sh

set -e

echo "🚀 Setting up One-Key-Communicator server..."

# Update system
apt-get update && apt-get upgrade -y

# Install dependencies
apt-get install -y \
    debian-keyring \
    debian-archive-keyring \
    apt-transport-https \
    curl \
    sqlite3

# Install Caddy (reverse proxy with automatic HTTPS)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# Create app user and directories
useradd -r -s /bin/false okc || true
mkdir -p /opt/okc/data
chown -R okc:okc /opt/okc

# Create systemd service
cat > /etc/systemd/system/okc.service << 'EOF'
[Unit]
Description=One-Key-Communicator
After=network.target

[Service]
Type=simple
User=okc
Group=okc
WorkingDirectory=/opt/okc
ExecStart=/opt/okc/okc
Restart=always
RestartSec=5

# Environment (edit /opt/okc/.env for BASE_URL)
EnvironmentFile=-/opt/okc/.env
Environment=OKC_PORT=8090
Environment=OKC_DATA_DIR=/opt/okc/data

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/okc/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Create default .env file
cat > /opt/okc/.env << 'EOF'
# Edit this file with your domain
OKC_BASE_URL=https://YOUR_DOMAIN.de
EOF
chown okc:okc /opt/okc/.env

# Enable service (don't start yet - no binary)
systemctl daemon-reload
systemctl enable okc

# Create deployment user for GitHub Actions
useradd -m -s /bin/bash deploy || true
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

# Allow deploy user to control okc service
cat > /etc/sudoers.d/deploy << 'EOF'
deploy ALL=(ALL) NOPASSWD: /bin/systemctl stop okc
deploy ALL=(ALL) NOPASSWD: /bin/systemctl start okc
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart okc
deploy ALL=(ALL) NOPASSWD: /bin/mv /tmp/okc /opt/okc/okc
deploy ALL=(ALL) NOPASSWD: /bin/chmod +x /opt/okc/okc
EOF

echo ""
echo "✅ Server setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add your SSH public key to /home/deploy/.ssh/authorized_keys"
echo "2. Configure Caddy with your domain (see /etc/caddy/Caddyfile)"
echo "3. Set up GitHub Secrets:"
echo "   - SERVER_HOST: $(curl -4s ifconfig.me)"
echo "   - SERVER_USER: deploy"
echo "   - SSH_KEY: (your private key)"
echo ""
echo "🔧 Caddy config location: /etc/caddy/Caddyfile"
echo "📁 App data directory: /opt/okc/data"
