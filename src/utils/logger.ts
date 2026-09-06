/**
 * Logger utility — structured logging with VEIL prefix.
 * All log output goes through here for consistent formatting.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

let currentLevel = LogLevel.DEBUG;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatMsg(module: string, msg: string): string {
  return `[VEIL:${module}] ${msg}`;
}

export const logger = {
  debug(module: string, msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.DEBUG) {
      console.debug(formatMsg(module, msg), ...args);
    }
  },

  info(module: string, msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.INFO) {
      console.info(formatMsg(module, msg), ...args);
    }
  },

  warn(module: string, msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.WARN) {
      console.warn(formatMsg(module, msg), ...args);
    }
  },

  error(module: string, msg: string, ...args: unknown[]): void {
    if (currentLevel <= LogLevel.ERROR) {
      console.error(formatMsg(module, msg), ...args);
    }
  },
};
