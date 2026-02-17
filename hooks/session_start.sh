#!/usr/bin/env bash
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
"${ROOT}/hooks/sessionhub.sh" hook session-start || exit 0
