#!/usr/bin/env node
/**
 * Import Python vault JSON into TypeScript vault.
 * Usage: node migrate-import.mjs <vault-data.json>
 *
 * The script creates a fresh AES-256-GCM vault with the same projects/secrets.
 * The old Python key is replaced with a new 32-byte hex key.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createCipheriv, randomBytes } from 'crypto'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const home = process.env.ZOCKET_HOME ?? join(process.env.HOME, '.zocket')
const vaultFile = join(home, 'vault.enc')
const keyFile   = join(home, 'master.key')

// Read migration JSON
const jsonFile = process.argv[2]
if (!jsonFile) { console.error('Usage: node migrate-import.mjs <vault-data.json>'); process.exit(1) }
const src = JSON.parse(readFileSync(jsonFile, 'utf8'))

// Generate new TypeScript-compatible key (32 bytes, stored as hex)
let key
if (existsSync(keyFile)) {
  const raw = readFileSync(keyFile, 'utf8').trim()
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex')
    console.log('[migrate] Using existing TypeScript key')
  } else {
    // Old Python key (Fernet base64) — replace with new key
    key = randomBytes(32)
    writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
    console.log('[migrate] Replaced Python key with new TypeScript key (hex)')
  }
} else {
  key = randomBytes(32)
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
  console.log('[migrate] Created new TypeScript key')
}

// Build new vault structure (same format as TypeScript VaultService)
const now = new Date().toISOString()
const vault = { version: 1, projects: {} }

for (const [name, proj] of Object.entries(src.projects ?? {})) {
  const secrets = {}
  for (const [key_, sec] of Object.entries(proj.secrets ?? {})) {
    secrets[key_] = {
      value:      typeof sec === 'string' ? sec : (sec.value ?? ''),
      description: typeof sec === 'object' ? (sec.description ?? '') : '',
      updated_at:  typeof sec === 'object' ? (sec.updated_at ?? now) : now,
    }
  }
  vault.projects[name] = {
    description: proj.description ?? '',
    created_at:  proj.created_at ?? now,
    updated_at:  proj.updated_at ?? now,
    folder_path: proj.folder_path ?? undefined,
    secrets,
  }
}

console.log(`[migrate] Projects: ${Object.keys(vault.projects).join(', ') || '(none)'}`)

// Encrypt with AES-256-GCM (TypeScript format: 4-byte version | 12-byte IV | 16-byte tag | ciphertext)
const plaintext = Buffer.from(JSON.stringify(vault))
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, iv)
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
const tag = cipher.getAuthTag()
const version = Buffer.allocUnsafe(4); version.writeUInt32BE(1, 0)
const out = Buffer.concat([version, iv, tag, ciphertext])

writeFileSync(vaultFile, out, { mode: 0o600 })
console.log(`[migrate] Vault written to ${vaultFile}`)
console.log('[migrate] Done. Restart the zocket service.')
