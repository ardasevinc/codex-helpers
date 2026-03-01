#!/bin/sh
set -e

REPO="ardasevinc/codex-helpers"
PACKAGE="${1:?Usage: install.sh <package> [version]}"
VERSION="${2:-}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
    | grep -o "\"tag_name\": \"${PACKAGE}-v[^\"]*\"" \
    | head -1 \
    | sed "s/.*${PACKAGE}-v\([^\"]*\).*/\1/")
  if [ -z "$VERSION" ]; then
    echo "No releases found for ${PACKAGE}" && exit 1
  fi
fi

TAG="${PACKAGE}-v${VERSION}"
BINARY="${PACKAGE}-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

echo "Installing ${PACKAGE} v${VERSION} (${OS}/${ARCH})..."
curl -fSL "$URL" -o "/tmp/${PACKAGE}"
chmod +x "/tmp/${PACKAGE}"

if [ -w "$INSTALL_DIR" ]; then
  mv "/tmp/${PACKAGE}" "${INSTALL_DIR}/${PACKAGE}"
else
  sudo mv "/tmp/${PACKAGE}" "${INSTALL_DIR}/${PACKAGE}"
fi

echo "${PACKAGE} v${VERSION} installed to ${INSTALL_DIR}/${PACKAGE}"
