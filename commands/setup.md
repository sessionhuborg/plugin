---
description: Configure SessionHub with your API key (Go CLI)
argument-hint: "[api-key]"
allowed-tools: ["Bash(sessionhub:*)"]
---

Set up SessionHub by configuring your API key. This is required before you can capture sessions.

## Arguments
- $1: Your SessionHub API key (optional - will prompt if not provided)

## Instructions

1. **Get the API key**:
   - If $1 is provided, use that as the API key
   - If not provided, ask the user: "Please enter your SessionHub API key (get one at https://sessionhub.dev/settings):"

2. **Validate the API key format**:
   - API key should not be empty
   - If empty or user cancels, inform them setup is incomplete

3. **Write the configuration**:

Run this command to save the config (replace API_KEY_HERE with the actual key):

```bash
${CLAUDE_PLUGIN_ROOT}/bin/sessionhub setup --api-key "API_KEY_HERE" --json
```

4. **Report the result**:
   - If successful: "SessionHub configured successfully! You can now use `/capture` to save your sessions."
   - If failed: Show the error and suggest checking the API key

## Example Usage

```
/setup sk_live_abc123...
```

Or without arguments to be prompted:

```
/setup
```
