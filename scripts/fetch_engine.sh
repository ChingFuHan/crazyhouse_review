#!/usr/bin/env bash
# Download the Fairy-Stockfish release binary for Linux x86-64 into engines/.
# Crazyhouse analysis requires Fairy-Stockfish; regular Stockfish has no crazyhouse support.
set -euo pipefail

VERSION="fairy_sf_14"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/engines"

if grep -qw bmi2 /proc/cpuinfo; then
  BUILD="fairy-stockfish_x86-64-bmi2"
elif grep -qw popcnt /proc/cpuinfo; then
  BUILD="fairy-stockfish_x86-64-modern"
else
  BUILD="fairy-stockfish_x86-64"
fi

mkdir -p "$DEST"
URL="https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/$VERSION/$BUILD"
echo "Downloading $URL"
curl -fL --retry 3 -o "$DEST/$BUILD.tmp" "$URL"
mv "$DEST/$BUILD.tmp" "$DEST/$BUILD"
chmod +x "$DEST/$BUILD"
ln -sf "$BUILD" "$DEST/fairy-stockfish"
sha256sum "$DEST/$BUILD"
printf 'uci\nquit\n' | "$DEST/fairy-stockfish" | grep -E '^id name'
