#!/usr/bin/env node
/**
 * SessionHub Clear Capture Hook
 *
 * Triggered on /clear command (SessionStart with source="clear").
 * Captures the session before it's cleared, based on user preferences.
 *
 * This hook checks the user's autoSaveSession preference before capturing.
 * If enabled (default), it spawns the capture command in the background.
 * Exits immediately to avoid blocking Claude Code.
 */

import { spawn } from 'child_process';
import { stdin } from 'process';
import path from 'path';
import fs from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { GrpcAPIClient } from './grpc-client.js';

// Debug logging - writes to ~/.sessionhub/hook-debug.log
const DEBUG_LOG_PATH = path.join(homedir(), '.sessionhub', 'hook-debug.log');

function debugLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [clear-capture] ${message}\n`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, logLine);
  } catch {
    // Can't log, ignore
  }
}

// ESM compatibility - define __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Config {
  user: { apiKey: string };
  backendGrpcUrl?: string;
  grpcUseTls?: boolean;
}

interface HookInput {
  session_id?: string;
  cwd?: string;
  source?: string;
  transcript_path?: string;
}

/**
 * Load configuration from ~/.sessionhub/config.json
 */
function loadConfig(): Config | null {
  try {
    const configPath = path.join(homedir(), '.sessionhub', 'config.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configData);
    }
  } catch {
    // Silently fail - config not available
  }
  return null;
}

/**
 * Output empty response (for SessionStart hook)
 */
function outputEmpty(): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: ''
    }
  }));
}

/**
 * Check if content is a system/meta message that should be ignored
 * These are Claude Code internal messages, not actual user conversation
 */
function isSystemOrMetaContent(content: string): boolean {
  if (!content) return true;
  const trimmed = content.trim();
  // System XML tags that Claude Code uses for internal messages
  return (
    trimmed.startsWith('<local-command-caveat>') ||
    trimmed.startsWith('<command-name>') ||
    trimmed.startsWith('<local-command-stdout>') ||
    trimmed.startsWith('<local-command-stderr>') ||
    trimmed.startsWith('<system-reminder>') ||
    trimmed.startsWith('[system') ||
    trimmed === '' ||
    // Also check for common meta patterns
    trimmed.startsWith('<hook-') ||
    trimmed.startsWith('<file-history-')
  );
}

/**
 * Quick check if transcript has meaningful content (user prompts + assistant responses)
 * Reads the file line by line and counts human/assistant messages
 * Returns true if session has at least 1 REAL user message AND 1 assistant response
 */
function hasValidSessionContent(transcriptPath: string): boolean {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    let hasUserMessage = false;
    let hasAssistantResponse = false;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Skip meta entries entirely
        if (entry.isMeta === true) {
          continue;
        }

        // Skip non-conversation entry types
        if (entry.type !== 'user' && entry.type !== 'human' && entry.type !== 'assistant') {
          continue;
        }

        // Check for user message (human turn)
        if ((entry.type === 'human' || entry.type === 'user') && entry.message?.content) {
          const msgContent = entry.message.content;
          // Handle string content
          if (typeof msgContent === 'string' && !isSystemOrMetaContent(msgContent)) {
            hasUserMessage = true;
          } else if (Array.isArray(msgContent) && msgContent.length > 0) {
            // Check for real text content in array format
            const hasRealText = msgContent.some((c: any) =>
              c.type === 'text' && c.text && !isSystemOrMetaContent(c.text)
            );
            if (hasRealText) hasUserMessage = true;
          }
        }

        // Check for assistant response
        if (entry.type === 'assistant' && entry.message?.content) {
          const msgContent = entry.message.content;
          if (typeof msgContent === 'string' && msgContent.trim()) {
            hasAssistantResponse = true;
          } else if (Array.isArray(msgContent) && msgContent.length > 0) {
            hasAssistantResponse = true;
          }
        }

        // Early exit if we found both
        if (hasUserMessage && hasAssistantResponse) {
          return true;
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    debugLog(`Validation result: hasUserMessage=${hasUserMessage}, hasAssistantResponse=${hasAssistantResponse}`);
    return hasUserMessage && hasAssistantResponse;
  } catch (e) {
    debugLog(`Error checking transcript content: ${e}`);
    // On error (file doesn't exist), don't capture - session is empty
    return false;
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
      return {};
    }
  }

  return {};
}

/**
 * Check if auto-save is enabled in user preferences
 * Returns true by default if preferences can't be loaded (fail-safe)
 */
async function isAutoSaveEnabled(config: Config): Promise<boolean> {
  try {
    const client = new GrpcAPIClient(
      config.user.apiKey,
      config.backendGrpcUrl || 'api.sessionhub.io:443',
      config.grpcUseTls
    );

    const prefs = await client.getUserPreferences();
    await client.close();

    // Default to enabled if preference not set
    return prefs?.autoSaveSession ?? true;
  } catch {
    // On error, default to enabled (fail-safe - don't lose user's work)
    return true;
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  debugLog('=== CLEAR-CAPTURE HOOK STARTED ===');
  try {
    // Read stdin for session metadata
    debugLog('Reading stdin...');
    const input = await readStdin();
    debugLog(`Received input: ${JSON.stringify(input)}`);

    const source = input.source;
    const transcriptPath = input.transcript_path;
    const cwd = input.cwd || process.cwd();
    debugLog(`source: ${source}`);
    debugLog(`transcript_path: ${transcriptPath}`);
    debugLog(`cwd: ${cwd}`);

    // Only process /clear events
    if (source !== 'clear') {
      debugLog(`Skipping - source is "${source}", not "clear"`);
      outputEmpty();
      process.exit(0);
    }

    // Skip if no transcript path
    if (!transcriptPath) {
      debugLog('ERROR: No transcript_path provided, exiting');
      outputEmpty();
      process.exit(0);
    }

    // Check if transcript file exists and get its size
    try {
      const stats = fs.statSync(transcriptPath);
      debugLog(`Transcript file exists, size: ${stats.size} bytes`);
    } catch (e) {
      debugLog(`ERROR: Transcript file not accessible: ${e}`);
    }

    // Load config to check if SessionHub is configured
    const config = loadConfig();
    if (!config?.user?.apiKey) {
      debugLog('ERROR: No API key configured, exiting');
      outputEmpty();
      process.exit(0);
    }
    debugLog('Config loaded, API key present');

    // Check user preference for auto-save
    debugLog('Checking auto-save preference...');
    const autoSaveEnabled = await isAutoSaveEnabled(config);
    debugLog(`Auto-save enabled: ${autoSaveEnabled}`);
    if (!autoSaveEnabled) {
      debugLog('Auto-save disabled by user preference, exiting');
      outputEmpty();
      process.exit(0);
    }

    // Check if session has meaningful content (skip empty sessions)
    debugLog('Checking if session has meaningful content...');
    const hasContent = hasValidSessionContent(transcriptPath);
    debugLog(`Session has content: ${hasContent}`);
    if (!hasContent) {
      debugLog('Session is empty (no user messages or assistant responses), skipping capture');
      outputEmpty();
      process.exit(0);
    }

    // Get plugin root directory
    // In ESM, __dirname is defined at module level from import.meta.url
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(__dirname);
    const cliPath = path.join(pluginRoot, 'dist', 'cli.js');
    debugLog(`Plugin root: ${pluginRoot}`);
    debugLog(`CLI path: ${cliPath}`);

    // Check if CLI exists
    if (!fs.existsSync(cliPath)) {
      debugLog(`ERROR: CLI not found at ${cliPath}`);
    }

    const args = [
      cliPath,
      'capture',
      '--transcript', transcriptPath,
      '--project-path', cwd,
      // Pass session_id to ensure correct session is captured even with parallel sessions
      ...(input.session_id ? ['--session-id', input.session_id] : [])
    ];
    debugLog(`Spawning: node ${args.join(' ')}`);

    // Create a log file for the capture process output
    const captureLogPath = path.join(homedir(), '.sessionhub', 'capture-output.log');
    const captureLogFd = fs.openSync(captureLogPath, 'a');
    fs.writeSync(captureLogFd, `\n[${new Date().toISOString()}] === CAPTURE FROM CLEAR STARTED ===\n`);
    fs.writeSync(captureLogFd, `Command: node ${args.join(' ')}\n`);

    // Run capture command - capture output for debugging
    const child = spawn('node', args, {
      detached: true,
      stdio: ['ignore', captureLogFd, captureLogFd],
      cwd: pluginRoot
    });

    debugLog(`Spawned child process PID: ${child.pid}`);

    // Unref the child to allow this process to exit
    child.unref();
    fs.closeSync(captureLogFd);

    debugLog('=== CLEAR-CAPTURE HOOK COMPLETED ===');
    // Output empty response - we don't inject context on clear
    outputEmpty();
    process.exit(0);
  } catch (error) {
    debugLog(`ERROR: Unexpected exception: ${error}`);
    // Silently fail - don't block Claude
    outputEmpty();
    process.exit(0);
  }
}

// Run main function
main();
