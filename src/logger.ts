/**
 * Logger utility for CLI
 *
 * By default, only errors are shown to keep output clean for users.
 * Set SESSIONHUB_DEBUG=1 for verbose logging.
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  private minLevel: LogLevel;

  constructor() {
    // Default to ERROR only, unless debug mode is enabled
    this.minLevel = process.env.SESSIONHUB_DEBUG === '1' ? 'DEBUG' : 'ERROR';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private write(level: LogLevel, message: string, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;

    if (args.length > 0) {
      console.error(formattedMessage, ...args);
    } else {
      console.error(formattedMessage);
    }
  }

  info(message: string, ...args: any[]): void {
    this.write('INFO', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.write('WARN', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    this.write('ERROR', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.write('DEBUG', message, ...args);
  }

  /**
   * Enable verbose logging (for debugging)
   */
  enableDebug(): void {
    this.minLevel = 'DEBUG';
  }
}

export const logger = new Logger();
