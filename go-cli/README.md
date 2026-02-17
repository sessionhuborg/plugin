# SessionHub Go CLI (Plugin-owned)

Standalone `sessionhub` CLI owned by the plugin package and bundled as `bin/sessionhub`.

## Build

```bash
cd sessionhub-plugin-standalone/go-cli
go build -o ../bin/sessionhub ./cmd/sessionhub
```

Or from plugin root:

```bash
npm run build:go-cli
```

## Why this layout

- CLI source lives in the plugin repo package (`go-cli/`) so plugin distribution is self-contained.
- Plugin installs can ship a prebuilt `bin/sessionhub` without requiring Node runtime for hooks.
- The same binary can be published separately for standalone installs.
