#!/usr/bin/env node
// Dependency-free CDP driver for an Electron app exposing the DevTools
// protocol on http://127.0.0.1:9222. Node v24+ (global fetch, WebSocket).
//
// Usage:
//   node driver.mjs eval "<js expression>"
//   node driver.mjs shot <outputPath.png>
//   node driver.mjs targets

import { writeFile } from 'node:fs/promises';

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const CONNECT_TIMEOUT_MS = 15000;

async function listTargets() {
  const res = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch target list: HTTP ${res.status}`);
  }
  return res.json();
}

function pickPageTarget(targets) {
  const pages = targets.filter(
    (t) => t.type === 'page' && !String(t.url || '').startsWith('devtools://'),
  );
  if (pages.length === 0) {
    throw new Error('No suitable page target found (type === "page", not devtools://)');
  }
  const preferred = pages.find(
    (t) => t.url.includes('index.html') || t.url.includes('localhost'),
  );
  return preferred || pages[0];
}

class CDPClient {
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
        reject(new Error(`Timed out connecting to ${this.url} after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });

      ws.addEventListener('error', (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket error connecting to ${this.url}: ${event.message || event}`));
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          return; // ignore malformed frames
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            rej(Object.assign(new Error(msg.error.message || 'CDP error'), { cdpError: msg.error }));
          } else {
            res(msg.result);
          }
        }
        // Events (no id) are ignored; this driver is purely request/response.
      });

      ws.addEventListener('close', () => {
        // Reject any still-pending requests so callers don't hang forever.
        for (const [id, { reject: rej }] of this.pending) {
          rej(new Error('WebSocket closed before response was received'));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

async function connectToPage() {
  const targets = await listTargets();
  const target = pickPageTarget(targets);
  const client = new CDPClient(target.webSocketDebuggerUrl);
  await client.connect();
  return client;
}

async function cmdEval(expression) {
  const client = await connectToPage();
  try {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      console.log(JSON.stringify(result.exceptionDetails));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result.result ? result.result.value : undefined));
  } finally {
    client.close();
  }
}

async function cmdShot(outputPath) {
  if (!outputPath) {
    throw new Error('Usage: node driver.mjs shot <outputPath.png>');
  }
  const client = await connectToPage();
  try {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data, 'base64');
    await writeFile(outputPath, buffer);

    await client.send('Emulation.clearDeviceMetricsOverride', {});

    console.log(`${outputPath} (${buffer.length} bytes)`);
  } finally {
    client.close();
  }
}

async function cmdTargets() {
  const targets = await listTargets();
  const summary = targets.map((t) => ({ id: t.id, type: t.type, url: t.url }));
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;

  switch (subcommand) {
    case 'eval':
      await cmdEval(rest[0]);
      break;
    case 'shot':
      await cmdShot(rest[0]);
      break;
    case 'targets':
      await cmdTargets();
      break;
    default:
      console.error('Usage:');
      console.error('  node driver.mjs eval "<js expression>"');
      console.error('  node driver.mjs shot <outputPath.png>');
      console.error('  node driver.mjs targets');
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    // Ensure we never hang on a stray open handle.
    process.exit(process.exitCode || 0);
  });
