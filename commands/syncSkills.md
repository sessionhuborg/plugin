---
description: Sync approved team skills from SessionHub as native SKILL.md files
argument-hint: "[--team team-id] [--project project-id]"
allowed-tools: ["Bash(node:*)"]
---

Sync approved team skills from SessionHub to the local plugin as native SKILL.md files. Once synced, Claude Code auto-discovers these skills and loads them JIT when contextually relevant.

## Arguments
- $1: Team ID (optional, uses primary team if omitted)

## Instructions

1. Run the sync command:

```bash
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js sync-skills ${1:+--team "$1"}
```

2. Parse the JSON output and report:
   - Total skills synced
   - How many were new, updated, or removed
   - The skills directory path

3. **Handle errors**:
   - If no teams found, suggest the user join or create a team at https://sessionhub.dev
   - For permission errors, suggest checking team membership
   - For other errors, report the error message

## What Happens

- Fetches all **approved**, **team-visible**, **non-sensitive** skills via gRPC
- Writes each skill as `skills/{slug}/SKILL.md` in the plugin directory
- Claude Code auto-discovers these and loads them when relevant
- Removes local skills that were deleted/archived on the server
- Caches versions to skip unchanged skills on re-sync

## Example Output

> Synced 12 skills (3 new, 1 updated, 1 removed)
