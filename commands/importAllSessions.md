---
description: Import all Claude Code sessions from project to SessionHub
argument-hint: "[project-path] [project-name]"
allowed-tools: ["Bash(bash:*)"]
---

Bulk import all Claude Code transcript files from a project directory to SessionHub.

## Arguments
- $1: Project path (optional, uses project directory from context or current directory)
- $2: Project name override (optional, auto-detected from directory)

## Instructions

1. **Get project path**:
   - If $1 is provided, use that path
   - Otherwise, look for `[SESSIONHUB_PROJECT_DIR:xxx]` in context
   - Fall back to `$SESSIONHUB_PROJECT_DIR` env var

2. Run the SessionHub CLI to import all sessions:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/sessionhub.sh import-all --json \
  --path "PROJECT_PATH_HERE" \
  ${2:+--project "$2"}
```

**Important**: Replace `PROJECT_PATH_HERE` with the resolved project path from step 1.

3. Parse the JSON output and report:
   - Total transcript files found
   - Successfully imported count
   - Failed count (if any)
   - List of imported sessions with their IDs

4. If the import fails, report the error.
