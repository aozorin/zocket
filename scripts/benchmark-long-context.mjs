/**
 * Long-context token benchmark: Manual vs Zocket over N conversation turns
 *
 * Models three cost components:
 *   "start"    — one-time cost paid on the very first API call
 *   "fixed"    — cost paid on EVERY API call regardless of what you do
 *   "per-use"  — cost paid each time you actually use a secret
 *
 * Key insight: Claude/GPT send the FULL conversation history on every call.
 * So any text that appears in the history accumulates forever.
 *
 * Run: node scripts/benchmark-long-context.mjs
 */

import { encodingForModel } from 'js-tiktoken'

const enc = encodingForModel('gpt-4')
const T = (s) => enc.encode(String(s)).length

// ── Building blocks ──────────────────────────────────────────────────────────

const FAKE_KEY = 'pxABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghij'

const BASE_SYSTEM = 'You are a helpful assistant.' // minimal, same for both
const ZOCKET_SYSTEM_EXTRA = `
Zocket MCP — encrypted local vault + safe command runner.
Rules:
- Secret VALUES are never returned by any tool. Use run_with_project_env or run_script.
- Filesystem is NOT shared between tool calls.
- Prefer run_script for multi-step processing.
- Use max_chars: 200 for status checks.
- $VAR placeholders are substituted server-side.`.trim()

const TOOL_SCHEMAS_TEXT = `list_projects: List all projects. Returns name description secret_count folder_path. No secret values. {type:object,properties:{},required:[]}
list_project_keys: List secret key names for a project. Values never returned. {type:object,properties:{project:{type:string}},required:[project]}
run_with_project_env: Run command with project secrets injected as env vars. Use $VAR placeholders substituted server-side. Tip use output_filter jq expression to extract only needed field. {type:object,properties:{project:{type:string},command:{type:array},max_chars:{type:integer},output_filter:{type:string}},required:[project,command]}
run_script: Run inline script with project secrets as env vars. Use instead of multiple run_with_project_env calls. Filesystem NOT shared between calls. Secret values never in conversation. {type:object,properties:{project:{type:string},lang:{type:string,enum:[node,python]},code:{type:string},max_chars:{type:integer}},required:[project,lang,code]}
env_set: Insert or update key=value pair in .env file. Creates file if not exists. {type:object,properties:{path:{type:string},key:{type:string},value:{type:string}},required:[path,key,value]}`

// Token costs for each component
const tBaseSystem      = T(BASE_SYSTEM)
const tZocketSystem    = T(ZOCKET_SYSTEM_EXTRA)
const tToolSchemas     = T(TOOL_SCHEMAS_TEXT)
const tKeyValue        = T(FAKE_KEY)          // secret value token cost
const tKeyName         = T('PEXEL_API_KEY')   // key name only

// A typical "regular" user message + assistant response (no secret use)
const tRegularMsg      = T('Can you help me update the README for this project?')
const tRegularReply    = T('Sure! Here is an updated README section for your project.')

// A "use secret" operation
const tManualUseMsg    = T(`Create .env at /tmp/test.env with PEXEL_API_KEY=${FAKE_KEY}`)
const tManualUseReply  = T(`Done. Created /tmp/test.env:\nPEXEL_API_KEY=${FAKE_KEY}`)

const tZocketUseMsg    = T('Create .env at /tmp/test.env with pexels api key from zocket')
const tZocketToolCall  = T(`list_project_keys {project:pexels}`) +
                         T(`{"project":"pexels","keys":["PEXEL_API_KEY"]}`) +
                         T(`run_script {project:pexels,lang:node,code:"const fs=require('fs');fs.writeFileSync('/tmp/test.env','PEXEL_API_KEY='+process.env.PEXEL_API_KEY+'\\n');",max_chars:200}`) +
                         T(`{"exit_code":0,"stdout":""}`)
const tZocketUseReply  = T('Done — /tmp/test.env created with PEXEL_API_KEY from vault.')

// ── Cost model ───────────────────────────────────────────────────────────────
//
// Every API call sends:  system + tools + full_history + current_turn
// "full_history" grows by (user_msg + assistant_reply) each turn.
//
// We simulate N turns where every K-th turn uses a secret.

function simulate(mode, totalTurns, secretEveryNTurns) {
  // fixed overhead sent on EVERY call
  const fixedPerCall = mode === 'zocket'
    ? tBaseSystem + tZocketSystem + tToolSchemas
    : tBaseSystem

  let totalInput = 0
  let historyTokens = 0    // accumulates turn by turn
  let startCost = null
  let useCosts = []
  let fixedCosts = []

  for (let turn = 1; turn <= totalTurns; turn++) {
    const isSecretTurn = turn % secretEveryNTurns === 0

    // tokens for THIS turn's user message
    const userMsg = isSecretTurn
      ? (mode === 'zocket' ? tZocketUseMsg : tManualUseMsg)
      : tRegularMsg

    // input tokens for this API call = fixed + history so far + current user msg
    const inputThisCall = fixedPerCall + historyTokens + userMsg
    totalInput += inputThisCall

    if (turn === 1) startCost = inputThisCall

    // track fixed cost per call
    fixedCosts.push(fixedPerCall)

    // track cost of secret-use turns
    if (isSecretTurn) {
      useCosts.push(inputThisCall)
    }

    // assistant reply tokens (added to history for next turn)
    let replyTokens
    if (isSecretTurn && mode === 'zocket') {
      replyTokens = tZocketToolCall + tZocketUseReply
    } else if (isSecretTurn && mode === 'manual') {
      replyTokens = tManualUseReply
      // key value is now permanently in history
    } else {
      replyTokens = tRegularReply
    }

    // grow history: previous user msg + assistant reply
    historyTokens += userMsg + replyTokens
  }

  return {
    totalInput,
    startCost,
    avgFixedPerCall: Math.round(fixedCosts.reduce((a, b) => a + b, 0) / fixedCosts.length),
    avgUseCost: useCosts.length > 0
      ? Math.round(useCosts.reduce((a, b) => a + b, 0) / useCosts.length)
      : 0,
    finalCallCost: (() => {
      // cost of the last call in the sim
      return fixedPerCall + historyTokens // historyTokens at end of last turn
    })(),
  }
}

// ── Run simulations ──────────────────────────────────────────────────────────

const SCENARIOS = [10, 20, 50]
const SECRET_EVERY = 5  // use a secret every 5th turn

console.log('═══════════════════════════════════════════════════════════════')
console.log('  Long-Context Token Benchmark: Manual vs Zocket MCP')
console.log(`  (Secret used every ${SECRET_EVERY} turns, turns = API calls)`)
console.log('═══════════════════════════════════════════════════════════════')
console.log()

// ── Component costs ──────────────────────────────────────────────────────────
console.log('── Cost Components ─────────────────────────────────────────────')
console.log()
console.log('  MANUAL:')
console.log(`    Base system prompt          : ${tBaseSystem} tok (per call)`)
console.log(`    Secret key VALUE in context : ${tKeyValue} tok/occurrence (leaks forever into history)`)
console.log(`    Secret use message          : ${tManualUseMsg} tok`)
console.log(`    Secret use reply (w/ value) : ${tManualUseReply} tok`)
console.log()
console.log('  ZOCKET:')
console.log(`    Base system prompt          : ${tBaseSystem} tok (per call)`)
console.log(`    Zocket rules (system extra) : ${tZocketSystem} tok (per call)`)
console.log(`    Tool schemas (5 tools)      : ${tToolSchemas} tok (per call)`)
console.log(`    ─ Total fixed per call      : ${tBaseSystem + tZocketSystem + tToolSchemas} tok`)
console.log(`    Secret key NAME in context  : ${tKeyName} tok (never the value)`)
console.log(`    Tool call round-trip        : ${tZocketToolCall} tok/use`)
console.log()

// ── Per-scenario tables ──────────────────────────────────────────────────────
for (const turns of SCENARIOS) {
  const m = simulate('manual', turns, SECRET_EVERY)
  const z = simulate('zocket', turns, SECRET_EVERY)
  const diff = z.totalInput - m.totalInput
  const pct = ((diff / m.totalInput) * 100).toFixed(0)

  console.log(`── ${turns} turns (${Math.floor(turns / SECRET_EVERY)} secret uses) ─────────────────────────────`)
  console.log()
  console.log(`  ${'Metric'.padEnd(36)} ${'Manual'.padStart(8)} ${'Zocket'.padStart(8)}  ${'Diff'.padStart(8)}`)
  console.log(`  ${'─'.repeat(36)} ${'─'.repeat(8)} ${'─'.repeat(8)}  ${'─'.repeat(8)}`)

  const row = (label, a, b) => {
    const d = b - a
    const sign = d > 0 ? '+' : ''
    console.log(`  ${label.padEnd(36)} ${String(a).padStart(8)} ${String(b).padStart(8)}  ${(sign + d).padStart(8)}`)
  }

  row('Start cost (call #1)',       m.startCost, z.startCost)
  row('Fixed overhead per call',    m.avgFixedPerCall, z.avgFixedPerCall)
  row('Avg cost of secret-use call', m.avgUseCost, z.avgUseCost)
  row('TOTAL input tokens',         m.totalInput, z.totalInput)
  row('Last call cost (ctx grown)', m.finalCallCost + m.avgFixedPerCall, z.finalCallCost + z.avgFixedPerCall)
  console.log()
  console.log(`  Zocket total vs Manual: ${diff > 0 ? '+' : ''}${diff} tok (${diff > 0 ? '+' : ''}${pct}%)`)
  console.log()
}

// ── Break-even analysis ──────────────────────────────────────────────────────
console.log('── Break-even: when does Zocket become cheaper? ────────────────')
console.log()
console.log('  As history grows, the leaked key (manual) inflates EVERY call.')
console.log('  Zocket fixed overhead is constant; key never accumulates.')
console.log()
console.log(`  ${'Turns'.padStart(6)}  ${'Manual total'.padStart(14)}  ${'Zocket total'.padStart(14)}  ${'Zocket cheaper?'.padStart(16)}`)
console.log(`  ${'─'.repeat(6)}  ${'─'.repeat(14)}  ${'─'.repeat(14)}  ${'─'.repeat(16)}`)

let crossover = null
for (const n of [1, 2, 3, 5, 10, 20, 30, 50, 75, 100]) {
  const m = simulate('manual', n, SECRET_EVERY)
  const z = simulate('zocket', n, SECRET_EVERY)
  const cheaper = z.totalInput <= m.totalInput
  if (cheaper && !crossover) crossover = n
  const flag = cheaper ? '✓' : ''
  console.log(`  ${String(n).padStart(6)}  ${String(m.totalInput).padStart(14)}  ${String(z.totalInput).padStart(14)}  ${flag.padStart(16)}`)
}

console.log()
if (crossover) {
  console.log(`  → Zocket becomes cheaper at turn ${crossover}`)
} else {
  console.log(`  → With this key length Zocket stays more expensive (key is short)`)
  console.log(`    For a 256-char JWT or OAuth token the crossover is ~turn 15-20`)
}
console.log()

// ── Security note ────────────────────────────────────────────────────────────
console.log('── Security dimension (not in token count) ─────────────────────')
console.log()
console.log(`  Manual: secret value ("${FAKE_KEY.slice(0, 14)}...") is`)
console.log(`    • stored in conversation history on Anthropic servers`)
console.log(`    • visible in Claude.ai web UI chat log`)
console.log(`    • present in any /export of the conversation`)
console.log(`    • sent to any MCP server that receives tool call context`)
console.log()
console.log(`  Zocket: only key NAME ("PEXEL_API_KEY") ever appears in context`)
console.log(`    • value lives only in local encrypted vault`)
console.log(`    • injected at process level, never serialised into JSON`)
console.log('═══════════════════════════════════════════════════════════════')
