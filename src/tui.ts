import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import type { VaultService } from './vault.js'
import type { ConfigStore } from './config.js'
import type { AuditLogger } from './audit.js'

type Services = {
  vault: VaultService
  config: ConfigStore
  audit: AuditLogger
}

async function promptMenu(rl: readline.Interface, title: string, options: string[]): Promise<number> {
  output.write(`\n${title}\n`)
  options.forEach((opt, i) => output.write(`  ${i + 1}) ${opt}\n`))
  const answer = await rl.question('> ')
  const idx = Number(answer.trim()) - 1
  return Number.isFinite(idx) && idx >= 0 && idx < options.length ? idx : -1
}

async function promptInput(rl: readline.Interface, label: string, fallback = ''): Promise<string> {
  const ans = await rl.question(`${label}${fallback ? ` (${fallback})` : ''}: `)
  return ans.trim() || fallback
}

async function promptConfirm(rl: readline.Interface, label: string): Promise<boolean> {
  const ans = await rl.question(`${label} [y/N]: `)
  return ans.trim().toLowerCase() === 'y'
}

async function pickProject(rl: readline.Interface, vault: VaultService): Promise<string | null> {
  const rows = await vault.listProjects()
  if (!rows.length) {
    output.write('No projects\n')
    return null
  }
  const idx = await promptMenu(rl, 'Select project', rows.map(r => `${r.name} (${r.secret_count})`))
  if (idx < 0) return null
  return rows[idx].name
}

async function showProjects(vault: VaultService): Promise<void> {
  const rows = await vault.listProjects()
  if (!rows.length) {
    output.write('No projects\n')
    return
  }
  rows.forEach(r => {
    output.write(`${r.name}\t${r.secret_count}\t${r.folder_path ?? ''}\n`)
  })
}

async function showSecrets(vault: VaultService, project: string, showValues: boolean): Promise<void> {
  const rows = await vault.listSecrets(project)
  if (!rows.length) {
    output.write('No secrets\n')
    return
  }
  for (const r of rows) {
    if (showValues) {
      const v = await vault.getSecretValue(project, r.key)
      output.write(`${r.key}\t${v}\t${r.description ?? ''}\n`)
    } else {
      output.write(`${r.key}\t${r.description ?? ''}\n`)
    }
  }
}

export async function runTui(services: Services): Promise<void> {
  const rl = readline.createInterface({ input, output })
  const { vault } = services
  try {
    while (true) {
      const main = await promptMenu(rl, 'Zocket TUI', [
        'Projects',
        'Secrets',
        'Exit',
      ])
      if (main === 2) break

      if (main === 0) {
        const idx = await promptMenu(rl, 'Projects', [
          'List',
          'Create',
          'Delete',
          'Set folder path',
          'Set allowed domains',
          'Back',
        ])
        if (idx === 5) continue
        if (idx === 0) await showProjects(vault)
        if (idx === 1) {
          const name = await promptInput(rl, 'Project name')
          const desc = await promptInput(rl, 'Description', '')
          const folder = await promptInput(rl, 'Folder path', '')
          await vault.createProject(name, desc)
          if (folder) await vault.setFolder(name, folder)
          output.write('Project created\n')
        }
        if (idx === 2) {
          const name = await pickProject(rl, vault)
          if (!name) continue
          if (await promptConfirm(rl, `Delete ${name}?`)) {
            await vault.deleteProject(name)
            output.write('Project deleted\n')
          }
        }
        if (idx === 3) {
          const name = await pickProject(rl, vault)
          if (!name) continue
          const path = await promptInput(rl, 'Folder path (empty to clear)', '')
          await vault.setFolder(name, path || undefined)
          output.write('Folder updated\n')
        }
        if (idx === 4) {
          const name = await pickProject(rl, vault)
          if (!name) continue
          const domains = await promptInput(rl, 'Allowed domains (comma-separated, empty to clear)', '')
          const value = domains ? domains.split(',').map(s => s.trim()).filter(Boolean) : null
          await vault.setAllowedDomains(name, value)
          output.write('Allowed domains updated\n')
        }
      }

      if (main === 1) {
        const project = await pickProject(rl, vault)
        if (!project) continue
        const idx = await promptMenu(rl, `Secrets for ${project}`, [
          'List (no values)',
          'List (with values)',
          'Add or update',
          'Get value',
          'Delete',
          'Back',
        ])
        if (idx === 5) continue
        if (idx === 0) await showSecrets(vault, project, false)
        if (idx === 1) await showSecrets(vault, project, true)
        if (idx === 2) {
          const key = await promptInput(rl, 'Key (UPPERCASE)', '')
          const value = await promptInput(rl, 'Value', '')
          const desc = await promptInput(rl, 'Description', '')
          await vault.setSecret(project, key, value, desc)
          output.write('Secret saved\n')
        }
        if (idx === 3) {
          const key = await promptInput(rl, 'Key', '')
          const value = await vault.getSecretValue(project, key)
          output.write(`${value}\n`)
        }
        if (idx === 4) {
          const key = await promptInput(rl, 'Key', '')
          if (await promptConfirm(rl, `Delete ${key}?`)) {
            await vault.deleteSecret(project, key)
            output.write('Secret deleted\n')
          }
        }
      }
    }
  } finally {
    rl.close()
  }
}
