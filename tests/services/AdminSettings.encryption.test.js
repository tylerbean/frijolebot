const crypto = require('crypto');
const { encryptToB64, decryptFromB64 } = require('../../services/tokenCrypto');

describe('Admin settings encryption integration (unit-level)', () => {
  beforeEach(() => {
    // Ensure a key is present for this test
    process.env.CONFIG_CRYPTO_KEY = crypto.randomBytes(32).toString('base64');
  });

  afterEach(() => {
    delete process.env.CONFIG_CRYPTO_KEY;
  });

  test('encryptToB64 produces decryptable ciphertext with same key', () => {
    const plain = 'token-abc-123';
    const enc = encryptToB64(plain);
    const dec = decryptFromB64(enc);
    expect(dec).toBe(plain);
  });
});




