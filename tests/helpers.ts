import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface TestServer {
  url: string;
  port: number;
  dataDir: string;
  proc: ChildProcess;
  logs: () => string;
  stop: (signal?: NodeJS.Signals) => Promise<number | null>;
}

type SpawnResult =
  | { server: TestServer }
  | { retry: true; error: string }
  | { retry: false; error: string };

async function spawnTestServer(
  env: Record<string, string>,
  options: { dataDir?: string; expectFailure?: boolean }
): Promise<SpawnResult> {
  const port = await freePort();
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'adh-data-'));
  let output = '';

  const proc = spawn(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'server.ts')], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      NODE_ENV: 'test',
      SERVE_FRONTEND: 'false',
      // A port collision must fail the start rather than silently bind 3000,
      // which would leave this harness talking to a different server.
      DISABLE_PORT_FALLBACK: 'true',
      PORT: String(port),
      DATA_DIR: dataDir,
      GEMINI_API_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d) => (output += d.toString()));
  proc.stderr?.on('data', (d) => (output += d.toString()));

  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));

  const server: TestServer = {
    url: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    proc,
    logs: () => output,
    stop: async (signal: NodeJS.Signals = 'SIGTERM') => {
      if (proc.exitCode !== null) return proc.exitCode;
      proc.kill(signal);
      return exited;
    },
  };

  if (options.expectFailure) {
    const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 20000))]);
    (server as any).exitCode = code;
    return { server };
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      const error = `Server exited early (${proc.exitCode}):\n${output}`;
      return output.includes('EADDRINUSE') ? { retry: true, error } : { retry: false, error };
    }
    try {
      const res = await fetch(`${server.url}/api/health`);
      if (res.ok) return { server };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await server.stop('SIGKILL');
  return { retry: false, error: `Server did not start:\n${output}` };
}

/**
 * Starts a test server, retrying on an ephemeral port collision. freePort()
 * releases the port before the server binds it, so a parallel test process can
 * take it first; because the server refuses to fall back to another port in
 * tests, a collision shows up as an early exit that we simply retry.
 */
export async function startTestServer(
  env: Record<string, string> = {},
  options: { dataDir?: string; expectFailure?: boolean } = {}
): Promise<TestServer> {
  const maxAttempts = 6;
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await spawnTestServer(env, options);
    if ('server' in result) return result.server;
    lastError = result.error;
    if (!result.retry) throw new Error(result.error);
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not start after ${maxAttempts} attempts:\n${lastError}`);
}

export async function api(
  server: TestServer,
  method: string,
  endpoint: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: Headers }> {
  const res = await fetch(`${server.url}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }

  return { status: res.status, data, headers: res.headers };
}

export interface MockResend {
  url: string;
  state: { lastBody: any; status: number; calls: number };
  close: () => Promise<void>;
}

/**
 * A local stand-in for the Resend API so the password-reset flow can be
 * exercised deterministically, without reaching the public internet. The last
 * request body is captured so tests can read the reset link (and its token).
 */
export async function startMockResend(): Promise<MockResend> {
  const port = await freePort();
  const state: { lastBody: any; status: number; calls: number } = { lastBody: null, status: 200, calls: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      state.calls += 1;
      try {
        state.lastBody = JSON.parse(body);
      } catch {
        state.lastBody = body;
      }
      res.statusCode = state.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(state.status === 200 ? { id: 'mock-email-id' } : { error: 'mock delivery failure' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    url: `http://127.0.0.1:${port}/emails`,
    state,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** Extracts the reset token from a captured Resend email body. */
export function extractResetToken(email: any): string | null {
  const html: string = (email && email.html) || '';
  const match = html.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

let emailCounter = 0;
export function uniqueEmail(prefix = 'user'): string {
  emailCounter += 1;
  return `${prefix}${Date.now()}${emailCounter}@example.com`;
}

export async function registerUser(server: TestServer, password = 'correct-horse-1') {
  const email = uniqueEmail();
  // Each simulated user comes from its own client IP (the proxy header
  // Cloud Run's front end sets), so per-IP registration limits apply
  // per user as they would in production.
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const res = await api(server, 'POST', '/api/auth/register', { name: 'Test User', email, password }, undefined, { 'X-Forwarded-For': ip });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register failed ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { email, password, token: res.data.token as string, user: res.data.user };
}
