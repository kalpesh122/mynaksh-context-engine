#!/usr/bin/env node
/**
 * One-command entrypoint: starts the mock upstream, waits for it to accept
 * connections, then starts the app. `npm start` and you have a working system.
 *
 * Child processes rather than one process so the app really talks HTTP to its
 * upstreams — see the note in mock-upstream-server.js.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config/app.config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

function waitForPort(port, host = '127.0.0.1', timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.connect(port, host);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not ready`));
        else setTimeout(attempt, 100);
      });
    })();
  });
}

const children = [];
function run(script, name) {
  const child = spawn(process.execPath, [path.join(here, script)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) process.exitCode = code;
    shutdown();
  });
  children.push({ child, name });
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) { try { child.kill('SIGTERM'); } catch {} }
}
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

run('../mocks/upstream-server.js', 'upstream');
await waitForPort(config.upstreamPort);
run('server.js', 'app');
