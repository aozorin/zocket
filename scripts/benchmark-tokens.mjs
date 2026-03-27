/**
 * Token benchmark: "Zocket way" vs "Manual way"
 *
 * Counts tokens using js-tiktoken (cl100k_base — same BPE as Claude/GPT-4).
 * No API key required.
 *
 * Run: node scripts/benchmark-tokens.mjs
 */

import { encodingForModel } from 'js-tiktoken'

const enc = encodingForModel('gpt-4') // cl100k_base, same as Claude

function countTokens(text) {
  return enc.encode(text).length
}

function countMessages(messages, tools = [], system = '') {
  let total = 0
  if (system) total += countTokens(system)
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') total += countTokens(JSON.stringify(block.input) + block.name)
        else if (block.type === 'tool_result') total += countTokens(block.content ?? '')
        else if (block.text) total += countTokens(block.text)
      }
    }
    total += 4 // per-message overhead (role token + separators)
  }
  for (const tool of tools) {
    total += countTokens(tool.name + tool.description + JSON.stringify(tool.input_schema))
  }
  return total
}

// ── Fake API key same shape as a real Pexels key ────────────────────────────
const FAKE_KEY = 'pxABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghij'

// ── Zocket MCP tool schemas ──────────────────────────────────────────────────
const ZOCKET_TOOLS = [
  {
    name: 'list_projects',
    description: 'List all projects. Returns name, description, secret_count, folder_path. No secret values.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_project_keys',
    description: 'List secret key names for a project. Values are never returned.',
    input_schema: {
      type: 'object',
      properties: { project: { type: 'string', description: 'Project name' } },
      required: ['project'],
    },
  },
  {
    name: 'run_with_project_env',
    description: 'Run a command with project secrets injected as environment variables. Use $VAR placeholders — substituted server-side. Tip: use output_filter (jq expression) to extract only the field you need.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        command: { type: 'array', items: { type: 'string' } },
        max_chars: { type: 'integer' },
        output_filter: { type: 'string' },
      },
      required: ['project', 'command'],
    },
  },
  {
    name: 'run_script',
    description: 'Run an inline script with project secrets available as environment variables. Use this instead of multiple run_with_project_env calls. Filesystem is NOT shared between calls. Secret values never appear in this conversation.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        lang: { type: 'string', enum: ['node'] },
        code: { type: 'string' },
        max_chars: { type: 'integer' },
      },
      required: ['project', 'lang', 'code'],
    },
  },
  {
    name: 'env_set',
    description: 'Insert or update a key=value pair in a .env file. Creates the file if it does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['path', 'key', 'value'],
    },
  },
]

const ZOCKET_SYSTEM = `Zocket MCP — encrypted local vault + safe command runner.
Rules:
- Secret VALUES are never returned by any tool. Use run_with_project_env or run_script to consume them.
- Filesystem is NOT shared between tool calls. Do not save intermediate data to /tmp.
- Prefer run_script for multi-step data processing instead of many sequential run_with_project_env calls.
- Use max_chars: 200 for status-only checks.
- $VAR and \${VAR} placeholders in command args are substituted server-side with project secrets.`

// ────────────────────────────────────────────────────────────────────────────
// Scenario A — Manual: user pastes key directly in chat, AI writes .env
// ────────────────────────────────────────────────────────────────────────────
const manualMessages = [
  {
    role: 'user',
    content: `Create a .env file at /tmp/test.env with the following:\nPEXEL_API_KEY=${FAKE_KEY}`,
  },
  {
    role: 'assistant',
    content: `I'll create the .env file.\n\`\`\`\nPEXEL_API_KEY=${FAKE_KEY}\n\`\`\`\nDone — /tmp/test.env created.`,
  },
]

// ────────────────────────────────────────────────────────────────────────────
// Scenario B — Zocket: AI uses MCP tools, key injected server-side
//   Turn 1: user request
//   Turn 2: AI calls list_project_keys
//   Turn 3: tool result (key name only)
//   Turn 4: AI calls run_script (writes .env with $PEXEL_API_KEY)
//   Turn 5: tool result (exit_code: 0)
//   Turn 6: AI confirms
// ────────────────────────────────────────────────────────────────────────────
const zocketMessages = [
  {
    role: 'user',
    content: 'Create a .env file at /tmp/test.env with the pexels api key from the "pexels" zocket project.',
  },
  {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't1', name: 'list_project_keys', input: { project: 'pexels' } }],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ project: 'pexels', keys: ['PEXEL_API_KEY'] }) }],
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 't2',
        name: 'run_script',
        input: {
          project: 'pexels',
          lang: 'node',
          code: "const fs=require('fs');fs.writeFileSync('/tmp/test.env','PEXEL_API_KEY='+process.env.PEXEL_API_KEY+'\\n');",
          max_chars: 200,
        },
      },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't2', content: JSON.stringify({ exit_code: 0, stdout: '' }) }],
  },
  {
    role: 'assistant',
    content: 'Done — /tmp/test.env created with PEXEL_API_KEY from vault.',
  },
]

// ── Count & report ────────────────────────────────────────────────────────────
const tokensManual = countMessages(manualMessages)
const tokensZocket = countMessages(zocketMessages, ZOCKET_TOOLS, ZOCKET_SYSTEM)

const tokensToolSchemas = countMessages([], ZOCKET_TOOLS)
const tokensSystem      = countTokens(ZOCKET_SYSTEM)
const tokensKeyInManual = countTokens(FAKE_KEY) * 2 // appears in user msg + assistant reply

const diff = tokensZocket - tokensManual
const pctDiff = ((diff / tokensManual) * 100).toFixed(0)

console.log('═══════════════════════════════════════════════════════')
console.log('  Token Benchmark: Manual vs Zocket MCP')
console.log('═══════════════════════════════════════════════════════')
console.log()
console.log(`  Scenario A — Manual (key value in chat)`)
console.log(`    Total input tokens : ${tokensManual}`)
console.log(`    Key appears in ctx : YES ("${FAKE_KEY.slice(0, 12)}..." = ${countTokens(FAKE_KEY)} tokens × 2)`)
console.log()
console.log(`  Scenario B — Zocket (key via MCP, never in chat)`)
console.log(`    Total input tokens : ${tokensZocket}`)
console.log(`      incl. tool schemas : ${tokensToolSchemas}`)
console.log(`      incl. system prompt: ${tokensSystem}`)
console.log(`    Key appears in ctx : NO`)
console.log()
console.log(`  Overhead of Zocket   : +${diff} tokens (+${pctDiff}%)`)
console.log()
console.log('───────────────────────────────────────────────────────')
console.log('  Breakdown of Zocket overhead:')
console.log(`    Tool schema definitions  : ${tokensToolSchemas} tokens (one-time per session)`)
console.log(`    System prompt rules      : ${tokensSystem} tokens (one-time per session)`)
console.log(`    Tool call round-trips    : ${tokensZocket - tokensManual - tokensToolSchemas - tokensSystem + tokensManual} tokens (variable)`)
console.log()
console.log(`  Secret key (${FAKE_KEY.length} chars) in Manual = ${tokensKeyInManual} tokens in ctx`)
console.log(`  In long sessions (50+ msgs) that key gets repeated in every`)
console.log(`  cache miss — Zocket overhead becomes negligible vs leak risk.`)
console.log('═══════════════════════════════════════════════════════')
