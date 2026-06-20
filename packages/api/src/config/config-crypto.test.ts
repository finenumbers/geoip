import { describe, it, expect } from 'vitest';
import { decryptSecretsJson, encryptSecretsJson, generateMasterKeyHex } from './config-crypto.js';

describe('config-crypto', () => {
  it('round-trips secrets with hex master key', () => {
    const key = generateMasterKeyHex();
    const plaintext = JSON.stringify({ email: 'test@example.com', password: 'secret' });
    const encrypted = encryptSecretsJson(plaintext, key);
    expect(decryptSecretsJson(encrypted, key)).toBe(plaintext);
  });

  it('round-trips secrets with passphrase master key', () => {
    const key = 'my-strong-passphrase';
    const plaintext = '{"a":1}';
    expect(decryptSecretsJson(encryptSecretsJson(plaintext, key), key)).toBe(plaintext);
  });

  it('rejects tampered payload', () => {
    const key = generateMasterKeyHex();
    const encrypted = encryptSecretsJson('{"a":1}', key);
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptSecretsJson(encrypted, key)).toThrow();
  });
});
