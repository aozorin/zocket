import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const VERSION = 1
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const version = Buffer.allocUnsafe(4)
  version.writeUInt32BE(VERSION, 0)
  return Buffer.concat([version, iv, tag, ciphertext])
}

export function decrypt(data: Buffer, key: Buffer): Buffer {
  const version = data.readUInt32BE(0)
  if (version !== VERSION) throw new Error(`Unsupported vault version: ${version}`)
  const iv = data.subarray(4, 4 + IV_BYTES)
  const tag = data.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES)
  const ciphertext = data.subarray(4 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function saveKey(key: Buffer, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, key.toString('hex'), { mode: 0o600 })
}

export async function loadKey(keyFilePath: string, storage: string): Promise<Buffer> {
  if (process.env.ZOCKET_MASTER_KEY) {
    return Buffer.from(process.env.ZOCKET_MASTER_KEY, 'hex')
  }
  if (storage === 'keyring') {
    try {
      const keytar = await import('keytar')
      const val = await keytar.getPassword('zocket', 'master-key')
      if (!val) throw new Error('Key not found in keyring')
      return Buffer.from(val, 'hex')
    } catch (e: any) {
      if (
        e.message?.includes('Cannot find module') ||
        e.code === 'ERR_MODULE_NOT_FOUND' ||
        e.message?.includes('keytar') ||
        e.message?.includes('Is it installed?') ||
        e.message?.includes('Could not resolve')
      ) {
        throw new Error('keytar not installed — run: npm i -g keytar')
      }
      throw e
    }
  }
  return Buffer.from(readFileSync(keyFilePath, 'utf8').trim(), 'hex')
}

export async function saveKeyToStorage(key: Buffer, storage: string, keyFilePath: string): Promise<void> {
  if (storage === 'keyring') {
    try {
      const keytar = await import('keytar')
      await keytar.setPassword('zocket', 'master-key', key.toString('hex'))
    } catch (e: any) {
      if (e.message?.includes('Cannot find module') || e.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('keytar not installed — run: npm i -g keytar')
      }
      throw e
    }
  } else {
    saveKey(key, keyFilePath)
  }
}
