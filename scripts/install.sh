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

# Build agentik from a source checkout (repo root or apps/daemon). Needs Go.
build_from_source() {
  command -v go >/dev/null 2>&1 || return 1
  local dir="$1"
  [ -f "${dir}/apps/daemon/main.go" ] && dir="${dir}/apps/daemon"
  [ -f "${dir}/main.go" ] || return 1
  echo "Building Agentik CLI from source (${dir})..." >&2
  ( cd "$dir" && go build -o "${INSTALL_DIR}/agentik" . )
}

# Resolution order: AGENTIK_CLI_PATH (prebuilt) -> GitHub release -> source build.
# Self-hosted/local installs have no published GitHub release, so the source
# build keeps the in-app "Add a computer" flow working on dev/CI machines.
if [ -n "${AGENTIK_CLI_PATH:-}" ]; then
  echo "Installing agentik from AGENTIK_CLI_PATH=${AGENTIK_CLI_PATH}..." >&2
  install -m 0755 "$AGENTIK_CLI_PATH" "${INSTALL_DIR}/agentik"
else
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  echo "Downloading Agentik CLI for ${os}/${arch}..." >&2
  if curl -fsSL "$release_url" -o "$tmp"; then
    chmod +x "$tmp"
    mv "$tmp" "${INSTALL_DIR}/agentik"
  else
    rm -f "$tmp"
    echo "No prebuilt release at ${release_url}." >&2
    src="${AGENTIK_SOURCE_DIR:-}"
    if [ -z "$src" ]; then
      d="$PWD"
      while [ "$d" != "/" ]; do
        if [ -f "${d}/apps/daemon/main.go" ]; then src="$d"; break; fi
        d="$(dirname "$d")"
      done
    fi
    if ! { [ -n "$src" ] && build_from_source "$src"; }; then
      echo "Could not install agentik. Options:" >&2
      echo "  - set AGENTIK_CLI_PATH=/path/to/agentik (prebuilt binary), or" >&2
      echo "  - set AGENTIK_SOURCE_DIR=/path/to/agentik-repo and install Go to build from source." >&2
      exit 1
    fi
  fi
  trap - EXIT
fi

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
