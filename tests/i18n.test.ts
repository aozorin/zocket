import { describe, it, expect } from 'vitest'

describe('i18n', () => {
  it('returns English message for known key', async () => {
    const { t } = await import('../src/i18n.js')
    expect(t('msg.init_complete', 'en')).toContain('complete')
  })

  it('returns Russian message when lang=ru', async () => {
    const { t } = await import('../src/i18n.js')
    const msg = t('msg.init_complete', 'ru')
    expect(msg).toBeTruthy()
    expect(msg).not.toBe('msg.init_complete')
  })

  it('supports {name} interpolation', async () => {
    const { t } = await import('../src/i18n.js')
    const msg = t('msg.project_created', 'en', { name: 'myproj' })
    expect(msg).toContain('myproj')
  })

  it('falls back to key for unknown key', async () => {
    const { t } = await import('../src/i18n.js')
    expect(t('unknown_key_xyz' as any, 'en')).toBe('unknown_key_xyz')
  })

  it('normalizeLang converts ru variants to ru', async () => {
    const { normalizeLang } = await import('../src/i18n.js')
    expect(normalizeLang('ru')).toBe('ru')
    expect(normalizeLang('ru-RU')).toBe('ru')
    expect(normalizeLang('en')).toBe('en')
    expect(normalizeLang('fr')).toBe('en')
  })
})
