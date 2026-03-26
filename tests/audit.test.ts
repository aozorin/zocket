import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('AuditLogger', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-audit-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('logs and tails entries', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    logger.log('login', 'web', {}, 'ok')
    logger.log('secret_get', 'mcp', { project: 'p' }, 'ok')
    const entries = logger.tail(10)
    expect(entries).toHaveLength(2)
    expect(entries[0].action).toBe('login')
  })

  it('tail limits results', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    for (let i = 0; i < 10; i++) logger.log('ping', 'mcp', {}, 'ok')
    expect(logger.tail(3)).toHaveLength(3)
  })

  it('failedLogins counts recent failures', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    logger.log('login', 'web', {}, 'fail')
    logger.log('login', 'web', {}, 'fail')
    logger.log('login', 'web', {}, 'ok')
    expect(logger.failedLogins(5)).toBe(2)
  })
})
