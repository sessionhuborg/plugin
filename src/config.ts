/**
 * Configuration management for SessionHub plugin.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import { logger } from './logger.js';

const UserConfigSchema = z.object({
  apiKey: z.string().default(''),
});

const SessionConfigSchema = z.object({
  sessionTimeout: z.number().default(300),
  fileWatchEnabled: z.boolean().default(true),
  autoDetectTools: z.boolean().default(true),
  minInteractionCount: z.number().default(1),
  monitoredProcesses: z.array(z.string()).default(['claude', 'claude-code', 'cursor', 'code']),
  watchedExtensions: z.array(z.string()).default([
    '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.rs', '.java',
    '.c', '.cpp', '.h', '.hpp', '.php', '.rb', '.swift', '.kt',
    '.scala', '.clj', '.hs', '.ml', '.elm', '.dart', '.vue',
    '.html', '.css', '.scss', '.sass', '.less', '.sql', '.sh',
    '.yaml', '.yml', '.json', '.xml', '.toml', '.ini', '.cfg'
  ]),
});

const LoggingConfigSchema = z.object({
  level: z.string().default('INFO'),
  filePath: z.string().optional(),
  consoleOutput: z.boolean().default(true),
  maxFileSize: z.number().default(10_000_000),
  backupCount: z.number().default(3),
});

const AppConfigSchema = z.object({
  user: UserConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  backendGrpcUrl: z.string().default('plugin.sessionhub.dev'),
  grpcUseTls: z.boolean().optional(), // Override TLS behavior (auto-detect by default: TLS for non-localhost)
  serverName: z.string().default('sessionhub-plugin'),
  serverVersion: z.string().default('1.0.0'),
  // Note: Supabase credentials removed for security
  // All Supabase operations now go through the authenticated backend
});

export type UserConfig = z.infer<typeof UserConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

export class ConfigManager {
  private configDir: string;
  private configFile: string;
  private config: AppConfig | null = null;

  constructor(configDir?: string) {
    if (configDir) {
      this.configDir = configDir;
    } else {
      this.configDir = join(homedir(), '.sessionhub');
    }

    this.configFile = join(this.configDir, 'config.json');

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  loadConfig(): AppConfig {
    let configData: any = {};

    if (existsSync(this.configFile)) {
      try {
        const fileContent = readFileSync(this.configFile, 'utf8');
        configData = JSON.parse(fileContent);
      } catch (error) {
        logger.warn(`Warning: Could not load config file: ${error}`);
      }
    }

    this.config = AppConfigSchema.parse(configData);
    return this.config;
  }

  saveConfig(config: AppConfig): void {
    try {
      // Write with restrictive permissions (owner read/write only)
      // This protects the API key from being read by other users
      writeFileSync(this.configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
      // Ensure permissions are set even if file existed with different perms
      chmodSync(this.configFile, 0o600);
      this.config = config;
    } catch (error) {
      console.error(`Error saving config: ${error}`);
    }
  }

  getConfig(): AppConfig {
    if (this.config === null) {
      return this.loadConfig();
    }
    return this.config;
  }

  // Environment variable overrides removed - use /setup command instead

  validateConfig(config: AppConfig): string[] {
    const issues: string[] = [];

    if (!config.user.apiKey) {
      issues.push('API key not configured. Run /setup <your-api-key> to configure.');
    }

    if (!config.backendGrpcUrl) {
      issues.push('Backend URL not configured.');
    }

    return issues;
  }

  /**
   * Check if the plugin has been configured with an API key
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    return !!config.user.apiKey;
  }
}

let configManager: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (configManager === null) {
    configManager = new ConfigManager();
  }
  return configManager;
}

export function getConfig(): AppConfig {
  return getConfigManager().getConfig();
}
