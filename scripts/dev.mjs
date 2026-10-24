// Runs the game server and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node', ['--watch', 'server/src/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: '8080' } }),
  spawn('npx', ['vite', '--config', 'client/vite.config.ts', 'client'], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
