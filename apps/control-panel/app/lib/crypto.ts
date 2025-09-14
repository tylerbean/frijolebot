import crypto from 'crypto';

const ALG = 'aes-256-gcm';

function getKey(): Buffer {
  const key = process.env.CONFIG_CRYPTO_KEY || process.env.ADMIN_CRYPTO_KEY || '';
  if (!key) throw new Error('CONFIG_CRYPTO_KEY missing');
  // Accept base64 or hex; otherwise use utf8 and hash to 32 bytes
  try {
    if (/^[A-Za-z0-9+/=]+$/.test(key) && key.length >= 44) {
      const buf = Buffer.from(key, 'base64');
      if (buf.length === 32) return buf;
    }
  } catch {}
  try {
    if (/^[0-9a-fA-F]+$/.test(key) && key.length === 64) return Buffer.from(key, 'hex');
  } catch {}
  return crypto.createHash('sha256').update(key, 'utf8').digest();
}

export function encryptToB64(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptFromB64(b64: string): string {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

export function maskToken(token: string): string {
  if (!token) return '';
  const last4 = token.slice(-4);
  return `••••••••••${last4}`;
}




