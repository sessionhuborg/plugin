---
description: View observations for a project or session in the SessionHub web UI
argument-hint: "[project-name]"
allowed-tools: ["Bash(bash:*)", "Read"]
---

View observations (decisions, discoveries, patterns) extracted from your Claude Code sessions.

Observations are now automatically extracted by the backend when sessions are captured and analyzed. You can browse and manage them in the SessionHub web UI.

## Arguments
- $1: Project name (optional, auto-detected from current directory)

## Instructions

1. **Determine the team and project context**

Try to get the last captured session for project context:
```bash
cat ~/.sessionhub/last-session.json 2>/dev/null
```

If the file exists, parse the JSON to get the `projectName`.

If the user provided a project-name argument ($1), use that instead.

If neither works, use the current directory name as the project name.

2. **Direct the user to the web UI**

Observations are managed in the SessionHub web app under the **Observations** tab in the sidebar.

Tell the user:
> Your observations are available in the SessionHub web app. Navigate to your team's **Observations** page and select the project from the dropdown.
>
> Observations are automatically extracted when sessions are captured with analysis enabled. To view observations for a specific project, visit:
> **https://sessionhub.dev/t/YOUR_TEAM/observations**

3. **Check if observations exist for recent session**

If you have a session ID from `last-session.json`, you can verify observations were extracted:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/sessionhub.sh observations --json \
  ${1:+--project "$1"}
```

This returns current observations payload from the backend for the resolved project.

## Example Usage

- `/observations` - Show where to find observations for current project
- `/observations my-project` - Show where to find observations for a specific project

## Notes

- Observations are automatically extracted by the backend after session capture
- No manual extraction step is needed anymore
- View, filter, promote, and manage lifecycle states in the web UI
- Admins can promote session observations to project scope for team-wide visibility
