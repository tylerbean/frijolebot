import { createClient, RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting = false;

export async function getRedis(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client) return client;
  if (connecting) {
    // simple spin-wait; in Next.js API this is fine for our use
    await new Promise((r) => setTimeout(r, 50));
    return client;
  }
  connecting = true;
  try {
    const c = createClient({ url });
    c.on('error', () => {});
    await c.connect();
    client = c;
    return client;
  } catch {
    return null;
  } finally {
    connecting = false;
  }
}

export async function publish(channel: string, payload: any): Promise<void> {
  const c = await getRedis();
  if (!c) return;
  try {
    await c.publish(channel, JSON.stringify(payload));
  } catch {
    // noop
  }
}

export async function invalidateFlags(keys?: string[]) {
  const c = await getRedis();
  if (!c) return;
  try {
    await c.publish('flags.invalidate', JSON.stringify({ keys: Array.isArray(keys) ? keys : null }));
  } catch {}
}


