#!/usr/bin/env node
// Copies the freshly built web app (dist/) into the Android app assets
// and verifies the result. Run after `npm run build`.
//
// The Android assets folder is generated and is not committed, so a
// release can never ship a stale bundle, demo code or the backend.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const distDir = path.join(root, 'dist');
const assetsDir = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public');

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('dist/index.html not found. Run `npm run build` first.');
}

// Files the Android WebView needs. The Node backend (server.cjs) is
// deliberately NOT copied: it runs on Cloud Run, never on the phone.
const FILES = ['index.html', 'manifest.json', 'icon.svg', 'sw.js', 'privacy-policy.html', 'delete-account.html'];

fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

for (const file of FILES) {
  const src = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(assetsDir, file));
  }
}

fs.cpSync(path.join(distDir, 'assets'), path.join(assetsDir, 'assets'), { recursive: true });

// ---- Verification -------------------------------------------------

const indexHtml = fs.readFileSync(path.join(assetsDir, 'index.html'), 'utf8');
const referenced = [...indexHtml.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);

if (!referenced.some((ref) => /^assets\/index-[\w-]+\.js$/.test(ref))) {
  fail('index.html does not reference a generated assets/index-*.js bundle.');
}

for (const ref of referenced) {
  if (!fs.existsSync(path.join(assetsDir, ref))) {
    fail(`index.html references missing file ${ref}.`);
  }
}

if (indexHtml.includes('/src/main.tsx')) {
  fail('index.html is the development entry point, not a production build.');
}

const forbiddenNames = /\.(zip|tar\.gz|jks|keystore|p12|pfx|pem|key|der|map)$|server\.cjs|service-account|credentials/i;
const forbiddenContent = [
  { pattern: /ais-dev-[a-z0-9-]+\.run\.app/i, label: 'development backend URL' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { pattern: /"type"\s*:\s*"service_account"/, label: 'service account key' },
  { pattern: /AI Studio/i, label: 'AI Studio branding' },
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(assetsDir, full);

    if (entry.isDirectory()) {
      walk(full);
      continue;
    }

    if (forbiddenNames.test(entry.name)) {
      fail(`forbidden file in Android assets: ${rel}`);
    }

    if (/\.(html|js|mjs|css|json|svg)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      for (const { pattern, label } of forbiddenContent) {
        if (pattern.test(content)) {
          fail(`${label} found in Android asset ${rel}`);
        }
      }
    }
  }
}

walk(assetsDir);

const bundle = referenced.find((ref) => /^assets\/index-[\w-]+\.js$/.test(ref));
console.log(`Android assets prepared from dist/ (entry bundle: ${bundle}).`);
