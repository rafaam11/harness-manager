import fs from 'node:fs/promises';
import path from 'node:path';
import { sessionKey } from './model.mjs';

export const statePath = (data, session) => path.join(data, 'sessions', sessionKey(session) + '.json');
export async function readState(data, session) {
  try {
    const text = await fs.readFile(statePath(data, session), 'utf8');
    if (text.length > 256 * 1024) throw new Error('State is too large');
    const value = JSON.parse(text);
    if (value.schemaVersion !== 1 || value.sessionId !== session) throw new Error('Invalid state');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function updateState(data, session, update) {
  const file = statePath(data, session);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const until = Date.now() + 1000;
  for (;;) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  const temp = file + '.' + process.pid + '.tmp';
  try {
    const next = update(await readState(data, session));
    await fs.writeFile(temp, JSON.stringify(next) + '\n', 'utf8');
    await fs.rename(temp, file);
    return next;
  } finally {
    await fs.rm(temp, { force: true });
    await fs.rmdir(lock);
  }
}
