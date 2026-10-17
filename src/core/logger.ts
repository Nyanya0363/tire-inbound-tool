import type { MatchTrace } from './types';

export interface LogEvent {
  time: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  data?: unknown;
}

export interface SessionSummary {
  total: number;
  matched: number;
  review: number;
  unmatched: number;
  exported: number;
}

export interface SessionLog {
  id: string;
  startedAt: string;
  finishedAt?: string;
  appVersion: string;
  commitSha: string;
  adapterId?: string;
  adapterVersion?: string;
  catalogVersion?: string;
  fileName?: string;
  events: LogEvent[];
  traces?: MatchTrace[];
  summary?: SessionSummary;
}

const STORAGE_KEY = 'tire-inbound:sessions';
const MAX_SESSIONS = 12;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSessions(): SessionLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SessionLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch (error) {
    console.warn('诊断日志写入失败', error);
  }
}

class SessionLogger {
  private session: SessionLog | null = null;

  start(meta: {
    appVersion: string;
    commitSha: string;
    adapterId: string;
    adapterVersion: string;
    catalogVersion: string;
    fileName?: string;
  }): SessionLog {
    this.session = {
      id: makeId(),
      startedAt: new Date().toISOString(),
      events: [],
      ...meta,
    };
    this.event('info', 'session_start', meta);
    return this.session;
  }

  private persist(): void {
    if (!this.session) return;
    const sessions = readSessions();
    const index = sessions.findIndex((item) => item.id === this.session?.id);
    if (index >= 0) sessions[index] = this.session;
    else sessions.unshift(this.session);
    writeSessions(sessions);
  }

  event(level: LogEvent['level'], event: string, data?: unknown): void {
    if (!this.session) return;
    this.session.events.push({
      time: new Date().toISOString(),
      level,
      event,
      data,
    });
    // Match rows are persisted in one batch when the run finishes. Persist
    // errors and user actions immediately so a crash still leaves a trail.
    if (level === 'error' || !event.startsWith('match_row')) {
      this.persist();
    }
  }

  finish(traces: MatchTrace[], summary: SessionSummary): void {
    if (!this.session) return;
    this.session.finishedAt = new Date().toISOString();
    this.session.traces = traces.slice(0, 1000);
    this.session.summary = summary;
    this.event('info', 'session_finish', summary);
  }

  current(): SessionLog | null {
    return this.session;
  }

  sessions(): SessionLog[] {
    return readSessions();
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.session = null;
  }
}

export const logger = new SessionLogger();

let globalLoggingInstalled = false;

export function installGlobalErrorLogging(): void {
  if (globalLoggingInstalled) return;
  globalLoggingInstalled = true;
  window.addEventListener('error', (event) => {
    logger.event('error', 'window_error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    logger.event('error', 'unhandled_rejection', {
      reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
  });
}

export function downloadDiagnostics(): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    commitSha: __COMMIT_SHA__,
    userAgent: navigator.userAgent,
    url: window.location.href,
    currentSession: logger.current(),
    sessions: logger.sessions(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `诊断日志_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
