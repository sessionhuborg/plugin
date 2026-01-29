#!/usr/bin/env node
/**
 * SessionHub CLI - Claude Code Plugin
 *
 * Capture and import Claude Code sessions to SessionHub.
 *
 * Architecture: Plugin → Backend (gRPC) → Supabase
 * The plugin no longer calls Supabase directly. All operations go through
 * the authenticated gRPC backend which securely holds the service key.
 */

import { program } from 'commander';
import { homedir } from 'os';
import { join, basename, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { ConfigManager } from './config.js';
import { GrpcAPIClient, parseSessionLimitError, parseOnboardingError } from './grpc-client.js';
import { TranscriptParser } from './transcript-parser.js';
import { ProjectDetector } from './project-detector.js';
import { logger } from './logger.js';
import type { SessionApiData, SubSessionData, UserInfo } from './models.js';

const CONFIG_DIR = join(homedir(), '.sessionhub');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function showSetupInstructions(): void {
  console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('  SessionHub is not configured yet!');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('\n  To get started, run:\n');
  console.error('    /setup <your-api-key>\n');
  console.error('  Get your API key at: https://sessionhub.dev/settings');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function initializeClient(apiKey?: string): Promise<{ client: GrpcAPIClient; user: UserInfo } | null> {
  const configManager = new ConfigManager();
  const config = configManager.getConfig();

  const finalApiKey = apiKey || config.user.apiKey;
  if (!finalApiKey) {
    showSetupInstructions();
    return null;
  }

  const client = new GrpcAPIClient(finalApiKey, config.backendGrpcUrl, config.grpcUseTls);

  const user = await client.validateApiKey();
  if (!user) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('  Authentication Failed');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('\n  Your API key appears to be invalid or the server is unreachable.');
    console.error('\n  To reconfigure, run:\n');
    console.error('    /setup <your-api-key>\n');
    console.error('  Get a new API key at: https://sessionhub.dev/settings');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return null;
  }

  logger.info(`Authenticated as: ${user.email}`);
  return { client, user };
}

async function ensureProject(
  client: GrpcAPIClient,
  projectName: string,
  projectPath: string
): Promise<any | null> {
  const projectDetector = new ProjectDetector();
  const detectedProject = projectDetector.detectProject(projectPath);

  if (!detectedProject) {
    console.error('Could not detect project');
    return null;
  }

  const finalProjectName = projectName || detectedProject.name;

  const existingProjects = await client.getProjects();
  const existingProject = existingProjects?.find(
    (p: any) => p.name === finalProjectName || p.display_name === finalProjectName
  );

  if (existingProject) {
    logger.info(`Using existing project: ${finalProjectName}`);
  } else {
    logger.info(`Project will be auto-created: ${finalProjectName}`);
  }

  return {
    name: finalProjectName,
    display_name: finalProjectName,
    description: existingProject?.description || `Auto-created project from CLI for ${finalProjectName}`,
    git_remote: existingProject?.git_remote || detectedProject.gitRemote,
    path: detectedProject.path,
    branch: detectedProject.branch,
  };
}

program
  .name('sessionhub-cli')
  .description('Capture and import Claude Code sessions to SessionHub')
  .version('1.0.0');

// Setup command - configure API key
program
  .command('setup')
  .description('Configure SessionHub with your API key')
  .option('--api-key <key>', 'Your SessionHub API key')
  .action(async (opts) => {
    try {
      const apiKey = opts.apiKey;

      if (!apiKey) {
        console.error('Error: API key is required. Usage: setup --api-key <your-api-key>');
        process.exit(1);
      }

      // Create config directory if it doesn't exist
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
      }

      // Load existing config or create new one
      let config: any = {};
      if (existsSync(CONFIG_FILE)) {
        try {
          config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
        } catch {
          // Start fresh if config is corrupted
        }
      }

      // Update API key
      config.user = config.user || {};
      config.user.apiKey = apiKey;

      // Validate the API key before saving
      const configManager = new ConfigManager();
      const fullConfig = configManager.getConfig();
      const client = new GrpcAPIClient(apiKey, fullConfig.backendGrpcUrl, fullConfig.grpcUseTls);

      const user = await client.validateApiKey();
      if (!user) {
        console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('  Invalid API Key');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('\n  The API key could not be validated.');
        console.error('  Please check your key and try again.');
        console.error('\n  Get your API key at: https://sessionhub.dev/settings');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(1);
      }

      // Always use the default backend URL (plugin.sessionhub.dev)
      // This ensures users with old cached URLs get updated
      config.backendGrpcUrl = 'plugin.sessionhub.dev';

      // Save config with restrictive permissions (contains API key)
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });

      const output = {
        success: true,
        message: 'SessionHub configured successfully!',
        email: user.email,
        configPath: CONFIG_FILE,
      };

      console.log(JSON.stringify(output, null, 2));
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('capture')
  .description('Capture a Claude Code session')
  .option('-p, --project <name>', 'Project name (auto-detected if omitted)')
  .option('-s, --session <name>', 'Session name (auto-generated if omitted)')
  .option('-t, --transcript <path>', 'Transcript file path (latest if omitted)')
  .option('-n, --last <n>', 'Only capture last N user-assistant exchanges', parseInt)
  .option('--api-key <key>', 'API key (uses API_KEY env var if omitted)')
  .option('--project-path <path>', 'Project path (uses cwd if omitted)')
  .option('--session-id <id>', 'Session ID to capture (finds exact transcript instead of latest)')
  .action(async (opts) => {
    try {
      const auth = await initializeClient(opts.apiKey);
      if (!auth) {
        process.exit(1);
      }

      const { client, user } = auth;
      const configManager = new ConfigManager();
      const config = configManager.getConfig();

      const currentPath = opts.projectPath || process.cwd();
      const autoDetectedProjectName = basename(currentPath);
      const projectName = opts.project || autoDetectedProjectName;
      const projectPath = currentPath;

      logger.info(`Project: ${projectName} from ${currentPath}`);

      const parser = new TranscriptParser({
        currentUser: user,
        grpcClient: client,
      });

      let targetFile: string;

      if (opts.transcript) {
        targetFile = opts.transcript;
      } else {
        const foundFile = await parser.findLatestTranscriptFile(projectPath, opts.sessionId);
        if (!foundFile) {
          console.error('Error: No transcript files found. Make sure you are in a project directory with Claude Code sessions.');
          process.exit(1);
        }
        targetFile = foundFile;
      }

      logger.info(`Processing transcript: ${targetFile}`);

      const sessionData = await parser.parseTranscriptFile(targetFile, opts.last);
      if (!sessionData) {
        console.error('Error: Failed to parse transcript file');
        process.exit(1);
      }

      // Discover and parse sub-agent files
      const subSessions: SubSessionData[] = [];
      if (sessionData.agentIdMap && sessionData.agentIdMap.size > 0) {
        const fs = await import('fs/promises');
        const path = await import('path');

        const projectDirName = projectPath.replace(/[\\/]/g, '-');
        const claudeProjectDir = path.join(homedir(), '.claude', 'projects', projectDirName);

        logger.info(`Checking for ${sessionData.agentIdMap.size} sub-agent files`);

        for (const [agentId, agentInfo] of sessionData.agentIdMap.entries()) {
          // Claude Code 2.1.x stores agent files in session subdirectories
          // Try new location first: {project}/{sessionId}/subagents/agent-{id}.jsonl
          // Fall back to old location: {project}/agent-{id}.jsonl
          const newAgentFilePath = path.join(
            claudeProjectDir,
            sessionData.sessionId,
            'subagents',
            `agent-${agentId}.jsonl`
          );
          const oldAgentFilePath = path.join(claudeProjectDir, `agent-${agentId}.jsonl`);

          let agentFilePath: string | null = null;

          try {
            await fs.access(newAgentFilePath);
            agentFilePath = newAgentFilePath;
            logger.info(`Found sub-agent file (v2.1.x): subagents/agent-${agentId}.jsonl`);
          } catch {
            // Try old location
            try {
              await fs.access(oldAgentFilePath);
              agentFilePath = oldAgentFilePath;
              logger.info(`Found sub-agent file (legacy): agent-${agentId}.jsonl`);
            } catch {
              // File doesn't exist in either location
              logger.info(`Sub-agent file not found for ${agentId}`);
            }
          }

          if (agentFilePath) {
            const subSession = await parser.parseSubAgentFile(
              agentFilePath,
              agentId,
              agentInfo.taskDescription,
              agentInfo.taskPrompt,
              agentInfo.interactionIndex
            );

            if (subSession) {
              subSessions.push(subSession);
            }
          }
        }

        if (subSessions.length > 0) {
          logger.info(`Discovered ${subSessions.length} sub-agent conversations`);
        }
      }

      const project = await ensureProject(client, projectName, projectPath);
      if (!project) {
        console.error('Error: Failed to create/find project');
        process.exit(1);
      }

      // Calculate total tokens including sub-sessions
      let totalInputTokens = sessionData.totalInputTokens;
      let totalOutputTokens = sessionData.totalOutputTokens;
      for (const subSession of subSessions) {
        totalInputTokens += subSession.inputTokens;
        totalOutputTokens += subSession.outputTokens;
      }

      const finalSessionName =
        opts.session || `Imported Session - ${new Date(sessionData.startTime).toLocaleString()}`;

      const apiSessionData: SessionApiData = {
        start_time: sessionData.startTime,
        end_time: sessionData.endTime,
        project_path: projectPath,
        project_name: projectName,
        name: finalSessionName,
        tool_name: 'claude-code',
        git_branch: sessionData.gitBranch,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_create_tokens: sessionData.totalCacheCreateTokens,
        cache_read_tokens: sessionData.totalCacheReadTokens,
        todo_snapshots: sessionData.todoSnapshots || [],
        plans: sessionData.plans || [],
        attachment_urls: sessionData.attachmentUrls || [],
        sub_sessions: subSessions,
        interactions: sessionData.interactions || [],
        // Plan slug - content is uploaded separately via UploadPlanFile RPC
        plan_slug: sessionData.planFileSlug,
        metadata: {
          import_source: 'cli',
          original_session_id: sessionData.sessionId,
          total_input_tokens: totalInputTokens,
          total_output_tokens: totalOutputTokens,
          interaction_count: sessionData.interactions.length,
          model_info: sessionData.modelInfo,
          planning_mode_info: sessionData.planningModeInfo,
          languages: sessionData.languages,
          sub_session_count: subSessions.length,
        },
      };

      let result;
      try {
        result = await client.upsertSession(apiSessionData);
      } catch (upsertError) {
        // Check for session limit error
        const limitError = parseSessionLimitError(upsertError as Error);
        if (limitError) {
          const output = {
            success: false,
            error: 'session_limit_exceeded',
            message: `Session limit reached (${limitError.currentCount}/${limitError.limit} sessions used)`,
            currentCount: limitError.currentCount,
            limit: limitError.limit,
            upgradeUrl: limitError.upgradeUrl,
          };
          console.log(JSON.stringify(output, null, 2));
          process.exit(1);
        }

        // Check for onboarding error (user not in any team)
        const onboardingError = parseOnboardingError(upsertError as Error);
        if (onboardingError) {
          const output = {
            success: false,
            error: 'onboarding_required',
            message: onboardingError.message,
            onboardingUrl: 'https://sessionhub.dev/onboarding',
          };
          console.log(JSON.stringify(output, null, 2));
          process.exit(1);
        }

        // Re-throw other errors
        throw upsertError;
      }

      if (!result.sessionId) {
        console.error('Error: Failed to create session');
        process.exit(1);
      }

      // Upload plan file to storage if available
      // Storage path: {teamId}/plans/{sessionId}/{slug}.md
      let planFileUploaded = false;
      if (sessionData.planFileSlug && sessionData.planFileContent) {
        try {
          const planResult = await client.uploadPlanFile(
            result.sessionId,
            sessionData.planFileSlug,
            sessionData.planFileContent
          );
          if (planResult.success) {
            logger.info(`Plan file uploaded: ${sessionData.planFileSlug}.md`);
            planFileUploaded = true;
          } else {
            logger.warn(`Plan file upload failed: ${planResult.error}`);
          }
        } catch (uploadError) {
          logger.warn(`Plan file upload error: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
          // Don't fail the entire capture if plan upload fails
        }
      }

      // Save last session info for /observations command (atomic write to prevent corruption)
      const lastSessionFile = join(CONFIG_DIR, 'last-session.json');
      const tempFile = `${lastSessionFile}.${process.pid}.tmp`;
      try {
        // Write to temp file first
        writeFileSync(tempFile, JSON.stringify({
          sessionId: result.sessionId,
          projectPath: projectPath,
          projectName: projectName,
          capturedAt: new Date().toISOString()
        }, null, 2));
        // Atomic rename
        renameSync(tempFile, lastSessionFile);
      } catch (writeError) {
        // Clean up temp file if it exists
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
        logger.warn(`Failed to save last-session.json: ${writeError}`);
      }

      // Note: Analysis and observations are triggered automatically by the backend
      // based on user preferences. The result includes flags for what was triggered.

      // Output result as JSON for parsing by slash commands
      const output = {
        success: true,
        sessionId: result.sessionId,
        wasUpdated: result.wasUpdated,
        newInteractionsCount: result.newInteractionsCount,
        analysisTriggered: (result as any).analysisTriggered || false,
        observationsTriggered: (result as any).observationsTriggered || false,
        planFileUploaded,
        planSlug: sessionData.planFileSlug || null,
        projectName,
        sessionName: finalSessionName,
        transcriptFile: basename(targetFile),
        totalInputTokens,
        totalOutputTokens,
        cacheCreateTokens: sessionData.totalCacheCreateTokens,
        cacheReadTokens: sessionData.totalCacheReadTokens,
        subSessionCount: subSessions.length,
      };

      console.log(JSON.stringify(output, null, 2));
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command('import-all')
  .description('Import all Claude Code sessions from a project')
  .option('-p, --project <name>', 'Project name (auto-detected if omitted)')
  .option('--path <dir>', 'Project directory (uses cwd if omitted)')
  .option('--api-key <key>', 'API key (uses API_KEY env var if omitted)')
  .action(async (opts) => {
    try {
      const auth = await initializeClient(opts.apiKey);
      if (!auth) {
        process.exit(1);
      }

      const { client, user } = auth;
      const configManager = new ConfigManager();
      const config = configManager.getConfig();

      const currentPath = opts.path || process.cwd();
      const autoDetectedProjectName = basename(currentPath);
      const projectName = opts.project || autoDetectedProjectName;

      logger.info(`Importing all sessions for project: ${projectName}`);

      const parser = new TranscriptParser({
        currentUser: user,
        grpcClient: client,
      });

      const transcriptFiles = await parser.listTranscriptFiles(currentPath);

      if (transcriptFiles.length === 0) {
        console.error('Error: No transcript files found');
        process.exit(1);
      }

      logger.info(`Found ${transcriptFiles.length} transcript files`);

      // Check session quota before starting import
      let sessionsToImport = transcriptFiles.length;
      let wasLimited = false;
      let skippedCount = 0;

      try {
        const quota = await client.getSessionQuota();
        if (quota && quota.limit !== -1) {  // -1 means unlimited (Pro tier)
          if (quota.remaining === 0) {
            const output = {
              success: false,
              error: 'session_limit_exceeded',
              message: `Session limit reached (${quota.currentCount}/${quota.limit} sessions). Cannot import any sessions.`,
              currentCount: quota.currentCount,
              limit: quota.limit,
              upgradeUrl: 'https://sessionhub.dev/pricing',
              totalFiles: transcriptFiles.length,
            };
            console.log(JSON.stringify(output, null, 2));
            process.exit(1);
          }

          if (quota.remaining < transcriptFiles.length) {
            sessionsToImport = quota.remaining;
            skippedCount = transcriptFiles.length - sessionsToImport;
            wasLimited = true;
            logger.warn(`Session limit: Only importing ${sessionsToImport} of ${transcriptFiles.length} sessions (${quota.currentCount}/${quota.limit} used)`);
          }
        }
      } catch (quotaError) {
        // If quota check fails, continue without limit (backend will enforce limit per-session)
        logger.warn(`Could not check session quota: ${quotaError}`);
      }

      const project = await ensureProject(client, projectName, currentPath);
      if (!project) {
        console.error('Error: Failed to create/find project');
        process.exit(1);
      }

      // Only process up to sessionsToImport files
      const filesToProcess = transcriptFiles.slice(0, sessionsToImport);

      let successCount = 0;
      let errorCount = 0;
      const results: Array<{ file: string; success: boolean; sessionId?: string; error?: string }> = [];

      for (const filePath of filesToProcess) {
        const fileName = basename(filePath);

        try {
          logger.info(`Processing: ${fileName}`);

          const sessionData = await parser.parseTranscriptFile(filePath);
          if (!sessionData) {
            errorCount++;
            results.push({ file: fileName, success: false, error: 'Failed to parse' });
            continue;
          }

          const sessionName = `Imported Session - ${new Date(sessionData.startTime).toLocaleString()}`;

          const apiSessionData: SessionApiData = {
            start_time: sessionData.startTime,
            end_time: sessionData.endTime,
            project_path: currentPath,
            project_name: projectName,
            name: sessionName,
            tool_name: 'claude-code',
            git_branch: sessionData.gitBranch,
            input_tokens: sessionData.totalInputTokens,
            output_tokens: sessionData.totalOutputTokens,
            cache_create_tokens: sessionData.totalCacheCreateTokens,
            cache_read_tokens: sessionData.totalCacheReadTokens,
            todo_snapshots: sessionData.todoSnapshots || [],
            plans: sessionData.plans || [],
            attachment_urls: sessionData.attachmentUrls || [],
            interactions: sessionData.interactions || [],
            // Plan file metadata (from ~/.claude/plans/{slug}.md)
            plan_file_slug: sessionData.planFileSlug,
            plan_file_content: sessionData.planFileContent,
            plan_file_modified_at: sessionData.planFileModifiedAt,
            metadata: {
              import_source: 'cli_bulk',
              original_session_id: sessionData.sessionId,
            },
          };

          const result = await client.upsertSession(apiSessionData);

          if (result.sessionId) {
            successCount++;
            results.push({ file: fileName, success: true, sessionId: result.sessionId });
          } else {
            errorCount++;
            results.push({ file: fileName, success: false, error: 'Failed to create session' });
          }
        } catch (error) {
          errorCount++;
          results.push({ file: fileName, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      const output = {
        success: errorCount === 0,
        projectName,
        totalFiles: transcriptFiles.length,
        processedFiles: filesToProcess.length,
        successCount,
        errorCount,
        wasLimited,
        limitInfo: wasLimited ? {
          skippedCount,
          upgradeUrl: 'https://sessionhub.dev/pricing',
        } : undefined,
        results,
      };

      console.log(JSON.stringify(output, null, 2));
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Note: analyze and extract-observations commands have been removed.
// Analysis and observations are now triggered automatically by the backend
// when sessions are captured, based on user preferences.
// Users can configure auto-analysis settings in the SessionHub web app.

// Health check command - verify plugin configuration and connectivity
program
  .command('health')
  .description('Check plugin health and connectivity status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const healthStatus = {
      configured: false,
      apiKeyValid: false,
      backendConnected: false,
      hooksRegistered: false,
      errors: [] as string[],
    };

    try {
      const configManager = new ConfigManager();
      const config = configManager.getConfig();

      // Check configuration
      healthStatus.configured = configManager.isConfigured();

      if (!healthStatus.configured) {
        healthStatus.errors.push('API key not configured');
      } else {
        // Validate API key and backend connectivity
        try {
          const client = new GrpcAPIClient(config.user.apiKey, config.backendGrpcUrl, config.grpcUseTls);
          const user = await client.validateApiKey();

          if (user) {
            healthStatus.apiKeyValid = true;
            healthStatus.backendConnected = true;
          } else {
            healthStatus.errors.push('API key validation failed');
          }
        } catch (error) {
          healthStatus.errors.push('Backend connection failed');
        }
      }

      // Check hooks registration
      const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
      const hooksPath = join(pluginRoot, 'hooks', 'hooks.json');
      healthStatus.hooksRegistered = existsSync(hooksPath);

      if (!healthStatus.hooksRegistered) {
        healthStatus.errors.push('Hooks not registered');
      }

      if (options.json) {
        console.log(JSON.stringify(healthStatus, null, 2));
      } else {
        console.log('\n--- Plugin Health Check ---\n');
        console.log(`Configured:         ${healthStatus.configured ? '✓' : '✗'}`);
        console.log(`API Key Valid:      ${healthStatus.apiKeyValid ? '✓' : '✗'}`);
        console.log(`Backend Connected:  ${healthStatus.backendConnected ? '✓' : '✗'}`);
        console.log(`Hooks Registered:   ${healthStatus.hooksRegistered ? '✓' : '✗'}`);

        if (healthStatus.errors.length > 0) {
          console.log('\nErrors:');
          healthStatus.errors.forEach(err => console.log(`  - ${err}`));
        } else {
          console.log('\nAll checks passed!');
        }
        console.log('');
      }

    } catch (error) {
      healthStatus.errors.push(error instanceof Error ? error.message : 'Unknown error');

      if (options.json) {
        console.log(JSON.stringify(healthStatus, null, 2));
      } else {
        console.error('Health check failed:', error);
      }

      process.exit(1);
    }
  });

program.parse();
