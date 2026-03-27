import { spawnSync } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

export type ScriptLang = 'node'

export interface RunResult {
  exit_code: number
  stdout: string
  stderr?: string
  truncated: boolean
}

export interface ExecPolicy {
  allow_list: string[] | null
  max_output: number
  allow_substitution: boolean
}

/** Substitute $VAR and ${VAR} placeholders in command args. */
function substituteEnv(args: string[], env: Record<string, string>): string[] {
  return args.map(arg =>
    arg.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_, a, b) => env[a ?? b] ?? ''),
  )
}

function trimResult(stdout: string, stderr: string, maxChars: number): RunResult & { exit_code: number } {
  const truncated = stdout.length > maxChars || stderr.length > maxChars
  const result: RunResult & { exit_code: number } = {
    exit_code: 0,
    stdout: stdout.slice(0, maxChars),
    truncated,
  }
  if (stderr.trim()) result.stderr = stderr.slice(0, maxChars)
  return result
}

/**
 * Run a command array with env substitution.
 * Used by run_with_project_env MCP tool.
 */
export function runCommand(
  command: string[],
  env: Record<string, string>,
  policy: ExecPolicy,
  maxChars = 500,
): RunResult {
  const [bin, ...rawArgs] = command
  if (!bin) throw new Error('Command is empty')

  if (policy.allow_list !== null && !policy.allow_list.includes(bin)) {
    throw new Error(`Command is not allowed: ${bin}`)
  }

  const args = policy.allow_substitution ? substituteEnv(rawArgs, env) : rawArgs

  const proc = spawnSync(bin, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })

  const r = trimResult(proc.stdout ?? '', proc.stderr ?? '', maxChars)
  r.exit_code = proc.status ?? 1
  return r
}

/**
 * Run an inline script with env injected.
 * Writes code to a temp file, executes it, cleans up.
 * Used by run_script MCP tool.
 */
export function runScript(
  _lang: ScriptLang,
  code: string,
  env: Record<string, string>,
  maxChars = 500,
): RunResult {
  const ext = '.mjs'
  const tmpFile = join(tmpdir(), `zkt-${randomBytes(8).toString('hex')}${ext}`)

  try {
    writeFileSync(tmpFile, code, 'utf8')
    const bin = 'node'

    const proc = spawnSync(bin, [tmpFile], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })

    const r = trimResult(proc.stdout ?? '', proc.stderr ?? '', maxChars)
    r.exit_code = proc.status ?? 1
    return r
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}
