import { readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'fs'
import { userInfo } from 'os'

/** Returns an array of key names from a .env file (values are never exposed). */
export function listEnvKeys(filePath: string): string[] {
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=')[0].trim())
    .filter(Boolean)
}

/** Inserts or updates a key=value pair in a .env file. */
export function setEnvKey(filePath: string, key: string, value: string, protect = false): void {
  if (protect && process.platform !== 'win32' && existsSync(filePath)) {
    const st = statSync(filePath)
    const uid = typeof st.uid === 'number' ? st.uid : null
    if (uid !== null && uid !== process.getuid()) {
      throw new Error(`File not owned by ${userInfo().username}. Run zocket service or chown ${filePath}`)
    }
  }
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const lines = existing ? existing.split('\n') : []

  // Find and replace existing key (handles KEY=, KEY ="...", etc.)
  const re = new RegExp(`^\\s*${key}\\s*=.*$`)
  const idx = lines.findIndex(l => re.test(l))

  const entry = `${key}=${value}`
  if (idx !== -1) {
    lines[idx] = entry
  } else {
    // Append; keep trailing newline tidy
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    lines.push(entry)
  }

  writeFileSync(filePath, lines.join('\n'))
  if (protect) {
    try { chmodSync(filePath, 0o600) } catch { /* ignore */ }
  }
}
