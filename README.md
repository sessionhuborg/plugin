# SessionHub Plugin for Claude Code

Capture and analyze your Claude Code development sessions with SessionHub.

## Quick Start

```bash
# 1. Add the marketplace
/plugin marketplace add https://github.com/sessionhuborg/plugin

# 2. Install the plugin
/plugin install sessionhub@sessionhuborg-plugin

# 3. Configure your API key
/sessionhub:setup YOUR_API_KEY
```

Get your API key at: [app.sessionhub.io/settings](https://app.sessionhub.io/settings)

## Features

- **Auto-Capture**: Automatically saves sessions when they end
- **Context Injection**: Loads relevant observations from past sessions at startup
- **Parallel Session Support**: Correctly identifies sessions when multiple are running
- **Bulk Import**: Import all transcript files from a project at once
- **Sub-Agent Support**: Captures sub-agent conversations from Task tool usage
- **Token Tracking**: Track input, output, and cache token usage

## Installation

### From GitHub

```bash
# 1. Add the marketplace
/plugin marketplace add https://github.com/sessionhuborg/plugin

# 2. Install the plugin
/plugin install sessionhub@sessionhuborg-plugin
```

### Verify Installation

```bash
/plugin list
```

## What Gets Installed

| Component | Purpose |
|-----------|---------|
| `/sessionhub:setup` | Configure SessionHub with your API key |
| `/sessionhub:captureSession` | Manually capture current session |
| `/sessionhub:importAllSessions` | Import all sessions from a project |
| `/sessionhub:observations` | Extract observations for context injection |
| `SessionStart` hook | Injects session ID + loads context from past sessions |
| `SessionEnd` hook | Auto-captures session when it ends |

## Usage

### Setup (First Time)

```bash
/sessionhub:setup YOUR_API_KEY
```

### Capture Current Session

```bash
/sessionhub:captureSession                              # Auto-detect project
/sessionhub:captureSession "feature work"               # Specify session name
/sessionhub:captureSession "feature work" my-project    # Specify session and project name
/sessionhub:captureSession --last 5                     # Only last 5 exchanges
```

### Import All Sessions

```bash
/sessionhub:importAllSessions                               # Import from current directory
/sessionhub:importAllSessions /path/to/project              # Import from specific path
/sessionhub:importAllSessions /path/to/project my-project   # With project name override
```

### Extract Observations

```bash
/sessionhub:observations                         # Get observations for current project
/sessionhub:observations <session-id>            # Get observations from specific session
```

### Auto-Capture

Sessions are automatically captured when Claude Code sessions end. No action required.

The `SessionStart` hook also injects context from your past sessions, helping Claude understand your project better.

## What Gets Captured

- User prompts and assistant responses
- Tool calls (Edit, Write, Bash, Grep, etc.)
- Token usage (input, output, cache)
- Planning mode cycles
- Todo list snapshots
- Sub-agent conversations
- Programming languages used
- Git branch information

## How Parallel Session Support Works

1. When a Claude Code session starts, the `SessionStart` hook injects a unique session ID
2. When you run `/sessionhub:captureSession` or the session ends, this ID finds the exact transcript
3. No more capturing the wrong session when multiple sessions are running

## Requirements

- Node.js 18+
- Claude Code CLI
- SessionHub account and API key

## Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/sessionhuborg/plugin.git
cd plugin

# Install dependencies
pnpm install

# Build (bundles with esbuild for standalone distribution)
pnpm run build

# Run tests
pnpm test
```

### Build System

The plugin uses **esbuild** to bundle all dependencies into standalone JavaScript files. This means:

- No `npm install` needed after marketplace installation
- All dependencies (gRPC, Zod, etc.) are bundled inline
- Works immediately when installed from the marketplace

### Testing Locally

```bash
# Install as local plugin
/plugin install ./plugin
```

### Project Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json        # Plugin manifest
├── commands/              # Slash command definitions
├── hooks/                 # Hook definitions and scripts
├── src/                   # TypeScript source
├── dist/                  # Bundled output (self-contained)
├── proto/                 # gRPC protobuf definitions
└── esbuild.config.js      # Build configuration
```

## Troubleshooting

### "SessionHub is not configured"

Run `/sessionhub:setup YOUR_API_KEY` to configure the plugin with your API key.

### Session ID not found

If `/sessionhub:captureSession` can't find the session ID:
1. Start a new Claude Code session (the hook only runs at session start)
2. Check that the plugin hooks are registered: `/plugin list`

### Wrong session captured

This happens when session ID injection isn't working. Ensure:
1. The plugin is properly installed
2. Node.js 18+ is available in PATH
3. Restart Claude Code after plugin installation

### Authentication failed

If you see "Authentication Failed", your API key may be invalid or expired:
1. Run `/sessionhub:setup NEW_API_KEY` with a fresh key
2. Get a new key at https://app.sessionhub.io/settings

### Plugin not loading

If commands aren't recognized:
1. Restart Claude Code completely
2. Run `/plugin list` to verify installation

## License

MIT
