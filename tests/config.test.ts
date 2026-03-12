import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ConfigStore', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('returns defaults when no file exists', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    const cfg = store.load()
    expect(cfg.language).toBe('en')
    expect(cfg.web_auth_enabled).toBe(false)
    expect(cfg.exec_max_output).toBe(4096)
  })

  it('persists and reloads values', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    store.set('language', 'ru')
    expect(store.load().language).toBe('ru')
  })

  it('ensureExists generates session_secret', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    const cfg = store.ensureExists()
    expect(cfg.session_secret).toHaveLength(64)
    const cfg2 = store.ensureExists()
    expect(cfg2.session_secret).toBe(cfg.session_secret)
  })
})
