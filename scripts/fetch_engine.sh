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

# Crazyhouse NNUE network (https://fairy-stockfish.github.io/nnue/, +1136 Elo over the classical
# evaluation). Fairy-Stockfish names networks <variant>-<first 12 hex of sha256>.nnue: verify it.
NET="crazyhouse-8ebf84784ad2.nnue"
NET_URL="https://drive.google.com/u/0/uc?id=1nieguR4yCb0BlME-AUhcrFYkmyIOGvqs&export=download"
if [ ! -f "$DEST/$NET" ]; then
  echo "Downloading $NET"
  curl -fL --retry 3 -o "$DEST/$NET.tmp" "$NET_URL"
  case "$(sha256sum "$DEST/$NET.tmp" | cut -c1-12)" in
    8ebf84784ad2) mv "$DEST/$NET.tmp" "$DEST/$NET" ;;
    *) rm -f "$DEST/$NET.tmp"; echo "NNUE checksum mismatch; the engine will use its classical evaluation" >&2 ;;
  esac
fi
