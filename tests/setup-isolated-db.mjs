/**
 * Test preload (tsx --import): points the local store at a fresh temp file so automated
 * suites never modify the tracked data/collaborate.db.json. Seeds from the tracked file
 * (read-only) so seeded personas exist exactly as before.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.COLLABORATE_DATA_FILE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collaborate-test-db-'));
  const file = path.join(dir, 'collaborate.db.json');
  const tracked = path.join(process.cwd(), 'data', 'collaborate.db.json');
  if (fs.existsSync(tracked)) fs.copyFileSync(tracked, file);
  process.env.COLLABORATE_DATA_FILE = file;
  process.on('exit', () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
}
