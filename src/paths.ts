import { homedir } from 'os'
import { join } from 'path'

export function zocketHome(): string {
  return process.env.ZOCKET_HOME ?? join(homedir(), '.zocket')
}
export function vaultPath(home = zocketHome()): string { return join(home, 'vault.enc') }
export function keyPath(home = zocketHome()): string { return join(home, 'master.key') }
export function configPath(home = zocketHome()): string { return join(home, 'config.json') }
export function auditPath(home = zocketHome()): string { return join(home, 'audit.log') }
export function backupsDir(home = zocketHome()): string { return join(home, 'backups') }
export function lockPath(home = zocketHome()): string { return join(home, 'vault.lock') }
