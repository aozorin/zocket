import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { spawnSync } from 'child_process'
import { VaultService } from './vault.js'
import { ConfigStore } from './config.js'
import { AuditLogger } from './audit.js'
import { runCommand, runScript } from './runner.js'
import { listEnvKeys, setEnvKey } from './env-file.js'
import { createAnalyzer } from './security.js'
import { extractHints } from './api-registry.js'

export interface McpServices {
  vault: VaultService
  config: ConfigStore
  audit: AuditLogger
  /** 'metadata' = no secret values ever returned; 'admin' = full access */
  mode: 'metadata' | 'admin'
}

export interface McpOptions {
  /**
   * 'eager'  — register all tools immediately (default).
   * 'lazy'   — register only list_tools_summary + activate_tool.
   *            Client calls activate_tool(name) to unlock each tool on demand.
   *            Saves ~80% of schema tokens on servers with many tools.
   */
  loading?: 'eager' | 'lazy'
}

const SYSTEM_INSTRUCTIONS = `
Zocket MCP — encrypted local vault + safe command runner.

Rules:
- Secret VALUES are never returned by any tool. Use run_with_project_env or run_script to consume them.
- Filesystem is NOT shared between tool calls. Do not save intermediate data to /tmp.
- Prefer run_script for multi-step data processing instead of many sequential run_with_project_env calls.
- Use max_chars: 200 for status-only checks; only request more when you actually need the full output.
- Use output_filter (jq expression) to extract only the field you need from JSON responses.
- $VAR and \${VAR} placeholders in command args are substituted server-side with project secrets.
- In lazy mode: call list_tools_summary to see available tools, then activate_tool(name) before first use.
`.trim()

/** Apply a jq expression to a JSON string. Returns filtered string or original on failure. */
function applyJq(json: string, expr: string): string {
  const proc = spawnSync('jq', ['-r', expr], {
    input: json,
    encoding: 'utf8',
    timeout: 3000,
  })
  if (proc.status === 0 && proc.stdout) return proc.stdout.trimEnd()
  return json
}

function ok(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
}

function err(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true }
}

// ── Tool catalog ─────────────────────────────────────────────────────────────

interface CatalogEntry {
  name: string
  /** One-liner shown in list_tools_summary and lazy mode discovery */
  summary: string
  register: (server: McpServer, services: McpServices) => void
}

function buildCatalog(services: McpServices): CatalogEntry[] {
  const { vault, config, audit } = services

  return [
    {
      name: 'list_projects',
      summary: 'List all projects (name, description, secret_count, folder_path). No secret values.',
      register: server => {
        server.tool(
          'list_projects',
          'List all projects. Returns name, description, secret_count, folder_path. No secret values.',
          async () => {
            try {
              return ok({ projects: await vault.listProjects() })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'list_project_keys',
      summary: 'List secret key names for a project. Values are never returned.',
      register: server => {
        server.tool(
          'list_project_keys',
          'List secret key names for a project. Values are never returned.',
          { project: z.string().describe('Project name') },
          async ({ project }) => {
            try {
              return ok({ project, keys: await vault.listKeys(project) })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'get_exec_policy',
      summary: 'Get current command execution policy (allowed commands, output limits).',
      register: server => {
        server.tool(
          'get_exec_policy',
          'Get the current command execution policy (allowed commands, output limits).',
          async () => {
            const cfg = config.load()
            return ok({
              allow_list: cfg.exec_allow_list,
              max_output: cfg.exec_max_output,
              allow_substitution: cfg.exec_allow_substitution,
            })
          },
        )
      },
    },

    {
      name: 'run_with_project_env',
      summary: 'Run a command with project secrets injected as $VAR env placeholders.',
      register: server => {
        server.tool(
          'run_with_project_env',
          [
            'Run a command with project secrets injected as environment variables.',
            'Use $VAR or ${VAR} placeholders in args — substituted server-side.',
            'Tip: use output_filter (jq expression) to extract only the field you need.',
            'Tip: use max_chars: 200 for status-only checks.',
          ].join(' '),
          {
            project: z.string().describe('Project name'),
            command: z.array(z.string()).min(1).describe('Command and args, e.g. ["curl", "-H", "Authorization: $API_KEY", "https://..."]'),
            max_chars: z.number().int().min(1).max(32000).optional().describe('Max output chars (default ~500)'),
            output_filter: z.string().optional().describe('jq expression to filter JSON stdout, e.g. ".items[0].url"'),
            confirm: z.boolean().optional().describe('Set to true to confirm execution of a medium-risk command after reviewing the warning'),
          },
          async ({ project, command, max_chars, output_filter, confirm }) => {
            try {
              const cfg = config.load()
              const allowedDomains = await vault.getAllowedDomains(project)
              const keyNames = await vault.listKeys(project)
              const hints = extractHints(project, keyNames)
              const sec = createAnalyzer(cfg, allowedDomains, hints).analyzeCommand(command)
              audit.log('security_check', 'mcp', { project, command: command[0], risk: sec.risk, findings: sec.findings.map(f => f.pattern) }, sec.allowed ? 'ok' : 'blocked')
              if (!sec.allowed) return err(`Security check blocked command: ${sec.reason}`)
              if (sec.risk === 'medium' && !confirm) {
                return ok({
                  requires_confirmation: true,
                  risk: sec.risk,
                  warning: `Command flagged as ${sec.risk.toUpperCase()} risk. Review findings and re-call with confirm: true to proceed.`,
                  findings: sec.findings.map(f => ({ pattern: f.pattern, description: f.description })),
                })
              }
              const policy = {
                allow_list: cfg.exec_allow_list,
                max_output: cfg.exec_max_output,
                allow_substitution: cfg.exec_allow_substitution,
              }
              const env = await vault.getEnv(project)
              const result = runCommand(command, env, policy, max_chars ?? cfg.exec_max_output)
              if (output_filter && result.stdout) result.stdout = applyJq(result.stdout, output_filter)
              audit.log('run_command', 'mcp', { project, command: command[0] }, result.exit_code === 0 ? 'ok' : 'fail')
              const res: Record<string, unknown> = { exit_code: result.exit_code, stdout: result.stdout }
              if (result.stderr) res.stderr = result.stderr
              if (result.truncated) res.truncated = true
              return ok(res)
            } catch (e) {
              audit.log('run_command', 'mcp', { project, command: command[0] }, 'denied')
              return err(String(e))
            }
          },
        )
      },
    },

    {
      name: 'run_script',
      summary: 'Run an inline node/python script with project secrets injected as env vars. Prefer over multiple run_with_project_env calls.',
      register: server => {
        server.tool(
          'run_script',
          [
            'Run an inline script with project secrets available as environment variables.',
            'Use this instead of multiple run_with_project_env calls — write the full logic in one script.',
            'Filesystem is NOT shared between calls. Secret values never appear in this conversation.',
          ].join(' '),
          {
            project: z.string().describe('Project name'),
            lang: z.enum(['node', 'python']).describe('Script language'),
            code: z.string().min(1).describe('Full script source code'),
            max_chars: z.number().int().min(1).max(32000).optional().describe('Max output chars (default ~500)'),
            confirm: z.boolean().optional().describe('Set to true to confirm execution of a medium-risk script after reviewing the warning'),
          },
          async ({ project, lang, code, max_chars, confirm }) => {
            try {
              const cfg = config.load()
              const allowedDomains = await vault.getAllowedDomains(project)
              const keyNames = await vault.listKeys(project)
              const hints = extractHints(project, keyNames)
              const sec = createAnalyzer(cfg, allowedDomains, hints).analyzeScript(lang, code)
              audit.log('security_check', 'mcp', { project, lang, risk: sec.risk, findings: sec.findings.map(f => f.pattern) }, sec.allowed ? 'ok' : 'blocked')
              if (!sec.allowed) return err(`Security check blocked script: ${sec.reason}`)
              if (sec.risk === 'medium' && !confirm) {
                return ok({
                  requires_confirmation: true,
                  risk: sec.risk,
                  warning: `Script flagged as ${sec.risk.toUpperCase()} risk. Review findings and re-call with confirm: true to proceed.`,
                  findings: sec.findings.map(f => ({ pattern: f.pattern, description: f.description })),
                })
              }
              const env = await vault.getEnv(project)
              const result = runScript(lang, code, env, max_chars ?? cfg.exec_max_output)
              audit.log('run_script', 'mcp', { project, lang }, result.exit_code === 0 ? 'ok' : 'fail')
              const res: Record<string, unknown> = { exit_code: result.exit_code, stdout: result.stdout }
              if (result.stderr) res.stderr = result.stderr
              if (result.truncated) res.truncated = true
              return ok(res)
            } catch (e) {
              audit.log('run_script', 'mcp', { project }, 'denied')
              return err(String(e))
            }
          },
        )
      },
    },

    {
      name: 'env_keys',
      summary: 'List key names in a .env file. Values are never returned.',
      register: server => {
        server.tool(
          'env_keys',
          'List key names in a .env file. Values are never returned.',
          { path: z.string().describe('Absolute path to the .env file') },
          ({ path }) => {
            try { return ok({ path, keys: listEnvKeys(path) }) }
            catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'env_set',
      summary: 'Insert or update a key=value pair in a .env file.',
      register: server => {
        server.tool(
          'env_set',
          'Insert or update a key=value pair in a .env file. Creates the file if it does not exist.',
          {
            path: z.string().describe('Absolute path to the .env file'),
            key: z.string().describe('Variable name, e.g. API_KEY'),
            value: z.string().describe('Value to set'),
          },
          ({ path, key, value }) => {
            try {
              setEnvKey(path, key, value)
              audit.log('env_set', 'mcp', { path, key }, 'ok')
              return ok({ path, key, updated: true })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'set_project_folder',
      summary: 'Set (or clear) the local folder path associated with a project.',
      register: server => {
        server.tool(
          'set_project_folder',
          'Associate a local folder path with a project. Pass null to remove the association.',
          {
            project: z.string().describe('Project name'),
            folder_path: z.string().nullable().describe('Absolute folder path, or null to clear'),
          },
          async ({ project, folder_path }) => {
            try {
              await vault.setFolder(project, folder_path ?? undefined)
              audit.log('set_project_folder', 'mcp', { project, folder_path }, 'ok')
              return ok({ project, folder_path })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'set_project_domains',
      summary: 'Set allowed outbound domains for a project. Requests to other domains will be blocked.',
      register: server => {
        server.tool(
          'set_project_domains',
          [
            'Set the list of domains this project\'s secrets are allowed to be sent to.',
            'Pass null to remove restrictions. Example: ["api.stripe.com", "zorin.pw"]',
            'After setting, run_with_project_env and run_script will block requests to any other domain.',
          ].join(' '),
          {
            project: z.string().describe('Project name'),
            domains: z.array(z.string()).nullable().describe('Domain list (no protocol), or null to remove restriction'),
          },
          async ({ project, domains }) => {
            try {
              await vault.setAllowedDomains(project, domains)
              audit.log('set_project_domains', 'mcp', { project, domains }, 'ok')
              return ok({ project, allowed_domains: domains })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },

    {
      name: 'get_settings',
      summary: 'Show current Zocket settings: security mode, loading mode, execution policy.',
      register: server => {
        server.tool(
          'get_settings',
          'Show current Zocket settings: security mode, loading mode, execution policy.',
          async () => {
            const cfg = config.load()
            return ok({
              security_mode:            cfg.security_mode,
              security_block_threshold: cfg.security_block_threshold,
              mcp_loading:              cfg.mcp_loading,
              exec_allow_list:          cfg.exec_allow_list,
              exec_max_output:          cfg.exec_max_output,
              exec_allow_substitution:  cfg.exec_allow_substitution,
            })
          },
        )
      },
    },

    {
      name: 'configure',
      summary: 'Update Zocket settings: security mode (off/audit/enforce), loading mode (eager/lazy), block threshold.',
      register: server => {
        server.tool(
          'configure',
          [
            'Update Zocket settings. All parameters are optional — only provided fields are changed.',
            'security_mode: off (disabled), audit (log only), enforce (block threats).',
            'mcp_loading: eager (all tools at connect), lazy (on-demand via activate_tool). Takes effect on next server restart.',
            'security_block_threshold: minimum risk level that triggers a block (low/medium/high/critical).',
          ].join(' '),
          {
            security_mode:            z.enum(['off', 'audit', 'enforce']).optional()
              .describe('Security analysis mode'),
            security_block_threshold: z.enum(['low', 'medium', 'high', 'critical']).optional()
              .describe('Block commands at this risk level and above'),
            mcp_loading:              z.enum(['eager', 'lazy']).optional()
              .describe('Tool registration strategy (takes effect on restart)'),
          },
          async ({ security_mode, security_block_threshold, mcp_loading }) => {
            try {
              const cfg = config.load()
              if (security_mode            !== undefined) cfg.security_mode            = security_mode
              if (security_block_threshold !== undefined) cfg.security_block_threshold = security_block_threshold
              if (mcp_loading              !== undefined) cfg.mcp_loading              = mcp_loading
              config.save(cfg)
              audit.log('configure', 'mcp', { security_mode, security_block_threshold, mcp_loading }, 'ok')
              return ok({
                security_mode:            cfg.security_mode,
                security_block_threshold: cfg.security_block_threshold,
                mcp_loading:              cfg.mcp_loading,
                note: mcp_loading !== undefined ? 'mcp_loading takes effect on next server restart' : undefined,
              })
            } catch (e) { return err(String(e)) }
          },
        )
      },
    },
  ]
}

// ── Server factory ────────────────────────────────────────────────────────────

export function createMcpServer(services: McpServices, options: McpOptions = {}): McpServer {
  const { loading = services.config.load().mcp_loading } = options

  const server = new McpServer(
    { name: 'zocket', version: '1.0.0' },
    { instructions: SYSTEM_INSTRUCTIONS },
  )

  const catalog = buildCatalog(services)

  if (loading === 'eager') {
    for (const entry of catalog) entry.register(server, services)
    return server
  }

  // ── Lazy mode ──────────────────────────────────────────────────────────────
  const activated = new Set<string>()

  server.tool(
    'list_tools_summary',
    'List available tools with short descriptions. Call activate_tool(name) to unlock one before use.',
    {
      query: z.string().optional().describe('Optional filter — returns tools whose name or summary contains this string'),
    },
    ({ query }) => {
      const q = query?.toLowerCase()
      const tools = catalog
        .filter(e => !q || e.name.includes(q) || e.summary.toLowerCase().includes(q))
        .map(e => ({ name: e.name, summary: e.summary, active: activated.has(e.name) }))
      return ok({ tools })
    },
  )

  server.tool(
    'activate_tool',
    'Register a tool by name so it becomes available. Call list_tools_summary first to see options.',
    { name: z.string().describe('Tool name to activate') },
    async ({ name }) => {
      const entry = catalog.find(e => e.name === name)
      if (!entry) return err(`Unknown tool: ${name}. Call list_tools_summary to see available tools.`)
      if (activated.has(name)) return ok({ name, status: 'already_active' })
      entry.register(server, services)
      activated.add(name)
      try {
        await server.server.notification({ method: 'notifications/tools/list_changed' })
      } catch { /* client may not support notifications — tool is still usable */ }
      return ok({ name, status: 'activated' })
    },
  )

  return server
}
