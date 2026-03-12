import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'

describe('paths', () => {
  const orig = process.env.ZOCKET_HOME

  afterEach(() => {
    if (orig === undefined) delete process.env.ZOCKET_HOME
    else process.env.ZOCKET_HOME = orig
  })

  it('zocketHome defaults to ~/.zocket', async () => {
    delete process.env.ZOCKET_HOME
    const { zocketHome } = await import('../src/paths.js')
    expect(zocketHome()).toBe(join(homedir(), '.zocket'))
  })

  it('zocketHome respects ZOCKET_HOME env', async () => {
    process.env.ZOCKET_HOME = '/tmp/test-zocket'
    const { zocketHome } = await import('../src/paths.js')
    expect(zocketHome()).toBe('/tmp/test-zocket')
  })

  it('vaultPath returns vault.enc inside home', async () => {
    process.env.ZOCKET_HOME = '/tmp/zkt'
    const { vaultPath } = await import('../src/paths.js')
    expect(vaultPath()).toBe('/tmp/zkt/vault.enc')
  })
})
