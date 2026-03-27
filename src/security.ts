import { checkDomainMatch } from './api-registry.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type SecurityMode   = 'off' | 'audit' | 'enforce'
export type RiskLevel      = 'none' | 'low' | 'medium' | 'high' | 'critical'
export type Severity       = 'low' | 'medium' | 'high' | 'critical'

export interface Finding {
  pattern:     string    // rule ID, e.g. 'ENV_DUMP_PIPE_NETWORK'
  description: string
  severity:    Severity
}

export interface SecurityResult {
  allowed:   boolean
  risk:      RiskLevel
  score:     number
  findings:  Finding[]
  reason?:   string
}

export interface SecurityConfig {
  mode:            SecurityMode
  block_threshold: RiskLevel
  /** If set, any outbound request to a domain NOT in this list triggers UNKNOWN_DOMAIN finding.
   *  null = no restriction (default). Add domains without protocol: ["api.stripe.com", "s3.amazonaws.com"] */
  allowed_domains: string[] | null
  /** Hints derived from project name + secret key names for semantic API matching.
   *  When set, enables SUSPICIOUS_DOMAIN rule for known APIs sent to unexpected domains. */
  hints?: string[] | null
}

// ─── Weights & thresholds ────────────────────────────────────────────────────

const W = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 2 } as const

const RISK_THRESHOLDS: [number, RiskLevel][] = [
  [20, 'critical'],
  [10, 'high'],
  [5,  'medium'],
  [1,  'low'],
  [0,  'none'],
]

const BLOCK_SCORE: Record<RiskLevel, number> = {
  none: Infinity, low: 1, medium: 5, high: 10, critical: 20,
}

function scoreToRisk(score: number): RiskLevel {
  for (const [threshold, level] of RISK_THRESHOLDS) {
    if (score >= threshold) return level
  }
  return 'none'
}

// ─── Domain extraction ────────────────────────────────────────────────────────

/** Extract all hostnames from URLs found in text */
function extractDomains(text: string): string[] {
  const matches = [...text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)]
  return [...new Set(matches.map(m => m[1].toLowerCase()))]
}

function domainAllowed(domain: string, allowedDomains: string[]): boolean {
  return allowedDomains.some(allowed => {
    const a = allowed.toLowerCase()
    return domain === a || domain.endsWith('.' + a)
  })
}

// ─── Analysis context ─────────────────────────────────────────────────────────

interface Ctx {
  text:       string          // effective text to match against
  envRefs:    string[]        // distinct $VAR names found
  hasNetwork: boolean
}

const NETWORK_RE = /\b(curl|wget|nc\b|ncat|socat|netcat|fetch|axios|requests?\.|urllib|http\.client|httpx|aiohttp|XMLHttpRequest|require\(['"]https?['"]\)|require\(["']node:https?["']\))\b/

function envRefsIn(text: string): string[] {
  const matches = [...text.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map(m => m[1])
  return [...new Set(matches)]
}

function buildCtx(text: string): Ctx {
  return { text, envRefs: envRefsIn(text), hasNetwork: NETWORK_RE.test(text) }
}

// ─── Rules ───────────────────────────────────────────────────────────────────

interface Rule {
  id:          string
  description: string
  severity:    Severity
  weight:      number
  supersedes?: string[]   // IDs of lower-priority rules this one replaces when both fire
  test:        (c: Ctx) => boolean
}

const RULES: Rule[] = [
  // ── Critical ────────────────────────────────────────────────────────────
  {
    id: 'ENV_DUMP_PIPE_NETWORK',
    description: 'printenv or env piped directly to a network tool (classic exfiltration)',
    severity: 'critical',
    weight: W.CRITICAL,
    supersedes: ['BARE_ENV_DUMP', 'SINGLE_ENV_NETWORK'],
    test: c => /\b(printenv|env)\b[^|]*\|[^|]*(curl|wget|nc\b|ncat|socat|netcat)\b/.test(c.text),
  },
  {
    id: 'PROC_ENVIRON_READ',
    description: 'Reading another process environment via /proc/<pid>/environ',
    severity: 'critical',
    weight: W.CRITICAL,
    test: c => /\/proc\/[0-9*]+\/environ/.test(c.text),
  },
  {
    id: 'LOOP_ENV_EXFIL',
    description: 'Loop iterating over environment variables combined with network call',
    severity: 'critical',
    weight: W.CRITICAL,
    supersedes: ['MULTIPLE_SECRETS_ARGS', 'SINGLE_ENV_NETWORK'],
    test: c =>
      /\bfor\b[\s\S]{0,120}(printenv|os\.environ|process\.env)[\s\S]{0,300}(curl|wget|fetch|requests?\.|urllib|http\.client)\b/.test(c.text) ||
      /for\s+\w+\s+in\s+(os\.environ|os\.environ\.items\(\)|os\.environ\.keys\(\))[\s\S]{0,300}(requests?|urllib|http\.client|curl|wget)\b/.test(c.text),
  },
  {
    id: 'MULTI_SECRET_IN_URL',
    description: 'Two or more distinct secrets referenced in a single outbound URL or query string',
    severity: 'critical',
    weight: W.CRITICAL,
    supersedes: ['MULTIPLE_SECRETS_ARGS', 'SINGLE_ENV_NETWORK'],
    test: c => {
      if (c.envRefs.length < 2 || !c.hasNetwork) return false
      // Both vars appear within the same URL string
      if (/https?:\/\/[^\s]*\$\{?[A-Z_][A-Z0-9_]*\}?[^\s]*\$\{?[A-Z_][A-Z0-9_]*\}?/.test(c.text)) return true
      // Query string: ?a=$VAR1&b=$VAR2
      if (/[?&]\w+=\$\{?[A-Z_][A-Z0-9_]*\}?(&\w+=\$\{?[A-Z_][A-Z0-9_]*\}?)+/.test(c.text)) return true
      return false
    },
  },

  // ── High ────────────────────────────────────────────────────────────────
  {
    id: 'ENCODE_PIPE_NETWORK',
    description: 'Base64/hex encoding of data combined with network transmission (obfuscated exfiltration)',
    severity: 'high',
    weight: W.HIGH,
    supersedes: ['SINGLE_ENV_NETWORK'],
    test: c =>
      /(base64|xxd\b|od\b|hexdump|btoa\(|\.toString\(['"]base64['"]\)|b64encode|binascii\.hexlify)[\s\S]{0,400}(curl|wget|nc\b|fetch|requests?\.|urllib)/.test(c.text),
  },
  {
    id: 'SENSITIVE_FILE_EXFIL',
    description: 'Reading sensitive system files (/etc/shadow, ~/.ssh/) combined with network call',
    severity: 'high',
    weight: W.HIGH,
    test: c =>
      /(\/etc\/shadow|\/etc\/passwd|\/root\/\.ssh|~\/\.ssh\/|\/home\/[^/\s]+\/\.ssh\/)[\s\S]{0,400}(curl|wget|nc\b|fetch|requests?\.|urllib|http\.client)/.test(c.text) ||
      /(curl|wget|nc\b|fetch|requests?\.|urllib)[\s\S]{0,400}(\/etc\/shadow|\/etc\/passwd|\/root\/\.ssh|~\/\.ssh\/|\/home\/[^/\s]+\/\.ssh\/)/.test(c.text),
  },
  {
    id: 'ENV_DUMP_SUBSHELL',
    description: 'printenv/env used inside a subshell substitution',
    severity: 'high',
    weight: W.HIGH,
    supersedes: ['BARE_ENV_DUMP'],
    test: c => /\$\(\s*(printenv|env)\s*\)/.test(c.text),
  },

  // ── Medium ───────────────────────────────────────────────────────────────
  {
    id: 'BARE_ENV_DUMP',
    description: 'Bare printenv/env call with no output destination — dumps all environment variables to stdout',
    severity: 'medium',
    weight: W.MEDIUM,
    test: c => /^\s*(printenv|env)\s*$/.test(c.text.trim()),
  },
  {
    id: 'MULTIPLE_SECRETS_ARGS',
    description: 'Two or more distinct secrets referenced alongside a network operation',
    severity: 'medium',
    weight: W.MEDIUM,
    test: c => c.envRefs.length >= 2 && c.hasNetwork,
  },
  {
    id: 'SCRIPT_ENUMERATE_ALL_ENV',
    description: 'Script bulk-reads all environment keys (Object.keys/entries or os.environ.items) with network present',
    severity: 'medium',
    weight: W.MEDIUM,
    test: c =>
      c.hasNetwork &&
      /(Object\.(keys|entries|values)\(process\.env\)|for\s*\(\s*(const\s+)?\[?\w+\]?\s+(?:in|of)\s+(?:Object\.\w+\()?process\.env|dict\(os\.environ\)|os\.environ\.items\(\)|os\.environ\.keys\(\))/.test(c.text),
  },
  {
    id: 'REDIRECT_ENV_TO_FILE',
    description: 'Environment dump redirected to a file (data persistence risk)',
    severity: 'medium',
    weight: W.MEDIUM,
    test: c => /\b(printenv|env)\b[^|]*>/.test(c.text),
  },

  // ── Low ──────────────────────────────────────────────────────────────────
  {
    id: 'SINGLE_ENV_NETWORK',
    description: 'A single secret is referenced alongside a network call (may be legitimate API auth)',
    severity: 'low',
    weight: W.LOW,
    test: c => c.envRefs.length >= 1 && c.hasNetwork,
  },
  {
    id: 'PROC_SELF_ENVIRON',
    description: 'Reading /proc/self/environ (own process environment)',
    severity: 'low',
    weight: W.LOW,
    test: c => /\/proc\/self\/environ/.test(c.text),
  },
  // This rule is only registered when allowed_domains is configured — see analyze()
  {
    id: 'UNKNOWN_DOMAIN',
    description: 'Secret sent to a domain not in exec_allowed_domains allowlist',
    severity: 'high',
    weight: W.HIGH,
    test: _ => false,  // replaced dynamically in analyze()
  },
  // This rule is only active when hints are configured — see analyze()
  {
    id: 'SUSPICIOUS_DOMAIN',
    description: 'Secret sent to a domain that does not match the known API for this project (semantic mismatch)',
    severity: 'medium',
    weight: W.MEDIUM,
    supersedes: ['SINGLE_ENV_NETWORK'],
    test: _ => false,  // replaced dynamically in analyze()
  },
]

// ─── Allowances ───────────────────────────────────────────────────────────────

interface Allowance {
  name:        string
  score_delta: number
  test:        (c: Ctx) => boolean
}

// These reduce score to avoid false positives on legitimate patterns
const ALLOWANCES: Allowance[] = [
  {
    name: 'AUTH_HEADER_SINGLE_KEY',
    score_delta: -3,
    // curl -H "Authorization: Bearer $API_KEY" https://api.example.com
    test: c =>
      c.envRefs.length === 1 &&
      /-H\s+['"]?Authorization:\s*(Bearer|Basic|Token)\s+\$\{?[A-Z_][A-Z0-9_]*\}?['"]?/.test(c.text),
  },
  {
    name: 'STATIC_HTTPS_TARGET',
    score_delta: -1,
    // URL target is a static domain, not $VAR-based host
    test: c =>
      /https:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(c.text) &&
      !/https?:\/\/\$\{?[A-Z_]/.test(c.text),
  },
  {
    name: 'SINGLE_ENV_VAR_ONLY',
    score_delta: -1,
    test: c => c.envRefs.length === 1,
  },
]

// ─── Analyzer ────────────────────────────────────────────────────────────────

export class SecurityAnalyzer {
  constructor(private cfg: SecurityConfig) {}

  analyzeCommand(command: string[]): SecurityResult {
    if (this.cfg.mode === 'off') return allow()
    // If bash/sh -c "script", use the inner script as the effective text
    const isBashC = command.length >= 3 &&
      /^(ba?sh|sh|dash|zsh|ksh)$/.test(command[0]) &&
      command[1] === '-c'
    const text = isBashC ? command[2] : command.join(' ')
    return this.analyze(buildCtx(text))
  }

  analyzeScript(_lang: 'node', code: string): SecurityResult {
    if (this.cfg.mode === 'off') return allow()
    const ctx = buildCtx(code)
    return this.analyze(ctx)
  }

  private analyze(ctx: Ctx): SecurityResult {
    const fired = new Set<string>()
    const findings: Finding[] = []

    // Patch UNKNOWN_DOMAIN rule dynamically based on allowed_domains config
    const allowedDomains = this.cfg.allowed_domains
    const unknownDomainRule = RULES.find(r => r.id === 'UNKNOWN_DOMAIN')!
    if (allowedDomains && allowedDomains.length > 0) {
      unknownDomainRule.test = (c: Ctx) => {
        if (!c.hasNetwork || c.envRefs.length === 0) return false
        const domains = extractDomains(c.text)
        if (domains.length === 0) return false  // no explicit URL (e.g. bare `nc`)
        return domains.some(d => !domainAllowed(d, allowedDomains))
      }
    } else {
      unknownDomainRule.test = () => false  // disabled when no allowlist
    }

    // Patch SUSPICIOUS_DOMAIN rule dynamically based on hints (project name + key names)
    const hints = this.cfg.hints ?? null
    const suspiciousDomainRule = RULES.find(r => r.id === 'SUSPICIOUS_DOMAIN')!
    if (hints && hints.length > 0) {
      suspiciousDomainRule.test = (c: Ctx) => {
        if (!c.hasNetwork || c.envRefs.length === 0) return false
        const domains = extractDomains(c.text)
        if (domains.length === 0) return false
        return domains.some(d => {
          const result = checkDomainMatch(hints, d)
          return result !== null && !result.ok
        })
      }
    } else {
      suspiciousDomainRule.test = () => false  // disabled when no hints
    }

    // Fire rules in weight-descending order; skip superseded IDs
    const sorted = [...RULES].sort((a, b) => b.weight - a.weight)
    for (const rule of sorted) {
      if (fired.has(rule.id)) continue
      if (rule.test(ctx)) {
        findings.push({ pattern: rule.id, description: rule.description, severity: rule.severity })
        fired.add(rule.id)
        rule.supersedes?.forEach(id => fired.add(id))
      }
    }

    // Sum scores
    let score = findings.reduce((s, f) => {
      const rule = RULES.find(r => r.id === f.pattern)!
      return s + rule.weight
    }, 0)

    // Allowances only offset genuinely low-risk patterns (score < HIGH threshold).
    // This prevents -1/-3 adjustments from cancelling out real HIGH/CRITICAL findings.
    // Also skip allowances when SUSPICIOUS_DOMAIN fired: even with a proper auth header,
    // sending a known API key to the wrong domain is not a false positive.
    const hasSuspiciousDomain = findings.some(f => f.pattern === 'SUSPICIOUS_DOMAIN')
    if (score < W.HIGH && !hasSuspiciousDomain) {
      for (const allowance of ALLOWANCES) {
        if (allowance.test(ctx)) score += allowance.score_delta
      }
      score = Math.max(0, score)
    }

    const risk    = scoreToRisk(score)
    const blocked = this.cfg.mode === 'enforce' && score >= BLOCK_SCORE[this.cfg.block_threshold]
    const allowed = !blocked

    return {
      allowed,
      risk,
      score,
      findings,
      reason: blocked
        ? `[${risk.toUpperCase()}] ${findings.map(f => f.pattern).join(', ')}`
        : undefined,
    }
  }
}

export function createAnalyzer(
  cfg: Pick<{ security_mode: SecurityMode; security_block_threshold: RiskLevel }, 'security_mode' | 'security_block_threshold'>,
  allowedDomains: string[] | null = null,
  hints: string[] | null = null,
): SecurityAnalyzer {
  return new SecurityAnalyzer({
    mode:            cfg.security_mode,
    block_threshold: cfg.security_block_threshold,
    allowed_domains: allowedDomains,
    hints,
  })
}

function allow(): SecurityResult {
  return { allowed: true, risk: 'none', score: 0, findings: [] }
}
