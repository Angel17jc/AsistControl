import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));

  it('round-trips JSON credentials', () => {
    const encrypted = box.encryptJson({ commKey: '123456' });
    expect(encrypted).not.toContain('123456');
    expect(box.decryptJson(encrypted)).toEqual({ commKey: '123456' });
  });

  it('uses a random IV so equal secrets produce different ciphertexts', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('detects tampering', () => {
    const parts = box.encrypt('secret').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('cannot be decrypted with another key', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(box.encrypt('secret'))).toThrow();
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
