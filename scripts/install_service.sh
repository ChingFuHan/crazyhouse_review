#!/usr/bin/env bash
# Install (or update) a systemd user service that serves Crazyhouse Review to the local network
# (and the tailnet, when this machine is on Tailscale) at boot. Re-run after pulling code changes:
# it rebuilds the UI and restarts the service.
#   LAN_NETWORK  allowed client network (default 192.168.0.0/24)
#   PORT         listening port (default 8820)
#   TAILSCALE    0 to keep tailnet devices out (default: allowed when `tailscale ip` works)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAN_NETWORK="${LAN_NETWORK:-192.168.0.0/24}"
PORT="${PORT:-8820}"
UNIT="crazyhouse-review.service"
UNIT_DIR="$HOME/.config/systemd/user"
# Tailscale's IPv4 range (the service listens on IPv4 only); which tailnet devices may reach this
# machine is up to the tailnet's ACLs.
TAILNET_NETWORK="100.64.0.0/10"
TAILNET_IP=""
if [ "${TAILSCALE:-}" != 0 ] && command -v tailscale >/dev/null; then
  TAILNET_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
fi
ALLOWED="127.0.0.0/8,::1/128,$LAN_NETWORK${TAILNET_IP:+,$TAILNET_NETWORK}"

[ -x "$ROOT/engines/fairy-stockfish" ] || "$ROOT/scripts/fetch_engine.sh"
(cd "$ROOT/frontend" && npm install --silent && npm run build)
(cd "$ROOT/backend" && uv sync --quiet)

# The AI CLIs a viewer may choose (and node, which codex runs on), as this shell finds them: a
# systemd service does not load nvm or shell profiles. Re-run after installing or moving a CLI.
CLI_DIRS=""
for cli in agy codex claude node; do
  if found="$(command -v "$cli" 2>/dev/null)"; then
    dir="$(dirname "$found")"
    case ":$CLI_DIRS:" in *":$dir:"*) ;; *) CLI_DIRS="$CLI_DIRS:$dir" ;; esac
  fi
done

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT" <<UNIT
[Unit]
Description=Crazyhouse Review (UI + API on port $PORT for $LAN_NETWORK${TAILNET_IP:+ and the tailnet})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$ROOT/scripts/run_server.sh
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
Environment=ALLOWED_CLIENT_NETWORKS=$ALLOWED
Environment=PATH=%h/.local/bin$CLI_DIRS:/usr/local/bin:/usr/bin:/bin
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
if [ -n "$TAILNET_IP" ]; then
  name="$(tailscale status --json 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
  echo "Tailnet: http://$TAILNET_IP:$PORT${name:+ or http://${name%%.*}:$PORT (http://$name:$PORT)}"
  echo "If tailnet devices cannot connect, allow them through the firewall once (needs sudo):"
  echo "  sudo ufw allow in on tailscale0 to any port $PORT proto tcp comment 'crazyhouse-review tailscale'"
fi
