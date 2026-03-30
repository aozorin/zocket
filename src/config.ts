import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'
import type { SecurityMode, RiskLevel } from './security.js'
import type { DefenceLevel } from './defence.js'

export type { SecurityMode, RiskLevel }
export type KeyStorage = 'file' | 'keyring' | 'env'
export type Lang = 'en' | 'ru'
export type McpLoading = 'eager' | 'lazy'

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
  security_mode: SecurityMode
  security_block_threshold: RiskLevel
  defence_level: DefenceLevel
  /** Tool registration strategy. eager = all tools at connect; lazy = on-demand via activate_tool. */
  mcp_loading: McpLoading
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
  exec_max_output: 500,
  exec_allow_substitution: true,
  exec_allow_full_output: false,
  exec_redact_secrets: true,
  security_mode: 'enforce' as SecurityMode,
  security_block_threshold: 'high' as RiskLevel,
  defence_level: 'decent' as DefenceLevel,
  mcp_loading: 'eager' as McpLoading,
}

export class ConfigStore {
  constructor(private path: string) {}

  load(): Config {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'))
      const merged = { ...DEFAULTS, ...raw }
      if (!merged.defence_level) {
        merged.defence_level = merged.security_mode === 'audit' ? 'low' : 'decent'
      }
      return merged
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
