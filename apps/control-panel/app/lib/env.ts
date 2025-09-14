import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '..', '..', '.env');

export function loadEnv(): Record<string, string> {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    return parseEnv(content);
  } catch (_) {
    return process.env as any;
  }
}

export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}




