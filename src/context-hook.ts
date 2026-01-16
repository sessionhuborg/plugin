#!/usr/bin/env node
/**
 * SessionHub Context Injection Hook
 *
 * This hook runs on SessionStart (including /clear and /compact) to inject
 * relevant observations from past sessions into the current Claude Code session.
 *
 * Architecture: Plugin → Backend (gRPC) → Supabase
 * The plugin no longer queries Supabase directly. All operations go through
 * the authenticated gRPC backend which securely holds the service key.
 *
 * Flow:
 * 1. Read stdin JSON containing session metadata (session_id, cwd, source, transcript_path)
 * 2. Load config from ~/.sessionhub/config.json
 * 3. Call backend to get user preferences and observations
 * 4. Format observations as markdown context
 * 5. Output to stdout as JSON with hookSpecificOutput structure
 *
 * The hook fails gracefully - if anything fails, it returns empty context
 * and allows the session to start normally.
 */

import { stdin } from 'process';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { formatObservationsContext, Observation } from './context-formatter.js';
import { GrpcAPIClient } from './grpc-client.js';

// Ensure ~/.sessionhub directory exists before any operations
const sessionhubDir = path.join(homedir(), '.sessionhub');
try {
  fs.mkdirSync(sessionhubDir, { recursive: true });
} catch {
  // Silently fail - may not have permissions
}

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
  } catch (error) {
    // Silently fail - config not available
  }
  return null;
}

/**
 * Output empty context response (for graceful failures)
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
 * Output context response
 */
function outputContext(context: string): void {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  }));
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
    // 1. Read stdin for session metadata
    const hookInput = await readStdin();
    const projectPath = hookInput.cwd || process.cwd();
    const projectName = path.basename(projectPath);

    // 2. Load configuration
    const config = loadConfig();
    if (!config?.user?.apiKey) {
      // No config or missing API key - skip context injection
      outputEmpty();
      return;
    }

    // 3. Create gRPC client
    const backendUrl = config.backendGrpcUrl || 'localhost:50051';
    const client = new GrpcAPIClient(config.user.apiKey, backendUrl, config.grpcUseTls);

    // 4. Get user preferences from backend
    const prefs = await client.getUserPreferences();
    if (!prefs) {
      // Failed to get preferences - skip context injection
      outputEmpty();
      return;
    }

    // 5. Check if context injection is enabled
    if (!prefs.contextInjection) {
      outputEmpty();
      return;
    }

    // 6. Get project ID by name (need to find or create project first)
    const projects = await client.getProjects();
    const project = projects?.find(p => p.name === projectName || p.display_name === projectName);

    if (!project) {
      // No project found for this directory - skip context injection
      outputEmpty();
      return;
    }

    // 7. Get user's context injection preferences
    const observationsLimit = prefs.contextInjectionLimit || 50;
    const fullDetailsCount = prefs.contextInjectionFullDetailsCount || 5;
    const maxTokens = prefs.contextInjectionMaxTokens || 2500;

    // 8. Fetch observations from backend
    const obsResult = await client.getProjectObservations(project.id, observationsLimit);

    if (!obsResult || obsResult.observations.length === 0) {
      // No observations - skip context injection
      outputEmpty();
      return;
    }

    // 9. Convert to Observation format for formatter
    const observations: Observation[] = obsResult.observations.map(obs => ({
      id: obs.id,
      session_id: obs.sessionId,
      project_id: obs.projectId,
      user_id: '', // Not needed for formatting
      type: obs.type as Observation['type'],
      title: obs.title,
      subtitle: obs.subtitle,
      narrative: obs.narrative,
      facts: obs.facts,
      concepts: obs.concepts,
      files: obs.files,
      tool_name: obs.toolName,
      discovery_tokens: 0, // Not tracked in backend response
      created_at: obs.createdAt,
      updated_at: obs.createdAt, // Use created_at as fallback
    }));

    // 10. Format observations as markdown context with user's preferences
    let context = formatObservationsContext(observations, {
      topN: Math.min(fullDetailsCount, observations.length),
      projectName: projectName,
      includeTable: true,
      includeFullDetails: true,
    });

    // 11. Enforce token budget by truncating if needed (rough estimate: 1 token ≈ 4 chars)
    const estimatedTokens = Math.ceil(context.length / 4);
    if (estimatedTokens > maxTokens) {
      // Truncate to fit within token budget
      const maxChars = maxTokens * 4;
      context = context.slice(0, maxChars) + '\n\n*[Context truncated to fit token budget]*';
    }

    // 12. Output the context
    outputContext(context);

  } catch (error) {
    // Fail gracefully - never block session start
    outputEmpty();
  }
}

// Run main function
main();
