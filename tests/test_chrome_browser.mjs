import assert from 'assert';
import { spawn, spawnSync, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const PORT = 3089;
  const GATEWAY_URL = `http://127.0.0.1:${PORT}`;

  console.log('--- STARTING NEXT.JS GATEWAY FOR CHROME TEST ---');
  const nextServer = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      COLLABORATE_BACKEND_URL: 'https://collaborate-1-am72.onrender.com',
      PORT: String(PORT),
    },
    shell: true,
  });

  await new Promise((resolve) => {
    let started = false;
    nextServer.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Ready') || msg.includes(String(PORT)) || msg.includes('started')) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });
    setTimeout(() => {
      if (!started) resolve();
    }, 4500);
  });

  try {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    console.log('Executing Chrome against fixed gateway endpoint:', `${GATEWAY_URL}/api/auth/me`);
    const output = execSync(`"${chromePath}" --headless --dump-dom "${GATEWAY_URL}/api/auth/me"`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    console.log('Chrome Rendered HTML:', output.trim());
    assert(output.includes('UNAUTHORIZED') && output.includes('Authentication required'), 'Chrome must receive readable JSON!');
    console.log('✅ CHROME SUCCESSFULLY DECODED AND RENDERED GATEWAY RESPONSE WITHOUT ERR_CONTENT_DECODING_FAILED!');
  } finally {
    if (nextServer.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(nextServer.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(nextServer.pid);
        }
      } catch (_) {}
    }
  }
}

run().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
