---
description: Push a local skill file or directory to the team as a draft for review
argument-hint: "<file-or-dir-path> [--title name] [--category type] [--tags a,b,c]"
allowed-tools: ["Bash(sessionhub:*)", "Read", "Glob"]
---

Push a local SKILL.md file or a multi-file skill directory to the team's Skills Hub as a draft. The skill will appear in the web UI for review and approval.

## Arguments
- $1: Path to a skill file (.md) or a skill directory (required)

## Instructions

1. **Determine input type**: Check whether $1 is a file or directory.
   - **File**: If $1 is a relative path, resolve it. If $1 is a skill name (no path separator), search for it:
     - Check `skills/$1/SKILL.md` in the plugin directory
     - Check `./$1.md` in the current directory
     - Check `CLAUDE.md` if the user mentions it
   - **Directory**: Use `--dir` flag. All files in the directory are included as a multi-file skill.

2. **Run the push command**:

For a single file:
```bash
${CLAUDE_PLUGIN_ROOT}/bin/sessionhub push-skill --json --file "$1"
```

For a directory (multi-file skill):
```bash
${CLAUDE_PLUGIN_ROOT}/bin/sessionhub push-skill --json --dir "$1"
```

If additional options were specified by the user, include them:
- `--title "Skill Name"` - Override the title
- `--category prompt` - Set category (prompt, checklist, code_pattern, runbook, playbook, other)
- `--tags "tag1,tag2"` - Add tags
- `--summary "Brief description"` - Add a summary

3. **Parse the JSON output** and report:
   - Skill slug and ID
   - File count (for multi-file skills)
   - Success message with link to review in the web UI

4. **Handle errors**:
   - File/directory not found: suggest checking the path
   - Permission errors: user might be a viewer (cannot create skills)
   - Other errors: report the error message

## Example Usage

- `/pushSkill skills/error-handling/SKILL.md` - Push a specific skill file
- `/pushSkill my-checklist.md --category checklist` - Push with category
- `/pushSkill skills/error-handling/` - Push an entire skill directory (multi-file)
