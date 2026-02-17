#!/usr/bin/env bash
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

resolve_os() {
  case "$(uname -s)" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

resolve_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "unknown" ;;
  esac
}

build_binary() {
  if ! command -v go >/dev/null 2>&1; then
    return 1
  fi
  if [[ ! -f "${ROOT}/go-cli/go.mod" ]]; then
    return 1
  fi

  mkdir -p "${ROOT}/bin" "${ROOT}/.cache/go-build"
  (
    cd "${ROOT}/go-cli"
    GOCACHE="${ROOT}/.cache/go-build" go build -o "${ROOT}/bin/sessionhub" ./cmd/sessionhub
  )
  chmod +x "${ROOT}/bin/sessionhub" || true
}

BIN="${ROOT}/bin/sessionhub"
if [[ ! -x "${BIN}" ]]; then
  OS_NAME="$(resolve_os)"
  ARCH_NAME="$(resolve_arch)"
  PREBUILT="${ROOT}/bin/sessionhub-${OS_NAME}-${ARCH_NAME}"

  if [[ -x "${PREBUILT}" ]]; then
    BIN="${PREBUILT}"
  else
    if ! build_binary; then
      echo "SessionHub CLI binary is missing and could not be built automatically." >&2
      echo "Expected: ${BIN}" >&2
      echo "To build manually: cd ${ROOT}/go-cli && go build -o ../bin/sessionhub ./cmd/sessionhub" >&2
      exit 127
    fi
  fi
fi

exec "${BIN}" "$@"
