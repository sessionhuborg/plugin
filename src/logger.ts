/**
 * Logger utility for CLI
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

class Logger {
  private write(level: LogLevel, message: string, ...args: any[]): void {
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
}

export const logger = new Logger();
