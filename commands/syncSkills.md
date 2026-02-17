---
description: Sync approved team skills from SessionHub to ~/.claude/skills/
argument-hint: "[--team team-id] [--project project-id]"
allowed-tools: ["Bash(sessionhub:*)"]
---

Sync approved team skills from SessionHub to `~/.claude/skills/` — the standard Claude Code personal skills directory. All skills are namespaced by team slug to prevent cross-team collisions. Once synced, Claude Code auto-discovers these skills and loads them JIT when contextually relevant.

## Arguments
- $1: Team ID (optional, uses primary team if omitted)

## Instructions

1. Run the sync command:

```bash
${CLAUDE_PLUGIN_ROOT}/bin/sessionhub sync-skills --json ${1:+--team "$1"}
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
- Writes each skill as `~/.claude/skills/{teamSlug}-{slug}/SKILL.md`
- Claude Code auto-discovers these from its standard skills directory
- Removes local skills that were deleted/archived on the server
- Caches versions to skip unchanged skills on re-sync

## Example Output

> Synced 12 skills (3 new, 1 updated, 1 removed)
