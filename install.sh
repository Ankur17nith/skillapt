#!/usr/bin/env bash
set -euo pipefail

# Skillapt Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Ankur17nith/skillapt/main/install.sh | bash
# Optional env: VERSION=x.y.z

PRODUCT_NAME="skillapt"

echo "=== Installing ${PRODUCT_NAME} CLI ==="

# 1. Check Node.js runtime
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to run ${PRODUCT_NAME}. Please install Node.js >= 22.12." >&2
  echo "Visit https://nodejs.org or use a version manager (nvm, fnm, volta)." >&2
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d. -f1)
NODE_MINOR=$(echo "${NODE_VERSION}" | cut -d. -f2)
if [ "${NODE_MAJOR}" -lt 22 ] || { [ "${NODE_MAJOR}" -eq 22 ] && [ "${NODE_MINOR}" -lt 12 ]; }; then
  echo "Error: Node.js 22.12 or higher is required. Found $(node -v)." >&2
  exit 1
fi

echo "✓ Node.js $(node -v) detected"

# 2. Check npm
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to install ${PRODUCT_NAME}." >&2
  echo "Please install npm (packaged with Node.js from https://nodejs.org or your package manager) and try again." >&2
  exit 1
fi

# 3. Determine package specifier
PKG_SPEC="${PRODUCT_NAME}"
if [ -n "${VERSION:-}" ]; then
  if ! [[ "${VERSION}" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]; then
    echo "Error: VERSION must be a plain version or dist-tag (e.g. 1.0.0 or latest)." >&2
    exit 1
  fi
  PKG_SPEC="${PRODUCT_NAME}@${VERSION}"
  echo "Installing specific version: ${PKG_SPEC}..."
else
  echo "Installing latest version of ${PRODUCT_NAME} via npm..."
fi

# 4. Attempt npm install -g and handle EACCES
INSTALL_LOG=$(mktemp)
if ! npm install -g "${PKG_SPEC}" >"${INSTALL_LOG}" 2>&1; then
  cat "${INSTALL_LOG}" >&2
  if grep -qi "EACCES" "${INSTALL_LOG}"; then
    echo "" >&2
    echo "Error: npm encountered an EACCES permissions error during global installation." >&2
    echo "Do NOT use 'sudo npm install'." >&2
    echo "To fix npm permissions without sudo, configure an npm prefix in your home directory or use a Node version manager (nvm, fnm, volta):" >&2
    echo "  mkdir -p \"\${HOME}/.npm-global\"" >&2
    echo "  npm config set prefix \"\${HOME}/.npm-global\"" >&2
    echo "  export PATH=\"\${HOME}/.npm-global/bin:\${PATH}\"" >&2
    echo "Add the export line to your ~/.bashrc or ~/.zshrc, then re-run this installer." >&2
  else
    echo "" >&2
    echo "Error: Failed to install ${PKG_SPEC} via npm. See error log above." >&2
  fi
  rm -f "${INSTALL_LOG}"
  exit 1
fi
rm -f "${INSTALL_LOG}"

# 5. Verify command availability in PATH
if ! command -v "${PRODUCT_NAME}" >/dev/null 2>&1; then
  echo "Error: '${PRODUCT_NAME}' was installed, but the executable was not found in your PATH." >&2
  echo "Ensure your global npm bin directory is in your PATH." >&2
  echo "You can find your npm global bin path with: npm prefix -g" >&2
  exit 1
fi

# 6. Verify skillapt --version runs successfully
if ! "${PRODUCT_NAME}" --version >/dev/null 2>&1; then
  echo "Error: '${PRODUCT_NAME}' binary was found, but '${PRODUCT_NAME} --version' failed to execute." >&2
  exit 1
fi

INSTALLED_VER=$("${PRODUCT_NAME}" --version)

# 7. Print success only after full verification
echo ""
echo "=== ${PRODUCT_NAME} v${INSTALLED_VER} installed successfully! ==="
echo "Run '${PRODUCT_NAME} --help' or '${PRODUCT_NAME} doctor' to get started."
