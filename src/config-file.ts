import { readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'fs'
import { userInfo } from 'os'
import { extname } from 'path'
import YAML from 'yaml'

function setDeep(obj: Record<string, any>, path: string[], value: any): void {
  let cur: any = obj
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key]
  }
  cur[path[path.length - 1]] = value
}

export function setConfigValue(filePath: string, keyPath: string, value: string, protect = false): void {
  const ext = extname(filePath).toLowerCase()
  if (!['.json', '.yaml', '.yml'].includes(ext)) {
    throw new Error('Unsupported config file type. Use .json, .yaml, or .yml')
  }

  if (protect && process.platform !== 'win32' && existsSync(filePath)) {
    const st = statSync(filePath)
    const uid = typeof st.uid === 'number' ? st.uid : null
    if (uid !== null && uid !== process.getuid()) {
      throw new Error(`File not owned by ${userInfo().username}. Run zocket service or chown ${filePath}`)
    }
  }

  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  let data: any = {}
  if (raw.trim()) {
    data = ext === '.json' ? JSON.parse(raw) : YAML.parse(raw)
  }

  const path = keyPath.split('.').map(s => s.trim()).filter(Boolean)
  if (!path.length) throw new Error('Invalid key path')
  setDeep(data, path, value)

  const out = ext === '.json' ? JSON.stringify(data, null, 2) : YAML.stringify(data)
  writeFileSync(filePath, out)
  if (protect) {
    try { chmodSync(filePath, 0o600) } catch { /* ignore */ }
  }
}
