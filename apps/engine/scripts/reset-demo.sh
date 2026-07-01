#!/usr/bin/env bash
# Reset an org (team) to zero — deletes all its data so you can re-seed cleanly.
#
# Usage:
#   ./scripts/reset-demo.sh                 # reset org "demo" (asks confirmation)
#   TEAM=acme ./scripts/reset-demo.sh       # reset another org by slug
#   ./scripts/reset-demo.sh --yes           # skip confirmation
#   ./scripts/reset-demo.sh --hard          # also wipe secrets/keys/memberships
#   ./scripts/reset-demo.sh --drop-team     # also delete the team row (implies --hard)
#
# Runs the ORM-based deletion (portable Postgres/PGlite). Safe to run while the engine is up.
set -euo pipefail

# Resolve the engine dir from this script's location, regardless of CWD.
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM="${TEAM:-demo}"

# Split flags: --yes is consumed here; the rest is forwarded to the bun script.
ASSUME_YES=0
FORWARD=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) FORWARD+=("$arg") ;;
  esac
done

MODE="operational data (secrets/keys/memberships KEPT)"
for arg in "${FORWARD[@]:-}"; do
  [[ "$arg" == "--hard" ]] && MODE="EVERYTHING incl. secrets/keys/memberships"
  [[ "$arg" == "--drop-team" ]] && MODE="EVERYTHING + the team row itself"
done

echo "⚠️  About to DELETE ${MODE} for org \"${TEAM}\". This is irreversible."
if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Type the org slug (\"${TEAM}\") to confirm: " reply
  if [[ "$reply" != "$TEAM" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

cd "$ENGINE_DIR"
TEAM="$TEAM" bun run scripts/reset-demo.ts "${FORWARD[@]:-}"
