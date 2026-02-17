#!/usr/bin/env bash
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN="${ROOT}/bin/sessionhub"

if [[ ! -x "${BIN}" ]]; then
  # SessionStart hooks should return a valid empty context payload.
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":""}}'
  exit 0
fi

"${BIN}" hook session-start-context
