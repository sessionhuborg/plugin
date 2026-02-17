#!/usr/bin/env bash
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN="${ROOT}/bin/sessionhub"

if [[ ! -x "${BIN}" ]]; then
  # Do not block Claude startup if binary is missing.
  exit 0
fi

"${BIN}" hook session-start
