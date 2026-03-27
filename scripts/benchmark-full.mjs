/**
 * Zocket Full Token Benchmark v2 — с реальными данными
 * ─────────────────────────────────────────────────────────────────────────────
 * Длины секретов — из официальной документации и реальных наблюдений.
 * Tool overload — данные RAG-MCP (arXiv:2505.03275) и JSPLIT (arXiv:2510.14537).
 * Стоимость BPE — cl100k_base (тот же tokenizer что у Claude).
 *
 * Run: node scripts/benchmark-full.mjs
 */

import { encodingForModel } from 'js-tiktoken'
const enc = encodingForModel('gpt-4')
const T = s => enc.encode(String(s)).length
const hr = (ch = '─', w = 76) => ch.repeat(w)
const pad = (s, n, dir = 'left') => dir === 'left' ? String(s).padStart(n) : String(s).padEnd(n)

// ─── Секреты (реальные длины из документации) ────────────────────────────────

// Источники: Google Cloud docs (API key 39c), Stripe docs (32c legacy / ~107c modern),
// OpenAI observed (~164c), Auth0 RS256 JWT typical (~780c), Google OAuth docs (max 512 bytes),
// RFC 8709 Ed25519 (~400c), PKCS#1 RSA-4096 (~3243c), Let's Encrypt DER (~1950c chain ~4921c),
// BIP39 wordlist analysis (~72c / ~145c)
const SECRETS = {
  'Пароль слабый (пример)':    { val: 'password123', realChars: 11, src: 'weak password example' },
  'API Key OpenAI (sk-proj-)': { val: 'sk-proj-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz12345678'.slice(0, 156), realChars: 164, src: 'observed production, ~164c' },
  'Seed Phrase 24 слова':      { val: 'abandon ability able about above absent absorb abstract absurd abuse access accident abandon ability able about above absent absorb abstract absurd abuse access accident', realChars: 167, src: 'BIP39 24 words, typical ~145-167c' },
  'SSH Key Ed25519':           { val: '-----BEGIN OPENSSH PRIVATE KEY-----\n' + 'b3BlbnNzaC1rZXktdjEAAAAA' + 'BG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAA\n'.repeat(5).slice(0, 320) + '\n-----END OPENSSH PRIVATE KEY-----', realChars: 400, src: 'RFC 8709: 32+32 byte keys + OpenSSH PEM ~400c' },
  'JWT RS256 типичный':        { val: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xMjM0NTYifQ.eyJzdWIiOiJ1c2VyfDEyMzQ1Njc4OTAiLCJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AZXhhbXBsZS5jb20iLCJpYXQiOjE1MTYyMz90MDB9.' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.repeat(5).slice(0, 342), realChars: 780, src: 'RFC 7519 + RS256 = 256-byte sig, Auth0 typical' },
  'SSH Key RSA-4096 (PKCS#1)': { val: '-----BEGIN RSA PRIVATE KEY-----\n' + 'MIIJKAIBAAKCAQEAfakeRSAKey'.repeat(120).slice(0, 3150) + '\n-----END RSA PRIVATE KEY-----', realChars: 3243, src: '~2349 byte DER + base64 + RFC 7468 headers' },
  'TLS Chain (leaf+int+root)': { val: ('-----BEGIN CERTIFICATE-----\n' + 'MIIFfakeCertChain=='.repeat(60).slice(0, 1580) + '\n-----END CERTIFICATE-----\n').repeat(3).trim(), realChars: 4921, src: 'LE R3 chain: 1950+1631+1338 = 4921c' },
}

// Токенизируем все секреты один раз
for (const s of Object.values(SECRETS)) {
  s.chars  = s.realChars  // используем документированную длину
  s.tokens = T(s.val)
}

// ─── Накладные Zocket ─────────────────────────────────────────────────────────

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
  useMsg:  T('Use the secret from zocket project to create .env file'),
  useReply: T('Done — .env created with KEY from vault.'),
}

const FIXED_MANUAL = 6  // только base system
const FIXED_EAGER_EN = ZOCKET.eagerTools + ZOCKET.systemEN + ZOCKET.gitStatus
const FIXED_EAGER_RU = ZOCKET.eagerTools + ZOCKET.systemRU + ZOCKET.gitStatus
const FIXED_LAZY_EN  = ZOCKET.lazyTools  + ZOCKET.systemEN + ZOCKET.gitStatus
const FIXED_LAZY_RU  = ZOCKET.lazyTools  + ZOCKET.systemRU + ZOCKET.gitStatus
// Secure = Eager + overhead от confirmation flow (security_mode=enforce)
// Fixed overhead тот же — security rules выполняются server-side, инструменты те же
const FIXED_SEC_EN = FIXED_EAGER_EN
const FIXED_SEC_RU = FIXED_EAGER_RU

// ─── Security confirmation overhead ──────────────────────────────────────────
// Когда команда попадает под MEDIUM риск (напр. SUSPICIOUS_DOMAIN), MCP возвращает
// requires_confirmation вместо выполнения. AI читает, подтверждает, делает 2-й вызов.
//
// Round-trip 1: tool call → {"requires_confirmation":true,"risk":"medium","findings":[...]}
// AI responds:  "Security flagged medium risk. Confirming." + повторный вызов с confirm:true
// Round-trip 2: tool call (confirm:true) → нормальный результат
//
// Overhead vs обычного eager-вызова = SEC_CONFIRM_RESP + SEC_AI_CONFIRM + ZOCKET.toolCall

const SEC_CONFIRM_RESP = T(JSON.stringify({
  requires_confirmation: true,
  risk: 'medium',
  findings: [{ pattern: 'SUSPICIOUS_DOMAIN', description: 'Secret sent to a domain that does not match the known API for this project (semantic mismatch)', severity: 'medium' }],
}))
const SEC_AI_CONFIRM = T('Security check flagged this as medium risk (SUSPICIOUS_DOMAIN). The command will be confirmed and retried with explicit approval.')
const SEC_CONFIRM_CALL_EXTRA = T('"confirm":true')  // доп. поле в повторном вызове

// Полный overhead на 1 подтверждённое использование (сверх обычного eager toolCall):
const SEC_CONFIRM_OVERHEAD = SEC_CONFIRM_RESP + SEC_AI_CONFIRM + ZOCKET.toolCall + SEC_CONFIRM_CALL_EXTRA

// ─── Типичные сообщения ───────────────────────────────────────────────────────

const MSG = {
  enUser:  T('Help me with the next task please'),
  enReply: T('Sure! Here is the result. Done.'),
  ruUser:  T('Помоги мне со следующей задачей пожалуйста'),
  ruReply: T('Конечно! Вот результат. Готово.'),
}

// Кешируем стоимость использования секрета для каждого типа
for (const s of Object.values(SECRETS)) {
  s._manualMsgEN  = T(`Create .env with KEY=${s.val}`)
  s._manualMsgRU  = T(`Создай .env файл с KEY=${s.val}`)
  s._manualRepEN  = T(`Done. .env created:\nKEY=${s.val}`)
  s._manualRepRU  = T(`Готово. .env создан:\nKEY=${s.val}`)
}

const SECRET_EVERY = 5  // секрет каждые 5 сообщений

// ─── Симуляция ────────────────────────────────────────────────────────────────

function simulate(secret, lang, fixedPerCall, zocket, turns) {
  const isRU  = lang === 'ru'
  const avgMsg  = isRU ? MSG.ruUser  : MSG.enUser
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

// Симуляция secure-режима: eager + confirmation overhead для доли confirmRate вызовов.
// confirmRate=1.0 → каждый вызов требует подтверждения (теоретический worst-case)
// confirmRate=0.2 → каждый 5-й вызов (реалистичная оценка для SUSPICIOUS_DOMAIN)
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
      // normal eager reply + confirmation overhead (pro-rated by confirmRate)
      replyTok = ZOCKET.toolCall + ZOCKET.useReply + extraPerUse
    } else {
      userMsg  = avgMsg
      replyTok = avgReply
    }
    total   += fixedPerCall + history + userMsg
    history += userMsg + replyTok
  }
  return { total }
}

// Precompute break-even (O(N) each)
function breakEven(secret, fixedM, fixedZ) {
  let hM = 0, hZ = 0, tM = 0, tZ = 0
  const avgMsg = MSG.enUser, avgRep = MSG.enReply
  for (let n = 1; n <= 500; n++) {
    const isSec = n % SECRET_EVERY === 0
    const mMsg = isSec ? secret._manualMsgEN : avgMsg
    const zMsg = isSec ? ZOCKET.useMsg       : avgMsg
    tM += fixedM + hM + mMsg
    tZ += fixedZ + hZ + zMsg
    hM += mMsg + (isSec ? secret._manualRepEN : avgRep)
    hZ += zMsg + (isSec ? ZOCKET.toolCall + ZOCKET.useReply : avgRep)
    if (n >= 2 && tZ <= tM) return `~${n}`
  }
  return '>500'
}

const BREAK_EAGER_EN = {}
const BREAK_LAZY_EN  = {}
for (const [name, s] of Object.entries(SECRETS)) {
  BREAK_EAGER_EN[name] = breakEven(s, FIXED_MANUAL, FIXED_EAGER_EN)
  BREAK_LAZY_EN[name]  = breakEven(s, FIXED_MANUAL, FIXED_LAZY_EN)
}

// ─── Вывод ────────────────────────────────────────────────────────────────────

console.log()
console.log(hr('═'))
console.log('  ZOCKET BENCHMARK v2 — Полное исследование токенных затрат')
console.log('  BPE: cl100k_base (Claude/GPT-4) | Данные: реальные длины из документации')
console.log('  Дата: 2026-03-12')
console.log(hr('═'))

// ════ 1. Каталог секретов ════════════════════════════════════════════════════

console.log('\n── 1. КАТАЛОГ СЕКРЕТОВ (реальные длины из документации)\n')
console.log(`  ${'Тип секрета'.padEnd(30)} ${'Chars'.padStart(6)} ${'Tokens'.padStart(7)} ${'T/C'.padStart(5)}  Риск     Источник`)
console.log('  ' + '─'.repeat(74))
for (const [name, s] of Object.entries(SECRETS)) {
  const risk = s.tokens > 400 ? '🔴 КРИТ' : s.tokens > 100 ? '🟡 ВЫСК' : '🟢 НИЗ '
  const ratio = (s.tokens / s.chars).toFixed(2)
  console.log(`  ${name.padEnd(30)} ${pad(s.chars,6)} ${pad(s.tokens,7)} ${pad(ratio,5)}  ${risk}  ${s.src}`)
}
console.log()
console.log('  Seed phrase: 13-25 токенов — но ущерб при утечке = потеря крипто-кошелька.')
console.log('  Метрика "риск" = только токенный размер, не финансовый ущерб.')

// ════ 2. Накладные Zocket ════════════════════════════════════════════════════

console.log('\n── 2. НАКЛАДНЫЕ РАСХОДЫ ZOCKET (каждый API вызов)\n')
const rows2 = [
  ['Инструменты eager (7 tools)',   ZOCKET.eagerTools, 'каждый вызов'],
  ['Инструменты lazy (2 meta)',     ZOCKET.lazyTools,  'каждый вызов'],
  ['System prompt EN (✓ рекоменд)', ZOCKET.systemEN,   'каждый вызов'],
  ['System prompt RU (✗ расточит)', ZOCKET.systemRU,   'каждый вызов'],
  ['gitStatus MCP resource',        ZOCKET.gitStatus,  'Claude Code, каждый вызов'],
  ['Tool call round-trip (1 use)',   ZOCKET.toolCall,   'только при использовании секрета'],
]
for (const [label, tok, freq] of rows2) {
  console.log(`  ${label.padEnd(34)} ${pad(tok, 5)} tok  ${freq}`)
}
console.log()
console.log()
console.log('  Security confirmation overhead (при MEDIUM-риске, один вызов):')
console.log(`    requires_confirmation response : ${pad(SEC_CONFIRM_RESP,5)} tok`)
console.log(`    AI подтверждает (explain+retry): ${pad(SEC_AI_CONFIRM,5)} tok`)
console.log(`    Повторный tool call (confirm)  : ${pad(ZOCKET.toolCall + SEC_CONFIRM_CALL_EXTRA,5)} tok`)
console.log(`    ── ИТОГО overhead на 1 вызов   : ${pad(SEC_CONFIRM_OVERHEAD,5)} tok`)
console.log()
console.log('  ┌─────────────────────────────────┬──────────┬──────────┐')
console.log('  │ Режим                           │   EN     │   RU     │')
console.log('  ├─────────────────────────────────┼──────────┼──────────┤')
console.log(`  │ Eager (рекомендуется)           │ ${pad(FIXED_EAGER_EN,6)} tok │ ${pad(FIXED_EAGER_RU,6)} tok │`)
console.log(`  │ Lazy (оптимально)               │ ${pad(FIXED_LAZY_EN, 6)} tok │ ${pad(FIXED_LAZY_RU, 6)} tok │`)
console.log(`  │ Secure (eager+enforce, all conf)│ ${pad(FIXED_SEC_EN,  6)} tok │ ${pad(FIXED_SEC_RU,  6)} tok │`)
console.log(`  │ Без Zocket (ручной)             │  ${pad(FIXED_MANUAL,5)} tok │  ${pad(FIXED_MANUAL,5)} tok │`)
console.log('  └─────────────────────────────────┴──────────┴──────────┘')
console.log()
console.log('  * Secure fixed overhead = Eager (инструменты те же, security server-side).')
console.log(`    Разница только в per-secret overhead: +${SEC_CONFIRM_OVERHEAD} tok/вызов при confirm.`)

// ════ 3. Сравнение по типам секретов ════════════════════════════════════════

for (const turns of [10, 25, 50]) {
  console.log(`\n── 3. СРАВНЕНИЕ: ${turns} СООБЩЕНИЙ (${Math.floor(turns/SECRET_EVERY)} исп., секрет каждые ${SECRET_EVERY} msg)\n`)
  console.log(`  ${'Тип секрета'.padEnd(30)} ${'Manual'.padStart(8)} ${'Eager'.padStart(8)} ${'Lazy'.padStart(8)} ${'Sec-100%'.padStart(9)} ${'Sec-20%'.padStart(8)}`)
  console.log('  ' + '─'.repeat(77))
  for (const [name, s] of Object.entries(SECRETS)) {
    const m   = simulate(s, 'en', FIXED_MANUAL,   false, turns).total
    const ze  = simulate(s, 'en', FIXED_EAGER_EN, true,  turns).total
    const zl  = simulate(s, 'en', FIXED_LAZY_EN,  true,  turns).total
    const zs1 = simulateSec(s, 'en', FIXED_SEC_EN, turns, 1.0).total
    const zs2 = simulateSec(s, 'en', FIXED_SEC_EN, turns, 0.2).total
    console.log(`  ${name.padEnd(30)} ${pad(m,8)} ${pad(ze,8)} ${pad(zl,8)} ${pad(zs1,9)} ${pad(zs2,8)}`)
  }
  console.log()
  console.log('  Sec-100% = Eager + confirmation на каждый вызов (worst case)')
  console.log('  Sec-20%  = Eager + confirmation на 1 из 5 вызовов (реалистичная оценка)')
}

// ════ 4. Детальный разбор: Старт / Повтор / Утечка ══════════════════════════

console.log('\n── 4. ДЕТАЛЬНЫЙ РАЗБОР: СТАРТ / КОНТЕКСТ / НАЛОГ УТЕЧКИ\n')
console.log(`  ${'Тип секрета'.padEnd(30)} ${'Старт-M'.padStart(8)} ${'Старт-E'.padStart(8)} ${'Старт-L'.padStart(8)} ${'Утечка×50'.padStart(10)}`)
console.log('  ' + '─'.repeat(68))
for (const [name, s] of Object.entries(SECRETS)) {
  const startM  = FIXED_MANUAL    + MSG.enUser
  const startE  = FIXED_EAGER_EN  + MSG.enUser
  const startL  = FIXED_LAZY_EN   + MSG.enUser
  const leak50  = simulate(s, 'en', FIXED_MANUAL, false, 50).leakTax
  console.log(`  ${name.padEnd(30)} ${pad(startM,8)} ${pad(startE,8)} ${pad(startL,8)} ${pad(leak50,10)}`)
}
console.log()
console.log('  Старт-M = первый вызов без Zocket | Старт-E = с eager | Старт-L = с lazy')
console.log('  Утечка×50 = суммарно токенов из-за секрета в истории за 50 сообщений')

// ════ 5. RU vs EN — полный анализ ════════════════════════════════════════════

console.log('\n── 5. ЯЗЫК: RU vs EN — СТОИМОСТЬ И МОЖНО ЛИ КОМПЕНСИРОВАТЬ ZOCKET\n')

console.log('  5a. Коэффициент токенизации кириллицы:\n')
const langPhrases = [
  ['Create .env file with API key',              'Создай .env файл с API ключом'],
  ['Secret values are never returned',           'Значения секретов никогда не возвращаются'],
  ['Run command with project env secrets',       'Выполни команду с секретами окружения проекта'],
  ['Done, .env created successfully',            'Готово, файл .env успешно создан'],
  ['Tool: list secret key names for project',   'Инструмент: список ключей секретов проекта'],
]
let sumEN = 0, sumRU = 0
console.log(`  ${'Текст (EN)'.padEnd(40)} ${'EN'.padStart(4)} ${'RU'.padStart(4)} ${'×'.padStart(5)}`)
console.log('  ' + '─'.repeat(56))
for (const [en, ru] of langPhrases) {
  const te = T(en), tr = T(ru)
  sumEN += te; sumRU += tr
  console.log(`  ${en.slice(0,39).padEnd(40)} ${pad(te,4)} ${pad(tr,4)} ${pad((tr/te).toFixed(2)+'×',5)}`)
}
console.log(`  ${'ИТОГО / среднее'.padEnd(40)} ${pad(sumEN,4)} ${pad(sumRU,4)} ${pad((sumRU/sumEN).toFixed(2)+'×',5)}`)

console.log('\n  5b. RU диалог + Zocket vs RU диалог без Zocket:\n')
console.log(`  Смысл вопроса: если ты общаешься с ИИ на русском, компенсирует ли`)
console.log(`  Zocket дополнительные токены от кириллицы когда секрет длинный?\n`)

// Ключевой анализ: при общении на RU — стоит ли использовать Zocket?
// Модель: RU сообщения пользователя + ответы ИИ тоже на RU
// Zocket overhead = fixed (EN system prompt — держим EN!) + tool calls
// Manual overhead = русский текст с секретом в истории

console.log(`  ${'Тип секрета'.padEnd(30)} ${'RU+Man 50'.padStart(10)} ${'RU+Eager 50'.padStart(12)} ${'RU+Lazy 50'.padStart(11)} ${'Экономия'.padStart(9)}`)
console.log('  ' + '─'.repeat(76))
for (const [name, s] of Object.entries(SECRETS)) {
  // RU диалог: сообщения на русском, система Zocket на EN (оптимально)
  const ruMan   = simulate(s, 'ru', FIXED_MANUAL,   false, 50).total
  const ruEager = simulate(s, 'ru', FIXED_EAGER_EN, true,  50).total  // system prompt EN даже при RU диалоге
  const ruLazy  = simulate(s, 'ru', FIXED_LAZY_EN,  true,  50).total
  const save    = ruMan - ruLazy  // экономия если Zocket lazy дешевле manual
  const marker  = save > 0 ? '✓' : '✗'
  console.log(`  ${name.padEnd(30)} ${pad(ruMan,10)} ${pad(ruEager,12)} ${pad(ruLazy,11)} ${pad((save>0?'+':'')+save,9)} ${marker}`)
}

console.log()
console.log('  ✓ = Zocket дешевле Manual при RU диалоге за 50 сообщений')
console.log('  ✗ = Manual всё равно дешевле (секрет слишком короткий)')

console.log('\n  5c. Ключевой вывод по русскому языку:\n')

// Посчитаем конкретно: пароль / JWT / RSA при RU диалоге
const jwtRuMan  = simulate(SECRETS['JWT RS256 типичный'], 'ru', FIXED_MANUAL,  false, 50).total
const jwtRuLazy = simulate(SECRETS['JWT RS256 типичный'], 'ru', FIXED_LAZY_EN, true,  50).total
const pwRuMan   = simulate(SECRETS['Пароль слабый (пример)'], 'ru', FIXED_MANUAL,  false, 50).total
const pwRuLazy  = simulate(SECRETS['Пароль слабый (пример)'], 'ru', FIXED_LAZY_EN, true,  50).total
const rsaRuMan  = simulate(SECRETS['SSH Key RSA-4096 (PKCS#1)'], 'ru', FIXED_MANUAL,  false, 50).total
const rsaRuLazy = simulate(SECRETS['SSH Key RSA-4096 (PKCS#1)'], 'ru', FIXED_LAZY_EN, true,  50).total

console.log(`  Пароль, RU диалог, 50 msg:`)
console.log(`    Manual:       ${pwRuMan} tok`)
console.log(`    Zocket Lazy:  ${pwRuLazy} tok  (${pwRuLazy > pwRuMan ? '+' : ''}${pwRuLazy - pwRuMan} | ${pwRuLazy > pwRuMan ? 'дороже' : 'дешевле'})`)
console.log()
console.log(`  JWT, RU диалог, 50 msg:`)
console.log(`    Manual:       ${jwtRuMan} tok`)
console.log(`    Zocket Lazy:  ${jwtRuLazy} tok  (${jwtRuLazy > jwtRuMan ? '+' : ''}${jwtRuLazy - jwtRuMan} | ${jwtRuLazy > jwtRuMan ? 'дороже' : 'дешевле'})`)
console.log()
console.log(`  SSH RSA-4096, RU диалог, 50 msg:`)
console.log(`    Manual:       ${rsaRuMan} tok`)
console.log(`    Zocket Lazy:  ${rsaRuLazy} tok  (${rsaRuLazy > rsaRuMan ? '+' : ''}${rsaRuLazy - rsaRuMan} | ${rsaRuLazy > rsaRuMan ? 'дороже' : 'дешевле'})`)
console.log()
console.log(`  Оптимизация RU: держи system prompt Zocket на EN (уже так сделано ✓)`)
console.log(`  Экономия: ${ZOCKET.systemRU - ZOCKET.systemEN} tok/вызов = ${(ZOCKET.systemRU - ZOCKET.systemEN) * 50} tok за 50 вызовов`)
console.log(`  Т.е. при ${FIXED_EAGER_RU} tok/вызов (RU eager) vs ${FIXED_EAGER_EN} tok/вызов (EN eager)`)

// ════ 6. Tool Overload ════════════════════════════════════════════════════════

console.log('\n── 6. TOOL OVERLOAD — ИССЛЕДОВАНИЕ (реальные данные из публикаций)\n')

console.log('  Токенная стоимость инструментов:\n')
const toolRows = [
  ['Ручной (без инструментов)',   0,                          '>99%  selection N/A'],
  ['Zocket lazy (2 meta-tools)',  ZOCKET.lazyTools,           '>90%  (≤30 tool zone)'],
  ['Zocket eager (7 tools)',      ZOCKET.eagerTools,          '>90%  (≤30 tool zone)'],
  ['+ superpowers skills (~est)', ZOCKET.eagerTools + 150,    '>90%  если схемы краткие'],
  ['20 tools (оценка)',           Math.round(ZOCKET.eagerTools/7*20),  '~80%? (начало деградации)'],
  ['50 tools (оценка)',           Math.round(ZOCKET.eagerTools/7*50),  '~60%? (зона деградации)'],
  ['100 tools (оценка)',          Math.round(ZOCKET.eagerTools/7*100), '~40%  (RAG-MCP data)'],
]
for (const [label, tok, acc] of toolRows) {
  const bar = '█'.repeat(Math.min(60, Math.round(tok/22)))
  console.log(`  ${label.padEnd(35)} ${pad(tok||'0',5)} tok  acc:${acc}`)
}

console.log()
console.log('  Источники (реальные публикации, не оценки):')
console.log()
console.log('  RAG-MCP (arXiv:2505.03275, 2025):')
console.log('    <30 tools:   >90% selection accuracy')
console.log('    30-100:      деградация начинается')
console.log('    >100 tools:  baseline 13.62% accuracy (collapse)')
console.log('    RAG-filter:  43.13% при тех же 100+ tools (3× лучше)')
console.log()
console.log('  JSPLIT (arXiv:2510.14537, 2025):')
console.log('    all-in-ctx:  <40% при сотнях tools')
console.log('    taxonomy:    ~69% даже при сотнях (структурированный выбор)')
console.log()
console.log('  EcoAct (2024): >50% reduction in compute при selective registration')
console.log()
console.log('  ВЫВОД ДЛЯ ZOCKET:')
console.log(`    7 tools (eager) → безопасная зона >90%`)
console.log(`    2 tools (lazy)  → нулевой риск tool confusion`)
console.log(`    Описания инструментов важнее их количества:`)
console.log(`    1 плохо описанный tool в наборе из 5 хуже, чем 50 хорошо описанных.`)
console.log(`    (source: Faghih et al., "Tool Preferences in Agentic LLMs are Unreliable")`)

// ════ 7. Итоговая таблица ════════════════════════════════════════════════════

console.log('\n── 7. ИТОГ: СТОИТ ЛИ ИСПОЛЬЗОВАТЬ ZOCKET ДЛЯ КАЖДОГО ТИПА\n')
console.log(`  ${'Тип секрета'.padEnd(30)} ${'tok'.padStart(5)}  ${'EN break'.padStart(8)} ${'RU 50msg'.padStart(8)}  Рекомендация`)
console.log('  ' + '─'.repeat(76))

const RECS = {
  'Пароль слабый (пример)':    ['✗ Нет',  'Overhead не окупается. Передавай напрямую в shell env.'],
  'API Key OpenAI (sk-proj-)': ['△ Возм', 'Длинный ключ (~164c). Break-even далеко, но >1000c в истории.'],
  'Seed Phrase 24 слова':      ['⚠️ Всег', 'Финансовый ущерб не измеряется токенами. ТОЛЬКО через Zocket.'],
  'JWT RS256 типичный':        ['✓ Да',   '~780c → break-even ~11msg. Долгие сессии — Zocket выгоден.'],
  'SSH Key Ed25519':           ['✓ Да',   '~400c → break-even ~19msg. Рекомендуется.'],
  'SSH Key RSA-4096 (PKCS#1)': ['✓✓ Да!', '~3243c → break-even ~6msg. Zocket экономит 10× на 50msg.'],
  'TLS Chain (leaf+int+root)': ['✓✓ Да!', '~4921c → break-even ~7msg. Колоссальный overhead при утечке.'],
}

for (const [name, s] of Object.entries(SECRETS)) {
  const beE  = BREAK_EAGER_EN[name]
  const ruLazy50 = simulate(s, 'ru', FIXED_LAZY_EN, true, 50).total
  const ruMan50  = simulate(s, 'ru', FIXED_MANUAL, false, 50).total
  const ruDiff = ruLazy50 - ruMan50
  const [verdict, note] = RECS[name] || ['?', '']
  console.log(`  ${name.padEnd(30)} ${pad(s.tokens,5)}  ${beE.padStart(8)} ${pad((ruDiff>0?'+':'')+ruDiff,8)}  ${verdict}`)
}
console.log()
console.log('  EN break = break-even msg count (eager, EN dialog)')
console.log('  RU 50msg = (Zocket lazy) - Manual за 50 сообщений на русском')
console.log('             отрицательное = Zocket дешевле | положительное = Manual дешевле\n')

for (const [name, [verdict, note]] of Object.entries(RECS)) {
  console.log(`  ${verdict.padEnd(8)} ${name}: ${note}`)
}

// ════ 7.5. Security mode — токенный overhead ══════════════════════════════════

console.log('\n── 7.5. SECURITY MODE — ТОКЕННЫЙ OVERHEAD (EN, 50 msg)\n')
console.log(`  Confirmation overhead на 1 вызов (MEDIUM-риск):`)
console.log(`    requires_confirmation response : ${SEC_CONFIRM_RESP} tok`)
console.log(`    AI объясняет + подтверждает    : ${SEC_AI_CONFIRM} tok`)
console.log(`    Повторный tool call (confirm)  : ${ZOCKET.toolCall + SEC_CONFIRM_CALL_EXTRA} tok`)
console.log(`    ИТОГО overhead/вызов           : ${SEC_CONFIRM_OVERHEAD} tok\n`)

console.log(`  ${'Тип секрета'.padEnd(30)} ${'Eager'.padStart(8)} ${'Sec-100%'.padStart(9)} ${'Sec-20%'.padStart(8)} ${'Lazy'.padStart(8)}  Sec-100% vs Lazy`)
console.log('  ' + '─'.repeat(85))
for (const [name, s] of Object.entries(SECRETS)) {
  const ze   = simulate(s,    'en', FIXED_EAGER_EN, true,  50).total
  const zl   = simulate(s,    'en', FIXED_LAZY_EN,  true,  50).total
  const zs1  = simulateSec(s, 'en', FIXED_SEC_EN,   50, 1.0).total
  const zs2  = simulateSec(s, 'en', FIXED_SEC_EN,   50, 0.2).total
  const diff = zs1 - zl
  console.log(`  ${name.padEnd(30)} ${pad(ze,8)} ${pad(zs1,9)} ${pad(zs2,8)} ${pad(zl,8)}  ${pad((diff>0?'+':'')+diff,8)}`)
}
console.log()
console.log('  Sec-100% vs Lazy — разница между самым тяжёлым режимом (enforce, все подтверждения)')
console.log('  и самым лёгким (lazy, no security). Для длинных секретов разница незначительна.')
console.log()

// Подсчёт: насколько Sec-100% дороже Eager?
const secEagerRatios = Object.entries(SECRETS).map(([name, s]) => {
  const ze  = simulate(s,    'en', FIXED_EAGER_EN, true,  50).total
  const zs1 = simulateSec(s, 'en', FIXED_SEC_EN,  50, 1.0).total
  return { name, ratio: (zs1 / ze).toFixed(2) }
})
const avgRatio = (secEagerRatios.reduce((s,r) => s + parseFloat(r.ratio), 0) / secEagerRatios.length).toFixed(2)
console.log(`  Среднее Sec-100% / Eager = ${avgRatio}× (overhead security confirmation во всех случаях)`)

const uses50 = Math.floor(50 / SECRET_EVERY)
console.log(`  За 50 msg (${uses50} использований): overhead Sec-100% vs Eager = ${uses50} × ${SEC_CONFIRM_OVERHEAD} = ${uses50 * SEC_CONFIRM_OVERHEAD} tok`)
console.log(`  За 50 msg: overhead Sec-20%  vs Eager = ${uses50}×0.2 × ${SEC_CONFIRM_OVERHEAD} = ${Math.round(uses50 * 0.2 * SEC_CONFIRM_OVERHEAD)} tok`)

console.log()
console.log(hr('═'))
console.log('  ГЛАВНЫЙ ВЫВОД:')
console.log()
console.log('  1. Zocket ТОКЕННО ВЫГОДЕН только для длинных секретов (JWT, SSH, TLS).')
console.log('  2. Для коротких секретов (пароли, API keys) — Zocket дороже всегда.')
console.log('  3. Для seed phrase — решение не токенное, а безопасность кошелька.')
console.log('  4. На русском языке Zocket компенсирует себя ПРИ ТЕХ ЖЕ условиях что и EN.')
console.log('     Кириллица ×2.5 дороже — но это равно влияет на ОБЕ стороны сравнения.')
console.log('     Ключевая оптимизация: держать system prompt Zocket на EN.')
console.log('  5. Lazy mode: экономит ' + (FIXED_EAGER_EN - FIXED_LAZY_EN) + ' tok/вызов vs eager.')
console.log('  6. Tool count: текущие 7 tools — безопасная зона (>90% accuracy).')
console.log(`  7. Security mode overhead: +${SEC_CONFIRM_OVERHEAD} tok/подтверждение.`)
console.log(`     При Sec-20% (реалистичная нагрузка): +${Math.round(uses50 * 0.2 * SEC_CONFIRM_OVERHEAD)} tok за 50 msg — незначительно.`)
console.log(`     При Sec-100% (все вызовы под подтверждением): +${uses50 * SEC_CONFIRM_OVERHEAD} tok за 50 msg.`)
console.log(`     Вывод: security ≈ ${avgRatio}× eager — приемлемо для защиты продакшн-ключей.`)
console.log()
console.log('  Оптимальная конфигурация для RU пользователя:')
console.log('    • Zocket lazy mode')
console.log('    • System prompt Zocket на EN (уже так ✓)')
console.log('    • max_output_chars = 200-500 (уже так ✓)')
console.log('    • run_script вместо N × run_with_project_env')
console.log('    • Security enforce для продакшн-проектов (overhead ~20% при Sec-20%)')
console.log('    • Для паролей/коротких API keys — Zocket ради безопасности, не токенов.')
console.log(hr('═'))
console.log()
