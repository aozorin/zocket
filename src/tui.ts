import blessed from 'blessed'
import type { Widgets } from 'blessed'
import { readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { VaultService } from './vault.js'
import type { ConfigStore } from './config.js'
import type { AuditLogger } from './audit.js'
import { applyDefence, normalizeDefence } from './defence.js'

type Services = {
  vault: VaultService
  config: ConfigStore
  audit: AuditLogger
}

type ProjectRow = {
  name: string
  description?: string | null
  folder_path?: string | null
  secret_count: number
}

type SecretRow = {
  key: string
  description?: string | null
  updated_at?: string | null
}

function safeText(value: string | null | undefined): string {
  if (!value) return ''
  return String(value)
}

function buildProjectLabel(row: ProjectRow): string {
  const count = row.secret_count ?? 0
  return `${row.name} (${count})`
}

export async function runTui(services: Services): Promise<void> {
  const { vault, config } = services
  const screen = blessed.screen({
    smartCSR: true,
    title: 'zocket',
  })

  const header = blessed.box({
    parent: screen,
    top: 0,
    height: 1,
    width: '100%',
    style: { fg: 'white', bg: 'blue' },
    content: ' zocket • TUI  |  q:quit  tab:switch  r:refresh  v:values  n:new project  d:delete  s:set  e:edit  x:delete  o:export  i:import  g:settings',
  })

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    height: 1,
    width: '100%',
    style: { fg: 'black', bg: 'white' },
    content: ' Ready',
  })

  const projectList = blessed.list({
    parent: screen,
    label: ' Projects ',
    top: 1,
    left: 0,
    bottom: 1,
    width: '30%',
    border: 'line',
    keys: true,
    mouse: true,
    style: {
      selected: { bg: 'blue', fg: 'white' },
      border: { fg: 'cyan' },
    },
    scrollbar: {
      ch: ' ',
      inverse: true,
    },
  })

  const secretTable = blessed.listtable({
    parent: screen,
    label: ' Secrets ',
    top: 1,
    left: '30%',
    bottom: 1,
    width: '70%',
    border: 'line',
    keys: true,
    mouse: true,
    align: 'left',
    noCellBorders: true,
    style: {
      header: { fg: 'yellow', bold: true },
      cell: { fg: 'white' },
      selected: { bg: 'blue', fg: 'white' },
      border: { fg: 'cyan' },
    },
  })

  const prompt = blessed.prompt({
    parent: screen,
    border: 'line',
    height: 9,
    width: '60%',
    top: 'center',
    left: 'center',
    label: ' Input ',
    keys: true,
    vi: true,
  })

  const confirm = blessed.question({
    parent: screen,
    border: 'line',
    height: 7,
    width: '60%',
    top: 'center',
    left: 'center',
    label: ' Confirm ',
    keys: true,
    vi: true,
  })

  let projects: ProjectRow[] = []
  let secrets: SecretRow[] = []
  let currentProject: ProjectRow | null = null
  let showValues = false

  function setStatus(message: string) {
    footer.setContent(` ${message}`)
    screen.render()
  }

  function setFocusPane(pane: 'projects' | 'secrets') {
    if (pane === 'projects') {
      projectList.style.border.fg = 'green'
      secretTable.style.border.fg = 'cyan'
      projectList.setLabel(' Projects ')
      secretTable.setLabel(' Secrets ')
      projectList.focus()
    } else {
      projectList.style.border.fg = 'cyan'
      secretTable.style.border.fg = 'green'
      projectList.setLabel(' Projects ')
      secretTable.setLabel(' Secrets ')
      secretTable.focus()
    }
    screen.render()
  }

  async function askInput(label: string, initial = ''): Promise<string | null> {
    return await new Promise(resolve => {
      prompt.input(label, initial, (err, value) => {
        if (err) return resolve(null)
        resolve(value ?? '')
      })
    })
  }

  async function askConfirm(label: string): Promise<boolean> {
    return await new Promise(resolve => {
      confirm.ask(label, (err, answer) => {
        if (err) return resolve(false)
        resolve(Boolean(answer))
      })
    })
  }

  async function refreshProjects(selectName?: string) {
    projects = await vault.listProjects()
    if (!projects.length) {
      projectList.setItems(['(no projects)'])
      projectList.select(0)
      currentProject = null
      return
    }
    const labels = projects.map(buildProjectLabel)
    projectList.setItems(labels)
    let idx = 0
    if (selectName) {
      const found = projects.findIndex(p => p.name === selectName)
      if (found >= 0) idx = found
    } else if (currentProject) {
      const found = projects.findIndex(p => p.name === currentProject?.name)
      if (found >= 0) idx = found
    }
    projectList.select(idx)
    currentProject = projects[idx]
  }

  async function refreshSecrets() {
    if (!currentProject) {
      secretTable.setData([['Key', 'Value', 'Description', 'Updated']])
      return
    }
    secrets = await vault.listSecrets(currentProject.name)
    let rows: string[][]
    if (!secrets.length) {
      rows = [[showValues ? 'Key' : 'Key', showValues ? 'Value' : 'Description', 'Updated']]
    } else {
      if (showValues) {
        const values = await Promise.all(secrets.map(s => vault.getSecretValue(currentProject!.name, s.key)))
        rows = [
          ['Key', 'Value', 'Description', 'Updated'],
          ...secrets.map((s, i) => [
            s.key,
            safeText(values[i]),
            safeText(s.description),
            safeText(s.updated_at),
          ]),
        ]
      } else {
        rows = [
          ['Key', 'Description', 'Updated'],
          ...secrets.map(s => [s.key, safeText(s.description), safeText(s.updated_at)]),
        ]
      }
    }
    secretTable.setData(rows)
  }

  async function refreshAll() {
    await refreshProjects()
    await refreshSecrets()
    screen.render()
  }

  async function createProject() {
    const name = await askInput('Project name')
    if (!name) return
    const desc = await askInput('Description (optional)', '')
    const folder = await askInput('Folder path (optional)', '')
    await vault.createProject(name, desc ?? '')
    if (folder) await vault.setFolder(name, folder)
    setStatus(`Project created: ${name}`)
    await refreshProjects(name)
    await refreshSecrets()
  }

  async function deleteProject() {
    if (!currentProject) return
    const ok = await askConfirm(`Delete project ${currentProject.name}?`)
    if (!ok) return
    await vault.deleteProject(currentProject.name)
    setStatus(`Project deleted: ${currentProject.name}`)
    await refreshProjects()
    await refreshSecrets()
  }

  async function setProjectFolder() {
    if (!currentProject) return
    const path = await askInput('Folder path (empty to clear)', currentProject.folder_path ?? '')
    if (path === null) return
    await vault.setFolder(currentProject.name, path.trim() || undefined)
    setStatus('Folder updated')
    await refreshProjects(currentProject.name)
  }

  async function setAllowedDomains() {
    if (!currentProject) return
    const initial = (await vault.getAllowedDomains(currentProject.name))?.join(', ') ?? ''
    const domains = await askInput('Allowed domains (comma-separated)', initial)
    if (domains === null) return
    const value = domains
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    await vault.setAllowedDomains(currentProject.name, value.length ? value : null)
    setStatus('Allowed domains updated')
  }

  async function exportVault() {
    const def = join(homedir(), 'zocket-export.json')
    const path = await askInput('Export file path', def)
    if (!path) return
    const data = await vault.exportData()
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
    setStatus(`Exported: ${path}`)
  }

  async function importVault() {
    const def = join(homedir(), 'zocket-export.json')
    const path = await askInput('Import file path', def)
    if (!path) return
    const modeRaw = await askInput('Import mode (merge/replace)', 'merge')
    const mode = modeRaw?.trim() === 'replace' ? 'replace' : 'merge'
    const ok = await askConfirm(`Import (${mode}) from ${path}?`)
    if (!ok) return
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    await vault.importData(parsed, mode)
    setStatus(`Imported (${mode}): ${path}`)
    await refreshAll()
  }

  async function updateSettings() {
    const cfg = config.load()
    const loading = await askInput('MCP loading (eager/lazy)', cfg.mcp_loading)
    if (!loading) return
    const defence = await askInput('Defence level (low/decent/high)', cfg.defence_level)
    if (!defence) return
    const next = applyDefence(cfg, normalizeDefence(defence))
    next.mcp_loading = loading.trim() === 'lazy' ? 'lazy' : 'eager'
    config.save(next)
    setStatus(`Settings saved: ${next.mcp_loading}, ${next.defence_level}`)
  }

  function selectedSecretKey(): string | null {
    if (!secrets.length) return null
    const idx = secretTable.selected - 1
    if (idx < 0 || idx >= secrets.length) return null
    return secrets[idx].key
  }

  async function upsertSecret(edit = false) {
    if (!currentProject) return
    let key = ''
    let value = ''
    let desc = ''
    if (edit) {
      const selectedKey = selectedSecretKey()
      if (!selectedKey) return
      key = selectedKey
      desc = secrets.find(s => s.key === selectedKey)?.description ?? ''
      value = showValues ? (await vault.getSecretValue(currentProject.name, selectedKey)) : ''
    }
    const keyInput = await askInput('Key (UPPERCASE)', key)
    if (!keyInput) return
    const valueInput = await askInput('Value', value)
    if (valueInput === null) return
    const descInput = await askInput('Description (optional)', desc)
    await vault.setSecret(currentProject.name, keyInput, valueInput, descInput ?? '')
    setStatus('Secret saved')
    await refreshSecrets()
  }

  async function deleteSecret() {
    if (!currentProject) return
    const key = selectedSecretKey()
    if (!key) return
    const ok = await askConfirm(`Delete secret ${key}?`)
    if (!ok) return
    await vault.deleteSecret(currentProject.name, key)
    setStatus(`Secret deleted: ${key}`)
    await refreshSecrets()
  }

  projectList.on('select', async (_: Widgets.ListElement, idx: number) => {
    currentProject = projects[idx] ?? null
    await refreshSecrets()
    screen.render()
  })

  screen.key(['q', 'C-c'], () => process.exit(0))
  screen.key(['tab'], () => {
    if (screen.focused === projectList) setFocusPane('secrets')
    else setFocusPane('projects')
  })
  screen.key(['r'], async () => {
    setStatus('Refreshing...')
    await refreshAll()
    setStatus('Ready')
  })
  screen.key(['v'], async () => {
    showValues = !showValues
    setStatus(showValues ? 'Values: visible' : 'Values: hidden')
    await refreshSecrets()
    screen.render()
  })
  screen.key(['n'], async () => {
    await createProject()
    screen.render()
  })
  screen.key(['d'], async () => {
    await deleteProject()
    screen.render()
  })
  screen.key(['f'], async () => {
    await setProjectFolder()
    screen.render()
  })
  screen.key(['a'], async () => {
    await setAllowedDomains()
    screen.render()
  })
  screen.key(['s'], async () => {
    await upsertSecret(false)
    screen.render()
  })
  screen.key(['e'], async () => {
    await upsertSecret(true)
    screen.render()
  })
  screen.key(['x'], async () => {
    await deleteSecret()
    screen.render()
  })
  screen.key(['o'], async () => {
    await exportVault()
    screen.render()
  })
  screen.key(['i'], async () => {
    await importVault()
    screen.render()
  })
  screen.key(['g'], async () => {
    await updateSettings()
    screen.render()
  })

  await refreshAll()
  setFocusPane('projects')
  screen.render()
}
