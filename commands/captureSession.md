---
description: Capture current Claude Code session to SessionHub
argument-hint: "[session-name] [project-name] [-n last-N] [-t transcript] [--api-key key] [--project-path path] [--session-id id]"
allowed-tools: ["Bash(sessionhub:*)"]
---

Capture the current Claude Code session to SessionHub for analytics and tracking.

## Arguments
- $1: Session name (optional, auto-generated from timestamp)
- $2: Project name (optional, auto-detected from current directory)

## Optional Flags
- `-n, --last N`: Only capture the last N user-assistant exchange pairs
- `-t, --transcript <path>`: Path to specific transcript file
- `--api-key <key>`: API key (uses stored config if omitted)
- `--project-path <path>`: Project directory path
- `--session-id <id>`: Session ID for parallel session support

## Instructions

1. **Extract values from context**: Look in the conversation for these injected values:
   - `[SESSIONHUB_SESSION_ID:xxx]` - The session ID (for parallel session support)
   - `[SESSIONHUB_PROJECT_DIR:xxx]` - The project directory path

2. Run the SessionHub CLI using the extracted values:

```bash
${CLAUDE_PLUGIN_ROOT}/bin/sessionhub capture --json \
  --project-path "PROJECT_DIR_HERE" \
  --session-id "SESSION_ID_HERE" \
  ${1:+--session "$1"} \
  ${2:+--project "$2"}
```

**Important**:
- Replace `PROJECT_DIR_HERE` with the path from `[SESSIONHUB_PROJECT_DIR:xxx]`
- Replace `SESSION_ID_HERE` with the ID from `[SESSIONHUB_SESSION_ID:xxx]`
- If values weren't found in context (older session), use `$SESSIONHUB_PROJECT_DIR` env var for project path, and omit `--session-id`

3. Parse the JSON output and report:
   - Session ID
   - Whether it was new or updated
   - Interactions captured
   - Token counts (input, output, cache)
   - Sub-agent count

4. **Handle errors**:
   - If capture fails with `session_limit_exceeded` error, display:
     - "Session limit reached (X/Y sessions used)"
     - "Upgrade to Pro for unlimited sessions: https://sessionhub.dev/pricing"
   - For other errors, report the error message.
