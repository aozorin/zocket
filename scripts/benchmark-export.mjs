/**
 * Zocket Benchmark Export — generates CSV + HTML report
 *
 * Run: node scripts/benchmark-export.mjs
 * Output: benchmark-results.csv, benchmark-report.html
 */

import { encodingForModel } from 'js-tiktoken'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const enc = encodingForModel('gpt-4')
const T = s => enc.encode(String(s)).length
const __dir = dirname(fileURLToPath(import.meta.url))

// ─── Secrets (same as benchmark-full.mjs) ────────────────────────────────────

const SECRETS = {
  'Weak Password (example)':   { val: 'password123', realChars: 11, category: 'Password', src: 'weak password example' },
  'API Key OpenAI (sk-proj-)': { val: 'sk-proj-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz12345678'.slice(0, 156), realChars: 164, category: 'API Key', src: 'observed production, ~164c' },
  'Seed Phrase 24 words':      { val: 'abandon ability able about above absent absorb abstract absurd abuse access accident abandon ability able about above absent absorb abstract absurd abuse access accident', realChars: 167, category: 'Crypto', src: 'BIP39 24 words, typical ~145-167c' },
  'SSH Ed25519':               { val: '-----BEGIN OPENSSH PRIVATE KEY-----\n' + 'b3BlbnNzaC1rZXktdjEAAAAA' + 'BG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAA\n'.repeat(5).slice(0, 320) + '\n-----END OPENSSH PRIVATE KEY-----', realChars: 400, category: 'SSH Key', src: 'RFC 8709: 32+32 byte keys + OpenSSH PEM ~400c' },
  'JWT RS256 typical':         { val: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xMjM0NTYifQ.eyJzdWIiOiJ1c2VyfDEyMzQ1Njc4OTAiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpYXQiOjE1MTYyMz90MDB9.' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.repeat(5).slice(0, 342), realChars: 780, category: 'JWT', src: 'RFC 7519 + RS256 = 256-byte sig, Auth0 typical' },
  'SSH RSA-4096 (PKCS#1)':     { val: '-----BEGIN RSA PRIVATE KEY-----\n' + 'MIIJKAIBAAKCAQEAfakeRSAKey'.repeat(120).slice(0, 3150) + '\n-----END RSA PRIVATE KEY-----', realChars: 3243, category: 'SSH Key', src: '~2349 byte DER + base64 + RFC 7468 headers' },
  'TLS Chain (leaf+int+root)': { val: ('-----BEGIN CERTIFICATE-----\n' + 'MIIFfakeCertChain=='.repeat(60).slice(0, 1580) + '\n-----END CERTIFICATE-----\n').repeat(3).trim(), realChars: 4921, category: 'TLS/Cert', src: 'LE R3 chain: 1950+1631+1338 = 4921c' },
}

for (const s of Object.values(SECRETS)) {
  s.chars  = s.realChars
  s.tokens = T(s.val)
}

// ─── Zocket overhead ─────────────────────────────────────────────────────────

const ZOCKET = {
  eagerTools: T([
    'list_projects: List all projects. name description secret_count folder_path. No values. {}',
    'list_project_keys: List secret key names. Values never returned. {project:string}',
    'run_with_project_env: Run command with secrets as env vars. $VAR substituted server-side. output_filter:jq max_chars:int. {project,command,max_chars,output_filter}',
    'run_script: Run inline node script with secrets as env. One script instead of many calls. Filesystem NOT shared. Values never in conversation. {project,lang,code,max_chars}',
    'env_keys: List key names in .env file. Values never returned. {path}',
    'env_set: Insert or update key=value in .env. Creates if missing. {path,key,value}',
    'get_exec_policy: Get execution policy. {}',
  ].join('\n')),
  lazyTools: T([
    'list_tools_summary: List available tools with short descriptions. Call activate_tool to unlock. {query?}',
    'activate_tool: Register a tool by name. Call list_tools_summary first. {name}',
  ].join('\n')),
  systemEN: T('Zocket MCP — encrypted vault + safe command runner. Secret values never returned. Use run_with_project_env or run_script with $VAR placeholders. Filesystem NOT shared between calls. Use max_chars:200 for status checks. Prefer run_script over multiple sequential calls.'),
  systemRU: T('Zocket MCP — зашифрованное хранилище и безопасный запуск команд. Значения секретов никогда не возвращаются. Используйте run_with_project_env или run_script с заполнителями $VAR. Файловая система НЕ разделена между вызовами. Используйте max_chars:200 для проверки статуса.'),
  gitStatus: T('gitStatus: branch:main Status: modified src/ commits: abc1234 feat: add module'),
  toolCall: T('list_project_keys {project:p}') + T('{"keys":["KEY"]}') +
            T('run_script {project:p,lang:node,code:"require(\'fs\').writeFileSync(\'.env\',\'KEY=\'+process.env.KEY)"}') +
            T('{"exit_code":0}'),
  useMsg:   T('Use the secret from zocket project to create .env file'),
  useReply: T('Done — .env created with KEY from vault.'),
}

const FIXED_MANUAL    = 6
const FIXED_EAGER_EN  = ZOCKET.eagerTools + ZOCKET.systemEN + ZOCKET.gitStatus
const FIXED_EAGER_RU  = ZOCKET.eagerTools + ZOCKET.systemRU + ZOCKET.gitStatus
const FIXED_LAZY_EN   = ZOCKET.lazyTools  + ZOCKET.systemEN + ZOCKET.gitStatus
const FIXED_LAZY_RU   = ZOCKET.lazyTools  + ZOCKET.systemRU + ZOCKET.gitStatus

const LAZY_SAVING_RATIO = FIXED_EAGER_EN / FIXED_LAZY_EN

const MSG = {
  enUser:  T('Help me with the next task please'),
  enReply: T('Sure! Here is the result. Done.'),
  ruUser:  T('Помоги мне со следующей задачей пожалуйста'),
  ruReply: T('Конечно! Вот результат. Готово.'),
}

const CYR_RATIO = (MSG.ruUser + MSG.ruReply) / (MSG.enUser + MSG.enReply)

function calcMultipliers(pairs) {
  let totalEn = 0
  let totalRu = 0
  let ratios = []
  for (const p of pairs) {
    const enTok = T(p.en)
    const ruTok = T(p.ru)
    totalEn += enTok
    totalRu += ruTok
    ratios.push(ruTok / enTok)
  }
  return {
    count: pairs.length,
    totalEn,
    totalRu,
    overall: totalRu / totalEn,
    mean: ratios.reduce((a, b) => a + b, 0) / ratios.length,
  }
}

const BASE_PAIRS = [
  {
    key: 'System prompt',
    en: 'Zocket MCP — encrypted vault + safe command runner. Secret values never returned. Use run_with_project_env or run_script with $VAR placeholders. Filesystem NOT shared between calls. Use max_chars:200 for status checks. Prefer run_script over multiple sequential calls.',
    ru: 'Zocket MCP — зашифрованное хранилище и безопасный запуск команд. Значения секретов никогда не возвращаются. Используйте run_with_project_env или run_script с заполнителями $VAR. Файловая система НЕ разделена между вызовами. Используйте max_chars:200 для проверки статуса.',
  },
  { key: 'Avg user message', en: 'Help me with the next task please', ru: 'Помоги мне со следующей задачей пожалуйста' },
  { key: 'Avg assistant reply', en: 'Sure! Here is the result. Done.', ru: 'Конечно! Вот результат. Готово.' },
]

const TEMPLATE_PAIRS = [
  { key: 'Manual msg template', en: 'Create .env with KEY=$VALUE', ru: 'Создай .env файл с KEY=$VALUE' },
  { key: 'Manual reply template', en: 'Done. .env created:\nKEY=$VALUE', ru: 'Готово. .env создан:\nKEY=$VALUE' },
]

const FULL_PAIRS = [
  ...BASE_PAIRS,
  ...Object.entries(SECRETS).flatMap(([name, s]) => {
    const enMsg = `Create .env with KEY=${s.val}`
    const ruMsg = `Создай .env файл с KEY=${s.val}`
    const enRep = `Done. .env created:\nKEY=${s.val}`
    const ruRep = `Готово. .env создан:\nKEY=${s.val}`
    return [
      { key: `Manual msg — ${name}`, en: enMsg, ru: ruMsg },
      { key: `Manual reply — ${name}`, en: enRep, ru: ruRep },
    ]
  }),
]

const TEXT_ONLY_PAIRS = [...BASE_PAIRS, ...TEMPLATE_PAIRS]
const MULT_FULL = calcMultipliers(FULL_PAIRS)
const MULT_TEXT = calcMultipliers(TEXT_ONLY_PAIRS)

for (const s of Object.values(SECRETS)) {
  s._manualMsgEN  = T(`Create .env with KEY=${s.val}`)
  s._manualMsgRU  = T(`Создай .env файл с KEY=${s.val}`)
  s._manualRepEN  = T(`Done. .env created:\nKEY=${s.val}`)
  s._manualRepRU  = T(`Готово. .env создан:\nKEY=${s.val}`)
}

const SECRET_EVERY = 5

// ─── Simulation ───────────────────────────────────────────────────────────────

function simulate(secret, lang, fixedPerCall, zocket, turns) {
  const isRU     = lang === 'ru'
  const avgMsg   = isRU ? MSG.ruUser  : MSG.enUser
  const avgReply = isRU ? MSG.ruReply : MSG.enReply
  let history = 0, total = 0, leakTax = 0
  for (let n = 1; n <= turns; n++) {
    const isSecret = n % SECRET_EVERY === 0
    let userMsg, replyTok
    if (isSecret && zocket) {
      userMsg  = ZOCKET.useMsg
      replyTok = ZOCKET.toolCall + ZOCKET.useReply
    } else if (isSecret && !zocket) {
      userMsg  = isRU ? secret._manualMsgRU : secret._manualMsgEN
      replyTok = isRU ? secret._manualRepRU : secret._manualRepEN
      leakTax += secret.tokens * 2
    } else {
      userMsg  = avgMsg
      replyTok = avgReply
    }
    total   += fixedPerCall + history + userMsg
    history += userMsg + replyTok
  }
  return { total, leakTax }
}

function breakEven(secret, fixedM, fixedZ) {
  let hM = 0, hZ = 0, tM = 0, tZ = 0
  for (let n = 1; n <= 500; n++) {
    const isSec = n % SECRET_EVERY === 0
    const mMsg = isSec ? secret._manualMsgEN : MSG.enUser
    const zMsg = isSec ? ZOCKET.useMsg       : MSG.enUser
    tM += fixedM + hM + mMsg
    tZ += fixedZ + hZ + zMsg
    hM += mMsg + (isSec ? secret._manualRepEN : MSG.enReply)
    hZ += zMsg + (isSec ? ZOCKET.toolCall + ZOCKET.useReply : MSG.enReply)
    if (n >= 2 && tZ <= tM) return n
  }
  return null
}

// ─── Security confirmation token overhead ────────────────────────────────────

const SEC_CONFIRM_RESP = T(JSON.stringify({
  requires_confirmation: true,
  risk: 'medium',
  findings: [{ pattern: 'SUSPICIOUS_DOMAIN', description: 'Secret sent to a domain that does not match the known API for this project (semantic mismatch)', severity: 'medium' }],
}))
const SEC_AI_CONFIRM         = T('Security check flagged this as medium risk (SUSPICIOUS_DOMAIN). The command will be confirmed and retried with explicit approval.')
const SEC_CONFIRM_CALL_EXTRA = T('"confirm":true')
const SEC_CONFIRM_OVERHEAD   = SEC_CONFIRM_RESP + SEC_AI_CONFIRM + ZOCKET.toolCall + SEC_CONFIRM_CALL_EXTRA
const FIXED_SEC_EN           = FIXED_EAGER_EN  // security runs server-side, same tools

function simulateSec(secret, lang, fixedPerCall, turns, confirmRate = 1.0) {
  const isRU     = lang === 'ru'
  const avgMsg   = isRU ? MSG.ruUser  : MSG.enUser
  const avgReply = isRU ? MSG.ruReply : MSG.enReply
  const extraPerUse = Math.round(SEC_CONFIRM_OVERHEAD * confirmRate)
  let history = 0, total = 0
  for (let n = 1; n <= turns; n++) {
    const isSecret = n % SECRET_EVERY === 0
    let userMsg, replyTok
    if (isSecret) {
      userMsg  = ZOCKET.useMsg
      replyTok = ZOCKET.toolCall + ZOCKET.useReply + extraPerUse
    } else {
      userMsg  = avgMsg
      replyTok = avgReply
    }
    total += fixedPerCall + history + userMsg
    history += userMsg + replyTok
  }
  return { total }
}

// ─── Compute all data ─────────────────────────────────────────────────────────

const results = []

for (const [name, s] of Object.entries(SECRETS)) {
  const beEager = breakEven(s, FIXED_MANUAL, FIXED_EAGER_EN)
  const beLazy  = breakEven(s, FIXED_MANUAL, FIXED_LAZY_EN)

  for (const turns of [1, 10, 25, 50]) {
    const manEN   = simulate(s, 'en', FIXED_MANUAL,    false, turns)
    const eagerEN = simulate(s, 'en', FIXED_EAGER_EN,  true,  turns)
    const lazyEN  = simulate(s, 'en', FIXED_LAZY_EN,   true,  turns)
    const manRU   = simulate(s, 'ru', FIXED_MANUAL,    false, turns)
    const eagerRU = simulate(s, 'ru', FIXED_EAGER_RU,  true,  turns)
    const lazyRU  = simulate(s, 'ru', FIXED_LAZY_EN,   true,  turns)  // system prompt EN
    const sec20EN  = simulateSec(s, 'en', FIXED_SEC_EN,  turns, 0.2).total
    const sec100EN = simulateSec(s, 'en', FIXED_SEC_EN,  turns, 1.0).total
    const sec20RU  = simulateSec(s, 'ru', FIXED_SEC_EN,  turns, 0.2).total
    const sec100RU = simulateSec(s, 'ru', FIXED_SEC_EN,  turns, 1.0).total

    results.push({
      name,
      category:    s.category,
      chars:       s.chars,
      tokens:      s.tokens,
      turns,
      // EN
      manual_en:   manEN.total,
      eager_en:    eagerEN.total,
      lazy_en:     lazyEN.total,
      sec20_en:    sec20EN,
      sec100_en:   sec100EN,
      leak_tax_en: manEN.leakTax,
      diff_eager_en: eagerEN.total - manEN.total,
      diff_lazy_en:  lazyEN.total  - manEN.total,
      // RU
      manual_ru:   manRU.total,
      eager_ru:    eagerRU.total,
      lazy_ru:     lazyRU.total,
      sec20_ru:    sec20RU,
      sec100_ru:   sec100RU,
      leak_tax_ru: manRU.leakTax,
      // break-even
      break_even_eager: beEager ?? '>500',
      break_even_lazy:  beLazy  ?? '>500',
    })
  }
}

// ─── CSV export ───────────────────────────────────────────────────────────────

const csvHeaders = [
  'name', 'category', 'chars', 'tokens', 'turns',
  'manual_en', 'eager_en', 'lazy_en', 'leak_tax_en', 'diff_eager_en', 'diff_lazy_en',
  'sec20_en', 'sec100_en',
  'manual_ru', 'eager_ru', 'lazy_ru', 'leak_tax_ru',
  'sec20_ru', 'sec100_ru',
  'break_even_eager', 'break_even_lazy',
]

const csvRows = [csvHeaders.join(',')]
for (const r of results) {
  csvRows.push(csvHeaders.map(h => JSON.stringify(r[h] ?? '')).join(','))
}

// Overhead table CSV
const overheadCsv = [
  'mode,lang,fixed_per_call_tokens',
  `manual,en,${FIXED_MANUAL}`,
  `manual,ru,${FIXED_MANUAL}`,
  `eager,en,${FIXED_EAGER_EN}`,
  `eager,ru,${FIXED_EAGER_RU}`,
  `lazy,en,${FIXED_LAZY_EN}`,
  `lazy,ru,${FIXED_LAZY_RU}`,
].join('\n')

const csvPath = join(__dir, '..', 'benchmark-results.csv')
writeFileSync(csvPath, csvRows.join('\n'))
console.log(`✓ CSV written: ${csvPath}`)

const overheadPath = join(__dir, '..', 'benchmark-overhead.csv')
writeFileSync(overheadPath, overheadCsv)
console.log(`✓ Overhead CSV written: ${overheadPath}`)

// ─── HTML report ─────────────────────────────────────────────────────────────

// Build data for charts
const secretNames = Object.keys(SECRETS)
const secretTokens = secretNames.map(n => SECRETS[n].tokens)

// 50-turn EN comparison data
const data50 = secretNames.map(name => {
  const r = results.find(r => r.name === name && r.turns === 50)
  return r
})

const manualData50   = data50.map(r => r.manual_en)
const eagerData50    = data50.map(r => r.eager_en)
const lazyData50     = data50.map(r => r.lazy_en)

// Break-even data
const beEagerData = secretNames.map(name => {
  const r = results.find(r => r.name === name && r.turns === 50)
  return typeof r.break_even_eager === 'number' ? r.break_even_eager : 510
})
const beLazyData = secretNames.map(name => {
  const r = results.find(r => r.name === name && r.turns === 50)
  return typeof r.break_even_lazy === 'number' ? r.break_even_lazy : 510
})

// ─── Scenario: Auto-compacting ───────────────────────────────────────────────

const COMPACT_RATIO  = 0.15
const COMPACT_PHASE1 = 50
const COMPACT_PHASE2 = 50

const TOOL_CALL_TOKENS = T('list_project_keys {project:p}') + T('{"keys":["KEY"]}') +
  T('run_script {project:p,lang:node,code:"require(\'fs\').writeFileSync(\'.env\',\'KEY=\'+process.env.KEY)"}') +
  T('{"exit_code":0}')
const TOOL_USE_MSG_T   = T('Use the secret from zocket project to create .env file')
const TOOL_USE_REP_T   = T('Done — .env created with KEY from vault.')
const SECRET_EVERY_SC  = 5

// Re-use SECRETS but add scenario-specific cache
for (const s of Object.values(SECRETS)) {
  s._scMsg = T(`Create .env with KEY=${s.val}`)
  s._scRep = T(`Done. .env created:\nKEY=${s.val}`)
}

function simCompact(secret, fixedPerCall, zocket) {
  function phase(hStart, turns) {
    let h = hStart, total = 0
    for (let n = 1; n <= turns; n++) {
      const isSec = n % SECRET_EVERY_SC === 0
      let uMsg, rep
      if (isSec && zocket)  { uMsg = TOOL_USE_MSG_T; rep = TOOL_CALL_TOKENS + TOOL_USE_REP_T }
      else if (isSec)       { uMsg = secret._scMsg;  rep = secret._scRep }
      else                  { uMsg = MSG.enUser;     rep = MSG.enReply }
      total += fixedPerCall + h + uMsg
      h += uMsg + rep
    }
    return { total, history: h }
  }
  const p1 = phase(0, COMPACT_PHASE1)
  const p2 = phase(Math.round(p1.history * COMPACT_RATIO), COMPACT_PHASE2)
  return { p1: p1.total, p2: p2.total, grand: p1.total + p2.total }
}

// Compact chart: 4 representative secrets (labels computed after shortLabels)
const COMPACT_SECRETS = ['JWT RS256 typical', 'SSH Ed25519', 'SSH RSA-4096 (PKCS#1)', 'TLS Chain (leaf+int+root)']
const compactData = Object.fromEntries(COMPACT_SECRETS.map(n => [n, simCompact(SECRETS[n], FIXED_MANUAL, false)]))
const compactDataZ = Object.fromEntries(COMPACT_SECRETS.map(n => [n, simCompact(SECRETS[n], FIXED_LAZY_EN, true)]))

// ─── Scenario: Mid-session injection ─────────────────────────────────────────

const MIDSESS_TOTAL  = 100
const INJECT_POINTS  = [1, 10, 25, 50, 75]

function simMidSession(secret, fixedPerCall, zocket, totalTurns, injectAt) {
  let h = 0, total = 0
  for (let n = 1; n <= totalTurns; n++) {
    const active     = n >= injectAt
    const sinceInj   = n - injectAt
    const isFirstUse = n === injectAt
    const isRepeated = active && sinceInj > 0 && sinceInj % SECRET_EVERY_SC === 0
    const isSecret   = isFirstUse || isRepeated
    let uMsg, rep
    if (isSecret && zocket)  { uMsg = TOOL_USE_MSG_T; rep = TOOL_CALL_TOKENS + TOOL_USE_REP_T }
    else if (isSecret)       { uMsg = secret._scMsg;  rep = secret._scRep }
    else                     { uMsg = MSG.enUser;     rep = MSG.enReply }
    total += fixedPerCall + h + uMsg
    h += uMsg + rep
  }
  return total
}

// Mid-session chart: JWT and RSA only (most dramatic)
const MIDSESS_SECRETS = ['JWT RS256 typical', 'SSH RSA-4096 (PKCS#1)']

const VERDICTS = {
  'Weak Password (example)':   '✗ No',
  'API Key OpenAI (sk-proj-)': '△ Maybe',
  'Seed Phrase 24 words':      '⚠ Always',
  'JWT RS256 typical':         '✓ Yes',
  'SSH Ed25519':               '✓ Yes',
  'SSH RSA-4096 (PKCS#1)':     '✓✓ Yes!',
  'TLS Chain (leaf+int+root)': '✓✓ Yes!',
}

const NOTES = {
  'Weak Password (example)':   'Overhead never pays off. Pass directly in shell env.',
  'API Key OpenAI (sk-proj-)': 'Long key (~164c). Break-even far, but security matters.',
  'JWT RS256 typical':         '~780c → break-even ~11msg. Long sessions — Zocket wins.',
  'SSH Ed25519':               '~400c → break-even ~19msg. Recommended.',
  'SSH RSA-4096 (PKCS#1)':     '~3243c → break-even ~6msg. Zocket saves 10× at 50msg.',
  'TLS Chain (leaf+int+root)': '~4921c → break-even ~7msg. Colossal overhead if leaked.',
  'Seed Phrase 24 words':      'Same. Financial damage is not measured in tokens.',
}

function verdictColor(v) {
  if (v.startsWith('✓✓')) return '#10b981'
  if (v.startsWith('✓'))  return '#34d399'
  if (v.startsWith('△'))  return '#f59e0b'
  if (v.startsWith('⚠'))  return '#ef4444'
  return '#6b7280'
}

// Line chart data: token cost vs turns for selected secrets
const selectedSecrets = ['JWT RS256 typical', 'SSH RSA-4096 (PKCS#1)', 'SSH Ed25519', 'API Key OpenAI (sk-proj-)']
const turnPoints = [5, 10, 15, 20, 25, 30, 40, 50]
const lineData = {}
for (const name of selectedSecrets) {
  const s = SECRETS[name]
  lineData[name] = {
    manual:  turnPoints.map(t => simulate(s, 'en', FIXED_MANUAL,   false, t).total),
    eager:   turnPoints.map(t => simulate(s, 'en', FIXED_EAGER_EN, true,  t).total),
    lazy:    turnPoints.map(t => simulate(s, 'en', FIXED_LAZY_EN,  true,  t).total),
    sec20:   turnPoints.map(t => simulateSec(s, 'en', FIXED_SEC_EN, t, 0.2).total),
    sec100:  turnPoints.map(t => simulateSec(s, 'en', FIXED_SEC_EN, t, 1.0).total),
  }
}

// Security mode data for 50-turn comparison
const sec50 = secretNames.map(name => {
  const s   = SECRETS[name]
  const s1  = simulateSec(s, 'en', FIXED_SEC_EN, 50, 1.0).total
  const s2  = simulateSec(s, 'en', FIXED_SEC_EN, 50, 0.2).total
  const sRu1 = simulateSec(s, 'ru', FIXED_SEC_EN, 50, 1.0).total
  const sRu2 = simulateSec(s, 'ru', FIXED_SEC_EN, 50, 0.2).total
  return { name, sec100en: s1, sec20en: s2, sec100ru: sRu1, sec20ru: sRu2 }
})

// Table rows for all 50-turn results
const tableRows50 = secretNames.map(name => {
  const s = SECRETS[name]
  const r = results.find(r => r.name === name && r.turns === 50)
  const sd = sec50.find(x => x.name === name)
  const verdict = VERDICTS[name]
  const vc = verdictColor(verdict)
  const beE = r.break_even_eager
  const beL = r.break_even_lazy
  const savings = r.manual_en - r.lazy_en
  const secOverEager = sd.sec100en - r.eager_en
  return `<tr>
    <td class="name">${name}</td>
    <td class="tag">${s.category}</td>
    <td>${s.chars}</td>
    <td>${s.tokens}</td>
    <td>${r.manual_en.toLocaleString()}</td>
    <td>${r.eager_en.toLocaleString()}</td>
    <td>${r.lazy_en.toLocaleString()}</td>
    <td style="color:#f59e0b">${sd.sec20en.toLocaleString()}</td>
    <td style="color:#ef4444">${sd.sec100en.toLocaleString()}</td>
    <td class="${savings > 0 ? 'pos' : 'neg'}">${savings > 0 ? '−' : '+'}${Math.abs(savings).toLocaleString()}</td>
    <td>${beE === '>500' ? '>500' : beE}</td>
    <td>${beL === '>500' ? '>500' : beL}</td>
    <td style="color:${vc};font-weight:600">${verdict}</td>
  </tr>`
}).join('\n')

// Short labels for charts
const shortLabels = secretNames.map(n =>
  n.replace('Weak Password (example)', 'Weak Pass.')
  .replace('API Key OpenAI (sk-proj-)', 'API OpenAI')
  .replace('JWT RS256 typical', 'JWT RS256')
  .replace('SSH Ed25519', 'SSH Ed25519')
  .replace('SSH RSA-4096 (PKCS#1)', 'SSH RSA-4096')
   .replace('TLS Chain (leaf+int+root)', 'TLS Chain')
   .replace('Seed Phrase 24 words', 'Seed 24w')
)

// Compact chart arrays (now that shortLabels is available)
const compactLabels = COMPACT_SECRETS.map(n => shortLabels[secretNames.indexOf(n)])
const compactManual = COMPACT_SECRETS.map(n => compactData[n].grand)
const compactLazy   = COMPACT_SECRETS.map(n => compactDataZ[n].grand)
const compactManP1  = COMPACT_SECRETS.map(n => compactData[n].p1)
const compactManP2  = COMPACT_SECRETS.map(n => compactData[n].p2)
const compactLazP1  = COMPACT_SECRETS.map(n => compactDataZ[n].p1)
const compactLazP2  = COMPACT_SECRETS.map(n => compactDataZ[n].p2)

// Mid-session chart arrays
const midsessManual = MIDSESS_SECRETS.map(n =>
  INJECT_POINTS.map(t => simMidSession(SECRETS[n], FIXED_MANUAL,   false, MIDSESS_TOTAL, t))
)
const midsessLazy = MIDSESS_SECRETS.map(n =>
  INJECT_POINTS.map(t => simMidSession(SECRETS[n], FIXED_LAZY_EN,  true,  MIDSESS_TOTAL, t))
)

const lineChartDatasets = selectedSecrets.flatMap((name, i) => {
  const colors = [
    ['#006699', '#0088cc', '#00a1ff', '#7ecbff', '#bfe7ff'],
    ['#6f7bff', '#8aa0ff', '#a9baff', '#c7d2ff', '#e3e8ff'],
    ['#20c997', '#3ddcab', '#79e6c2', '#b8f2dd', '#e6fbf2'],
    ['#f59e0b', '#f7b648', '#f9cc7b', '#fce3b4', '#fef3dd'],
  ][i]
  return [
    { label: `${name} Manual`,   data: lineData[name].manual,  borderColor: colors[0], backgroundColor: 'transparent', borderWidth: 2, borderDash: [] },
    { label: `${name} Eager`,    data: lineData[name].eager,   borderColor: colors[1], backgroundColor: 'transparent', borderWidth: 2, borderDash: [6,3] },
    { label: `${name} Lazy`,     data: lineData[name].lazy,    borderColor: colors[2], backgroundColor: 'transparent', borderWidth: 1, borderDash: [2,2] },
    { label: `${name} Sec-20%`,  data: lineData[name].sec20,   borderColor: colors[3], backgroundColor: 'transparent', borderWidth: 1, borderDash: [4,2] },
    { label: `${name} Sec-100%`, data: lineData[name].sec100,  borderColor: colors[4], backgroundColor: 'transparent', borderWidth: 1, borderDash: [1,2] },
  ]
})

// ─── Security benchmark data ─────────────────────────────────────────────────

console.log('Running security benchmark (npx tsx benchmark-security.ts --json)…')
const secRaw = spawnSync('npx', ['tsx', 'scripts/benchmark-security.ts', '--json'], {
  cwd: join(__dir, '..'),
  encoding: 'utf8',
  timeout: 120_000,
})
if (secRaw.error || secRaw.status !== 0) {
  console.error('Security benchmark failed:', secRaw.error ?? secRaw.stderr)
  process.exit(1)
}
const sec = JSON.parse(secRaw.stdout)
console.log(`✓ Security: ${sec.totalPass}/${sec.totalPass + sec.totalFail} tests pass, F1=${(sec.domain.f1*100).toFixed(0)}%`)

// Helpers for security HTML
const RISK_COLORS = { critical:'#ff6b6b', high:'#ff9f43', medium:'#f59e0b', low:'#20c997', none:'#9aa5b1' }
const riskBadge = r => `<span style="background:${RISK_COLORS[r]||'#9aa5b1'};color:#fff;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700">${r.toUpperCase()}</span>`
const passMark  = p => p ? '<span style="color:#20c997;font-weight:700">PASS</span>' : '<span style="color:#ff6b6b;font-weight:700">FAIL</span>'

const secDetectionRows = sec.detection.map(r => `<tr style="background:${r.pass?'rgba(32,201,151,.08)':'rgba(255,107,107,.08)'}">
  <td style="text-align:left"><span class="tag">${r.id}</span></td>
  <td style="text-align:left;color:var(--text2);font-size:0.78rem">${r.category}</td>
  <td style="text-align:left">${r.scenario}</td>
  <td style="text-align:left"><code style="font-size:0.75rem;color:var(--text3)">${r.mode}</code></td>
  <td>${r.allowed ? '✓' : '✗'}</td>
  <td>${riskBadge(r.risk)}</td>
  <td style="text-align:left">${r.rules.map(x => `<code style="font-size:0.75rem;background:var(--bg3);padding:1px 5px;border-radius:3px">${x}</code>`).join(' ') || '—'}</td>
  <td>${passMark(r.pass)}${r.failures.length ? `<br><small style="color:#ef4444">${r.failures.join('<br>')}</small>` : ''}</td>
</tr>`).join('\n')

const secRuleRows = sec.ruleCounts.map(({rule, count}) => {
  const pct = ((count / (sec.totalPass + sec.totalFail)) * 100).toFixed(0)
  const w   = Math.round((count / sec.ruleCounts[0].count) * 160)
  return `<tr><td style="text-align:left"><code style="font-size:0.8rem;background:var(--bg3);padding:2px 7px;border-radius:3px">${rule}</code></td><td>${count}</td><td>${pct}%</td>
  <td><div style="background:var(--blue);height:10px;border-radius:3px;width:${w}px"></div></td></tr>`
}).join('\n')

const secDomainRows = sec.domain.rows.map(row => {
  const resColor = row.result === 'MISMATCH' ? 'var(--red)' : row.result === 'ok' ? 'var(--green)' : 'var(--text3)'
  return `<tr style="background:${row.pass?'rgba(16,185,129,.05)':'rgba(239,68,68,.05)'}">
    <td style="text-align:left">${row.label}</td>
    <td><code style="font-size:0.75rem">${row.expected}</code></td>
    <td style="color:${resColor};font-weight:700">${row.result}</td>
    <td>${passMark(row.pass)}</td>
  </tr>`
}).join('\n')

const secRegistryRows = sec.registryByCategory.map(({cat, providers, domains, keywords}) => {
  const w = Math.round((providers / sec.registry.totalProviders) * 160)
  return `<tr>
    <td style="text-align:left">${cat}</td>
    <td>${providers}</td><td>${domains}</td><td>${keywords}</td>
    <td><div style="background:var(--purple);height:10px;border-radius:3px;width:${w}px"></div></td>
  </tr>`
}).join('\n')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Zocket MCP — Token Benchmark Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #ffffff;
    --bg2: #f8f9fa;
    --bg3: #eef2f6;
    --card: #ffffff;
    --text: #2c2c2c;
    --text2: #6c757d;
    --text3: #9aa5b1;
    --green: #20c997;
    --yellow: #f59e0b;
    --red: #ff6b6b;
    --blue: #0088cc;
    --purple: #4f46e5;
    --border: rgba(0, 0, 0, 0.08);
    --shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    --primary: #0088cc;
    --primary-dark: #006699;
    --primary-light: rgba(0, 136, 204, 0.1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: linear-gradient(180deg, #f5f8fb 0%, #ffffff 55%); color: var(--text); font-family: 'Inter', system-ui, sans-serif; line-height: 1.6; }
  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header { background: linear-gradient(135deg, #007ab8 0%, #0088cc 45%, #00a1ff 100%); padding: 56px 24px; text-align: center; border-bottom: 1px solid rgba(0, 136, 204, 0.2); color: #fff; }
  header h1 { font-size: clamp(1.6rem, 4vw, 2.8rem); font-weight: 800; color: #fff; }
  header p { color: rgba(255, 255, 255, 0.85); margin-top: 8px; font-size: 1rem; }
  .badges { display: flex; gap: 8px; justify-content: center; margin-top: 16px; flex-wrap: wrap; }
  .badge { background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.35); border-radius: 999px; padding: 4px 14px; font-size: 0.75rem; color: #fff; }
  .lang-toggle { display: flex; gap: 6px; justify-content: center; margin-top: 14px; }
  .lang-toggle a { padding: 4px 10px; border-radius: 999px; font-size: 0.72rem; border: 1px solid rgba(255, 255, 255, 0.6); color: #fff; text-decoration: none; opacity: 0.7; }
  .lang-toggle a.active { opacity: 1; background: rgba(255, 255, 255, 0.22); }

  .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 32px 0; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; text-align: center; box-shadow: var(--shadow); }
  .stat-card .value { font-size: 2rem; font-weight: 700; line-height: 1; }
  .stat-card .label { font-size: 0.78rem; color: var(--text2); margin-top: 6px; }

  section { margin: 48px 0; }
  h2 { font-size: 1.4rem; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
  h2 .num { background: var(--primary); color: white; border-radius: 6px; padding: 2px 10px; font-size: 0.85rem; font-weight: 600; }
  h3 { font-size: 1rem; font-weight: 600; color: var(--text2); margin-bottom: 12px; }

  .chart-wrap { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow); }
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 768px) { .chart-row { grid-template-columns: 1fr; } }
  canvas { max-height: 360px; }

  .table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--border); background: var(--card); box-shadow: var(--shadow); }
  .table-wrap.wide { overflow-x: visible; }
  table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
  thead th { background: var(--bg2); padding: 10px 12px; text-align: right; white-space: nowrap; font-weight: 600; color: var(--text2); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  thead th:first-child, thead th:nth-child(2) { text-align: left; }
  tbody tr { border-top: 1px solid var(--border); transition: background 0.15s; }
  tbody tr:hover { background: #f3f6fb; }
  tbody td { padding: 9px 12px; text-align: right; }
  tbody td.name { text-align: left; font-weight: 500; white-space: nowrap; }
  tbody td.tag { text-align: left; }
  .tag { display: inline-block; background: var(--primary-light); border-radius: 4px; padding: 2px 8px; font-size: 0.72rem; color: var(--primary-dark); white-space: nowrap; }
  td.pos { color: var(--green); }
  td.neg { color: var(--red); }

  .overhead-table { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 640px) { .overhead-table { grid-template-columns: 1fr; } }
  .overhead-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; box-shadow: var(--shadow); }
  .overhead-card h4 { font-size: 0.9rem; font-weight: 600; margin-bottom: 12px; color: var(--text2); }
  .overhead-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
  .overhead-row:last-child { border: none; }
  .overhead-row .tok { font-weight: 700; color: var(--yellow); }

  .insight-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .insight { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; box-shadow: var(--shadow); }
  .insight .title { font-weight: 600; font-size: 0.9rem; margin-bottom: 8px; }
  .insight p { font-size: 0.83rem; color: var(--text2); }

  .rec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
  .rec-item { background: var(--card); border-radius: 8px; padding: 12px 16px; display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--border); box-shadow: var(--shadow); }
  .rec-item .verdict { font-size: 0.85rem; font-weight: 700; min-width: 70px; }
  .rec-item .desc { font-size: 0.82rem; color: var(--text2); }
  .rec-item .secret-name { font-size: 0.85rem; font-weight: 500; margin-bottom: 2px; }

  .calc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 900px) { .calc-grid { grid-template-columns: 1fr; } }
  .calc-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; box-shadow: var(--shadow); }
  .calc-head { font-weight: 700; font-size: 0.95rem; margin-bottom: 10px; }
  .calc-row { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; margin-bottom: 10px; }
  .calc-row label { font-size: 0.78rem; color: var(--text2); }
  .calc-row select { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .calc-row:last-child { margin-bottom: 0; }
  .calc-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .calc-table th { text-align: left; padding: 10px 12px; background: var(--bg2); color: var(--text2); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .calc-table td { padding: 9px 12px; border-top: 1px solid var(--border); }
  .calc-table td.num { text-align: right; }
  .calc-note { font-size: 0.78rem; color: var(--text3); margin-top: 8px; }

  footer { text-align: center; padding: 32px 24px; border-top: 1px solid var(--border); color: var(--text3); font-size: 0.8rem; margin-top: 64px; background: var(--bg2); }
  footer a { color: var(--primary-dark); }

  .row-good { background: rgba(32, 201, 151, 0.08); }
  .row-warn { background: rgba(245, 158, 11, 0.08); }

  .compact-table { table-layout: fixed; width: 100%; }
  .compact-table thead th { white-space: normal; }
  .compact-table td, .compact-table th { padding: 6px 8px; font-size: 0.72rem; }
  .compact-table td { word-break: break-word; }
  .compact-table .name { white-space: normal; }
</style>
</head>
<body>
<header>
  <div class="container">
    <h1 data-i18n="title">Zocket MCP — Benchmark Report</h1>
    <p data-i18n="subtitle">Token efficiency · Security detection · API registry · Performance</p>
    <div class="badges">
      <span class="badge" id="badge-date">📅 2026-03-12</span>
      <span class="badge" id="badge-bpe">🔤 BPE cl100k_base (Claude Code / Codex)</span>
      <span class="badge" id="badge-secrets">🔐 ${secretNames.length} secret types</span>
      <span class="badge" id="badge-lang">💬 EN + RU analysis</span>
      <span class="badge" id="badge-sec">🛡 ${sec.totalPass}/${sec.totalPass + sec.totalFail} security tests pass</span>
      <span class="badge" id="badge-api">🌐 ${sec.registry.totalProviders} API providers</span>
    </div>
    <div class="lang-toggle">
      <a href="?lang=en" id="lang-en">EN</a>
      <a href="?lang=ru" id="lang-ru">RU</a>
    </div>
  </div>
</header>

<div class="container">

  <div class="stats-grid">
    <div class="stat-card">
      <div class="value" style="color:var(--purple)">${secretNames.length}</div>
      <div class="label" data-i18n="stat.secret_types">Secret types analyzed</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--blue)">${LAZY_SAVING_RATIO.toFixed(2)}×</div>
      <div class="label" data-i18n="stat.lazy_saving">Less tokens with Lazy mode (vs Eager)</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--green)">~6</div>
      <div class="label" data-i18n="stat.break_even">Messages to break-even (RSA-4096)</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--yellow)">${MULT_TEXT.overall.toFixed(2)}×</div>
      <div class="label" data-i18n="stat.cyrillic_overhead">Cyrillic token overhead vs Latin</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--red)">743k</div>
      <div class="label" data-i18n="stat.manual_tokens">Manual tokens (RSA-4096, 50 turns)</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color:var(--green)">37k</div>
      <div class="label" data-i18n="stat.lazy_tokens">Zocket Lazy tokens (same scenario)</div>
    </div>
  </div>

  <!-- Section 1: Overhead breakdown -->
  <section>
    <h2><span class="num">1</span> <span data-i18n="s1.title">Zocket Overhead Per API Call</span></h2>
    <div class="overhead-table">
      <div class="overhead-card">
        <h4 data-i18n="s1.fixed_overhead">Fixed overhead per call (tokens)</h4>
        <div class="overhead-row"><span data-i18n="s1.manual">Manual (no tools)</span>               <span class="tok">${FIXED_MANUAL} tok</span></div>
        <div class="overhead-row"><span data-i18n="s1.eager_en">Zocket Eager EN ✓</span>               <span class="tok">${FIXED_EAGER_EN} tok</span></div>
        <div class="overhead-row"><span data-i18n="s1.eager_ru">Zocket Eager RU</span>                 <span class="tok">${FIXED_EAGER_RU} tok</span></div>
        <div class="overhead-row"><span data-i18n="s1.lazy_en">Zocket Lazy EN ✓✓</span>               <span class="tok">${FIXED_LAZY_EN} tok</span></div>
        <div class="overhead-row"><span data-i18n="s1.lazy_ru">Zocket Lazy RU</span>                  <span class="tok">${FIXED_LAZY_RU} tok</span></div>
        <div class="overhead-row" style="color:var(--yellow)"><span data-i18n="s1.sec_fixed">Zocket Sec EN (fixed = Eager)</span> <span class="tok">${FIXED_SEC_EN} tok</span></div>
        <div class="overhead-row" style="color:var(--red)"><span data-i18n="s1.sec_confirm">+ confirm overhead / use (Sec-100%)</span> <span class="tok">+${SEC_CONFIRM_OVERHEAD} tok</span></div>
      </div>
      <div class="overhead-card">
        <h4 data-i18n="s1.breakdown">Overhead components breakdown</h4>
        <div class="overhead-row"><span>Tool schemas (7 eager tools)</span>   <span class="tok">${ZOCKET.eagerTools} tok</span></div>
        <div class="overhead-row"><span>Tool schemas (2 lazy meta-tools)</span><span class="tok">${ZOCKET.lazyTools} tok</span></div>
        <div class="overhead-row"><span>System prompt (EN)</span>             <span class="tok">${ZOCKET.systemEN} tok</span></div>
        <div class="overhead-row"><span>System prompt (RU)</span>             <span class="tok">${ZOCKET.systemRU} tok</span></div>
        <div class="overhead-row"><span>Tool call round-trip (1 use)</span>   <span class="tok">${ZOCKET.toolCall} tok</span></div>
      </div>
    </div>
    <div class="chart-wrap">
      <h3 data-i18n="s1.chart">Overhead comparison (tokens per call)</h3>
      <canvas id="overheadChart"></canvas>
    </div>
  </section>

  <!-- Section 2: Secret catalog -->
  <section>
    <h2><span class="num">2</span> <span data-i18n="s2.title">Secret Token Sizes (Real-world lengths)</span></h2>
    <div class="chart-wrap">
      <h3 data-i18n="s2.chart">Token count by secret type</h3>
      <canvas id="secretTokensChart"></canvas>
    </div>
  </section>

  <!-- Section 3: 50-turn comparison -->
  <section>
    <h2><span class="num">3</span> <span data-i18n="s3.title">Total Input Tokens — 50 Turns (EN, secret every 5 messages)</span></h2>
    <div class="chart-wrap">
      <canvas id="comparison50Chart"></canvas>
    </div>
    <div class="table-wrap wide">
      <table class="compact-table">
        <thead>
          <tr>
            <th data-i18n="s3.th.secret">Secret type</th>
            <th data-i18n="s3.th.category">Category</th>
            <th data-i18n="s3.th.chars">Chars</th>
            <th data-i18n="s3.th.tokens">Tokens</th>
            <th data-i18n="s3.th.manual">Manual</th>
            <th data-i18n="s3.th.eager">Eager</th>
            <th data-i18n="s3.th.lazy">Lazy</th>
            <th style="color:var(--yellow)" data-i18n="s3.th.sec20">Sec-20%</th>
            <th style="color:var(--red)" data-i18n="s3.th.sec100">Sec-100%</th>
            <th data-i18n="s3.th.savings">Savings (Lazy)</th>
            <th data-i18n="s3.th.break_e">Break-E</th>
            <th data-i18n="s3.th.break_l">Break-L</th>
            <th data-i18n="s3.th.verdict">Verdict</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows50}
        </tbody>
      </table>
    </div>
    <p style="font-size:0.78rem;color:var(--text3);margin-top:8px" data-i18n-html="s3.note">
      Savings = Manual − Lazy. Break-E/L = message where Zocket becomes cheaper than Manual.<br>
      <span style="color:var(--yellow)">Sec-20%</span> = Eager + security confirm on 20% of uses (realistic estimate for SUSPICIOUS_DOMAIN).
      <span style="color:var(--red)">Sec-100%</span> = every use requires confirmation (worst case).
      Sec fixed overhead = Eager (security runs server-side). Confirm overhead: +${SEC_CONFIRM_OVERHEAD} tok/use.
    </p>
  </section>

  <!-- Section 3.5: Smart calculator -->
  <section id="smart-calculator">
    <h2><span class="num">3.5</span> <span data-i18n="calc.title">Smart comparison calculator</span></h2>
    <p class="calc-note" data-i18n="calc.subtitle">Compare any two configurations and see totals, overhead, leak tax, and break-even.</p>
    <div class="calc-grid">
      <div class="calc-card">
        <div class="calc-head" data-i18n="calc.variant_a">Variant A</div>
        <div class="calc-row">
          <label data-i18n="calc.secret">Secret</label>
          <select id="calc-a-secret">
            ${secretNames.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.mode">Mode</label>
          <select id="calc-a-mode">
            <option value="manual" data-mode="manual">Manual</option>
            <option value="eager" data-mode="eager">Eager</option>
            <option value="lazy" data-mode="lazy">Lazy</option>
            <option value="sec20" data-mode="sec20">Sec-20%</option>
            <option value="sec100" data-mode="sec100">Sec-100%</option>
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.lang">Language</label>
          <select id="calc-a-lang">
            <option value="en" data-lang="en">EN</option>
            <option value="ru" data-lang="ru">RU</option>
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.turns">Turns</label>
          <select id="calc-a-turns">
            <option value="1" data-turns="1">1</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50" selected>50</option>
          </select>
        </div>
      </div>
      <div class="calc-card">
        <div class="calc-head" data-i18n="calc.variant_b">Variant B</div>
        <div class="calc-row">
          <label data-i18n="calc.secret">Secret</label>
          <select id="calc-b-secret">
            ${secretNames.map(n => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.mode">Mode</label>
          <select id="calc-b-mode">
            <option value="manual" data-mode="manual">Manual</option>
            <option value="eager" data-mode="eager">Eager</option>
            <option value="lazy" data-mode="lazy">Lazy</option>
            <option value="sec20" data-mode="sec20">Sec-20%</option>
            <option value="sec100" data-mode="sec100">Sec-100%</option>
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.lang">Language</label>
          <select id="calc-b-lang">
            <option value="en" data-lang="en">EN</option>
            <option value="ru" data-lang="ru">RU</option>
          </select>
        </div>
        <div class="calc-row">
          <label data-i18n="calc.turns">Turns</label>
          <select id="calc-b-turns">
            <option value="1" data-turns="1">1</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50" selected>50</option>
          </select>
        </div>
      </div>
    </div>
    <div class="table-wrap">
      <table class="calc-table">
        <thead>
          <tr>
            <th data-i18n="calc.metric">Metric</th>
            <th data-i18n="calc.variant_a">Variant A</th>
            <th data-i18n="calc.variant_b">Variant B</th>
            <th data-i18n="calc.delta">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          <tr><td data-i18n="calc.m.total">Total tokens</td><td id="calc-a-total" class="num"></td><td id="calc-b-total" class="num"></td><td id="calc-d-total" class="num"></td></tr>
          <tr><td data-i18n="calc.m.avg">Avg / turn</td><td id="calc-a-avg" class="num"></td><td id="calc-b-avg" class="num"></td><td id="calc-d-avg" class="num"></td></tr>
          <tr><td data-i18n="calc.m.savings">Savings vs manual</td><td id="calc-a-save" class="num"></td><td id="calc-b-save" class="num"></td><td id="calc-d-save" class="num"></td></tr>
          <tr><td data-i18n="calc.m.leak">Leak tax (manual)</td><td id="calc-a-leak" class="num"></td><td id="calc-b-leak" class="num"></td><td id="calc-d-leak" class="num"></td></tr>
          <tr><td data-i18n="calc.m.fixed">Fixed overhead / call</td><td id="calc-a-fixed" class="num"></td><td id="calc-b-fixed" class="num"></td><td id="calc-d-fixed" class="num"></td></tr>
          <tr><td data-i18n="calc.m.confirm">Confirm overhead / use</td><td id="calc-a-confirm" class="num"></td><td id="calc-b-confirm" class="num"></td><td id="calc-d-confirm" class="num"></td></tr>
          <tr><td data-i18n="calc.m.security">Security level</td><td id="calc-a-security"></td><td id="calc-b-security"></td><td id="calc-d-security"></td></tr>
          <tr><td data-i18n="calc.m.break_even">Break-even (Eager/Lazy)</td><td id="calc-a-break"></td><td id="calc-b-break"></td><td id="calc-d-break"></td></tr>
          <tr><td data-i18n="calc.m.secret_size">Secret size (tokens)</td><td id="calc-a-size" class="num"></td><td id="calc-b-size" class="num"></td><td id="calc-d-size" class="num"></td></tr>
          <tr><td data-i18n="calc.m.frequency">Secret frequency</td><td id="calc-a-freq"></td><td id="calc-b-freq"></td><td id="calc-d-freq"></td></tr>
        </tbody>
      </table>
    </div>
    <p class="calc-note" data-i18n="calc.note">Break-even uses eager/lazy reference. Sec-20/100 piggyback on eager fixed overhead.</p>
  </section>

  <!-- Section 4: Growth over conversation -->
  <section>
    <h2><span class="num">4</span> Token Cost Growth Over Conversation</h2>
    <div class="chart-wrap">
      <h3>Selected secrets: Manual vs Eager vs Lazy (EN, turns 5–50)</h3>
      <canvas id="growthChart"></canvas>
    </div>
    <div class="insight-grid">
      <div class="insight">
        <div class="title">📈 The Leak Tax Effect</div>
        <p>Every time a secret appears in conversation history, it costs tokens on <strong>every subsequent API call</strong>. A 3243-char RSA key adds ~600 tokens to history permanently — multiplying cost over time.</p>
      </div>
      <div class="insight">
        <div class="title">📉 Zocket's Flat Overhead</div>
        <p>Zocket's fixed overhead (tool schemas + system prompt) is constant per call. The secret value <strong>never appears</strong> in context — only the key name does. This is why Zocket wins for long conversations.</p>
      </div>
      <div class="insight">
        <div class="title">⚡ Lazy Mode Advantage</div>
        <p>Lazy mode registers only 2 meta-tools initially, saving ${FIXED_EAGER_EN - FIXED_LAZY_EN} tokens per call vs eager. Over 50 calls that's ${(FIXED_EAGER_EN - FIXED_LAZY_EN) * 50} tokens saved — roughly equivalent to ${Math.round((FIXED_EAGER_EN - FIXED_LAZY_EN) * 50 / 750)} JWT tokens.</p>
      </div>
    </div>
  </section>

  <!-- Section 5: Break-even -->
  <section>
    <h2><span class="num">5</span> Break-Even Analysis</h2>
    <div class="chart-wrap">
      <h3>Messages until Zocket becomes cheaper than Manual (EN, eager vs lazy)</h3>
      <canvas id="breakEvenChart"></canvas>
    </div>
    <p style="font-size:0.82rem;color:var(--text2);margin-top:8px">Values capped at 510 for visualization (means Zocket never becomes cheaper within 500 messages). Shorter bar = faster break-even = Zocket more beneficial.</p>
  </section>

  <!-- Section 6: RU vs EN -->
  <section>
    <h2><span class="num">6</span> Russian vs English — Tokenization Overhead</h2>
    <div class="insight-grid">
      <div class="insight">
        <div class="title">🇷🇺 Cyrillic overhead depends on text</div>
        <p>For Zocket’s text-only phrases, overall RU/EN ratio is <strong>${MULT_TEXT.overall.toFixed(2)}×</strong>; mean of pair ratios is <strong>${MULT_TEXT.mean.toFixed(2)}×</strong>. This affects <strong>both sides</strong> of the comparison equally — the break-even point doesn't change.</p>
      </div>
      <div class="insight">
        <div class="title">✅ Key optimization: EN system prompt</div>
        <p>Even for Russian users, keep the Zocket system prompt in English. This saves ${ZOCKET.systemRU - ZOCKET.systemEN} tokens/call = ${(ZOCKET.systemRU - ZOCKET.systemEN) * 50} tokens over 50 calls. Already implemented in Zocket ✓</p>
      </div>
      <div class="insight">
        <div class="title">🔑 Same break-even for RU dialogs</div>
        <p>Secret values are always ASCII. The "leak tax" is language-independent. Break-even points are identical for Russian and English conversations.</p>
      </div>
    </div>
    <div class="chart-wrap" style="margin-top:20px">
      <h3>50-turn total tokens: Russian dialog (Manual vs Lazy vs Sec-20% vs Sec-100%, EN system prompt)</h3>
      <canvas id="ruComparisonChart"></canvas>
    </div>
  </section>

  <!-- Section 6.1: RU/EN multipliers -->
  <section>
    <h2><span class="num">6.1</span> <span data-i18n="s6a.title">RU/EN Tokenization Multipliers</span></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="text-align:left" data-i18n="s6a.th.set">Set</th>
            <th data-i18n="s6a.th.en">EN total</th>
            <th data-i18n="s6a.th.ru">RU total</th>
            <th data-i18n="s6a.th.overall">Overall ratio (sum RU / sum EN)</th>
            <th data-i18n="s6a.th.mean">Mean of pair ratios</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="name" data-i18n="s6a.full">All pairs (incl. secret values)</td>
            <td>${MULT_FULL.totalEn}</td>
            <td>${MULT_FULL.totalRu}</td>
            <td>${MULT_FULL.overall.toFixed(3)}</td>
            <td>${MULT_FULL.mean.toFixed(3)}</td>
          </tr>
          <tr>
            <td class="name" data-i18n="s6a.text">Text-only (no secret values)</td>
            <td>${MULT_TEXT.totalEn}</td>
            <td>${MULT_TEXT.totalRu}</td>
            <td>${MULT_TEXT.overall.toFixed(3)}</td>
            <td>${MULT_TEXT.mean.toFixed(3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p style="font-size:0.78rem;color:var(--text3);margin-top:8px" data-i18n="s6a.note">
      “Overall ratio” weights long ASCII secrets heavily; “Mean of pair ratios” gives each RU/EN pair equal weight.
    </p>
  </section>

  <!-- Section 7: Recommendations -->
  <section>
    <h2><span class="num">7</span> Verdict by Secret Type</h2>
    <div class="rec-grid">
      ${secretNames.map(name => {
        const verdict = VERDICTS[name]
        const note    = NOTES[name]
        const vc      = verdictColor(verdict)
        return `<div class="rec-item">
          <div class="verdict" style="color:${vc}">${verdict}</div>
          <div>
            <div class="secret-name">${name}</div>
            <div class="desc">${note}</div>
          </div>
        </div>`
      }).join('\n')}
    </div>
  </section>

  <!-- Section 8: Tool overload research -->
  <section>
    <h2><span class="num">8</span> Tool Overload Research</h2>
    <div class="insight-grid">
      <div class="insight">
        <div class="title">RAG-MCP <a href="https://arxiv.org/abs/2505.03275" target="_blank">arXiv:2505.03275</a> (2025)</div>
        <p>&lt;30 tools: &gt;90% selection accuracy<br>30–100: degradation begins<br>&gt;100 tools: baseline 13.62% (collapse)<br>RAG-filter: 43.13% at 100+ tools (3× better)</p>
      </div>
      <div class="insight">
        <div class="title">JSPLIT <a href="https://arxiv.org/abs/2510.14537" target="_blank">arXiv:2510.14537</a> (2025)</div>
        <p>All-in-ctx: &lt;40% at hundreds of tools<br>Taxonomy: ~69% even at hundreds (structured selection)</p>
      </div>
      <div class="insight">
        <div class="title">✅ Zocket's position</div>
        <p>7 tools (eager) → safe zone &gt;90%<br>2 tools (lazy) → zero confusion risk<br>Zocket is well within safe thresholds for both modes.</p>
      </div>
    </div>
  </section>

  <!-- Section 9: Auto-compacting scenario -->
  <section>
    <h2><span class="num">9</span> Scenario: Auto-Compacting (Context Compression)</h2>
    <div class="insight-grid" style="margin-bottom:20px">
      <div class="insight">
        <div class="title">🗜 What compaction means for Manual</div>
        <p>When Claude Code compacts conversation history, secrets shared manually are <strong>gone or unreliably preserved</strong>. The user must re-paste the secret. Leak tax restarts. Each compaction event = full cost re-incurred.</p>
      </div>
      <div class="insight">
        <div class="title">🔒 What compaction means for Zocket</div>
        <p>The vault is <strong>external state</strong> — completely unaffected by context compression. After any compaction, the AI just calls the tool again. Zero re-injection. Works after 1 or 1000 compactions.</p>
      </div>
      <div class="insight">
        <div class="title">📊 Model: 50 turns → compact → 50 turns</div>
        <p>History compressed to ${Math.round(COMPACT_RATIO * 100)}% after phase 1. Phase 2 Manual re-injects the secret at the first use. Phase 2 Zocket behaves identically to phase 1 — no state change needed.</p>
      </div>
    </div>
    <div class="chart-wrap">
      <h3>Total tokens: Phase 1 + Phase 2 (after compaction). ${COMPACT_PHASE1 + COMPACT_PHASE2} turns total.</h3>
      <canvas id="compactChart"></canvas>
    </div>
    <p style="font-size:0.82rem;color:var(--text2);margin-top:8px">Phase 1 = pre-compaction (50 turns). Phase 2 = post-compaction (50 more turns). Manual secret re-injected at first use after compaction.</p>
  </section>

  <!-- Section 10: Mid-session injection -->
  <section>
    <h2><span class="num">10</span> Scenario: Mid-Session Secret Injection</h2>
    <div class="insight-grid" style="margin-bottom:20px">
      <div class="insight">
        <div class="title">⏱ Manual: position-dependent cost</div>
        <p>Injecting a secret at turn 50 of 100 is <strong>cheaper</strong> than turn 1 — but only because the secret pollutes fewer remaining turns. You pay with workflow constraints: you can't use the secret early without cost.</p>
      </div>
      <div class="insight">
        <div class="title">🎯 Zocket: position-independent</div>
        <p>Tool call cost is <strong>identical at any turn</strong>. Whether you access the secret at turn 1 or turn 99, the token cost is the same. This is "any-time access" — use secrets whenever needed, without planning around leak tax.</p>
      </div>
      <div class="insight">
        <div class="title">📈 ${MIDSESS_TOTAL}-turn session, injected at turns ${INJECT_POINTS.join(', ')}</div>
        <p>For RSA-4096 in a ${MIDSESS_TOTAL}-turn session: Manual at T=1 costs ${simMidSession(SECRETS['SSH RSA-4096 (PKCS#1)'], FIXED_MANUAL, false, MIDSESS_TOTAL, 1).toLocaleString()} tokens vs T=50 at ${simMidSession(SECRETS['SSH RSA-4096 (PKCS#1)'], FIXED_MANUAL, false, MIDSESS_TOTAL, 50).toLocaleString()} — saving ${(simMidSession(SECRETS['SSH RSA-4096 (PKCS#1)'], FIXED_MANUAL, false, MIDSESS_TOTAL, 1) - simMidSession(SECRETS['SSH RSA-4096 (PKCS#1)'], FIXED_MANUAL, false, MIDSESS_TOTAL, 50)).toLocaleString()} by delaying. Zocket stays flat at ${simMidSession(SECRETS['SSH RSA-4096 (PKCS#1)'], FIXED_LAZY_EN, true, MIDSESS_TOTAL, 1).toLocaleString()} regardless.</p>
      </div>
    </div>
    <div class="chart-wrap">
      <h3>Total tokens vs injection point — ${MIDSESS_TOTAL}-turn session (JWT RS256 and SSH RSA-4096)</h3>
      <canvas id="midsessChart"></canvas>
    </div>
  </section>

  <!-- Section 11: Competitive landscape -->
  <section>
    <h2><span class="num">11</span> Competitive Landscape</h2>
    <div class="table-wrap" style="margin-bottom:24px">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Tool</th>
            <th style="text-align:left">Type</th>
            <th style="text-align:left">MCP</th>
            <th style="text-align:left">Local</th>
            <th style="text-align:left">Run commands</th>
            <th style="text-align:left">Cross-session</th>
            <th style="text-align:left">No secrets in context</th>
            <th style="text-align:left">Free / OSS</th>
          </tr>
        </thead>
        <tbody>
          <tr class="row-good"><td class="name" style="color:var(--green)">Zocket</td><td><span class="tag">Local vault</span></td><td>✅ Native</td><td>✅ Always</td><td>✅ run_script</td><td>✅ vault persists</td><td>✅ By design</td><td>✅ MIT</td></tr>
          <tr class="row-warn"><td class="name" style="color:var(--yellow)">Zocket + Security</td><td><span class="tag">Vault + guard</span></td><td>✅ Native</td><td>✅ Always</td><td>✅ + domain check</td><td>✅ vault persists</td><td>✅ + runtime block</td><td>✅ MIT</td></tr>
          <tr><td class="name">Bitwarden MCP</td><td><span class="tag">Password mgr</span></td><td>✅ Official</td><td>✅ Local</td><td>❌</td><td>✅ cloud sync</td><td>⚠ reads values</td><td>✅ OSS</td></tr>
          <tr><td class="name">1Password</td><td><span class="tag">Password mgr</span></td><td>❌ CLI only</td><td>⚠ app req</td><td>❌</td><td>✅ cloud sync</td><td>⚠ via CLI</td><td>❌ paid</td></tr>
          <tr><td class="name">HashiCorp Vault MCP</td><td><span class="tag">Enterprise</span></td><td>✅ Official</td><td>⚠ server</td><td>❌</td><td>✅ server</td><td>⚠ API returns values</td><td>✅ OSS</td></tr>
          <tr><td class="name">Infisical MCP</td><td><span class="tag">SaaS secrets</span></td><td>✅ Official</td><td>❌ SaaS</td><td>❌</td><td>✅ cloud</td><td>⚠ API returns values</td><td>⚠ freemium</td></tr>
          <tr><td class="name">Doppler MCP</td><td><span class="tag">SaaS secrets</span></td><td>⚠ community</td><td>❌ SaaS</td><td>❌</td><td>✅ cloud</td><td>❌ token in env</td><td>⚠ freemium</td></tr>
          <tr><td class="name">mcp-secrets-vault</td><td><span class="tag">Local vault</span></td><td>✅</td><td>✅</td><td>❌</td><td>⚠ file-based</td><td>✅ similar model</td><td>✅ OSS</td></tr>
          <tr><td class="name">mcp-secrets-plugin</td><td><span class="tag">OS keychain</span></td><td>✅</td><td>✅ keychain</td><td>❌</td><td>⚠ per-OS</td><td>✅</td><td>✅ OSS</td></tr>
          <tr><td class="name">Azure Key Vault MCP</td><td><span class="tag">Cloud vault</span></td><td>✅ Official</td><td>❌ Azure</td><td>❌</td><td>✅ cloud</td><td>⚠ API values</td><td>❌ paid</td></tr>
          <tr><td class="name">direnv / .env files</td><td><span class="tag">Shell util</span></td><td>❌</td><td>✅</td><td>⚠ manual</td><td>❌ per-dir</td><td>❌ files readable</td><td>✅ free</td></tr>
        </tbody>
      </table>
    </div>
    <div class="insight-grid">
      <div class="insight">
        <div class="title">🎯 Zocket's unique position</div>
        <p>Only tool that combines: <strong>native MCP</strong> + <strong>command execution with secret injection</strong> + <strong>cross-session persistence</strong> + <strong>secrets never returned to AI context</strong>. This combination doesn't exist in any other tool.</p>
      </div>
      <div class="insight">
        <div class="title">🌐 Cross-project, cross-session</div>
        <p>Zocket vault stores secrets once, available to any project, any chat session, any AI client — Claude Code, Codex, Cursor, VS Code, custom agents. No re-pasting across sessions. One vault for all your AI workflows.</p>
      </div>
      <div class="insight">
        <div class="title">☁ vs Cloud vaults (Infisical, Doppler)</div>
        <p>Cloud vaults require internet, accounts, and send secrets over API. Their MCP servers typically <strong>return secret values</strong> to the AI context. Zocket injects at process level — secret stays local, never serialized into JSON.</p>
      </div>
      <div class="insight">
        <div class="title">🔐 vs Password managers (1Password, Bitwarden)</div>
        <p>Password managers are designed for human-readable access. MCP access (if available) typically reads vault contents into AI context. Zocket was designed specifically for AI workflows: value injection without exposure.</p>
      </div>
    </div>
  </section>

  <!-- Section 17: Security token overhead -->
  <section>
    <h2><span class="num">17</span> Security Mode — Token Overhead Analysis</h2>
    <div class="insight-grid" style="margin-bottom:20px">
      <div class="insight">
        <div class="title">🔁 Confirmation round-trip cost</div>
        <p>
          When a command triggers MEDIUM risk (e.g. SUSPICIOUS_DOMAIN), MCP returns
          <code>requires_confirmation</code> instead of executing. The AI reads it,
          sends a second call with <code>confirm:true</code>. Total overhead per use:
          <strong>${SEC_CONFIRM_OVERHEAD} tokens</strong>
          (${SEC_CONFIRM_RESP} response + ${SEC_AI_CONFIRM} AI confirm + ${ZOCKET.toolCall + SEC_CONFIRM_CALL_EXTRA} retry call).
        </p>
      </div>
      <div class="insight">
        <div class="title">📊 Realistic vs worst-case</div>
        <p>
          <strong>Sec-20%</strong>: 1 in 5 secret uses triggers confirmation
          (realistic for SUSPICIOUS_DOMAIN when not all keys go to flagged APIs).
          Overhead over 50 messages: +${Math.round(Math.floor(50/SECRET_EVERY) * 0.2 * SEC_CONFIRM_OVERHEAD)} tok vs Eager.<br>
          <strong>Sec-100%</strong>: every use confirms (adversarial scenario).
          Overhead over 50 messages: +${Math.floor(50/SECRET_EVERY) * SEC_CONFIRM_OVERHEAD} tok vs Eager.
        </p>
      </div>
      <div class="insight">
        <div class="title">✅ Security is affordable</div>
        <p>
          For long secrets (JWT, SSH RSA-4096), security overhead is
          <strong>&lt;5% of Manual cost</strong> — negligible.
          For short secrets (passwords, API keys), security adds relatively more overhead
          but these are already cheaper with Manual — use security <em>for protection</em>,
          not token savings.
        </p>
      </div>
    </div>
    <div class="chart-row">
      <div class="chart-wrap">
        <h3>50-turn total: all 4 modes × 2 languages (EN/RU)</h3>
        <canvas id="secTokenChart" style="max-height:380px"></canvas>
      </div>
      <div class="chart-wrap">
        <h3>Security overhead vs Eager (50 turns, EN)</h3>
        <canvas id="secOverheadChart" style="max-height:380px"></canvas>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">Secret type</th>
            <th>Eager EN</th>
            <th style="color:var(--yellow)">Sec-20% EN</th>
            <th style="color:var(--red)">Sec-100% EN</th>
            <th>Eager RU</th>
            <th style="color:var(--yellow)">Sec-20% RU</th>
            <th style="color:var(--red)">Sec-100% RU</th>
            <th>Sec-20% vs Eager</th>
            <th>Sec-100% vs Eager</th>
          </tr>
        </thead>
        <tbody>
          ${secretNames.map(name => {
            const r  = results.find(r => r.name === name && r.turns === 50)
            const sd = sec50.find(x => x.name === name)
            const rRu = results.find(r => r.name === name && r.turns === 50)
            const eagerRu = simulate(SECRETS[name], 'ru', FIXED_EAGER_RU, true, 50).total
            const d20 = sd.sec20en - r.eager_en
            const d100 = sd.sec100en - r.eager_en
            return `<tr>
              <td class="name">${name}</td>
              <td>${r.eager_en.toLocaleString()}</td>
              <td style="color:#f59e0b">${sd.sec20en.toLocaleString()}</td>
              <td style="color:#ef4444">${sd.sec100en.toLocaleString()}</td>
              <td>${eagerRu.toLocaleString()}</td>
              <td style="color:#f59e0b">${sd.sec20ru.toLocaleString()}</td>
              <td style="color:#ef4444">${sd.sec100ru.toLocaleString()}</td>
              <td class="neg">+${d20.toLocaleString()}</td>
              <td class="neg">+${d100.toLocaleString()}</td>
            </tr>`
          }).join('\n')}
        </tbody>
      </table>
    </div>
    <p style="font-size:0.78rem;color:var(--text3);margin-top:8px">
      Sec-20%/100% fixed overhead = Eager (security runs server-side, same tool schemas).
      Difference is per-use confirmation overhead only.
      RU uses EN system prompt (already optimized in Zocket).
    </p>
  </section>

  <!-- Divider -->
  <div style="border-top:2px solid var(--border);margin:48px 0;padding-top:8px">
    <p style="color:var(--text3);font-size:0.78rem;letter-spacing:.08em;text-transform:uppercase">Security Module Benchmark</p>
  </div>

  <!-- Section 12: Security summary stats -->
  <section>
    <h2><span class="num">12</span> Security Module Overview</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="value" style="color:var(--green)">${sec.totalPass}/${sec.totalPass + sec.totalFail}</div>
        <div class="label">Detection tests pass</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color:var(--blue)">${sec.registry.totalProviders}</div>
        <div class="label">API providers in registry</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color:var(--purple)">${sec.registry.totalDomains}</div>
        <div class="label">Known domains</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color:var(--green)">${(sec.domain.f1*100).toFixed(0)}%</div>
        <div class="label">Semantic matching F1</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color:var(--yellow)">${Math.round(sec.perf.find(p=>p.label.includes('legitimate curl'))?.opsPerSec/1000)}k</div>
        <div class="label">analyzeCommand ops/sec</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color:var(--blue)">${Math.round(sec.perf.find(p=>p.label.includes('known API hit'))?.opsPerSec/1000)}k</div>
        <div class="label">checkDomainMatch ops/sec</div>
      </div>
    </div>
    <div class="insight-grid">
      <div class="insight">
        <div class="title">🛡 Multi-layer detection</div>
        <p>15 rules across 4 severity levels (critical/high/medium/low). Rules apply supersession — higher-severity rules suppress redundant lower-severity findings to prevent double-counting.</p>
      </div>
      <div class="insight">
        <div class="title">🧠 Semantic API matching</div>
        <p>SUSPICIOUS_DOMAIN rule uses project name + key names to identify which API you're using, then flags if secrets are sent to an unexpected domain. Zero false positives on private APIs (e.g. zorin.pw).</p>
      </div>
      <div class="insight">
        <div class="title">⚡ Zero overhead in hot path</div>
        <p>analyzeCommand runs at ~200k ops/sec (5μs/op). checkDomainMatch at ~900k ops/sec (1μs/op). Security checks add negligible latency — far below any network or disk operation.</p>
      </div>
    </div>
  </section>

  <!-- Section 13: Performance -->
  <section>
    <h2><span class="num">13</span> Security Engine Performance (50k iterations)</h2>
    <div class="chart-row">
      <div class="chart-wrap">
        <h3>ops/sec by operation type</h3>
        <canvas id="secPerfChart" style="max-height:300px"></canvas>
      </div>
      <div class="chart-wrap">
        <h3>ns per operation</h3>
        <canvas id="secPerfNsChart" style="max-height:300px"></canvas>
      </div>
    </div>
  </section>

  <!-- Section 14: Detection matrix -->
  <section>
    <h2><span class="num">14</span> Detection Matrix — ${sec.totalPass}/${sec.totalPass + sec.totalFail} Pass</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="text-align:left">ID</th>
            <th style="text-align:left">Category</th>
            <th style="text-align:left">Scenario</th>
            <th style="text-align:left">Mode</th>
            <th>Allowed</th>
            <th>Risk</th>
            <th style="text-align:left">Rules Fired</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${secDetectionRows}
        </tbody>
      </table>
    </div>
  </section>

  <!-- Section 15: Rule frequency + score distribution -->
  <section>
    <h2><span class="num">15</span> Rule Firing Frequency &amp; Score Distribution</h2>
    <div class="chart-row">
      <div class="chart-wrap">
        <h3>Rules fired across all test cases</h3>
        <canvas id="secRuleChart" style="max-height:320px"></canvas>
      </div>
      <div class="chart-wrap">
        <h3>Score distribution</h3>
        <canvas id="secScoreChart" style="max-height:320px"></canvas>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table>
        <thead>
          <tr><th style="text-align:left">Rule</th><th>Count</th><th>Freq</th><th style="text-align:left">Bar</th></tr>
        </thead>
        <tbody>${secRuleRows}</tbody>
      </table>
    </div>
  </section>

  <!-- Section 16: API registry + domain matching -->
  <section>
    <h2><span class="num">16</span> API Registry &amp; Semantic Domain Matching</h2>
    <div class="chart-row">
      <div class="chart-wrap">
        <h3>Providers by category</h3>
        <canvas id="secRegistryChart" style="max-height:300px"></canvas>
      </div>
      <div class="chart-wrap">
        <h3>SUSPICIOUS_DOMAIN accuracy</h3>
        <canvas id="secDomainChart" style="max-height:300px"></canvas>
      </div>
    </div>
    <div class="table-wrap" style="margin-bottom:20px">
      <table>
        <thead>
          <tr><th style="text-align:left">Category</th><th>Providers</th><th>Domains</th><th>Keywords</th><th style="text-align:left">Bar</th></tr>
        </thead>
        <tbody>${secRegistryRows}</tbody>
        <tr><td style="text-align:left;font-weight:700">TOTAL</td><td><b>${sec.registry.totalProviders}</b></td><td><b>${sec.registry.totalDomains}</b></td><td><b>${sec.registry.totalKeywords}</b></td><td></td></tr>
      </table>
    </div>
    <h3 style="margin-bottom:12px">Domain matching test cases (${sec.domain.rows.filter(r=>r.pass).length}/${sec.domain.rows.length} pass)</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th style="text-align:left">Test Case</th><th>Expected</th><th>Result</th><th>Status</th></tr>
        </thead>
        <tbody>${secDomainRows}</tbody>
      </table>
    </div>
    <p style="font-size:0.8rem;color:var(--text3);margin-top:8px">
      Confusion Matrix (positive = flagged SUSPICIOUS): TP=${sec.domain.tp} TN=${sec.domain.tn} FP=${sec.domain.fp} FN=${sec.domain.fn}
      &nbsp;|&nbsp; Precision=${(sec.domain.precision*100).toFixed(1)}% &nbsp;|&nbsp; Recall=${(sec.domain.recall*100).toFixed(1)}% &nbsp;|&nbsp; F1=${(sec.domain.f1*100).toFixed(1)}%
    </p>
  </section>

</div>

<footer>
  <div class="container">
    <p>Zocket MCP Benchmark — Token analysis via <strong>js-tiktoken</strong> (cl100k_base) · Security analysis via <strong>SecurityAnalyzer</strong> + API Registry<br>
    Secret lengths: Google Cloud docs, Stripe docs, Auth0 docs, RFC 7519, RFC 8709, Let's Encrypt, BIP39 spec<br>
    Generated: 2026-03-12 | <a href="benchmark-results.csv">Token CSV</a> | <a href="benchmark-security.csv">Security CSV</a></p>
  </div>
</footer>

<script>
const I18N = {
  en: {
    title: 'Zocket MCP — Benchmark Report',
    subtitle: 'Token efficiency · Security detection · API registry · Performance',
    badges: {
      date: '📅 2026-03-12',
      bpe: '🔤 BPE cl100k_base (Claude Code / Codex)',
      secrets: (n) => '🔐 ' + n + ' secret types',
      lang: '💬 EN + RU analysis',
      sec: (p, t) => '🛡 ' + p + '/' + t + ' security tests pass',
      api: (n) => '🌐 ' + n + ' API providers',
    },
    stat: {
      secret_types: 'Secret types analyzed',
      lazy_saving: 'Less tokens with Lazy mode (vs Eager)',
      break_even: 'Messages to break-even (RSA-4096)',
      cyrillic_overhead: 'Cyrillic token overhead vs Latin',
      manual_tokens: 'Manual tokens (RSA-4096, 50 turns)',
      lazy_tokens: 'Zocket Lazy tokens (same scenario)',
    },
    s1: {
      title: 'Zocket Overhead Per API Call',
      fixed_overhead: 'Fixed overhead per call (tokens)',
      manual: 'Manual (no tools)',
      eager_en: 'Zocket Eager EN ✓',
      eager_ru: 'Zocket Eager RU',
      lazy_en: 'Zocket Lazy EN ✓✓',
      lazy_ru: 'Zocket Lazy RU',
      sec_fixed: 'Zocket Sec EN (fixed = Eager)',
      sec_confirm: '+ confirm overhead / use (Sec-100%)',
      breakdown: 'Overhead components breakdown',
      chart: 'Overhead comparison (tokens per call)',
    },
    s2: {
      title: 'Secret Token Sizes (Real-world lengths)',
      chart: 'Token count by secret type',
    },
    s3: {
      title: 'Total Input Tokens — 50 Turns (EN, secret every 5 messages)',
      th: {
        secret: 'Secret type',
        category: 'Category',
        chars: 'Chars',
        tokens: 'Tokens',
        manual: 'Manual',
        eager: 'Eager',
        lazy: 'Lazy',
        sec20: 'Sec-20%',
        sec100: 'Sec-100%',
        savings: 'Savings (Lazy)',
        break_e: 'Break-E',
        break_l: 'Break-L',
        verdict: 'Verdict',
      },
      note: (confirm) =>
        'Savings = Manual − Lazy. Break-E/L = message where Zocket becomes cheaper than Manual.<br>' +
        '<span style="color:var(--yellow)">Sec-20%</span> = Eager + security confirm on 20% of uses (realistic estimate for SUSPICIOUS_DOMAIN). ' +
        '<span style="color:var(--red)">Sec-100%</span> = every use requires confirmation (worst case). ' +
        'Sec fixed overhead = Eager (security runs server-side). Confirm overhead: +' + confirm + ' tok/use.',
    },
    labels: {
      manual: 'Manual',
      eager: 'Eager',
      lazy: 'Lazy',
      sec20: 'Sec-20%',
      sec100: 'Sec-100%',
    },
    calc: {
      title: 'Smart comparison calculator',
      subtitle: 'Compare any two configurations and see totals, overhead, leak tax, and break-even.',
      variant_a: 'Variant A',
      variant_b: 'Variant B',
      secret: 'Secret',
      mode: 'Mode',
      lang: 'Language',
      turns: 'Turns',
      metric: 'Metric',
      delta: 'Δ (B − A)',
      note: 'Break-even uses eager/lazy reference. Sec-20/100 piggyback on eager fixed overhead.',
      modes: {
        manual: 'Manual',
        eager: 'Zocket Eager',
        lazy: 'Zocket Lazy',
        sec20: 'Sec-20%',
        sec100: 'Sec-100%',
      },
      langs: {
        en: 'EN',
        ru: 'RU',
      },
      m: {
        total: 'Total tokens',
        avg: 'Avg / turn',
        savings: 'Savings vs manual',
        leak: 'Leak tax (manual)',
        fixed: 'Fixed overhead / call',
        confirm: 'Confirm overhead / use',
        security: 'Security level',
        break_even: 'Break-even (Eager/Lazy)',
        secret_size: 'Secret size (tokens)',
        frequency: 'Secret frequency',
      },
    },
    s6a: {
      title: 'RU/EN Tokenization Multipliers',
      th: {
        set: 'Set',
        en: 'EN total',
        ru: 'RU total',
        overall: 'Overall ratio (sum RU / sum EN)',
        mean: 'Mean of pair ratios',
      },
      full: 'All pairs (incl. secret values)',
      text: 'Text-only (no secret values)',
      note: '“Overall ratio” weights long ASCII secrets heavily; “Mean of pair ratios” gives each RU/EN pair equal weight.',
    },
  },
  ru: {
    title: 'Zocket MCP — Отчёт по бенчмаркам',
    subtitle: 'Эффективность токенов · Детекция безопасности · Реестр API · Производительность',
    badges: {
      date: '📅 2026-03-12',
      bpe: '🔤 BPE cl100k_base (Claude Code / Codex)',
      secrets: (n) => '🔐 ' + n + ' типов секретов',
      lang: '💬 анализ EN + RU',
      sec: (p, t) => '🛡 ' + p + '/' + t + ' тестов безопасности пройдено',
      api: (n) => '🌐 ' + n + ' API провайдеров',
    },
    stat: {
      secret_types: 'Типов секретов проанализировано',
      lazy_saving: 'Меньше токенов в Lazy (vs Eager)',
      break_even: 'Сообщений до окупаемости (RSA-4096)',
      cyrillic_overhead: 'Оверхед токенов кириллицы vs латиница',
      manual_tokens: 'Manual токены (RSA-4096, 50 ходов)',
      lazy_tokens: 'Zocket Lazy токены (тот же сценарий)',
    },
    s1: {
      title: 'Оверхед Zocket на вызов API',
      fixed_overhead: 'Фиксированный оверхед на вызов (токены)',
      manual: 'Manual (без инструментов)',
      eager_en: 'Zocket Eager EN ✓',
      eager_ru: 'Zocket Eager RU',
      lazy_en: 'Zocket Lazy EN ✓✓',
      lazy_ru: 'Zocket Lazy RU',
      sec_fixed: 'Zocket Sec EN (фикс = Eager)',
      sec_confirm: '+ подтверждение / вызов (Sec-100%)',
      breakdown: 'Разбор компонентов оверхеда',
      chart: 'Сравнение оверхеда (токены/вызов)',
    },
    s2: {
      title: 'Размеры секретов в токенах (реальные длины)',
      chart: 'Количество токенов по типу секрета',
    },
    s3: {
      title: 'Общие входные токены — 50 ходов (EN, секрет каждые 5 сообщений)',
      th: {
        secret: 'Тип секрета',
        category: 'Категория',
        chars: 'Симв.',
        tokens: 'Токены',
        manual: 'Manual',
        eager: 'Eager',
        lazy: 'Lazy',
        sec20: 'Sec-20%',
        sec100: 'Sec-100%',
        savings: 'Экономия (Lazy)',
        break_e: 'Окуп‑E',
        break_l: 'Окуп‑L',
        verdict: 'Вердикт',
      },
      note: (confirm) =>
        'Экономия = Manual − Lazy. Break‑E/L = сообщение, где Zocket становится дешевле Manual.<br>' +
        '<span style="color:var(--yellow)">Sec‑20%</span> = Eager + подтверждение безопасности в 20% случаев (оценка для SUSPICIOUS_DOMAIN). ' +
        '<span style="color:var(--red)">Sec‑100%</span> = подтверждение на каждом использовании (худший сценарий). ' +
        'Sec фиксированный оверхед = Eager (проверка на сервере). Подтверждение: +' + confirm + ' ток/вызов.',
    },
    labels: {
      manual: 'Manual',
      eager: 'Eager',
      lazy: 'Lazy',
      sec20: 'Sec-20%',
      sec100: 'Sec-100%',
    },
    calc: {
      title: 'Умный калькулятор сравнения',
      subtitle: 'Сравните любые две конфигурации и получите итоги, оверхед, leak tax и окупаемость.',
      variant_a: 'Вариант A',
      variant_b: 'Вариант B',
      secret: 'Секрет',
      mode: 'Режим',
      lang: 'Язык',
      turns: 'Ходы',
      metric: 'Метрика',
      delta: 'Δ (B − A)',
      note: 'Окупаемость берётся из eager/lazy. Sec-20/100 используют eager fixed overhead.',
      modes: {
        manual: 'Manual',
        eager: 'Zocket Eager',
        lazy: 'Zocket Lazy',
        sec20: 'Sec-20%',
        sec100: 'Sec-100%',
      },
      langs: {
        en: 'EN',
        ru: 'RU',
      },
      m: {
        total: 'Всего токенов',
        avg: 'Среднее / ход',
        savings: 'Экономия vs manual',
        leak: 'Leak tax (manual)',
        fixed: 'Фикс. оверхед / вызов',
        confirm: 'Подтверждение / использование',
        security: 'Уровень безопасности',
        break_even: 'Окупаемость (Eager/Lazy)',
        secret_size: 'Размер секрета (токены)',
        frequency: 'Частота секрета',
      },
    },
    s6a: {
      title: 'Мультипликаторы токенизации RU/EN',
      th: {
        set: 'Набор',
        en: 'EN всего',
        ru: 'RU всего',
        overall: 'Общий коэффициент (sum RU / sum EN)',
        mean: 'Среднее по парам',
      },
      full: 'Все пары (с секретами)',
      text: 'Только текст (без значений секретов)',
      note: '«Общий коэффициент» сильно зависит от длинных ASCII‑секретов; «Среднее по парам» даёт каждой RU/EN паре равный вес.',
    },
  },
}

const LANG = new URLSearchParams(location.search).get('lang') || 'en'
const L = I18N[LANG] || I18N.en

document.documentElement.lang = LANG
document.getElementById('lang-en')?.classList.toggle('active', LANG === 'en')
document.getElementById('lang-ru')?.classList.toggle('active', LANG === 'ru')

document.querySelectorAll('[data-i18n]').forEach(el => {
  const key = el.getAttribute('data-i18n')
  const parts = key.split('.')
  let cur = L
  for (const p of parts) cur = cur?.[p]
  if (typeof cur === 'string') el.textContent = cur
})
document.querySelectorAll('[data-i18n-html]').forEach(el => {
  const key = el.getAttribute('data-i18n-html')
  const parts = key.split('.')
  let cur = L
  for (const p of parts) cur = cur?.[p]
  if (typeof cur === 'function') el.innerHTML = cur(${SEC_CONFIRM_OVERHEAD})
  else if (typeof cur === 'string') el.innerHTML = cur
})

document.querySelectorAll('option[data-mode]').forEach(opt => {
  const label = L.calc?.modes?.[opt.value]
  if (label) opt.textContent = label
})
document.querySelectorAll('option[data-lang]').forEach(opt => {
  const label = L.calc?.langs?.[opt.value]
  if (label) opt.textContent = label
})

const setText = (selector, value) => {
  const el = document.querySelector(selector)
  if (el) el.textContent = value
}
setText('#badge-date', L.badges.date)
setText('#badge-bpe', L.badges.bpe)
setText('#badge-secrets', L.badges.secrets(${secretNames.length}))
setText('#badge-lang', L.badges.lang)
setText('#badge-sec', L.badges.sec(${sec.totalPass}, ${sec.totalPass + sec.totalFail}))
setText('#badge-api', L.badges.api(${sec.registry.totalProviders}))

Chart.defaults.color = '#6c757d'
Chart.defaults.borderColor = '#334155'
Chart.defaults.font.family = "Inter, system-ui, sans-serif"

const secretLabels = ${JSON.stringify(shortLabels)}
const secretTokens = ${JSON.stringify(secretTokens)}
const manualData50  = ${JSON.stringify(manualData50)}
const eagerData50   = ${JSON.stringify(eagerData50)}
const lazyData50    = ${JSON.stringify(lazyData50)}
const beEagerData   = ${JSON.stringify(beEagerData)}
const beLazyData    = ${JSON.stringify(beLazyData)}
const turnLabels    = ${JSON.stringify(turnPoints)}
const lineDatasets  = ${JSON.stringify(lineChartDatasets)}
const sec50data     = ${JSON.stringify(sec50)}
const calcRows      = ${JSON.stringify(results)}
const calcMeta      = {
  secretEvery: ${SECRET_EVERY},
  confirmOverhead: ${SEC_CONFIRM_OVERHEAD},
  fixed: {
    manual: ${FIXED_MANUAL},
    eager_en: ${FIXED_EAGER_EN},
    eager_ru: ${FIXED_EAGER_RU},
    lazy_en: ${FIXED_LAZY_EN},
    lazy_ru: ${FIXED_LAZY_RU},
    sec_en: ${FIXED_SEC_EN},
  },
}

const calcRowFor = (name, turns) => calcRows.find(r => r.name === name && r.turns === Number(turns))
const calcTotalFor = (row, mode, lang) => {
  if (!row) return null
  if (mode === 'manual') return row['manual_' + lang]
  if (mode === 'eager') return row['eager_' + lang]
  if (mode === 'lazy') return row['lazy_' + lang]
  if (mode === 'sec20') return row['sec20_' + lang]
  if (mode === 'sec100') return row['sec100_' + lang]
  return null
}
const calcFixedFor = (mode, lang) => {
  if (mode === 'manual') return calcMeta.fixed.manual
  if (mode === 'eager') return lang === 'ru' ? calcMeta.fixed.eager_ru : calcMeta.fixed.eager_en
  if (mode === 'lazy') return lang === 'ru' ? calcMeta.fixed.lazy_ru : calcMeta.fixed.lazy_en
  if (mode === 'sec20' || mode === 'sec100') return calcMeta.fixed.sec_en
  return null
}
const calcConfirmFor = (mode) => {
  if (mode === 'sec20') return Math.round(calcMeta.confirmOverhead * 0.2)
  if (mode === 'sec100') return calcMeta.confirmOverhead
  return 0
}
const formatNum = (n) => n === null || n === undefined ? '—' : Number(n).toLocaleString()
const formatDelta = (a, b) => {
  if (typeof a !== 'number' || typeof b !== 'number') return '—'
  const d = b - a
  return (d > 0 ? '+' : '') + d.toLocaleString()
}
const formatBreakEven = (row, mode) => {
  if (!row) return '—'
  if (mode === 'eager') return row.break_even_eager
  if (mode === 'lazy') return row.break_even_lazy
  if (mode === 'sec20' || mode === 'sec100') return row.break_even_eager
  return '—'
}
const formatSecurity = (mode) => {
  if (mode === 'manual') return LANG === 'ru' ? 'Нет' : 'None'
  if (mode === 'eager' || mode === 'lazy') return LANG === 'ru' ? 'Базовый' : 'Baseline'
  if (mode === 'sec20') return LANG === 'ru' ? 'Средний (20%)' : 'Medium (20%)'
  if (mode === 'sec100') return LANG === 'ru' ? 'Строгий (100%)' : 'Strict (100%)'
  return '—'
}

function readCalc(prefix) {
  return {
    secret: document.getElementById('calc-' + prefix + '-secret')?.value,
    mode: document.getElementById('calc-' + prefix + '-mode')?.value,
    lang: document.getElementById('calc-' + prefix + '-lang')?.value,
    turns: document.getElementById('calc-' + prefix + '-turns')?.value,
  }
}

function writeCalc(prefix, m) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  set('calc-' + prefix + '-total', formatNum(m.total))
  set('calc-' + prefix + '-avg', formatNum(m.avg))
  set('calc-' + prefix + '-save', formatNum(m.savings))
  set('calc-' + prefix + '-leak', formatNum(m.leak))
  set('calc-' + prefix + '-fixed', formatNum(m.fixed))
  set('calc-' + prefix + '-confirm', formatNum(m.confirm))
  set('calc-' + prefix + '-security', m.security ?? '—')
  set('calc-' + prefix + '-break', m.breakEven ?? '—')
  set('calc-' + prefix + '-size', formatNum(m.size))
  set('calc-' + prefix + '-freq', m.freq)
}

function calcMetrics(sel) {
  const row = calcRowFor(sel.secret, sel.turns)
  const total = calcTotalFor(row, sel.mode, sel.lang)
  const manual = row ? row['manual_' + sel.lang] : null
  const leak = sel.mode === 'manual' ? (row?.['leak_tax_' + sel.lang] ?? 0) : 0
  const fixed = calcFixedFor(sel.mode, sel.lang)
  const confirm = calcConfirmFor(sel.mode)
  const avg = typeof total === 'number' ? total / Number(sel.turns) : null
  const savings = typeof total === 'number' && typeof manual === 'number' ? (manual - total) : null
  const breakEven = formatBreakEven(row, sel.mode)
  const security = formatSecurity(sel.mode)
  const freq = LANG === 'ru'
    ? ('каждые ' + calcMeta.secretEvery + ' сообщений')
    : ('every ' + calcMeta.secretEvery + ' messages')
  return {
    total,
    avg,
    savings,
    leak,
    fixed,
    confirm,
    security,
    breakEven,
    size: row?.tokens ?? null,
    freq,
  }
}

function updateCalc() {
  const a = readCalc('a')
  const b = readCalc('b')
  const ma = calcMetrics(a)
  const mb = calcMetrics(b)
  writeCalc('a', ma)
  writeCalc('b', mb)
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val }
  set('calc-d-total', formatDelta(ma.total, mb.total))
  set('calc-d-avg', formatDelta(ma.avg, mb.avg))
  set('calc-d-save', formatDelta(ma.savings, mb.savings))
  set('calc-d-leak', formatDelta(ma.leak, mb.leak))
  set('calc-d-fixed', formatDelta(ma.fixed, mb.fixed))
  set('calc-d-confirm', formatDelta(ma.confirm, mb.confirm))
  set('calc-d-security', '—')
  set('calc-d-break', '—')
  set('calc-d-size', formatDelta(ma.size, mb.size))
  set('calc-d-freq', '—')
}

const calcIds = [
  'calc-a-secret','calc-a-mode','calc-a-lang','calc-a-turns',
  'calc-b-secret','calc-b-mode','calc-b-lang','calc-b-turns',
]
calcIds.forEach(id => document.getElementById(id)?.addEventListener('change', updateCalc))

const aSecretSel = document.getElementById('calc-a-secret')
const bSecretSel = document.getElementById('calc-b-secret')
if (aSecretSel && bSecretSel) {
  aSecretSel.value = aSecretSel.options[0]?.value || ''
  document.getElementById('calc-a-mode').value = 'manual'
  document.getElementById('calc-a-lang').value = 'en'
  document.getElementById('calc-a-turns').value = '50'
  const rsa = 'SSH RSA-4096 (PKCS#1)'
  const hasRsa = Array.from(bSecretSel.options).some(o => o.value === rsa)
  bSecretSel.value = hasRsa ? rsa : (bSecretSel.options[0]?.value || '')
  document.getElementById('calc-b-mode').value = 'lazy'
  document.getElementById('calc-b-lang').value = 'en'
  document.getElementById('calc-b-turns').value = '50'
  updateCalc()
}

// Overhead chart
new Chart(document.getElementById('overheadChart'), {
  type: 'bar',
  data: {
    labels: [
      L.labels.manual,
      L.labels.eager + ' EN',
      L.labels.eager + ' RU',
      L.labels.lazy + ' EN',
      L.labels.lazy + ' RU',
      'Sec EN (fixed)',
      'Sec EN +confirm/use',
    ],
    datasets: [{
      label: 'Tokens per call',
      data: [${FIXED_MANUAL}, ${FIXED_EAGER_EN}, ${FIXED_EAGER_RU}, ${FIXED_LAZY_EN}, ${FIXED_LAZY_RU}, ${FIXED_SEC_EN}, ${FIXED_SEC_EN + SEC_CONFIRM_OVERHEAD}],
      backgroundColor: ['#6b7280','#3b82f6','#60a5fa','#10b981','#34d399','#f59e0b','#ef4444'],
    }]
  },
  options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
})

// Secret tokens chart
new Chart(document.getElementById('secretTokensChart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [{
      label: 'Tokens',
      data: secretTokens,
      backgroundColor: secretTokens.map(t => t > 400 ? '#ef4444' : t > 100 ? '#f59e0b' : '#10b981'),
    }]
  },
  options: {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
})

// 50-turn comparison
new Chart(document.getElementById('comparison50Chart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [
      { label: L.labels.manual,   data: manualData50,  backgroundColor: '#ef4444' },
      { label: L.labels.eager,    data: eagerData50,   backgroundColor: '#3b82f6' },
      { label: L.labels.lazy,     data: lazyData50,    backgroundColor: '#10b981' },
      { label: L.labels.sec20,    data: sec50data.map(d => d.sec20en),  backgroundColor: '#f59e0b' },
      { label: L.labels.sec100,   data: sec50data.map(d => d.sec100en), backgroundColor: '#dc2626' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true } }
  }
})

// Growth chart
new Chart(document.getElementById('growthChart'), {
  type: 'line',
  data: { labels: turnLabels, datasets: lineDatasets.map(d => ({...d, tension: 0.3, pointRadius: 3})) },
  options: {
    plugins: { legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 20 } } },
    scales: { y: { beginAtZero: true }, x: { title: { display: true, text: 'Conversation turns' } } }
  }
})

// Break-even chart
new Chart(document.getElementById('breakEvenChart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [
      { label: 'Break-even ' + L.labels.eager, data: beEagerData, backgroundColor: '#3b82f6' },
      { label: 'Break-even ' + L.labels.lazy,  data: beLazyData,  backgroundColor: '#10b981' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: {
      y: { beginAtZero: true, max: 520, title: { display: true, text: 'Messages (capped at 510 = never)' } }
    }
  }
})

// RU comparison
const ruManual50  = ${JSON.stringify(secretNames.map(name => simulate(SECRETS[name], 'ru', FIXED_MANUAL, false, 50).total))}
const ruLazy50    = ${JSON.stringify(secretNames.map(name => simulate(SECRETS[name], 'ru', FIXED_LAZY_EN, true, 50).total))}
const ruSec20_50  = ${JSON.stringify(secretNames.map(name => simulateSec(SECRETS[name], 'ru', FIXED_SEC_EN, 50, 0.2).total))}
const ruSec100_50 = ${JSON.stringify(secretNames.map(name => simulateSec(SECRETS[name], 'ru', FIXED_SEC_EN, 50, 1.0).total))}
new Chart(document.getElementById('ruComparisonChart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [
      { label: 'RU ' + L.labels.manual,              data: ruManual50,  backgroundColor: '#ef4444' },
      { label: 'RU ' + L.labels.lazy, data: ruLazy50,   backgroundColor: '#10b981' },
      { label: 'RU ' + L.labels.sec20,             data: ruSec20_50,  backgroundColor: '#f59e0b' },
      { label: 'RU ' + L.labels.sec100,            data: ruSec100_50, backgroundColor: '#dc2626' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true } }
  }
})

// Auto-compact chart
const compactLabels   = ${JSON.stringify(compactLabels)}
const compactManual   = ${JSON.stringify(compactManual)}
const compactLazy     = ${JSON.stringify(compactLazy)}
const compactManP1    = ${JSON.stringify(compactManP1)}
const compactManP2    = ${JSON.stringify(compactManP2)}
const compactLazP1    = ${JSON.stringify(compactLazP1)}
const compactLazP2    = ${JSON.stringify(compactLazP2)}
new Chart(document.getElementById('compactChart'), {
  type: 'bar',
  data: {
    labels: compactLabels,
    datasets: [
      { label: L.labels.manual + ' Phase 1',  data: compactManP1, backgroundColor: '#ef444499', stack: 'manual' },
      { label: L.labels.manual + ' Phase 2 (re-inject)', data: compactManP2, backgroundColor: '#ef4444', stack: 'manual' },
      { label: 'Zocket Phase 1',  data: compactLazP1, backgroundColor: '#10b98199', stack: 'zocket' },
      { label: 'Zocket Phase 2',  data: compactLazP2, backgroundColor: '#10b981',   stack: 'zocket' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
  }
})

// Mid-session chart
const midsessLabels  = ${JSON.stringify(INJECT_POINTS.map(t => 'T='+t))}
const midsessManual  = ${JSON.stringify(midsessManual)}
const midsessLazy    = ${JSON.stringify(midsessLazy)}
const midsessColors  = ['#ef4444','#8b5cf6','#10b981','#f59e0b']
const midsessNames   = ${JSON.stringify(MIDSESS_SECRETS.flatMap(n => [n+' Manual', n+' Lazy']))}
new Chart(document.getElementById('midsessChart'), {
  type: 'line',
  data: {
    labels: midsessLabels,
    datasets: [
      { label: midsessNames[0], data: midsessManual[0], borderColor: midsessColors[0], backgroundColor:'transparent', borderWidth:2, tension:0.3 },
      { label: midsessNames[1], data: midsessLazy[0],   borderColor: midsessColors[1], backgroundColor:'transparent', borderWidth:2, borderDash:[6,3], tension:0.3 },
      { label: midsessNames[2], data: midsessManual[1], borderColor: midsessColors[2], backgroundColor:'transparent', borderWidth:2, tension:0.3 },
      { label: midsessNames[3], data: midsessLazy[1],   borderColor: midsessColors[3], backgroundColor:'transparent', borderWidth:2, borderDash:[6,3], tension:0.3 },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: {
      y: { beginAtZero: true },
      x: { title: { display: true, text: 'Secret first used at turn T (of ${MIDSESS_TOTAL})' } }
    }
  }
})

// ── Section 17: Security token overhead charts ────────────────────────────────

const eager50en =${JSON.stringify(secretNames.map(name => results.find(r => r.name===name && r.turns===50).eager_en))}
const lazy50en  = ${JSON.stringify(secretNames.map(name => results.find(r => r.name===name && r.turns===50).lazy_en))}
const manual50en= ${JSON.stringify(secretNames.map(name => results.find(r => r.name===name && r.turns===50).manual_en))}
const eager50ru = ${JSON.stringify(secretNames.map(name => simulate(SECRETS[name], 'ru', FIXED_EAGER_RU, true, 50).total))}
const sec20enArr = sec50data.map(d => d.sec20en)
const sec100enArr= sec50data.map(d => d.sec100en)
const sec20ruArr = sec50data.map(d => d.sec20ru)
const sec100ruArr= sec50data.map(d => d.sec100ru)

new Chart(document.getElementById('secTokenChart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [
      { label: L.labels.manual + ' EN',    data: manual50en,  backgroundColor: '#6b7280',   stack: 'en' },
      { label: L.labels.eager + ' EN',     data: eager50en,   backgroundColor: '#3b82f6',   stack: 'en' },
      { label: L.labels.lazy + ' EN',      data: lazy50en,    backgroundColor: '#10b981',   stack: 'en' },
      { label: L.labels.sec20 + ' EN',   data: sec20enArr,  backgroundColor: '#f59e0b',   stack: 'en' },
      { label: L.labels.sec100 + ' EN',  data: sec100enArr, backgroundColor: '#ef4444',   stack: 'en' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true } }
  }
})

const secOverheadData = sec50data.map((d,i) => d.sec100en - eager50en[i])
const sec20OverheadData = sec50data.map((d,i) => d.sec20en - eager50en[i])
new Chart(document.getElementById('secOverheadChart'), {
  type: 'bar',
  data: {
    labels: secretLabels,
    datasets: [
      { label: L.labels.sec20 + ' overhead vs ' + L.labels.eager, data: sec20OverheadData, backgroundColor: '#f59e0b' },
      { label: L.labels.sec100 + ' overhead vs ' + L.labels.eager,data: secOverheadData,   backgroundColor: '#ef4444' },
    ]
  },
  options: {
    plugins: { legend: { position: 'top' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'Extra tokens (50 turns)' } } }
  }
})

// ── Security detection charts ─────────────────────────────────────────────────

const secPerf = ${JSON.stringify(sec.perf)}
const secPerfLabels = secPerf.map(p => p.label.replace(/^(analyzeCommand|analyzeScript|checkDomainMatch|extractHints) — /, '').slice(0,32))
new Chart(document.getElementById('secPerfChart'), {
  type: 'bar',
  data: {
    labels: secPerfLabels,
    datasets: [{
      label: 'ops/sec',
      data: secPerf.map(p => p.opsPerSec),
      backgroundColor: secPerf.map((p,i) => ['#3b82f6','#6366f1','#8b5cf6','#a78bfa','#10b981','#34d399','#6ee7b7','#f59e0b','#fbbf24','#f97316','#ef4444'][i % 11]),
    }]
  },
  options: {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true, title: { display: true, text: 'ops/sec' } } }
  }
})

new Chart(document.getElementById('secPerfNsChart'), {
  type: 'bar',
  data: {
    labels: secPerfLabels,
    datasets: [{
      label: 'ns/op',
      data: secPerf.map(p => p.nsPerOp),
      backgroundColor: '#f59e0b',
    }]
  },
  options: {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true, title: { display: true, text: 'ns per op' } } }
  }
})

const secRuleData  = ${JSON.stringify(sec.ruleCounts)}
new Chart(document.getElementById('secRuleChart'), {
  type: 'bar',
  data: {
    labels: secRuleData.map(r => r.rule),
    datasets: [{
      label: 'Times fired',
      data: secRuleData.map(r => r.count),
      backgroundColor: '#3b82f6',
    }]
  },
  options: {
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true } }
  }
})

const secScoreData = ${JSON.stringify(sec.scoreGroups)}
new Chart(document.getElementById('secScoreChart'), {
  type: 'doughnut',
  data: {
    labels: secScoreData.map(g => g.label),
    datasets: [{
      data: secScoreData.map(g => g.count),
      backgroundColor: ['#6b7280','#10b981','#f59e0b','#f97316','#ef4444'],
    }]
  },
  options: { plugins: { legend: { position: 'right' } } }
})

const secRegData   = ${JSON.stringify(sec.registryByCategory)}
new Chart(document.getElementById('secRegistryChart'), {
  type: 'bar',
  data: {
    labels: secRegData.map(r => r.cat),
    datasets: [
      { label: 'Providers', data: secRegData.map(r => r.providers), backgroundColor: '#8b5cf6' },
      { label: 'Domains',   data: secRegData.map(r => r.domains),   backgroundColor: '#3b82f6' },
    ]
  },
  options: {
    indexAxis: 'y',
    plugins: { legend: { position: 'top' } },
    scales: { x: { beginAtZero: true } }
  }
})

const secDomainStats = ${JSON.stringify(sec.domain)}
new Chart(document.getElementById('secDomainChart'), {
  type: 'doughnut',
  data: {
    labels: ['True Positive', 'True Negative', 'False Positive', 'False Negative'],
    datasets: [{
      data: [secDomainStats.tp, secDomainStats.tn, secDomainStats.fp, secDomainStats.fn],
      backgroundColor: ['#10b981','#3b82f6','#ef4444','#f59e0b'],
    }]
  },
  options: {
    plugins: {
      legend: { position: 'bottom' },
      title: { display: true, text: 'F1: ' + (secDomainStats.f1*100).toFixed(1) + '%  |  Precision: ' + (secDomainStats.precision*100).toFixed(1) + '%  |  Recall: ' + (secDomainStats.recall*100).toFixed(1) + '%' }
    }
  }
})
</script>
</body>
</html>`

const htmlPath = join(__dir, '..', 'benchmark-report.html')
writeFileSync(htmlPath, html)
console.log(`✓ HTML written: ${htmlPath}`)

// ─── npm publishability summary ───────────────────────────────────────────────

console.log()
console.log('── npm/GitHub publishability ───────────────────────────────────')
console.log()
console.log('  The benchmark (benchmark-full.mjs + benchmark-export.mjs) can be')
console.log('  published as a standalone npm package:')
console.log()
console.log('  Name:    @zocket/token-benchmark  or  mcp-token-benchmark')
console.log('  Deps:    js-tiktoken (single production dependency)')
console.log('  Scripts: node benchmark-full.mjs   # console report')
console.log('           node benchmark-export.mjs  # CSV + HTML')
console.log()
console.log('  GitHub: tag it as a research note in the main zocket repo,')
console.log('  or extract to zocket/benchmarks/ subdirectory with its own')
console.log('  package.json + README.')
console.log()
console.log('  Caution: the simulated secret values look realistic but are fake.')
console.log('  Add a clear disclaimer in README before publishing.')
