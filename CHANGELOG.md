# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-16

### Added
- Initial marketplace release
- `/setup` - Configure SessionHub API key with validation
- `/capture` - Capture current session with optional naming and exchange limits
- `/import` - Bulk import all sessions from a Claude Code project
- `/observations` - Extract AI-powered insights from past sessions for context injection
- `SessionStart` hook - Injects session ID for parallel session support + loads context
- `SessionEnd` hook - Automatically captures sessions when they end
- Parallel session support with unique session ID injection
- Sub-agent conversation capture from Task tool usage
- Token tracking (input, output, cache tokens)
- Git branch detection
- Programming language detection
