import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { hashPassword } from './password-hashing';

/** Hashes and verifies passwords; the parameters live in password-hashing.ts. */
@Injectable()
export class PasswordService {
  /** Used to spend the same time when the user does not exist (prevents user enumeration). */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
