import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

export type KeyStorage = 'file' | 'keyring' | 'env'
export type Lang = 'en' | 'ru'

export interface Config {
  language: Lang
  key_storage: KeyStorage
  web_auth_enabled: boolean
  web_password_hash: string
  web_password_salt: string
  theme: string
  theme_variant: string
  session_secret: string
  folder_picker_roots: string[]
  exec_allow_list: string[] | null
  exec_max_output: number
  exec_allow_substitution: boolean
  exec_allow_full_output: boolean
  exec_redact_secrets: boolean
}

const DEFAULTS: Config = {
  language: 'en',
  key_storage: 'file',
  web_auth_enabled: false,
  web_password_hash: '',
  web_password_salt: '',
  theme: 'standard',
  theme_variant: 'light',
  session_secret: '',
  folder_picker_roots: ['/home', '/srv', '/opt', '/var/www', '/var/lib'],
  exec_allow_list: null,
  exec_max_output: 4096,
  exec_allow_substitution: true,
  exec_allow_full_output: false,
  exec_redact_secrets: true,
}

export class ConfigStore {
  constructor(private path: string) {}

  load(): Config {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'))
      return { ...DEFAULTS, ...raw }
    } catch {
      return { ...DEFAULTS }
    }
  }

  save(cfg: Config): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(cfg, null, 2))
  }

  set<K extends keyof Config>(key: K, value: Config[K]): void {
    const cfg = this.load()
    cfg[key] = value
    this.save(cfg)
  }

  ensureExists(): Config {
    const cfg = this.load()
    if (!cfg.session_secret) {
      cfg.session_secret = randomBytes(32).toString('hex')
      this.save(cfg)
    }
    return cfg
  }
}
