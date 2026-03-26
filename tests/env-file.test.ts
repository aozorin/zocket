import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('env-file', () => {
  let dir: string
  let envPath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zkt-env-'))
    envPath = join(dir, '.env')
  })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('listEnvKeys returns [] for missing file', async () => {
    const { listEnvKeys } = await import('../src/env-file.js')
    expect(listEnvKeys(envPath)).toEqual([])
  })

  it('listEnvKeys returns key names only', async () => {
    const { listEnvKeys } = await import('../src/env-file.js')
    writeFileSync(envPath, '# comment\nAPI_KEY=secret\nDB_URL=postgres://x\n')
    expect(listEnvKeys(envPath)).toEqual(['API_KEY', 'DB_URL'])
  })

  it('setEnvKey inserts new key', async () => {
    const { setEnvKey, listEnvKeys } = await import('../src/env-file.js')
    setEnvKey(envPath, 'API_KEY', 'abc123')
    expect(listEnvKeys(envPath)).toContain('API_KEY')
  })

  it('setEnvKey updates existing key', async () => {
    const { setEnvKey } = await import('../src/env-file.js')
    writeFileSync(envPath, 'API_KEY=old\n')
    setEnvKey(envPath, 'API_KEY', 'new_value')
    const { readFileSync } = await import('fs')
    const content = readFileSync(envPath, 'utf8')
    expect(content).toContain('API_KEY=new_value')
    expect(content).not.toContain('API_KEY=old')
  })

  it('setEnvKey preserves other keys', async () => {
    const { setEnvKey, listEnvKeys } = await import('../src/env-file.js')
    writeFileSync(envPath, 'EXISTING=value\n')
    setEnvKey(envPath, 'API_KEY', 'abc')
    const keys = listEnvKeys(envPath)
    expect(keys).toContain('EXISTING')
    expect(keys).toContain('API_KEY')
  })
})
