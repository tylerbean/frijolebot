const crypto = require('crypto');

const ALG = 'aes-256-gcm';

function getKey() {
  const key = process.env.CONFIG_CRYPTO_KEY || process.env.ADMIN_CRYPTO_KEY || '';
  if (!key) throw new Error('CONFIG_CRYPTO_KEY missing');
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

function encryptToB64(plain) {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptFromB64(b64) {
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

function maskToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  if (token.length <= 4) return '•';
  const last4 = token.slice(-4);
  const masked = '•'.repeat(Math.max(1, token.length - 4));
  return masked + last4;
}

module.exports = { encryptToB64, decryptFromB64, maskToken };




