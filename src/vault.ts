import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { lock } from 'proper-lockfile'
import { encrypt, decrypt } from './crypto.js'

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
}

export class VaultService {
  constructor(
    private vaultPath: string,
    private lockFile: string,
    private key: Buffer,
  ) {}

  private load(): VaultData {
    if (!existsSync(this.vaultPath)) return { version: 1, projects: {} }
    const raw = readFileSync(this.vaultPath)
    return JSON.parse(decrypt(raw, this.key).toString('utf8'))
  }

  private save(data: VaultData): void {
    mkdirSync(dirname(this.vaultPath), { recursive: true })
    writeFileSync(this.vaultPath, encrypt(Buffer.from(JSON.stringify(data)), this.key))
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
    }))
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
