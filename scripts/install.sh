#!/usr/bin/env bash
#
# scripts/install.sh — build Notepads for Linux and install it for the current user.
#
#   ./scripts/install.sh              # release build + install to ~/.local
#   ./scripts/install.sh --system     # install to /usr/local (needs sudo)
#   ./scripts/install.sh --no-build   # install an existing target/release binary
#   ./scripts/install.sh --uninstall  # remove everything this script installed
#
# What it installs:
#   ~/.local/bin/notepads-for-linux           the binary (or /usr/local/bin)
#   ~/.local/share/applications/*.desktop     launcher + "Open with" entry
#   ~/.local/share/icons/hicolor/*/apps/*.png icons
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="io.github.notepads-linux"
BIN_NAME="notepads-for-linux"
PREFIX="${HOME}/.local"
DO_BUILD=1
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --system) PREFIX="/usr/local";;
    --no-build) DO_BUILD=0;;
    --uninstall) UNINSTALL=1;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "unknown option: $arg" >&2; exit 2;;
  esac
done

SUDO=""
if [ "$PREFIX" = "/usr/local" ]; then SUDO="sudo"; fi

BIN_DIR="$PREFIX/bin"
APP_DIR="$PREFIX/share/applications"
ICON_BASE="$PREFIX/share/icons/hicolor"

desktop_file() {
  cat <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Notepads
GenericName=Text Editor
Comment=A modern, lightweight text editor with a minimalist design
Exec=$BIN_DIR/$BIN_NAME %F
Icon=$APP_ID
Terminal=false
Categories=Utility;TextEditor;GTK;
MimeType=text/plain;text/markdown;application/json;text/x-python;text/x-rust;text/x-shellscript;inode/directory;
StartupNotify=true
StartupWMClass=notepads-for-linux
Keywords=text;editor;notepad;markdown;notes;code;
Actions=new-window;new-document;

[Desktop Action new-window]
Name=New window
Exec=$BIN_DIR/$BIN_NAME --new-window

[Desktop Action new-document]
Name=New document
Exec=$BIN_DIR/$BIN_NAME Untitled.txt
EOF
}

if [ "$UNINSTALL" = "1" ]; then
  echo "==> removing Notepads for Linux from $PREFIX"
  $SUDO rm -f "$BIN_DIR/$BIN_NAME"
  $SUDO rm -f "$APP_DIR/$APP_ID.desktop"
  for size in 32 48 64 128 256 512; do
    $SUDO rm -f "$ICON_BASE/${size}x${size}/apps/$APP_ID.png"
  done
  command -v update-desktop-database >/dev/null && $SUDO update-desktop-database "$APP_DIR" || true
  command -v gtk-update-icon-cache >/dev/null && $SUDO gtk-update-icon-cache -f -t "$ICON_BASE" 2>/dev/null || true
  echo "==> done. (Your settings in ~/.config/$APP_ID were left alone.)"
  exit 0
fi

if [ "$DO_BUILD" = "1" ]; then
  echo "==> checking build dependencies"
  missing=()
  for tool in cargo node npm pkg-config; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then missing+=("libwebkit2gtk-4.1-dev"); fi
  if ! pkg-config --exists gtk+-3.0 2>/dev/null; then missing+=("libgtk-3-dev"); fi
  if [ "${#missing[@]}" -gt 0 ]; then
    cat >&2 <<EOF
Missing build dependencies: ${missing[*]}

  Debian / Ubuntu:
    sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \\
      librsvg2-dev patchelf build-essential curl nodejs npm
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

  Fedora:
    sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel \\
      librsvg2-devel patchelf nodejs npm cargo

  Arch:
    sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg patchelf nodejs npm rust
EOF
    exit 1
  fi

  echo "==> fetching the Tauri CLI (npm)"
  (cd "$ROOT" && npm install --no-audit --no-fund --silent)

  echo "==> building (this takes a few minutes the first time)"
  (cd "$ROOT" && npx tauri build --bundles none)
fi

BINARY="$ROOT/src-tauri/target/release/$BIN_NAME"
if [ ! -x "$BINARY" ]; then
  echo "release binary not found at $BINARY" >&2
  exit 1
fi

echo "==> installing into $PREFIX"
$SUDO install -Dm755 "$BINARY" "$BIN_DIR/$BIN_NAME"
$SUDO mkdir -p "$APP_DIR"

tmp_desktop="$(mktemp)"
desktop_file > "$tmp_desktop"
$SUDO install -Dm644 "$tmp_desktop" "$APP_DIR/$APP_ID.desktop"
rm -f "$tmp_desktop"

MASTER_ICON="$ROOT/src-tauri/icons/icon.png"
if [ ! -f "$MASTER_ICON" ]; then
  echo "==> generating icons"
  python3 "$ROOT/scripts/make-icons.py" || true
fi
for size in 32 48 64 128 256 512; do
  $SUDO mkdir -p "$ICON_BASE/${size}x${size}/apps"
  if command -v convert >/dev/null 2>&1 && [ -f "$MASTER_ICON" ]; then
    convert "$MASTER_ICON" -resize "${size}x${size}" "$ICON_BASE/${size}x${size}/apps/$APP_ID.png" 2>/dev/null \
      || $SUDO install -Dm644 "$MASTER_ICON" "$ICON_BASE/${size}x${size}/apps/$APP_ID.png"
  elif [ -f "$MASTER_ICON" ]; then
    $SUDO install -Dm644 "$MASTER_ICON" "$ICON_BASE/${size}x${size}/apps/$APP_ID.png"
  fi
done

command -v update-desktop-database >/dev/null && $SUDO update-desktop-database "$APP_DIR" || true
command -v gtk-update-icon-cache >/dev/null && $SUDO gtk-update-icon-cache -f -t "$ICON_BASE" 2>/dev/null || true

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo; echo "NOTE: $BIN_DIR is not in your PATH. Add it with:"; echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc";;
esac

echo
echo "==> installed. Launch it from your applications menu, or run: notepads-for-linux"
echo "==> notepads-for-linux file.txt   also works from a terminal, like the original CLI"
