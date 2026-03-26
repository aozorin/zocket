import { readFileSync, writeFileSync, existsSync } from 'fs'

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
export function setEnvKey(filePath: string, key: string, value: string): void {
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
}
