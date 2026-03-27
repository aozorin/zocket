import { Command } from 'commander'
import { createServer } from 'http'
import { mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { serve } from '@hono/node-server'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { VaultService } from './vault.js'
import { ConfigStore } from './config.js'
import { AuditLogger } from './audit.js'
import { createMcpServer } from './mcp.js'
import { createWebApp } from './web.js'
import { vaultPath, keyPath, configPath, auditPath, lockPath, zocketHome } from './paths.js'
import { loadOrCreateKey } from './keys.js'
import { runTui } from './tui.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function createServices() {
  const home = zocketHome()
  mkdirSync(home, { recursive: true })
  const key = loadOrCreateKey(keyPath())
  const vault = new VaultService(vaultPath(), lockPath(), key)
  vault.ensureExists()
  const config = new ConfigStore(configPath())
  const audit = new AuditLogger(auditPath())
  config.ensureExists()
  return { vault, config, audit }
}

// ── Start command ─────────────────────────────────────────────────────────────

async function cmdStart(opts: {
  host: string
  webPort: number
  mcpPort: number
  mcpStreamPort: number
  mode: string
}) {
  const { vault, config, audit } = createServices()
  const cfg = config.ensureExists()

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
  })

  // ── MCP Streamable HTTP on mcpStreamPort ──────────────────────────────────
  const streamableSessions = new Map<string, StreamableHTTPServerTransport>()

  const streamableHttp = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end('Not found')
      return
    }

    const method = (req.method ?? 'GET').toUpperCase()

    let parsedBody: unknown = undefined
    if (method === 'POST') {
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
      }
      if (raw.trim().length > 0) {
        try {
          parsedBody = JSON.parse(raw)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }))
          return
        }
      }
    }

    const header = req.headers['mcp-session-id']
    const sessionId = Array.isArray(header) ? header[0] : header

    let transport: StreamableHTTPServerTransport | undefined
    if (sessionId && streamableSessions.has(sessionId)) {
      transport = streamableSessions.get(sessionId)
    } else if (!sessionId && method === 'POST' && parsedBody && isInitializeRequest(parsedBody)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          if (transport) streamableSessions.set(sid, transport)
        },
      })
      transport.onclose = () => {
        const sid = transport?.sessionId
        if (sid && streamableSessions.has(sid)) streamableSessions.delete(sid)
      }

      const mcpServer = createMcpServer(services, { loading: cfg.mcp_loading })
      mcpServer.connect(transport).catch((e: unknown) => {
        console.error('[zocket] MCP streamable connect error:', e)
      })
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      }))
      return
    }

    try {
      await transport.handleRequest(req, res, parsedBody)
    } catch (e) {
      console.error('[zocket] MCP streamable request error:', e)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }))
      }
    }
  })

  streamableHttp.listen(opts.mcpStreamPort, opts.host, () => {
    console.log(`[zocket] mcp    http://${opts.host}:${opts.mcpStreamPort}/mcp  (streamable-http)`)
    console.log(`[zocket] ready  — vault: ${vaultPath()}`)
  })
}

// ── CLI setup ─────────────────────────────────────────────────────────────────

export function buildCli(): Command {
  const program = new Command('zocket')
    .description('Local encrypted vault + MCP server for AI agent workflows')
    .version('1.0.0')

  program
    .command('init')
    .description('Initialize vault and config')
    .action(async () => {
      createServices()
      console.log(`[zocket] initialized — vault: ${vaultPath()}`)
    })

  program
    .command('start')
    .description('Start web panel + MCP SSE + MCP Streamable HTTP servers')
    .option('--host <host>',      'Bind host',          '127.0.0.1')
    .option('--web-port <port>',  'Web panel port',     '18001')
    .option('--mcp-port <port>',  'MCP SSE port',       '18002')
    .option('--mcp-stream-port <port>', 'MCP Streamable HTTP port', '18003')
    .option('--mode <mode>',      'MCP mode (metadata|admin)', 'admin')
    .action(async (opts) => {
      await cmdStart({
        host:    opts.host,
        webPort: parseInt(opts.webPort, 10),
        mcpPort: parseInt(opts.mcpPort, 10),
        mcpStreamPort: parseInt(opts.mcpStreamPort, 10),
        mode:    opts.mode,
      })
    })

  const projects = program.command('projects').description('Manage projects')
  projects
    .command('list')
    .action(async () => {
      const { vault } = createServices()
      const rows = await vault.listProjects()
      if (!rows.length) {
        console.log('No projects')
        return
      }
      for (const r of rows) {
        console.log(`${r.name}\t${r.secret_count}\t${r.folder_path ?? ''}`)
      }
    })

  projects
    .command('create <name>')
    .option('--description <text>', 'Description', '')
    .option('--folder <path>', 'Folder path', '')
    .action(async (name, opts) => {
      const { vault } = createServices()
      await vault.createProject(name, opts.description ?? '')
      if (opts.folder) await vault.setFolder(name, opts.folder)
      console.log('Project created:', name)
    })

  projects
    .command('delete <name>')
    .action(async (name) => {
      const { vault } = createServices()
      await vault.deleteProject(name)
      console.log('Project deleted:', name)
    })

  projects
    .command('set-folder <name> [path]')
    .description('Set or clear folder path (use "-" to clear)')
    .action(async (name, path) => {
      const { vault } = createServices()
      const value = path && path !== '-' ? path : undefined
      await vault.setFolder(name, value)
      console.log('Folder updated:', name)
    })

  projects
    .command('set-domains <name> [domains]')
    .description('Set or clear allowed domains (comma-separated, use "-" to clear)')
    .action(async (name, domains) => {
      const { vault } = createServices()
      const value = domains && domains !== '-' ? domains.split(',').map(s => s.trim()).filter(Boolean) : null
      await vault.setAllowedDomains(name, value)
      console.log('Domains updated:', name)
    })

  const secrets = program.command('secrets').description('Manage secrets')
  secrets
    .command('list <project>')
    .option('--show-values', 'Include secret values', false)
    .action(async (project, opts) => {
      const { vault } = createServices()
      const rows = await vault.listSecrets(project)
      if (!rows.length) {
        console.log('No secrets')
        return
      }
      for (const r of rows) {
        if (opts.showValues) {
          const v = await vault.getSecretValue(project, r.key)
          console.log(`${r.key}\t${v}\t${r.description ?? ''}`)
        } else {
          console.log(`${r.key}\t${r.description ?? ''}`)
        }
      }
    })

  secrets
    .command('get <project> <key>')
    .action(async (project, key) => {
      const { vault } = createServices()
      const v = await vault.getSecretValue(project, key)
      console.log(v)
    })

  secrets
    .command('set <project> <key> <value>')
    .option('--description <text>', 'Description', '')
    .action(async (project, key, value, opts) => {
      const { vault } = createServices()
      await vault.setSecret(project, key, value, opts.description ?? '')
      console.log('Secret saved:', key)
    })

  secrets
    .command('delete <project> <key>')
    .action(async (project, key) => {
      const { vault } = createServices()
      await vault.deleteSecret(project, key)
      console.log('Secret deleted:', key)
    })

  program
    .command('tui')
    .description('Interactive terminal UI for full management')
    .action(async () => {
      const { vault, config, audit } = createServices()
      await runTui({ vault, config, audit })
    })

  return program
}
