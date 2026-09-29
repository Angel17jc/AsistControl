import { PasswordService } from './password.service';

/**
 * Hashes live in the database for years: a library upgrade must keep verifying the ones it
 * did not create. This one was made by argon2 0.44 (the demo seed, before 0.45).
 */
const HASH_FROM_ARGON2_0_44 =
  '$argon2id$v=19$m=65536,t=3,p=4$9KmrSsTbeLrEW6eQBhGWCA$k5G/RYJAT2YtLaiKdBDd3Ulhw4YoqA1ynfiJmrE1pmo';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and the OWASP parameters', async () => {
    const hash = await passwords.hash('Correct horse battery staple');
    const [, algorithm, version, params] = hash.split('$');
    expect([algorithm, version]).toEqual(['argon2id', 'v=19']);
    // Compared as a set: argon2 0.45 writes them as m,p,t where 0.44 wrote m,t,p (both read both).
    expect(new Set(params!.split(','))).toEqual(new Set(['m=19456', 't=2', 'p=1']));
  });

  it('verifies its own hashes and rejects other passwords', async () => {
    const hash = await passwords.hash('Correct horse battery staple');
    await expect(passwords.verify(hash, 'Correct horse battery staple')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'correct horse battery staple')).resolves.toBe(false);
  });

  it('keeps verifying hashes stored before the library was upgraded', async () => {
    await expect(passwords.verify(HASH_FROM_ARGON2_0_44, 'AsistControl2026')).resolves.toBe(true);
    await expect(passwords.verify(HASH_FROM_ARGON2_0_44, 'AsistControl2025')).resolves.toBe(false);
  });

  it('answers false, not an error, for a malformed hash', async () => {
    await expect(passwords.verify('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('spends a verification when the user does not exist, and fails', async () => {
    await expect(passwords.verifyAgainstDummy('AsistControl2026')).resolves.toBe(false);
  });
});
