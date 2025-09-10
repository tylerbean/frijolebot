import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const ENV_PATH = path.join(process.cwd(), '..', '..', '.env');

function parseEnv(content: string): Record<string, string> {
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

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  let env: Record<string, string> = {};
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    env = parseEnv(content);
  } catch (_) {
    env = process.env as any;
  }

  pool = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT ? parseInt(env.POSTGRES_PORT, 10) : 5432,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DATABASE,
    ssl: env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  });
  return pool;
}


