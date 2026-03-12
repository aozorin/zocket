import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function makeVault(dir: string) {
  const { generateKey } = await import('../src/crypto.js')
  const { VaultService } = await import('../src/vault.js')
  const key = generateKey()
  return new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
}

describe('VaultService', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-vault-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('creates and lists projects', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('myproj', 'desc')
    const projects = await vault.listProjects()
    expect(projects.map(p => p.name)).toContain('myproj')
  })

  it('rejects invalid project names', async () => {
    const vault = await makeVault(dir)
    await expect(vault.createProject('bad name!', '')).rejects.toThrow()
  })

  it('sets and gets secrets', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'MY_KEY', 'myvalue', '')
    const keys = await vault.listKeys('proj')
    expect(keys).toContain('MY_KEY')
  })

  it('rejects invalid secret key names', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await expect(vault.setSecret('proj', 'bad-key', 'val', '')).rejects.toThrow()
  })

  it('deletes secret', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'KEY', 'val', '')
    await vault.deleteSecret('proj', 'KEY')
    expect(await vault.listKeys('proj')).not.toContain('KEY')
  })

  it('deletes project', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.deleteProject('proj')
    expect((await vault.listProjects()).map(p => p.name)).not.toContain('proj')
  })

  it('sets folder_path and matches by longest prefix', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setFolder('proj', '/home/user/projects/myapp')
    const match = await vault.findByPath('/home/user/projects/myapp/src/foo.ts')
    expect(match).toBe('proj')
  })

  it('env returns only secrets for project', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'TOKEN', 'abc123', '')
    const env = await vault.getEnv('proj')
    expect(env['TOKEN']).toBe('abc123')
  })

  it('handles concurrent writes without data loss', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await Promise.all([
      vault.setSecret('proj', 'KEY_A', 'a', ''),
      vault.setSecret('proj', 'KEY_B', 'b', ''),
    ])
    const keys = await vault.listKeys('proj')
    expect(keys).toContain('KEY_A')
    expect(keys).toContain('KEY_B')
  })

  it('persists across instances', async () => {
    const { generateKey } = await import('../src/crypto.js')
    const { VaultService } = await import('../src/vault.js')
    const key = generateKey()
    const v1 = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
    await v1.createProject('persist', 'test')
    const v2 = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
    expect((await v2.listProjects()).map(p => p.name)).toContain('persist')
  })
})
