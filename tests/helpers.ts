import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

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

export async function startTestServer(
  env: Record<string, string> = {},
  options: { dataDir?: string; expectFailure?: boolean } = {}
): Promise<TestServer> {
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
    return server;
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited early (${proc.exitCode}):\n${output}`);
    }
    try {
      const res = await fetch(`${server.url}/api/health`);
      if (res.ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  await server.stop('SIGKILL');
  throw new Error(`Server did not start:\n${output}`);
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
