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

# Check npm
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to install ${PRODUCT_NAME}." >&2
  echo "Please install npm (packaged with Node.js from https://nodejs.org) and try again." >&2
  exit 1
fi

echo "Installing ${PRODUCT_NAME} via npm..."

# Attempt npm install -g and capture output to handle EACCES
INSTALL_LOG=$(mktemp)
if ! npm install -g "${PRODUCT_NAME}" >"${INSTALL_LOG}" 2>&1 && ! npm install -g "https://github.com/${REPO}.git" >"${INSTALL_LOG}" 2>&1; then
  cat "${INSTALL_LOG}" >&2
  if grep -qi "EACCES" "${INSTALL_LOG}"; then
    echo "" >&2
    echo "Error: npm encountered an EACCES permissions error during global installation." >&2
    echo "Do NOT use 'sudo npm install'." >&2
    echo "To fix npm permissions without sudo, configure an npm prefix in your home directory:" >&2
    echo "  mkdir -p \"\${HOME}/.npm-global\"" >&2
    echo "  npm config set prefix \"\${HOME}/.npm-global\"" >&2
    echo "  export PATH=\"\${HOME}/.npm-global/bin:\${PATH}\"" >&2
    echo "Add that export to your ~/.bashrc or ~/.zshrc, then re-run this installer." >&2
  else
    echo "" >&2
    echo "Error: Failed to install ${PRODUCT_NAME} via npm. See output above for details." >&2
  fi
  rm -f "${INSTALL_LOG}"
  exit 1
fi
rm -f "${INSTALL_LOG}"

# Verify installation
if ! command -v "${PRODUCT_NAME}" >/dev/null 2>&1; then
  echo "Error: '${PRODUCT_NAME}' was installed, but the command was not found in your PATH." >&2
  echo "Ensure your global npm bin directory is in your PATH." >&2
  echo "You can check your npm global bin path by running: npm prefix -g" >&2
  exit 1
fi

if ! "${PRODUCT_NAME}" --version >/dev/null 2>&1; then
  echo "Error: '${PRODUCT_NAME}' command was found, but '${PRODUCT_NAME} --version' failed to run." >&2
  exit 1
fi

INSTALLED_VER=$("${PRODUCT_NAME}" --version)

echo ""
echo "=== ${PRODUCT_NAME} v${INSTALLED_VER} installed successfully! ==="
echo "Run '${PRODUCT_NAME} --help' or '${PRODUCT_NAME} doctor' to get started."
