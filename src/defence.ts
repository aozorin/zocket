import type { Config } from './config.js'

export type DefenceLevel = 'low' | 'decent' | 'high'

export function normalizeDefence(value: string | undefined): DefenceLevel {
  if (value === 'low' || value === 'high') return value
  return 'decent'
}

export function applyDefence(cfg: Config, level: DefenceLevel): Config {
  const next = { ...cfg, defence_level: level }
  if (level === 'low') {
    next.security_mode = 'audit'
    next.security_block_threshold = 'critical'
  } else if (level === 'high') {
    next.security_mode = 'enforce'
    next.security_block_threshold = 'low'
  } else {
    next.security_mode = 'enforce'
    next.security_block_threshold = 'high'
  }
  return next
}
