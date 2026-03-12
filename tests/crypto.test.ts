import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('crypto', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-crypto-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('generateKey returns 32 bytes', async () => {
    const { generateKey } = await import('../src/crypto.js')
    expect(generateKey()).toHaveLength(32)
  })

  it('encrypt/decrypt round-trip', async () => {
    const { generateKey, encrypt, decrypt } = await import('../src/crypto.js')
    const key = generateKey()
    const plaintext = Buffer.from('hello world')
    const ciphertext = encrypt(plaintext, key)
    expect(decrypt(ciphertext, key).toString()).toBe('hello world')
  })

  it('encrypted output has version + IV + tag prefix', async () => {
    const { generateKey, encrypt } = await import('../src/crypto.js')
    const key = generateKey()
    const out = encrypt(Buffer.from('test'), key)
    expect(out.readUInt32BE(0)).toBe(1)
    expect(out.length).toBeGreaterThan(4 + 12 + 16)
  })

  it('decrypt throws on wrong key', async () => {
    const { generateKey, encrypt, decrypt } = await import('../src/crypto.js')
    const key1 = generateKey()
    const key2 = generateKey()
    const ciphertext = encrypt(Buffer.from('secret'), key1)
    expect(() => decrypt(ciphertext, key2)).toThrow()
  })

  it('loadKey reads from file', async () => {
    const { generateKey, saveKey, loadKey } = await import('../src/crypto.js')
    const key = generateKey()
    const keyFile = join(dir, 'master.key')
    saveKey(key, keyFile)
    const loaded = await loadKey(keyFile, 'file')
    expect(loaded).toEqual(key)
  })

  it('loadKey reads from ZOCKET_MASTER_KEY env var', async () => {
    const { generateKey, loadKey } = await import('../src/crypto.js')
    const key = generateKey()
    process.env.ZOCKET_MASTER_KEY = key.toString('hex')
    try {
      const loaded = await loadKey('/nonexistent', 'file')
      expect(loaded).toEqual(key)
    } finally {
      delete process.env.ZOCKET_MASTER_KEY
    }
  })

  it('loadKey throws user-friendly error when keytar missing and storage=keyring', async () => {
    const { loadKey } = await import('../src/crypto.js')
    await expect(loadKey('/nonexistent', 'keyring')).rejects.toThrow('keytar not installed')
  })
})
