import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

export type KeyMaterial = {
  key: Buffer
  source: 'hex' | 'base64' | 'generated'
  legacyBase64?: string
}

function isHexKey(raw: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(raw)
}

function isBase64UrlKey(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43,44}=?$/.test(raw)
}

function base64UrlToBuffer(raw: string): Buffer {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return Buffer.from(normalized + pad, 'base64')
}

export function loadOrCreateKey(keyFile: string): KeyMaterial {
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, 'utf8').trim()
    if (isHexKey(raw)) {
      return { key: Buffer.from(raw, 'hex'), source: 'hex' }
    }
    if (isBase64UrlKey(raw)) {
      const key = base64UrlToBuffer(raw)
      if (key.length !== 32) {
        throw new Error('Legacy base64 key is invalid length')
      }
      return { key, source: 'base64', legacyBase64: raw }
    }
    throw new Error('Unsupported key format: expected 64-char hex or base64url')
  }
  mkdirSync(dirname(keyFile), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
  return { key, source: 'generated' }
}
