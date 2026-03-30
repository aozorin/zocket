import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { lock } from 'proper-lockfile'
import { encrypt, decrypt, decryptLegacyFernet } from './crypto.js'

const PROJECT_RE = /^[a-zA-Z0-9._-]+$/
const SECRET_RE = /^[A-Z_][A-Z0-9_]*$/

export interface SecretEntry {
  value: string
  description: string
  updated_at: string
}

export interface ProjectEntry {
  description: string
  created_at: string
  updated_at: string
  secrets: Record<string, SecretEntry>
  folder_path?: string
  /** Domains this project's secrets are allowed to be sent to. null = no restriction. */
  allowed_domains?: string[] | null
}

interface VaultData {
  version: number
  projects: Record<string, ProjectEntry>
}

export interface ProjectInfo {
  name: string
  description: string
  created_at: string
  folder_path?: string
  secret_count: number
  allowed_domains?: string[] | null
}

export class VaultService {
  constructor(
    private vaultPath: string,
    private lockFile: string,
    private key: Buffer,
    private legacyKeyBase64?: string,
    private keyFilePath?: string,
  ) {}

  private load(): VaultData {
    if (!existsSync(this.vaultPath)) return { version: 1, projects: {} }
    const raw = readFileSync(this.vaultPath)
    try {
      return JSON.parse(decrypt(raw, this.key).toString('utf8'))
    } catch (err) {
      const message = String(err)
      if (this.legacyKeyBase64 && message.includes('Unsupported vault version')) {
        return this.migrateLegacy(raw)
      }
      throw err
    }
  }

  private save(data: VaultData): void {
    mkdirSync(dirname(this.vaultPath), { recursive: true })
    writeFileSync(this.vaultPath, encrypt(Buffer.from(JSON.stringify(data)), this.key))
  }

  ensureExists(): void {
    if (!existsSync(this.vaultPath)) {
      this.save({ version: 1, projects: {} })
    }
  }

  private migrateLegacy(raw: Buffer): VaultData {
    const plaintext = decryptLegacyFernet(raw, this.legacyKeyBase64 as string)
    let parsed: any
    try {
      parsed = JSON.parse(plaintext.toString('utf8'))
    } catch {
      throw new Error('Legacy vault JSON parse failed')
    }
    const data: VaultData = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      projects: parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {},
    }
    // Normalize and re-save using new AES-GCM envelope
    if (!data.version || data.version !== 1) data.version = 1
    if (!data.projects) data.projects = {}
    this.save(data)
    if (this.keyFilePath) {
      try {
        writeFileSync(this.keyFilePath, this.key.toString('hex'), { mode: 0o600 })
      } catch {
        // ignore key rewrite failure; vault already migrated
      }
    }
    return data
  }

  private async withLock<T>(fn: (data: VaultData) => T): Promise<T> {
    mkdirSync(dirname(this.lockFile), { recursive: true })
    if (!existsSync(this.lockFile)) writeFileSync(this.lockFile, '')
    const release = await lock(this.lockFile, { retries: { retries: 5, minTimeout: 50 } })
    try {
      const data = this.load()
      const result = fn(data)
      this.save(data)
      return result
    } finally {
      await release()
    }
  }

  async createProject(name: string, description: string): Promise<void> {
    if (!PROJECT_RE.test(name)) throw new Error(`Invalid project name: ${name}`)
    await this.withLock(data => {
      if (data.projects[name]) throw new Error(`Project already exists: ${name}`)
      const now = new Date().toISOString()
      data.projects[name] = { description, created_at: now, updated_at: now, secrets: {} }
    })
  }

  async deleteProject(name: string): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[name]) throw new Error(`Project not found: ${name}`)
      delete data.projects[name]
    })
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const data = this.load()
    return Object.entries(data.projects).map(([name, p]) => ({
      name,
      description: p.description,
      created_at: p.created_at,
      folder_path: p.folder_path,
      secret_count: Object.keys(p.secrets).length,
      allowed_domains: p.allowed_domains,
    }))
  }

  async setAllowedDomains(project: string, domains: string[] | null): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      data.projects[project].allowed_domains = domains
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async getAllowedDomains(project: string): Promise<string[] | null> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return data.projects[project].allowed_domains ?? null
  }

  async setSecret(project: string, key: string, value: string, description: string): Promise<void> {
    if (!SECRET_RE.test(key)) throw new Error(`Invalid secret key: ${key}`)
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      data.projects[project].secrets[key] = { value, description, updated_at: new Date().toISOString() }
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async deleteSecret(project: string, key: string): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      delete data.projects[project].secrets[key]
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async listKeys(project: string): Promise<string[]> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return Object.keys(data.projects[project].secrets)
  }

  async listSecrets(project: string): Promise<Array<{ key: string; description: string; updated_at: string }>> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return Object.entries(data.projects[project].secrets).map(([key, s]) => ({
      key,
      description: s.description,
      updated_at:  s.updated_at,
    }))
  }

  async getEnv(project: string): Promise<Record<string, string>> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return Object.fromEntries(Object.entries(data.projects[project].secrets).map(([k, v]) => [k, v.value]))
  }

  async setFolder(project: string, folderPath: string | undefined): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      data.projects[project].folder_path = folderPath
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async findByPath(path: string): Promise<string | null> {
    const data = this.load()
    let best: string | null = null
    let bestLen = 0
    for (const [name, proj] of Object.entries(data.projects)) {
      if (proj.folder_path && path.startsWith(proj.folder_path) && proj.folder_path.length > bestLen) {
        best = name
        bestLen = proj.folder_path.length
      }
    }
    return best
  }

  async getSecretValue(project: string, key: string): Promise<string> {
    const data = this.load()
    const secret = data.projects[project]?.secrets[key]
    if (!secret) throw new Error(`Secret not found: ${project}/${key}`)
    return secret.value
  }

  async exportData(): Promise<VaultData> {
    const data = this.load()
    return JSON.parse(JSON.stringify(data)) as VaultData
  }

  private normalizeImport(input: any): VaultData {
    if (!input || typeof input !== 'object') throw new Error('Invalid import payload')
    const rawProjects = input.projects && typeof input.projects === 'object' ? input.projects : {}
    const projects: Record<string, ProjectEntry> = {}
    const now = new Date().toISOString()

    for (const [name, raw] of Object.entries(rawProjects)) {
      if (!PROJECT_RE.test(name)) throw new Error(`Invalid project name in import: ${name}`)
      const p = raw as any
      const entry: ProjectEntry = {
        description: typeof p?.description === 'string' ? p.description : '',
        created_at: typeof p?.created_at === 'string' ? p.created_at : now,
        updated_at: typeof p?.updated_at === 'string' ? p.updated_at : now,
        secrets: {},
      }
      if (typeof p?.folder_path === 'string' && p.folder_path.trim()) {
        entry.folder_path = p.folder_path
      }
      if (Array.isArray(p?.allowed_domains)) {
        entry.allowed_domains = p.allowed_domains.map((d: string) => String(d)).filter(Boolean)
      }
      const rawSecrets = p?.secrets && typeof p.secrets === 'object' ? p.secrets : {}
      for (const [key, s] of Object.entries(rawSecrets)) {
        if (!SECRET_RE.test(key)) throw new Error(`Invalid secret key in import: ${key}`)
        const val = s as any
        entry.secrets[key] = {
          value: typeof val?.value === 'string' ? val.value : '',
          description: typeof val?.description === 'string' ? val.description : '',
          updated_at: typeof val?.updated_at === 'string' ? val.updated_at : now,
        }
      }
      projects[name] = entry
    }

    return { version: 1, projects }
  }

  async importData(input: any, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
    const incoming = this.normalizeImport(input)
    const now = new Date().toISOString()
    await this.withLock(data => {
      if (mode === 'replace') {
        data.projects = incoming.projects
        return
      }
      for (const [name, entry] of Object.entries(incoming.projects)) {
        if (!data.projects[name]) {
          data.projects[name] = entry
          data.projects[name].updated_at = now
          continue
        }
        const existing = data.projects[name]
        existing.description = entry.description
        existing.folder_path = entry.folder_path
        existing.allowed_domains = entry.allowed_domains
        for (const [key, secret] of Object.entries(entry.secrets)) {
          existing.secrets[key] = secret
        }
        existing.updated_at = now
      }
    })
  }

  async reEncrypt(newKey: Buffer): Promise<void> {
    mkdirSync(dirname(this.lockFile), { recursive: true })
    if (!existsSync(this.lockFile)) writeFileSync(this.lockFile, '')
    const release = await lock(this.lockFile, { retries: { retries: 5, minTimeout: 50 } })
    try {
      const data = this.load()
      this.key = newKey
      this.save(data)
    } finally {
      await release()
    }
  }
}
