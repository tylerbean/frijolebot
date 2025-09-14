const crypto = require('crypto');

describe('tokenCrypto encryption/decryption', () => {
  let originalKey;
  let tokenCrypto;

  function setKeyBase64(buf) {
    process.env.CONFIG_CRYPTO_KEY = Buffer.from(buf).toString('base64');
    delete require.cache[require.resolve('../../services/tokenCrypto')];
    tokenCrypto = require('../../services/tokenCrypto');
  }

  beforeEach(() => {
    originalKey = process.env.CONFIG_CRYPTO_KEY;
    const key = crypto.randomBytes(32);
    setKeyBase64(key);
  });

  afterEach(() => {
    process.env.CONFIG_CRYPTO_KEY = originalKey;
    try { delete require.cache[require.resolve('../../services/tokenCrypto')]; } catch (_) {}
  });

  test('roundtrip with base64 key', () => {
    const { encryptToB64, decryptFromB64 } = tokenCrypto;
    const plaintext = 'super-secret-token-123';
    const enc = encryptToB64(plaintext);
    expect(typeof enc).toBe('string');
    const dec = decryptFromB64(enc);
    expect(dec).toBe(plaintext);
  });

  test('roundtrip with hex key', () => {
    // Set hex key
    const hexKey = crypto.randomBytes(32).toString('hex');
    process.env.CONFIG_CRYPTO_KEY = hexKey;
    delete require.cache[require.resolve('../../services/tokenCrypto')];
    tokenCrypto = require('../../services/tokenCrypto');
    const { encryptToB64, decryptFromB64 } = tokenCrypto;
    const plaintext = 'hex-key-token-xyz';
    const enc = encryptToB64(plaintext);
    const dec = decryptFromB64(enc);
    expect(dec).toBe(plaintext);
  });

  test('decrypt fails with mismatched key', () => {
    const { encryptToB64 } = tokenCrypto;
    const plaintext = 'mismatch-me';
    const enc = encryptToB64(plaintext);
    // Change key
    const otherKey = crypto.randomBytes(32);
    setKeyBase64(otherKey);
    const { decryptFromB64 } = tokenCrypto;
    expect(() => decryptFromB64(enc)).toThrow();
  });

  test('maskToken shows only last 4 characters', () => {
    setKeyBase64(crypto.randomBytes(32));
    const { maskToken } = tokenCrypto;
    const masked = maskToken('abcdefghijklmno1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).toMatch(/^•+/);
  });
});




