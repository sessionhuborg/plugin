#!/usr/bin/env node
/**
 * SessionHub Session ID Injection Hook
 *
 * This hook runs on SessionStart to:
 * 1. Check if SessionHub is configured (API key present)
 * 2. Inject the session ID into Claude's context for parallel session support
 * 3. Persist SESSIONHUB_PROJECT_DIR to CLAUDE_ENV_FILE for slash commands
 *
 * The hook fails gracefully - if anything fails, it allows the session to start normally.
 */

import { stdin } from 'process';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

// Ensure ~/.sessionhub directory exists before any operations
const sessionhubDir = path.join(homedir(), '.sessionhub');
try {
  fs.mkdirSync(sessionhubDir, { recursive: true });
} catch {
  // Silently fail - may not have permissions
}

/**
 * Escape special shell characters for safe use in double-quoted strings
 * Prevents shell injection when writing to env files
 */
function escapeShellString(str: string): string {
  // Remove newlines/carriage returns to prevent line injection attacks
  // Then escape: backslash, double-quote, dollar sign, backtick
  return str.replace(/[\n\r]/g, '').replace(/[\\"`$]/g, '\\$&');
}

/**
 * Validate that a string is a valid UUID format
 * Prevents injection attacks via malformed session IDs
 */
function isValidUUID(str: string): boolean {
  // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

interface HookInput {
  session_id?: string;
  cwd?: string;
}

interface Config {
  user: { apiKey: string };
}

/**
 * Check if SessionHub is configured with an API key
 */
function checkConfig(): { configured: boolean; error?: string } {
  try {
    const configPath = path.join(homedir(), '.sessionhub', 'config.json');
    if (!fs.existsSync(configPath)) {
      return { configured: false, error: 'SessionHub is not configured yet.' };
    }

    const configData = fs.readFileSync(configPath, 'utf-8');
    const config: Config = JSON.parse(configData);
    const apiKey = config?.user?.apiKey;

    if (!apiKey) {
      return { configured: false, error: 'SessionHub API key is not set.' };
    }

    return { configured: true };
  } catch {
    return { configured: false, error: 'Could not read SessionHub config.' };
  }
}

/**
 * Read stdin for hook input
 */
async function readStdin(): Promise<HookInput> {
  // Check if running in TTY mode (for testing)
  if (stdin.isTTY) {
    return { cwd: process.cwd() };
  }

  let inputData = '';
  for await (const chunk of stdin) {
    inputData += chunk;
  }

  if (inputData.trim()) {
    try {
      return JSON.parse(inputData);
    } catch {
      return { cwd: process.cwd() };
    }
  }

  return { cwd: process.cwd() };
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    // Read stdin for session metadata
    const hookInput = await readStdin();
    const sessionId = hookInput.session_id;
    const projectDir = process.env.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd();

    // Check if SessionHub is configured
    const { configured } = checkConfig();

    // Persist project directory to env file for slash commands
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (envFile && projectDir) {
      try {
        // Escape shell special characters to prevent injection
        const escapedPath = escapeShellString(projectDir);
        fs.appendFileSync(envFile, `export SESSIONHUB_PROJECT_DIR="${escapedPath}"\n`);
      } catch {
        // Silently fail - don't block session start
      }
    }

    // Build the context message
    const contextParts: string[] = [];

    // Add setup warning if not configured
    if (!configured) {
      contextParts.push(
        '**SessionHub Setup Required**: Run `/setup <your-api-key>` to enable session capture. ' +
        'Get your API key at https://sessionhub.dev/settings'
      );
    }

    // Add session tracking info (only if valid UUID format)
    // Security: Validate session ID format to prevent injection attacks
    if (sessionId && isValidUUID(sessionId)) {
      contextParts.push(
        `[SESSIONHUB_SESSION_ID:${sessionId}] [SESSIONHUB_PROJECT_DIR:${projectDir}]`
      );
    }

    // Output the context if we have any
    if (contextParts.length > 0) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: contextParts.join(' | ')
        }
      }));
    }
  } catch {
    // Silently fail - don't block session start
  }
}

// Run main function
main();
