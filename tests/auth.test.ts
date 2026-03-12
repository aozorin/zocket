import { describe, it, expect } from 'vitest'

describe('auth', () => {
  it('hashPassword returns hash and salt', async () => {
    const { hashPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('secret123')
    expect(hash).toHaveLength(64)
    expect(salt).toHaveLength(32)
  })

  it('verifyPassword returns true for correct password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('correct')
    expect(verifyPassword('correct', hash, salt)).toBe(true)
  })

  it('verifyPassword returns false for wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('correct')
    expect(verifyPassword('wrong', hash, salt)).toBe(false)
  })
})
