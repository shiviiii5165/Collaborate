import crypto from 'crypto';

/**
 * Password hashing: scrypt (N=16384, r=8, p=1, 64-byte key) with a random 16-byte salt per password.
 *
 * Asynchronous on purpose. scryptSync takes ~40 ms of the single JavaScript thread per call, so a stream
 * of login attempts (even ones the per-account limiter later refuses, spread across many accounts) could
 * stall every other request. crypto.scrypt runs on libuv's worker pool instead. The parameters and the
 * stored hex format are unchanged, so existing hashes verify as before.
 */
const KEY_LENGTH = 64;

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt)).toString('hex');
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  try {
    if (!hash || !salt) return false;
    const expected = Buffer.from(hash, 'hex');
    const derived = await scrypt(password, salt);
    return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
