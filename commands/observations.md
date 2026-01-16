---
description: Extract observations from an analyzed session for context injection
argument-hint: "[session-id]"
allowed-tools: ["Bash(node:*)", "Read"]
---

Extract observations from a Claude Code session that has already been analyzed.

Observations are actionable learnings (decisions, discoveries, patterns) that can be injected into future sessions as context.

## Arguments
- $1: Database session ID (optional, uses last captured session if omitted)

## Prerequisites

The session must already have AI insights generated. If not, the extraction will fail.

## Instructions

1. **Determine Session ID**

If the user provided a session-id argument ($1), use it directly.

If no session-id was provided, try to get the last captured session:
```bash
cat ~/.sessionhub/last-session.json 2>/dev/null
```

If the file exists, parse the JSON and extract the `sessionId` value.

If neither works, inform the user:
> "No session ID provided and no recent capture found. Please specify a session ID or run /capture first."

2. **Run Observations Extraction**

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js extract-observations --session SESSION_ID
```

Replace `SESSION_ID` with the determined session ID.

3. **Report Results**

Parse the JSON output and report:
- Success: "Observations extracted successfully for session {sessionId}"
- Failure: Show the error message from the CLI

## Example Usage

- `/observations` - Extract observations from the last captured session
- `/observations abc123-def456` - Extract observations from a specific session

## Notes

- Observations require existing AI insights (run /capture with analysis enabled first)
- This command triggers an async operation - observations may take a moment to appear
- Extracted observations are stored in the database and can be viewed in the session detail page
