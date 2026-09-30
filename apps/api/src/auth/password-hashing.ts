import * as argon2 from 'argon2';

/**
 * argon2id with OWASP's recommended parameters. The single place they are defined: the API
 * (PasswordService) and the demo seed both hash through here, so a user created either way
 * gets the same hash. Plain module, no Nest, so the seed can import it.
 */
export const PASSWORD_HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_HASH_OPTIONS);
}
