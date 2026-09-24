#!/bin/bash
# Build ArduPilot SITL for the macOS release and stage it for Tauri resources.
# Usage: scripts/build-sitl-macos.sh aarch64-apple-darwin|x86_64-apple-darwin
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  aarch64-apple-darwin) ARCH_FLAG="" ;;
  x86_64-apple-darwin) ARCH_FLAG="-arch x86_64" ;;
  *)
    echo "usage: $0 aarch64-apple-darwin|x86_64-apple-darwin" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/sitl"
TAG="${ARDUPILOT_TAG:-Copter-4.7.0}"
SRC="${RUNNER_TEMP:-/tmp}/ardupilot-$TAG"

if [ -n "$ARCH_FLAG" ]; then
  softwareupdate --install-rosetta --agree-to-license || true
  export CFLAGS="$ARCH_FLAG"
  export CXXFLAGS="$ARCH_FLAG"
  export LDFLAGS="$ARCH_FLAG"
fi

brew install gawk
python3 -m pip install --user --upgrade 'empy==3.3.4' pyserial || \
  python3 -m pip install --user --upgrade --break-system-packages 'empy==3.3.4' pyserial

if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC"
  git clone --depth 1 --branch "$TAG" https://github.com/ArduPilot/ardupilot.git "$SRC"
fi
git -C "$SRC" submodule update --init --recursive --depth 1

python3 "$SRC/waf" configure --board sitl
python3 "$SRC/waf" copter plane

mkdir -p "$DEST"
cp -f "$SRC/build/sitl/bin/arducopter" "$SRC/build/sitl/bin/arduplane" "$DEST/"
chmod 755 "$DEST/arducopter" "$DEST/arduplane"

if [ "$TARGET" = "x86_64-apple-darwin" ]; then
  file "$DEST/arducopter" | grep -q x86_64
else
  file "$DEST/arducopter" | grep -q arm64
fi
echo "staged $DEST for $TARGET"
