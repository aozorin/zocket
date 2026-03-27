import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

export function loadOrCreateKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, 'utf8').trim()
    return Buffer.from(raw, 'hex')
  }
  mkdirSync(dirname(keyFile), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
  return key
}
