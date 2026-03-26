import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface AuditEntry {
  timestamp: string
  action: string
  actor: string
  details: Record<string, unknown>
  status: string
}

export class AuditLogger {
  constructor(private path: string) {}

  log(action: string, actor: string, details: Record<string, unknown>, status: string): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const entry: AuditEntry = { timestamp: new Date().toISOString(), action, actor, details, status }
    appendFileSync(this.path, JSON.stringify(entry) + '\n')
  }

  tail(n: number): AuditEntry[] {
    if (!existsSync(this.path)) return []
    const lines = readFileSync(this.path, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-n).map(l => JSON.parse(l))
  }

  failedLogins(withinMinutes: number): number {
    if (!existsSync(this.path)) return 0
    const since = new Date(Date.now() - withinMinutes * 60_000)
    const lines = readFileSync(this.path, 'utf8').trim().split('\n').filter(Boolean)
    return lines
      .map(l => JSON.parse(l) as AuditEntry)
      .filter(e => e.action === 'login' && e.status === 'fail' && new Date(e.timestamp) >= since)
      .length
  }
}
