#!/usr/bin/env bash
# Install (or update) a systemd user service that serves Crazyhouse Review to the local network
# at boot. Re-run after pulling code changes: it rebuilds the UI and restarts the service.
#   LAN_NETWORK  allowed client network (default 192.168.0.0/24)
#   PORT         listening port (default 8820)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAN_NETWORK="${LAN_NETWORK:-192.168.0.0/24}"
PORT="${PORT:-8820}"
UNIT="crazyhouse-review.service"
UNIT_DIR="$HOME/.config/systemd/user"

[ -x "$ROOT/engines/fairy-stockfish" ] || "$ROOT/scripts/fetch_engine.sh"
(cd "$ROOT/frontend" && npm install --silent && npm run build)
(cd "$ROOT/backend" && uv sync --quiet)

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT" <<UNIT
[Unit]
Description=Crazyhouse Review (UI + API on port $PORT for $LAN_NETWORK)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$ROOT/scripts/run_server.sh
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
Environment=ALLOWED_CLIENT_NETWORKS=127.0.0.0/8,::1/128,$LAN_NETWORK
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null
systemctl --user restart "$UNIT"
echo "Installed $UNIT_DIR/$UNIT (enabled at boot)."
echo "Allow the LAN through the firewall once (needs sudo):"
echo "  sudo ufw allow from $LAN_NETWORK to any port $PORT proto tcp comment 'crazyhouse-review'"
for ip in $(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1); do
  python3 -c "import ipaddress,sys; sys.exit(0 if ipaddress.ip_address('$ip') in ipaddress.ip_network('$LAN_NETWORK') else 1)" \
    && echo "Open: http://$ip:$PORT"
done
