#!/usr/bin/env bash
# Dev mode's bridge on this server, once, as root (docs/plans/DEVICE-BRIDGE.md):
#   sudo bash agent/devices/setup-server.sh [host] [port]
# nginx sends wss://<host>/bridge to the relay (agent/devices/relay.mjs on 127.0.0.1:<port>), with a Let's Encrypt
# certificate (webroot; certbot's timer renews it and reloads nginx). Defaults: 68-183-124-79.sslip.io (a name for
# this server's IP, no domain to buy) and 8790 (devices.port in agent/config.json). Run it again to repair.
set -euo pipefail
HOST=${1:-68-183-124-79.sslip.io}
PORT=${2:-8790}
SITE=/etc/nginx/sites-available/kidtube-bridge
ACME=/var/www/kidtube-acme
CERT=/etc/letsencrypt/live/$HOST

mkdir -p "$ACME"
http_block() {
  cat <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $HOST;
  location /.well-known/acme-challenge/ { root $ACME; }
  location / { $1 }
}
EOF
}

# 1. Port 80 only, so that Let's Encrypt can check the name.
if [ ! -f "$CERT/fullchain.pem" ]; then
  { echo "# Dev mode's bridge (KidTube). Made by agent/devices/setup-server.sh."; http_block "return 404;"; } > "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/kidtube-bridge
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w "$ACME" -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email \
    --deploy-hook "systemctl reload nginx"
fi

# 2. TLS on 443: /bridge → the relay (a WebSocket, kept open for hours), nothing else.
cat > "$SITE" <<EOF
# Dev mode's bridge (KidTube). Made by agent/devices/setup-server.sh.
map \$http_upgrade \$kt_bridge_upgrade { default upgrade; '' close; }
limit_req_zone \$binary_remote_addr zone=kt_bridge:1m rate=20r/m;
$(http_block "return 301 https://\$host\$request_uri;")
server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name $HOST;
  ssl_certificate $CERT/fullchain.pem;
  ssl_certificate_key $CERT/privkey.pem;
  location = /bridge {
    limit_req zone=kt_bridge burst=20 nodelay;
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$kt_bridge_upgrade;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
  location / { return 404; }
}
EOF
ln -sf "$SITE" /etc/nginx/sites-enabled/kidtube-bridge
nginx -t && systemctl reload nginx
echo "Done: wss://$HOST/bridge → 127.0.0.1:$PORT (the relay: agent/poll.sh starts it within a minute)."
