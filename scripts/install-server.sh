#!/bin/sh
# Installs a holder town (engine + live server) on a VPS, run ON the server as root from inside the app folder.
# It only ADDS things: one nginx site for $DOMAIN and two pm2 processes. Other sites and apps
# already on the server are never edited.
#
#   sh scripts/install-server.sh          first install (also safe to run again)
#   sh scripts/install-server.sh update   after `git pull`: rebuild the site, restart the engine
#   sh scripts/install-server.sh https    once the domain's DNS points at this server
#
# Night Market ($LAMP) intended values (domain still TBD):
#   DOMAIN=<tbd> PORT=5371 LIVE_PORT=5372 NAME=lamp-engine LIVE_NAME=lamp-live sh scripts/install-server.sh
#
# Settings: DOMAIN=example.fun PORT=5301 LIVE_PORT=5302 NAME=dome-engine LIVE_NAME=dome-live sh scripts/install-server.sh
set -e
DOMAIN="${DOMAIN:?set DOMAIN=example.fun}"
PORT="${PORT:?set PORT}"
LIVE_PORT="${LIVE_PORT:-$((PORT + 1))}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${NAME:?set NAME}"
LIVE_NAME="${LIVE_NAME:-${NAME%-engine}-live}"
RPC=rpc.mainnet.chain.robinhood.com
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }

if [ "$1" = https ]; then
  say "HTTPS certificate for $DOMAIN"
  command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --redirect --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
  sed -i "s#^SITE_URL=.*#SITE_URL=https://$DOMAIN#" "$APP/.env"
  pm2 restart "$NAME" --update-env >/dev/null
  echo "Done: https://$DOMAIN"
  exit 0
fi

build() {
  say "Building the site and installing the engine"
  cd "$APP"
  npm ci --no-audit --no-fund
  npm run build
}

restart() {
  cd "$APP"
  if pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" --update-env >/dev/null
  else
    pm2 start node_modules/.bin/tsx --name "$NAME" --cwd "$APP" -- bot/town-engine.ts >/dev/null
  fi
  if pm2 describe "$LIVE_NAME" >/dev/null 2>&1; then
    pm2 restart "$LIVE_NAME" --update-env >/dev/null
  else
    LIVE_PORT="$(grep '^LIVE_PORT=' .env | cut -d= -f2)" pm2 start node_modules/.bin/tsx --name "$LIVE_NAME" --cwd "$APP" -- bot/town-live.ts >/dev/null
  fi
  pm2 save >/dev/null
  sleep 5
  say "Engine check"
  curl -s "127.0.0.1:$(grep '^PORT=' .env | cut -d= -f2)/api/status" | head -c 160; echo
}

if [ "$1" = update ]; then
  build
  restart
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive

say "1/6 Packages (Node 20, nginx, pm2, certbot) — only what is missing"
command -v curl >/dev/null || (apt-get update && apt-get install -y curl)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  if command -v node >/dev/null; then echo "Node $(node -v) is older than 20. Upgrade it first (other apps may depend on it)."; exit 1; fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
fi
command -v nginx >/dev/null || apt-get install -y nginx
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
command -v pm2 >/dev/null || npm install -g pm2
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

say "2/6 Port 80 must belong to nginx"
OWNER="$(ss -ltnp 'sport = :80' 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)"
if [ -n "$OWNER" ] && [ "$OWNER" != nginx ]; then
  echo "Port 80 is used by '$OWNER', not nginx. Stopping here so nothing else breaks."; exit 1
fi

say "3/6 Robinhood RPC reachable? (Indonesian DNS blocks it)"
if curl -s -m 15 -X POST "https://$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q 0x1237; then
  echo "RPC OK"
else
  echo "RPC blocked: switching this server's DNS to encrypted DNS (Cloudflare + Google, DNS-over-TLS)."
  mkdir -p /etc/systemd/resolved.conf.d
  cat > /etc/systemd/resolved.conf.d/10-dot.conf <<'EOF'
[Resolve]
DNS=1.1.1.1#cloudflare-dns.com 8.8.8.8#dns.google 1.0.0.1#cloudflare-dns.com
FallbackDNS=8.8.4.4#dns.google
DNSOverTLS=yes
Domains=~.
EOF
  systemctl restart systemd-resolved
  sleep 3
  curl -s -m 15 -X POST "https://$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q 0x1237 && echo "RPC OK now" || { echo "RPC still unreachable. Send this output to the developer."; exit 1; }
fi

say "4/6 Engine settings (.env)"
cd "$APP"
if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! pm2 describe "$NAME" >/dev/null 2>&1; then
  echo "Port $PORT is taken by another app. Run again with PORT=<free port>."; exit 1
fi
if [ ! -f .env ]; then
  (umask 077; cp .env.example .env)
  sed -i "s#^PORT=.*#PORT=$PORT#; s#^LIVE_PORT=.*#LIVE_PORT=$LIVE_PORT#; s#^SITE_URL=.*#SITE_URL=http://$DOMAIN#; s#^ADMIN_SECRET=.*#ADMIN_SECRET=$(openssl rand -hex 24)#" .env
  echo "Created .env (ADMIN_SECRET generated; keep it private)."
else
  echo ".env already exists, left as is."
fi

build

say "5/6 nginx site for $DOMAIN (a new file; other sites untouched)"
CONF=/etc/nginx/sites-available/$DOMAIN
if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    root $APP/dist;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:$(grep '^PORT=' .env | cut -d= -f2);
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /ws {
        proxy_pass http://127.0.0.1:$(grep '^LIVE_PORT=' .env | cut -d= -f2);
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }
    location / {
        try_files \$uri \$uri.html \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
NGINX
  ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
fi
chmod o+x /root 2>/dev/null || true
if nginx -t; then systemctl reload nginx; else
  echo "nginx config test failed: removing only the $DOMAIN site again."
  rm -f "/etc/nginx/sites-enabled/$DOMAIN" "$CONF"; exit 1
fi

say "6/6 Engine and live server (pm2: $NAME, $LIVE_NAME)"
restart

IP="$(curl -s -m 8 -4 ifconfig.me || hostname -I | cut -d' ' -f1)"
say "Installed. Check it before pointing the domain:"
echo "  curl -H 'Host: $DOMAIN' http://127.0.0.1/ | head -5"
echo "Then in the domain's DNS add:  A @ -> $IP   and   A www -> $IP"
echo "Once DNS works:  sh scripts/install-server.sh https"
