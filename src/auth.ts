import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto'

const ITERATIONS = 600_000
const KEY_LEN = 32
const DIGEST = 'sha256'

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
