import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Authenticated symmetric encryption for secrets stored in the database (device credentials).
 * Format: v1.<iv>.<authTag>.<ciphertext> (base64url). Tampering makes decryption fail.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, ciphertext]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split('.');
    if (version !== VERSION || !iv || !tag || !ciphertext) {
      throw new Error('Unsupported secret format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  encryptJson(value: Record<string, string>): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson(payload: string): Record<string, string> {
    return JSON.parse(this.decrypt(payload)) as Record<string, string>;
  }
}
