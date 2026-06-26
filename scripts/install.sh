#!/usr/bin/env bash
set -euo pipefail

# Agentik CLI installer — does not start the daemon.
# After install, run: agentik setup --url <engine> --token <token> --start

AGENTIK_VERSION="${AGENTIK_VERSION:-latest}"
INSTALL_DIR="${AGENTIK_INSTALL_DIR:-$HOME/.local/bin}"
GITHUB_REPO="${AGENTIK_GITHUB_REPO:-agentik-ai/agentik}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

case "$os" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $os" >&2
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR"

if [ "$AGENTIK_VERSION" = "latest" ]; then
  release_url="https://github.com/${GITHUB_REPO}/releases/latest/download/agentik-${os}-${arch}"
else
  release_url="https://github.com/${GITHUB_REPO}/releases/download/${AGENTIK_VERSION}/agentik-${os}-${arch}"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Downloading Agentik CLI for ${os}/${arch}..."
if ! curl -fsSL "$release_url" -o "$tmp"; then
  echo "Release download failed. Build from source or set AGENTIK_CLI_PATH." >&2
  exit 1
fi

chmod +x "$tmp"
mv "$tmp" "${INSTALL_DIR}/agentik"
trap - EXIT

if ! echo ":$PATH:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "Add ${INSTALL_DIR} to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi

echo ""
echo "Installed agentik to ${INSTALL_DIR}/agentik"
if command -v agentik >/dev/null 2>&1; then
  agentik doctor || true
else
  echo "Run: export PATH=\"${INSTALL_DIR}:\$PATH\" && agentik doctor"
fi

echo ""
echo "Next: agentik setup --url <engine-url> --token <your-token> --start"
