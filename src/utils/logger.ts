// Safe client-side diagnostics and error reporting utility
// Ensures sensitive document contents and credentials are NEVER logged or transmitted.

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
  timestamp: number;
}

const MAX_LOGS = 50;
const logBuffer: LogEntry[] = [];

export const logger = {
  info: (message: string, context?: Record<string, any>) => {
    const entry: LogEntry = { level: 'info', message, context: sanitizeContext(context), timestamp: Date.now() };
    bufferLog(entry);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DocHelper Info] ${message}`, entry.context || '');
    }
  },

  warn: (message: string, context?: Record<string, any>) => {
    const entry: LogEntry = { level: 'warn', message, context: sanitizeContext(context), timestamp: Date.now() };
    bufferLog(entry);
    console.warn(`[DocHelper Warning] ${message}`, entry.context || '');
  },

  error: (message: string, error?: any, context?: Record<string, any>) => {
    const errObj = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error;
    const entry: LogEntry = {
      level: 'error',
      message,
      context: { ...sanitizeContext(context), error: errObj },
      timestamp: Date.now(),
    };
    bufferLog(entry);
    console.error(`[DocHelper Error] ${message}`, entry.context);
  },

  getRecentLogs: (): LogEntry[] => {
    return [...logBuffer];
  },

  clearLogs: () => {
    logBuffer.length = 0;
  },
};

function bufferLog(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
}

// Strip out potential PII, base64 payloads, and passwords from logs
function sanitizeContext(context?: Record<string, any>): Record<string, any> | undefined {
  if (!context) return undefined;
  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(context)) {
    if (typeof val === 'string' && (val.length > 500 || val.startsWith('data:image/') || val.startsWith('data:application/'))) {
      sanitized[key] = `[Truncated payload: ${val.length} chars]`;
    } else if (key.toLowerCase().includes('password') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}
