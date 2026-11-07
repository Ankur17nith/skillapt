#!/usr/bin/env bash
set -euo pipefail

# Skillapt Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Ankur17nith/skillapt/main/install.sh | bash

PRODUCT_NAME="skillapt"
REPO="Ankur17nith/skillapt"

echo "=== Installing ${PRODUCT_NAME} CLI ==="

# Check Node.js runtime
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to run ${PRODUCT_NAME}. Please install Node.js >= 20." >&2
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "Error: Node.js 20 or higher is required. Found $(node -v)." >&2
  exit 1
fi

echo "✓ Node.js $(node -v) detected"

# Check npm or install destination
if command -v npm >/dev/null 2>&1; then
  echo "Installing ${PRODUCT_NAME} via npm..."
  npm install -g "${PRODUCT_NAME}" || npm install -g "https://github.com/${REPO}.git"
else
  # Direct install fallback into ~/.local/bin
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "${INSTALL_DIR}"
  echo "Fetching pre-built CLI bundle to ${INSTALL_DIR}..."
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/dist/cli.js" -o "${INSTALL_DIR}/${PRODUCT_NAME}"
  chmod +x "${INSTALL_DIR}/${PRODUCT_NAME}"
  echo "✓ Installed ${PRODUCT_NAME} to ${INSTALL_DIR}/${PRODUCT_NAME}"
  echo "Make sure ${INSTALL_DIR} is in your PATH."
fi

echo ""
echo "=== ${PRODUCT_NAME} installed successfully! ==="
if command -v "${PRODUCT_NAME}" >/dev/null 2>&1; then
  "${PRODUCT_NAME}" --version
fi
echo "Run '${PRODUCT_NAME} --help' or '${PRODUCT_NAME} doctor' to get started."
