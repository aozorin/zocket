import { Command } from 'commander'
import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'
import { serve } from '@hono/node-server'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { VaultService } from './vault.js'
import { ConfigStore } from './config.js'
import { AuditLogger } from './audit.js'
import { createMcpServer } from './mcp.js'
import { createWebApp } from './web.js'
import { vaultPath, keyPath, configPath, auditPath, lockPath, zocketHome } from './paths.js'

// ── Key management ────────────────────────────────────────────────────────────

function loadOrCreateKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, 'utf8').trim()
    return Buffer.from(raw, 'hex')
  }
  mkdirSync(dirname(keyFile), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
  return key
}

// ── Start command ─────────────────────────────────────────────────────────────

async function cmdStart(opts: {
  host: string
  webPort: number
  mcpPort: number
  mode: string
}) {
  const home = zocketHome()
  mkdirSync(home, { recursive: true })

  const key    = loadOrCreateKey(keyPath())
  const vault  = new VaultService(vaultPath(), lockPath(), key)
  const config = new ConfigStore(configPath())
  const audit  = new AuditLogger(auditPath())
  const cfg    = config.ensureExists()

  const mode = (opts.mode === 'admin' ? 'admin' : 'metadata') as 'admin' | 'metadata'
  const services = { vault, config, audit, mode }

  // ── Web panel on webPort ──────────────────────────────────────────────────
  const webApp = createWebApp({ vault, config, audit })
  serve({ fetch: webApp.fetch, hostname: opts.host, port: opts.webPort }, () => {
    console.log(`[zocket] web    http://${opts.host}:${opts.webPort}`)
  })

  // ── MCP SSE on mcpPort ────────────────────────────────────────────────────
  const sessions = new Map<string, SSEServerTransport>()

  const mcpHttp = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res)
      sessions.set(transport.sessionId, transport)
      res.on('close', () => sessions.delete(transport.sessionId))

      const mcpServer = createMcpServer(services, { loading: cfg.mcp_loading })
      mcpServer.connect(transport).catch((e: unknown) => {
        console.error('[zocket] MCP connect error:', e)
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const transport = sessions.get(sessionId)
      if (!transport) { res.writeHead(404).end('Session not found'); return }
      transport.handlePostMessage(req, res).catch((e: unknown) => {
        console.error('[zocket] MCP message error:', e)
      })
      return
    }

    res.writeHead(404).end('Not found')
  })

  mcpHttp.listen(opts.mcpPort, opts.host, () => {
    console.log(`[zocket] mcp    http://${opts.host}:${opts.mcpPort}/sse  (mode: ${mode}, loading: ${cfg.mcp_loading})`)
    console.log(`[zocket] ready  — vault: ${vaultPath()}`)
  })
}

// ── CLI setup ─────────────────────────────────────────────────────────────────

export function buildCli(): Command {
  const program = new Command('zocket')
    .description('Local encrypted vault + MCP server for AI agent workflows')
    .version('1.0.0')

  program
    .command('start')
    .description('Start web panel and MCP SSE server')
    .option('--host <host>',      'Bind host',          '127.0.0.1')
    .option('--web-port <port>',  'Web panel port',     '18001')
    .option('--mcp-port <port>',  'MCP SSE port',       '18002')
    .option('--mode <mode>',      'MCP mode (metadata|admin)', 'admin')
    .action(async (opts) => {
      await cmdStart({
        host:    opts.host,
        webPort: parseInt(opts.webPort, 10),
        mcpPort: parseInt(opts.mcpPort, 10),
        mode:    opts.mode,
      })
    })

  return program
}
