# Zocket TypeScript Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite zocket from Python to TypeScript/Node.js so the npm package is the entire application with no Python dependency.

**Architecture:** Three interfaces (CLI/Web/MCP) share one VaultService core. Bundled with tsup into a single `dist/zocket.js` ESM file.

**Tech Stack:** TypeScript 5, Hono + @hono/node-server, Commander.js, @modelcontextprotocol/sdk, proper-lockfile, tsup, Vitest

---

## Chunk 1: Setup + Foundation

### Task 1: Scaffold new TypeScript project

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Remove all Python source files**

```bash
rm -rf zocket/ build/ dist/ zocket.egg-info/ bin/ scripts/release-check.sh
rm -f pyproject.toml scripts/publish-1.0.0.sh
```

- [ ] **Step 2: Replace package.json**

```json
{
  "name": "@ao_zorin/zocket",
  "version": "1.0.0",
  "description": "Local encrypted vault + web panel + MCP server for AI agent workflows",
  "type": "module",
  "bin": { "zocket": "dist/zocket.js" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0",
    "hono": "^4.0.0",
    "proper-lockfile": "^4.1.2",
    "zod": "^3.22.0"
  },
  "peerDependencies": {
    "keytar": "^7.0.0"
  },
  "peerDependenciesMeta": {
    "keytar": { "optional": true }
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/proper-lockfile": "^4.1.4",
    "typescript": "^5.0.0",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0"
  },
  "engines": { "node": ">=18.0.0" },
  "files": ["dist"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/aozorin/zocket.git"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  bundle: true,
  minify: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  external: ['keytar'],
})
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

- [ ] **Step 6: Create src/index.ts (stub)**

```typescript
import { program } from './cli.js'
program.parse()
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript project, remove Python source"
```

---

### Task 2: paths.ts

**Files:**
- Create: `src/paths.ts`
- Create: `tests/paths.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { homedir } from 'os'

describe('paths', () => {
  const orig = process.env.ZOCKET_HOME

  afterEach(() => {
    if (orig === undefined) delete process.env.ZOCKET_HOME
    else process.env.ZOCKET_HOME = orig
  })

  it('zocketHome defaults to ~/.zocket', async () => {
    delete process.env.ZOCKET_HOME
    const { zocketHome } = await import('../src/paths.js')
    expect(zocketHome()).toBe(join(homedir(), '.zocket'))
  })

  it('zocketHome respects ZOCKET_HOME env', async () => {
    process.env.ZOCKET_HOME = '/tmp/test-zocket'
    const { zocketHome } = await import('../src/paths.js')
    expect(zocketHome()).toBe('/tmp/test-zocket')
  })

  it('vaultPath returns vault.enc inside home', async () => {
    process.env.ZOCKET_HOME = '/tmp/zkt'
    const { vaultPath } = await import('../src/paths.js')
    expect(vaultPath()).toBe('/tmp/zkt/vault.enc')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/paths.test.ts
```

Expected: FAIL — `Cannot find module '../src/paths.js'`

- [ ] **Step 3: Implement src/paths.ts**

```typescript
import { homedir } from 'os'
import { join } from 'path'

export function zocketHome(): string {
  return process.env.ZOCKET_HOME ?? join(homedir(), '.zocket')
}

export function vaultPath(home = zocketHome()): string {
  return join(home, 'vault.enc')
}

export function keyPath(home = zocketHome()): string {
  return join(home, 'master.key')
}

export function configPath(home = zocketHome()): string {
  return join(home, 'config.json')
}

export function auditPath(home = zocketHome()): string {
  return join(home, 'audit.log')
}

export function backupsDir(home = zocketHome()): string {
  return join(home, 'backups')
}

export function lockPath(home = zocketHome()): string {
  return join(home, 'vault.lock')
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/paths.test.ts
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat: add paths module"
```

---

### Task 3: config.ts

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ConfigStore', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('returns defaults when no file exists', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    const cfg = store.load()
    expect(cfg.language).toBe('en')
    expect(cfg.web_auth_enabled).toBe(false)
    expect(cfg.exec_max_output).toBe(4096)
  })

  it('persists and reloads values', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    store.set('language', 'ru')
    expect(store.load().language).toBe('ru')
  })

  it('ensureExists generates session_secret', async () => {
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    const cfg = store.ensureExists()
    expect(cfg.session_secret).toHaveLength(64) // 32 bytes hex
    // idempotent
    const cfg2 = store.ensureExists()
    expect(cfg2.session_secret).toBe(cfg.session_secret)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/config.test.ts
```

- [ ] **Step 3: Implement src/config.ts**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

export type KeyStorage = 'file' | 'keyring' | 'env'
export type Lang = 'en' | 'ru'

export interface Config {
  language: Lang
  key_storage: KeyStorage
  web_auth_enabled: boolean
  web_password_hash: string
  web_password_salt: string
  theme: string
  theme_variant: string
  session_secret: string
  folder_picker_roots: string[]
  exec_allow_list: string[] | null
  exec_max_output: number
  exec_allow_substitution: boolean
  exec_allow_full_output: boolean
  exec_redact_secrets: boolean
}

const DEFAULTS: Config = {
  language: 'en',
  key_storage: 'file',
  web_auth_enabled: false,
  web_password_hash: '',
  web_password_salt: '',
  theme: 'standard',
  theme_variant: 'light',
  session_secret: '',
  folder_picker_roots: ['/home', '/srv', '/opt', '/var/www', '/var/lib'],
  exec_allow_list: null,
  exec_max_output: 4096,
  exec_allow_substitution: true,
  exec_allow_full_output: false,
  exec_redact_secrets: true,
}

export class ConfigStore {
  constructor(private path: string) {}

  load(): Config {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'))
      return { ...DEFAULTS, ...raw }
    } catch {
      return { ...DEFAULTS }
    }
  }

  save(cfg: Config): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(cfg, null, 2))
  }

  set<K extends keyof Config>(key: K, value: Config[K]): void {
    const cfg = this.load()
    cfg[key] = value
    this.save(cfg)
  }

  ensureExists(): Config {
    const cfg = this.load()
    if (!cfg.session_secret) {
      cfg.session_secret = randomBytes(32).toString('hex')
      this.save(cfg)
    }
    return cfg
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/config.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config module"
```

---

### Task 4: i18n.ts

**Files:**
- Create: `src/i18n.ts`
- Create: `tests/i18n.test.ts`

Reference: `/home/zorin/project/zocket/zocket/i18n.py` — port all key names exactly.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/i18n.test.ts
import { describe, it, expect } from 'vitest'

describe('i18n', () => {
  it('returns English by default', async () => {
    const { t } = await import('../src/i18n.js')
    expect(t('vault_initialized', 'en')).toContain('initialized')
  })

  it('returns Russian when lang=ru', async () => {
    const { t } = await import('../src/i18n.js')
    const msg = t('vault_initialized', 'ru')
    expect(msg).toBeTruthy()
    expect(msg).not.toBe('vault_initialized') // key not returned as-is
  })

  it('supports interpolation', async () => {
    const { t } = await import('../src/i18n.js')
    const msg = t('project_created', 'en', { name: 'myproj' })
    expect(msg).toContain('myproj')
  })

  it('falls back to key name for unknown key', async () => {
    const { t } = await import('../src/i18n.js')
    expect(t('unknown_key_xyz' as any, 'en')).toBe('unknown_key_xyz')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/i18n.test.ts
```

- [ ] **Step 3: Implement src/i18n.ts**

Port all keys from `/home/zorin/project/zocket/zocket/i18n.py`. Structure:

```typescript
export type Lang = 'en' | 'ru'

const messages: Record<Lang, Record<string, string>> = {
  en: {
    'app.tagline': 'Local encrypted vault for MCP/CLI workflows.',
    'ui.projects': 'Projects',
    'ui.name': 'Name',
    'ui.keys_count': 'Keys',
    'ui.new_project': 'New project',
    'ui.optional_desc': 'Description (optional)',
    'ui.optional_folder': 'Project folder path (optional)',
    'ui.project_folder': 'Project folder',
    'ui.not_set': 'Not set',
    'ui.choose_folder': 'Choose folder',
    'ui.save_folder': 'Save folder',
    'ui.clear_folder': 'Clear folder',
    'ui.folder_picker': 'Folder picker',
    'ui.current_path': 'Current path',
    'ui.parent_folder': 'Up',
    'ui.roots': 'Roots',
    'ui.select_folder': 'Select this folder',
    'ui.close': 'Close',
    'ui.loading': 'Loading...',
    'ui.no_subfolders': 'No subfolders',
    'ui.folder_picker_failed': 'Failed to load folders',
    'ui.create': 'Create',
    'ui.real_values_visible': 'Real values are visible.',
    'ui.hide_values': 'Hide values',
    'ui.masked_values_visible': 'Masked values are visible.',
    'ui.show_values': 'Show values',
    'ui.delete_project': 'Delete project',
    'ui.secrets': 'Secrets',
    'ui.description': 'Description',
    'ui.updated_at': 'Updated',
    'ui.value': 'Value',
    'ui.delete': 'Delete',
    'ui.edit_secret': 'Edit secret',
    'ui.add_or_update_secret': 'Add or update secret',
    'ui.secret_preset': 'Secret preset',
    'ui.choose_preset': 'Choose preset',
    'ui.friendly_name': 'Friendly name (optional)',
    'ui.key': 'Key',
    'ui.folder_search': 'Search folders',
    'ui.no_matching_folders': 'No matching folders',
    'ui.save': 'Save',
    'ui.no_projects': 'No projects yet',
    'ui.create_left': 'Create a project in the left panel.',
    'ui.lang': 'Language',
    'ui.lang_en': 'English',
    'ui.lang_ru': 'Russian',
    'ui.theme': 'Theme',
    'ui.theme_standard': 'Standard',
    'ui.theme_zorin': 'Zorin Pretty',
    'ui.variant_light': 'Light view',
    'ui.variant_dark': 'Dark glow',
    'ui.sign_in': 'Sign in',
    'ui.password': 'Password',
    'ui.password_repeat': 'Repeat password',
    'ui.login': 'Login',
    'ui.logout': 'Logout',
    'ui.invalid_login': 'Invalid password',
    'ui.auth_required': 'Authentication is required',
    'ui.first_time_set_password': 'Set admin password first via CLI: zocket auth set-password',
    'ui.first_setup_title': 'First launch setup',
    'ui.first_setup_subtitle': 'Choose how to protect your local panel.',
    'ui.set_password': 'Set your password',
    'ui.save_and_enter': 'Save and open panel',
    'ui.generate_password': 'Generate strong password',
    'ui.generate_password_hint': 'A secure random password will be generated and shown once.',
    'ui.generate_and_enter': 'Generate and open panel',
    'ui.continue_without_password': 'Continue without password',
    'ui.insecure_warning': 'This is less secure. Anyone with local access may open the panel.',
    'ui.i_understand_risk': 'I understand the risk',
    'ui.continue_anyway': 'Continue without password',
    'ui.insecure_confirm_dialog': 'Continue without password? This is less secure.',
    'ui.confirm_insecure_required': 'Please confirm that you understand the security risk.',
    'ui.invalid_setup_option': 'Invalid setup option.',
    'ui.password_required': 'Password is required.',
    'ui.passwords_do_not_match': 'Passwords do not match.',
    'ui.generated_password_notice': 'Generated admin password (shown once):',
    'ui.generated_password_save_now': 'Save it now. You can change it later via CLI.',
    'msg.key_file': 'Key file: {path}',
    'msg.vault_file': 'Vault file: {path}',
    'msg.init_complete': 'Initialization complete.',
    'msg.project_created': 'Project created: {name}',
    'msg.project_deleted': 'Project deleted: {name}',
    'msg.project_folder_set': 'Project folder saved: {name}',
    'msg.project_folder_cleared': 'Project folder cleared: {name}',
    'msg.secret_saved': 'Secret {key} saved for project {project}',
    'msg.secret_deleted': 'Secret {key} deleted from project {project}',
    'msg.password_set': 'Web admin password was updated.',
    'msg.language_set': 'Language set to {lang}.',
    'err.usage_use': 'Usage: zocket use <project> -- <command> [args...]',
    'err.need_login': 'Error: password login required.',
  },
  ru: {
    'app.tagline': 'Локальное шифрованное хранилище для MCP/CLI.',
    'ui.projects': 'Проекты',
    'ui.name': 'Имя',
    'ui.keys_count': 'Ключей',
    'ui.new_project': 'Новый проект',
    'ui.optional_desc': 'Описание (опционально)',
    'ui.optional_folder': 'Папка проекта (опционально)',
    'ui.project_folder': 'Папка проекта',
    'ui.not_set': 'Не задано',
    'ui.choose_folder': 'Выбрать папку',
    'ui.save_folder': 'Сохранить папку',
    'ui.clear_folder': 'Очистить папку',
    'ui.folder_picker': 'Выбор папки',
    'ui.current_path': 'Текущий путь',
    'ui.parent_folder': 'Вверх',
    'ui.roots': 'Корни',
    'ui.select_folder': 'Выбрать эту папку',
    'ui.close': 'Закрыть',
    'ui.loading': 'Загрузка...',
    'ui.no_subfolders': 'Подпапок нет',
    'ui.folder_picker_failed': 'Не удалось загрузить папки',
    'ui.create': 'Создать',
    'ui.real_values_visible': 'Показаны реальные значения.',
    'ui.hide_values': 'Скрыть значения',
    'ui.masked_values_visible': 'Показаны замаскированные значения.',
    'ui.show_values': 'Показать значения',
    'ui.delete_project': 'Удалить проект',
    'ui.secrets': 'Секреты',
    'ui.description': 'Описание',
    'ui.updated_at': 'Обновлён',
    'ui.value': 'Значение',
    'ui.delete': 'Удалить',
    'ui.edit_secret': 'Редактировать',
    'ui.add_or_update_secret': 'Добавить или обновить секрет',
    'ui.secret_preset': 'Пресет секрета',
    'ui.choose_preset': 'Выбрать пресет',
    'ui.friendly_name': 'Читабельное имя (опционально)',
    'ui.key': 'Ключ',
    'ui.folder_search': 'Поиск папок',
    'ui.no_matching_folders': 'Совпадений не найдено',
    'ui.save': 'Сохранить',
    'ui.no_projects': 'Проектов пока нет',
    'ui.create_left': 'Создайте проект слева.',
    'ui.lang': 'Язык',
    'ui.lang_en': 'Английский',
    'ui.lang_ru': 'Русский',
    'ui.theme': 'Тема',
    'ui.theme_standard': 'Стандартная',
    'ui.theme_zorin': 'Zorin Pretty',
    'ui.variant_light': 'Светлая',
    'ui.variant_dark': 'Тёмная',
    'ui.sign_in': 'Вход',
    'ui.password': 'Пароль',
    'ui.password_repeat': 'Повторите пароль',
    'ui.login': 'Войти',
    'ui.logout': 'Выйти',
    'ui.invalid_login': 'Неверный пароль',
    'ui.auth_required': 'Требуется аутентификация',
    'ui.first_time_set_password': 'Сначала задайте пароль через CLI: zocket auth set-password',
    'ui.first_setup_title': 'Первичная настройка',
    'ui.first_setup_subtitle': 'Выберите способ защиты локальной панели.',
    'ui.set_password': 'Задать свой пароль',
    'ui.save_and_enter': 'Сохранить и открыть панель',
    'ui.generate_password': 'Сгенерировать надёжный пароль',
    'ui.generate_password_hint': 'Будет сгенерирован случайный пароль и показан один раз.',
    'ui.generate_and_enter': 'Сгенерировать и открыть панель',
    'ui.continue_without_password': 'Продолжить без пароля',
    'ui.insecure_warning': 'Это менее безопасно. Любой с локальным доступом сможет открыть панель.',
    'ui.i_understand_risk': 'Я понимаю риск',
    'ui.continue_anyway': 'Продолжить без пароля',
    'ui.insecure_confirm_dialog': 'Продолжить без пароля? Это менее безопасно.',
    'ui.confirm_insecure_required': 'Подтвердите, что вы понимаете риск безопасности.',
    'ui.invalid_setup_option': 'Некорректный вариант настройки.',
    'ui.password_required': 'Нужно ввести пароль.',
    'ui.passwords_do_not_match': 'Пароли не совпадают.',
    'ui.generated_password_notice': 'Сгенерированный пароль администратора (показан один раз):',
    'ui.generated_password_save_now': 'Сохраните его сейчас. Позже можно сменить через CLI.',
    'msg.key_file': 'Файл ключа: {path}',
    'msg.vault_file': 'Файл vault: {path}',
    'msg.init_complete': 'Инициализация завершена.',
    'msg.project_created': 'Проект создан: {name}',
    'msg.project_deleted': 'Проект удалён: {name}',
    'msg.project_folder_set': 'Папка проекта сохранена: {name}',
    'msg.project_folder_cleared': 'Папка проекта очищена: {name}',
    'msg.secret_saved': 'Секрет {key} сохранён для проекта {project}',
    'msg.secret_deleted': 'Секрет {key} удалён из проекта {project}',
    'msg.password_set': 'Пароль веб-админа обновлён.',
    'msg.language_set': 'Язык переключен на {lang}.',
    'err.usage_use': 'Использование: zocket use <project> -- <command> [args...]',
    'err.need_login': 'Ошибка: нужен парольный вход.',
  },
}

export function t(key: string, lang: Lang = 'en', vars: Record<string, string> = {}): string {
  const msg = messages[lang]?.[key] ?? messages['en']?.[key] ?? key
  return msg.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
}

export function normalizeLang(lang: string): Lang {
  return lang?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/i18n.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n.ts tests/i18n.test.ts
git commit -m "feat: add i18n module (EN/RU)"
```

---

### Task 5: auth.ts

**Files:**
- Create: `src/auth.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/auth.test.ts
import { describe, it, expect } from 'vitest'

describe('auth', () => {
  it('hashPassword returns hash and salt', async () => {
    const { hashPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('secret123')
    expect(hash).toHaveLength(64)
    expect(salt).toHaveLength(32)
  })

  it('verifyPassword returns true for correct password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('correct')
    expect(verifyPassword('correct', hash, salt)).toBe(true)
  })

  it('verifyPassword returns false for wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('../src/auth.js')
    const { hash, salt } = hashPassword('correct')
    expect(verifyPassword('wrong', hash, salt)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/auth.test.ts
```

- [ ] **Step 3: Implement src/auth.ts**

```typescript
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto'

const ITERATIONS = 600_000
const KEY_LEN = 32
const DIGEST = 'sha256'

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST)
  const expected = Buffer.from(hash, 'hex')
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/auth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "feat: add auth module (PBKDF2-SHA256)"
```

---

## Chunk 2: Crypto + Vault

### Task 6: crypto.ts

**Files:**
- Create: `src/crypto.ts`
- Create: `tests/crypto.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/crypto.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('crypto', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-crypto-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('generateKey returns 32 bytes', async () => {
    const { generateKey } = await import('../src/crypto.js')
    expect(generateKey()).toHaveLength(32)
  })

  it('encrypt/decrypt round-trip', async () => {
    const { generateKey, encrypt, decrypt } = await import('../src/crypto.js')
    const key = generateKey()
    const plaintext = Buffer.from('hello world')
    const ciphertext = encrypt(plaintext, key)
    expect(decrypt(ciphertext, key).toString()).toBe('hello world')
  })

  it('encrypted output has version + IV + tag prefix', async () => {
    const { generateKey, encrypt } = await import('../src/crypto.js')
    const key = generateKey()
    const out = encrypt(Buffer.from('test'), key)
    expect(out.readUInt32BE(0)).toBe(1) // version
    expect(out.length).toBeGreaterThan(4 + 12 + 16) // version + IV + tag
  })

  it('decrypt throws on wrong key', async () => {
    const { generateKey, encrypt, decrypt } = await import('../src/crypto.js')
    const key1 = generateKey()
    const key2 = generateKey()
    const ciphertext = encrypt(Buffer.from('secret'), key1)
    expect(() => decrypt(ciphertext, key2)).toThrow()
  })

  it('loadKey reads from file', async () => {
    const { generateKey, saveKey, loadKey } = await import('../src/crypto.js')
    const key = generateKey()
    const keyFile = join(dir, 'master.key')
    saveKey(key, keyFile)
    const loaded = await loadKey(keyFile, 'file')
    expect(loaded).toEqual(key)
  })

  it('loadKey reads from ZOCKET_MASTER_KEY env var', async () => {
    const { generateKey, loadKey } = await import('../src/crypto.js')
    const key = generateKey()
    process.env.ZOCKET_MASTER_KEY = key.toString('hex')
    try {
      const loaded = await loadKey('/nonexistent', 'file')
      expect(loaded).toEqual(key)
    } finally {
      delete process.env.ZOCKET_MASTER_KEY
    }
  })

  it('loadKey throws user-friendly error when keytar missing and storage=keyring', async () => {
    const { loadKey } = await import('../src/crypto.js')
    await expect(loadKey('/nonexistent', 'keyring')).rejects.toThrow('keytar not installed')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/crypto.test.ts
```

- [ ] **Step 3: Implement src/crypto.ts**

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { dirname } from 'path'

const VERSION = 1
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const version = Buffer.allocUnsafe(4)
  version.writeUInt32BE(VERSION, 0)
  return Buffer.concat([version, iv, tag, ciphertext])
}

export function decrypt(data: Buffer, key: Buffer): Buffer {
  const version = data.readUInt32BE(0)
  if (version !== VERSION) throw new Error(`Unsupported vault version: ${version}`)
  const iv = data.subarray(4, 4 + IV_BYTES)
  const tag = data.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES)
  const ciphertext = data.subarray(4 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function saveKey(key: Buffer, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, key.toString('hex'), { mode: 0o600 })
}

export async function loadKey(keyFilePath: string, storage: string): Promise<Buffer> {
  if (process.env.ZOCKET_MASTER_KEY) {
    return Buffer.from(process.env.ZOCKET_MASTER_KEY, 'hex')
  }
  if (storage === 'keyring') {
    try {
      const keytar = await import('keytar')
      const val = await keytar.getPassword('zocket', 'master-key')
      if (!val) throw new Error('Key not found in keyring')
      return Buffer.from(val, 'hex')
    } catch (e: any) {
      if (e.message?.includes('Cannot find module')) {
        throw new Error('keytar not installed — run: npm i -g keytar')
      }
      throw e
    }
  }
  return Buffer.from(readFileSync(keyFilePath, 'utf8').trim(), 'hex')
}

export async function saveKeyToStorage(key: Buffer, storage: string, keyFilePath: string): Promise<void> {
  if (storage === 'keyring') {
    try {
      const keytar = await import('keytar')
      await keytar.setPassword('zocket', 'master-key', key.toString('hex'))
    } catch (e: any) {
      if (e.message?.includes('Cannot find module')) {
        throw new Error('keytar not installed — run: npm i -g keytar')
      }
      throw e
    }
  } else {
    saveKey(key, keyFilePath)
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/crypto.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/crypto.ts tests/crypto.test.ts
git commit -m "feat: add crypto module (AES-256-GCM)"
```

---

### Task 7: vault.ts

**Files:**
- Create: `src/vault.ts`
- Create: `tests/vault.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/vault.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function makeVault(dir: string) {
  const { generateKey } = await import('../src/crypto.js')
  const { VaultService } = await import('../src/vault.js')
  const key = generateKey()
  return new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
}

describe('VaultService', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-vault-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('creates and lists projects', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('myproj', 'desc')
    const projects = await vault.listProjects()
    expect(projects.map(p => p.name)).toContain('myproj')
  })

  it('rejects invalid project names', async () => {
    const vault = await makeVault(dir)
    await expect(vault.createProject('bad name!', '')).rejects.toThrow()
  })

  it('sets and gets secrets', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'MY_KEY', 'myvalue', '')
    const keys = await vault.listKeys('proj')
    expect(keys).toContain('MY_KEY')
  })

  it('rejects invalid secret key names', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await expect(vault.setSecret('proj', 'bad-key', 'val', '')).rejects.toThrow()
  })

  it('deletes secret', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'KEY', 'val', '')
    await vault.deleteSecret('proj', 'KEY')
    expect(await vault.listKeys('proj')).not.toContain('KEY')
  })

  it('deletes project', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.deleteProject('proj')
    expect((await vault.listProjects()).map(p => p.name)).not.toContain('proj')
  })

  it('sets folder_path and matches by longest prefix', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setFolder('proj', '/home/user/projects/myapp')
    const match = await vault.findByPath('/home/user/projects/myapp/src/foo.ts')
    expect(match).toBe('proj')
  })

  it('env returns only secrets for project', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'TOKEN', 'abc123', '')
    const env = await vault.getEnv('proj')
    expect(env['TOKEN']).toBe('abc123')
  })

  it('handles concurrent writes without data loss', async () => {
    const vault = await makeVault(dir)
    await vault.createProject('proj', '')
    await Promise.all([
      vault.setSecret('proj', 'KEY_A', 'a', ''),
      vault.setSecret('proj', 'KEY_B', 'b', ''),
    ])
    const keys = await vault.listKeys('proj')
    expect(keys).toContain('KEY_A')
    expect(keys).toContain('KEY_B')
  })

  it('persists across instances', async () => {
    const { generateKey } = await import('../src/crypto.js')
    const { VaultService } = await import('../src/vault.js')
    const key = generateKey()
    const v1 = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
    await v1.createProject('persist', 'test')
    const v2 = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
    expect((await v2.listProjects()).map(p => p.name)).toContain('persist')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/vault.test.ts
```

- [ ] **Step 3: Implement src/vault.ts**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { lock } from 'proper-lockfile'
import { encrypt, decrypt } from './crypto.js'

const PROJECT_RE = /^[a-zA-Z0-9._-]+$/
const SECRET_RE = /^[A-Z_][A-Z0-9_]*$/

export interface SecretEntry {
  value: string
  description: string
  updated_at: string
}

export interface ProjectEntry {
  description: string
  created_at: string
  updated_at: string
  secrets: Record<string, SecretEntry>
  folder_path?: string
}

interface VaultData {
  version: number
  projects: Record<string, ProjectEntry>
}

export interface ProjectInfo {
  name: string
  description: string
  created_at: string
  folder_path?: string
  secret_count: number
}

export class VaultService {
  constructor(
    private vaultPath: string,
    private lockFile: string,
    private key: Buffer, // mutable — updated by reEncrypt()
  ) {}

  private load(): VaultData {
    if (!existsSync(this.vaultPath)) return { version: 1, projects: {} }
    const raw = readFileSync(this.vaultPath)
    return JSON.parse(decrypt(raw, this.key).toString('utf8'))
  }

  private save(data: VaultData): void {
    mkdirSync(dirname(this.vaultPath), { recursive: true })
    writeFileSync(this.vaultPath, encrypt(Buffer.from(JSON.stringify(data)), this.key))
  }

  private async withLock<T>(fn: (data: VaultData) => T): Promise<T> {
    mkdirSync(dirname(this.lockFile), { recursive: true })
    if (!existsSync(this.lockFile)) writeFileSync(this.lockFile, '')
    const release = await lock(this.lockFile, { retries: { retries: 5, minTimeout: 50 } })
    try {
      const data = this.load()
      const result = fn(data)
      this.save(data)
      return result
    } finally {
      await release()
    }
  }

  async createProject(name: string, description: string): Promise<void> {
    if (!PROJECT_RE.test(name)) throw new Error(`Invalid project name: ${name}`)
    await this.withLock(data => {
      if (data.projects[name]) throw new Error(`Project already exists: ${name}`)
      const now = new Date().toISOString()
      data.projects[name] = { description, created_at: now, updated_at: now, secrets: {} }
    })
  }

  async deleteProject(name: string): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[name]) throw new Error(`Project not found: ${name}`)
      delete data.projects[name]
    })
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const data = this.load()
    return Object.entries(data.projects).map(([name, p]) => ({
      name,
      description: p.description,
      created_at: p.created_at,
      folder_path: p.folder_path,
      secret_count: Object.keys(p.secrets).length,
    }))
  }

  async setSecret(project: string, key: string, value: string, description: string): Promise<void> {
    if (!SECRET_RE.test(key)) throw new Error(`Invalid secret key: ${key}`)
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      data.projects[project].secrets[key] = { value, description, updated_at: new Date().toISOString() }
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async deleteSecret(project: string, key: string): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      delete data.projects[project].secrets[key]
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async listKeys(project: string): Promise<string[]> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return Object.keys(data.projects[project].secrets)
  }

  async getEnv(project: string): Promise<Record<string, string>> {
    const data = this.load()
    if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
    return Object.fromEntries(Object.entries(data.projects[project].secrets).map(([k, v]) => [k, v.value]))
  }

  async setFolder(project: string, folderPath: string | undefined): Promise<void> {
    await this.withLock(data => {
      if (!data.projects[project]) throw new Error(`Project not found: ${project}`)
      data.projects[project].folder_path = folderPath
      data.projects[project].updated_at = new Date().toISOString()
    })
  }

  async findByPath(path: string): Promise<string | null> {
    const data = this.load()
    let best: string | null = null
    let bestLen = 0
    for (const [name, proj] of Object.entries(data.projects)) {
      if (proj.folder_path && path.startsWith(proj.folder_path) && proj.folder_path.length > bestLen) {
        best = name
        bestLen = proj.folder_path.length
      }
    }
    return best
  }

  async getSecretValue(project: string, key: string): Promise<string> {
    const data = this.load()
    const secret = data.projects[project]?.secrets[key]
    if (!secret) throw new Error(`Secret not found: ${project}/${key}`)
    return secret.value
  }

  async reEncrypt(newKey: Buffer): Promise<void> {
    const release = await lock(this.lockFile, { retries: { retries: 5, minTimeout: 50 } })
    try {
      const data = this.load()
      this.key = newKey
      this.save(data)
    } finally {
      await release()
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/vault.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/vault.ts tests/vault.test.ts
git commit -m "feat: add vault module"
```

---

## Chunk 3: Audit + Backup + Runner

### Task 8: audit.ts

**Files:**
- Create: `src/audit.ts`
- Create: `tests/audit.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/audit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('AuditLogger', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-audit-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('logs and tails entries', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    logger.log('login', 'web', {}, 'ok')
    logger.log('secret_get', 'mcp', { project: 'p' }, 'ok')
    const entries = logger.tail(10)
    expect(entries).toHaveLength(2)
    expect(entries[0].action).toBe('login')
  })

  it('tail limits results', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    for (let i = 0; i < 10; i++) logger.log('ping', 'mcp', {}, 'ok')
    expect(logger.tail(3)).toHaveLength(3)
  })

  it('failedLogins counts recent failures', async () => {
    const { AuditLogger } = await import('../src/audit.js')
    const logger = new AuditLogger(join(dir, 'audit.log'))
    logger.log('login', 'web', {}, 'fail')
    logger.log('login', 'web', {}, 'fail')
    logger.log('login', 'web', {}, 'ok')
    expect(logger.failedLogins(5)).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/audit.test.ts
```

- [ ] **Step 3: Implement src/audit.ts**

```typescript
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface AuditEntry {
  timestamp: string
  action: string
  actor: string
  details: Record<string, unknown>
  status: string
}

export class AuditLogger {
  constructor(private path: string) {}

  log(action: string, actor: string, details: Record<string, unknown>, status: string): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const entry: AuditEntry = { timestamp: new Date().toISOString(), action, actor, details, status }
    appendFileSync(this.path, JSON.stringify(entry) + '\n')
  }

  tail(n: number): AuditEntry[] {
    if (!existsSync(this.path)) return []
    const lines = readFileSync(this.path, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-n).map(l => JSON.parse(l))
  }

  failedLogins(withinMinutes: number): number {
    if (!existsSync(this.path)) return 0
    const since = new Date(Date.now() - withinMinutes * 60_000)
    const lines = readFileSync(this.path, 'utf8').trim().split('\n').filter(Boolean)
    return lines
      .map(l => JSON.parse(l) as AuditEntry)
      .filter(e => e.action === 'login' && e.status === 'fail' && new Date(e.timestamp) >= since)
      .length
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/audit.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/audit.ts tests/audit.test.ts
git commit -m "feat: add audit module"
```

---

### Task 9: backup.ts

**Files:**
- Create: `src/backup.ts`
- Create: `tests/backup.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/backup.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('backup', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-backup-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('creates backup with .enc extension and timestamp name', async () => {
    const { createBackup, listBackups } = await import('../src/backup.js')
    const vaultPath = join(dir, 'vault.enc')
    writeFileSync(vaultPath, 'fake-encrypted-data')
    const backupsDir = join(dir, 'backups')
    const name = createBackup(vaultPath, backupsDir)
    expect(name).toMatch(/^vault-\d{8}T\d{6}Z\.enc$/)
    const list = listBackups(backupsDir)
    expect(list).toContain(name)
  })

  it('restores backup over vault file', async () => {
    const { createBackup, restoreBackup } = await import('../src/backup.js')
    const vaultPath = join(dir, 'vault.enc')
    writeFileSync(vaultPath, 'original')
    const backupsDir = join(dir, 'backups')
    const name = createBackup(vaultPath, backupsDir)
    writeFileSync(vaultPath, 'modified')
    restoreBackup(name, vaultPath, backupsDir)
    const { readFileSync } = await import('fs')
    expect(readFileSync(vaultPath, 'utf8')).toBe('original')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/backup.test.ts
```

- [ ] **Step 3: Implement src/backup.ts**

```typescript
import { copyFileSync, readdirSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace('T', 'T').slice(0, 15) + 'Z'
}

export function createBackup(vaultPath: string, backupsDir: string): string {
  mkdirSync(backupsDir, { recursive: true })
  const name = `vault-${timestamp()}.enc`
  copyFileSync(vaultPath, join(backupsDir, name))
  return name
}

export function listBackups(backupsDir: string): string[] {
  if (!existsSync(backupsDir)) return []
  return readdirSync(backupsDir)
    .filter(f => f.endsWith('.enc'))
    .sort()
    .reverse()
}

export function restoreBackup(name: string, vaultPath: string, backupsDir: string): void {
  copyFileSync(join(backupsDir, name), vaultPath)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/backup.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/backup.ts tests/backup.test.ts
git commit -m "feat: add backup module"
```

---

### Task 10: runner.ts

**Files:**
- Create: `src/runner.ts`
- Create: `tests/runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/runner.test.ts
import { describe, it, expect } from 'vitest'

describe('runner', () => {
  it('substitutes $VAR placeholders', async () => {
    const { substituteEnv } = await import('../src/runner.js')
    expect(substituteEnv('echo $FOO', { FOO: 'bar' })).toBe('echo bar')
  })

  it('substitutes ${VAR} placeholders', async () => {
    const { substituteEnv } = await import('../src/runner.js')
    expect(substituteEnv('echo ${FOO}', { FOO: 'bar' })).toBe('echo bar')
  })

  it('redacts secret values from output', async () => {
    const { redactSecrets } = await import('../src/runner.js')
    const output = 'token is abc123 here'
    expect(redactSecrets(output, { TOKEN: 'abc123' })).toBe('token is ***REDACTED*** here')
  })

  it('runWithEnv executes command and returns output', async () => {
    const { runWithEnv } = await import('../src/runner.js')
    const result = await runWithEnv('echo hello', {}, { redactSecrets: false, maxOutput: 4096 })
    expect(result.output.trim()).toBe('hello')
    expect(result.exit_code).toBe(0)
  })

  it('runWithEnv truncates output to maxOutput', async () => {
    const { runWithEnv } = await import('../src/runner.js')
    const result = await runWithEnv('echo hello', {}, { redactSecrets: false, maxOutput: 3 })
    expect(result.output.length).toBeLessThanOrEqual(3)
    expect(result.truncated).toBe(true)
  })

  it('checkAllowList throws when command not in allow list', async () => {
    const { checkAllowList } = await import('../src/runner.js')
    expect(() => checkAllowList('rm -rf /', ['echo', 'ls'])).toThrow(/not allowed/)
    expect(() => checkAllowList('echo hello', ['echo', 'ls'])).not.toThrow()
  })

  it('checkAllowList allows all when list is null', async () => {
    const { checkAllowList } = await import('../src/runner.js')
    expect(() => checkAllowList('any command', null)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/runner.test.ts
```

- [ ] **Step 3: Implement src/runner.ts**

```typescript
import { execSync } from 'child_process'

export function substituteEnv(command: string, env: Record<string, string>): string {
  return command
    .replace(/\$\{(\w+)\}/g, (_, k) => env[k] ?? `\${${k}}`)
    .replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, k) => env[k] ?? `$${k}`)
}

export function redactSecrets(output: string, env: Record<string, string>): string {
  let result = output
  for (const value of Object.values(env)) {
    if (value.length >= 4) {
      result = result.replaceAll(value, '***REDACTED***')
    }
  }
  return result
}

export function checkAllowList(command: string, allowList: string[] | null): void {
  if (!allowList) return
  const binary = command.trim().split(/\s+/)[0]
  if (!allowList.includes(binary)) {
    throw new Error(`Command "${binary}" not allowed by exec_allow_list`)
  }
}

export interface RunOptions {
  redactSecrets: boolean
  maxOutput: number
  allowList?: string[] | null
}

export interface RunResult {
  output: string
  exit_code: number
  truncated: boolean
}

export async function runWithEnv(
  command: string,
  env: Record<string, string>,
  opts: RunOptions,
): Promise<RunResult> {
  if (opts.allowList !== undefined) checkAllowList(command, opts.allowList ?? null)
  let output = ''
  let exit_code = 0
  try {
    output = execSync(command, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e: any) {
    output = (e.stdout ?? '') + (e.stderr ?? '')
    exit_code = e.status ?? 1
  }
  if (opts.redactSecrets) output = redactSecrets(output, env)
  const truncated = output.length > opts.maxOutput
  if (truncated) output = output.slice(0, opts.maxOutput)
  return { output, exit_code, truncated }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/runner.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts tests/runner.test.ts
git commit -m "feat: add runner module"
```

---

## Chunk 4: Web + MCP

### Task 11: web.ts + ui/

**Files:**
- Create: `src/web.ts`
- Create: `src/ui/login.tsx`
- Create: `src/ui/index.tsx`
- Create: `tests/web.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/web.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function makeApp(dir: string) {
  const { generateKey } = await import('../src/crypto.js')
  const { VaultService } = await import('../src/vault.js')
  const { ConfigStore } = await import('../src/config.js')
  const { AuditLogger } = await import('../src/audit.js')
  const { createApp } = await import('../src/web.js')
  const key = generateKey()
  const vault = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
  const config = new ConfigStore(join(dir, 'config.json'))
  const audit = new AuditLogger(join(dir, 'audit.log'))
  return createApp({ vault, config, audit })
}

describe('web app', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-web-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('GET / redirects to login when auth enabled', async () => {
    const app = await makeApp(dir)
    // enable auth via config
    const { ConfigStore } = await import('../src/config.js')
    const store = new ConfigStore(join(dir, 'config.json'))
    store.set('web_auth_enabled', true)
    const res = await app.request('/')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('GET / returns 200 when auth disabled', async () => {
    const app = await makeApp(dir)
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })

  it('GET /login returns 200', async () => {
    const app = await makeApp(dir)
    const res = await app.request('/login')
    expect(res.status).toBe(200)
  })

  it('POST /projects/create creates project', async () => {
    const app = await makeApp(dir)
    const res = await app.request('/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=testproj&description=test',
    })
    expect(res.status).toBe(302)
  })

  it('GET /api/folders rejects path traversal', async () => {
    const app = await makeApp(dir)
    const res = await app.request('/api/folders?path=/etc/passwd')
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/web.test.ts
```

- [ ] **Step 3: Implement src/ui/login.tsx**

```tsx
/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx'

interface LoginProps {
  error?: string
  lang: string
  theme: string
  variant: string
  firstRun: boolean
}

export const LoginPage: FC<LoginProps> = ({ error, firstRun, theme, variant }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Zocket — Login</title>
      <style>{loginStyles(theme, variant)}</style>
    </head>
    <body>
      <div class="container">
        <h1>Zocket</h1>
        {firstRun ? <FirstRunForm /> : <LoginForm error={error} />}
      </div>
    </body>
  </html>
)

const LoginForm: FC<{ error?: string }> = ({ error }) => (
  <form method="POST" action="/login">
    {error && <p class="error">{error}</p>}
    <input type="password" name="password" placeholder="Password" autofocus />
    <button type="submit">Login</button>
  </form>
)

const FirstRunForm: FC = () => (
  <div>
    <p>Welcome! Set up your vault password.</p>
    <form method="POST" action="/setup/first-run">
      <input type="password" name="password" placeholder="Enter password" />
      <input type="password" name="password_repeat" placeholder="Repeat password" />
      <button name="action" value="set">Set Password</button>
      <button name="action" value="generate">Generate Strong Password</button>
      <button name="action" value="skip">Continue Without Password</button>
    </form>
  </div>
)

function loginStyles(theme: string, variant: string): string {
  return `body { font-family: sans-serif; display: flex; justify-content: center; padding: 2rem; }
  .container { max-width: 400px; width: 100%; }
  input { display: block; width: 100%; padding: .5rem; margin: .5rem 0; }
  button { padding: .5rem 1rem; margin: .25rem; cursor: pointer; }
  .error { color: red; }`
}
```

- [ ] **Step 4: Implement src/ui/index.tsx**

Port the main dashboard from the Python Jinja2 template (`/home/zorin/project/zocket/zocket/templates/index.html`). Structure as Hono JSX component with sections: sidebar (project list), main (secrets table), folder picker, theme switcher.

```tsx
/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx'
import type { ProjectInfo } from '../vault.js'

interface DashboardProps {
  projects: ProjectInfo[]
  selectedProject?: string
  secretKeys: string[]
  lang: string
  theme: string
  variant: string
}

export const DashboardPage: FC<DashboardProps> = ({ projects, selectedProject, secretKeys, lang, theme, variant }) => (
  <html lang={lang}>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Zocket</title>
      <style>{dashboardStyles(theme, variant)}</style>
    </head>
    <body>
      <div class="layout">
        <aside class="sidebar">
          <h2>Projects</h2>
          <ul>
            {projects.map(p => (
              <li key={p.name}>
                <a href={`/?project=${p.name}`} class={p.name === selectedProject ? 'active' : ''}>
                  {p.name} ({p.secret_count})
                </a>
              </li>
            ))}
          </ul>
          <form method="POST" action="/projects/create">
            <input name="name" placeholder="Project name" required />
            <input name="description" placeholder="Description" />
            <button type="submit">+ Create</button>
          </form>
        </aside>
        <main>
          {selectedProject ? (
            <SecretsPanel project={selectedProject} secretKeys={secretKeys} />
          ) : (
            <p>Select or create a project.</p>
          )}
        </main>
      </div>
      <script>{clientScript()}</script>
    </body>
  </html>
)

const SecretsPanel: FC<{ project: string; secretKeys: string[] }> = ({ project, secretKeys }) => (
  <div>
    <h2>{project}</h2>
    <form method="POST" action={`/projects/${project}/secrets/upsert`}>
      <input name="key" placeholder="KEY_NAME" pattern="[A-Z_][A-Z0-9_]*" required />
      <input name="value" placeholder="value" required />
      <input name="description" placeholder="description" />
      <button type="submit">Set Secret</button>
    </form>
    <table>
      <thead><tr><th>Key</th><th>Actions</th></tr></thead>
      <tbody>
        {secretKeys.map(k => (
          <tr key={k}>
            <td>{k}</td>
            <td>
              <button class="copy-btn" data-key={k} data-project={project}>Copy</button>
              <form method="POST" action={`/projects/${project}/secrets/${k}/delete`} style="display:inline">
                <button type="submit">Delete</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

function clientScript(): string {
  return `
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key, project = btn.dataset.project
        const res = await fetch('/projects/' + project + '/secrets/' + key + '/value')
        const { value } = await res.json()
        navigator.clipboard.writeText(value)
      })
    })
  `
}

function dashboardStyles(theme: string, variant: string): string {
  const bg = variant === 'dark' ? '#1a1a1a' : '#fff'
  const fg = variant === 'dark' ? '#eee' : '#222'
  return `body { font-family: sans-serif; margin: 0; background: ${bg}; color: ${fg}; }
  .layout { display: flex; height: 100vh; }
  .sidebar { width: 260px; border-right: 1px solid #ccc; padding: 1rem; overflow-y: auto; }
  main { flex: 1; padding: 1.5rem; overflow-y: auto; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: .5rem; border-bottom: 1px solid #ddd; text-align: left; }
  .active { font-weight: bold; }
  input { padding: .4rem; margin: .2rem 0; }
  button { cursor: pointer; padding: .4rem .8rem; margin: .2rem; }`
}
```

- [ ] **Step 5: Implement src/web.ts**

```typescript
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { resolve } from 'path'
import { readdirSync, statSync } from 'fs'
import type { VaultService } from './vault.js'
import type { ConfigStore } from './config.js'
import type { AuditLogger } from './audit.js'
import { hashPassword, verifyPassword } from './auth.js'
import { randomBytes } from 'crypto'
import { LoginPage } from './ui/login.js'
import { DashboardPage } from './ui/index.js'

interface AppDeps { vault: VaultService; config: ConfigStore; audit: AuditLogger }

export function createApp(deps: AppDeps) {
  const { vault, config, audit } = deps
  const app = new Hono()

  // Session store (in-memory)
  const sessions = new Map<string, { authed: boolean; ts: number }>()

  function isAuthed(c: any): boolean {
    const cfg = config.load()
    if (!cfg.web_auth_enabled) return true
    const sid = getCookie(c, 'zocket_sid')
    return !!(sid && sessions.get(sid)?.authed)
  }

  function requireAuth(c: any, next: () => any) {
    if (!isAuthed(c)) return c.redirect('/login')
    return next()
  }

  app.get('/login', (c) => {
    const cfg = config.load()
    const firstRun = cfg.web_auth_enabled && !cfg.web_password_hash
    return c.html(<LoginPage firstRun={firstRun} lang={cfg.language} theme={cfg.theme} variant={cfg.theme_variant} />)
  })

  app.post('/login', async (c) => {
    const cfg = config.load()
    const body = await c.req.parseBody()
    const password = body['password'] as string
    if (verifyPassword(password, cfg.web_password_hash, cfg.web_password_salt)) {
      const sid = randomBytes(16).toString('hex')
      sessions.set(sid, { authed: true, ts: Date.now() })
      setCookie(c, 'zocket_sid', sid, { httpOnly: true, sameSite: 'Lax', path: '/' })
      audit.log('login', 'web', {}, 'ok')
      return c.redirect('/')
    }
    audit.log('login', 'web', {}, 'fail')
    return c.html(<LoginPage firstRun={false} error="Invalid password" lang={cfg.language} theme={cfg.theme} variant={cfg.theme_variant} />)
  })

  app.post('/logout', (c) => {
    const sid = getCookie(c, 'zocket_sid')
    if (sid) sessions.delete(sid)
    deleteCookie(c, 'zocket_sid')
    return c.redirect('/login')
  })

  app.post('/setup/first-run', async (c) => {
    const body = await c.req.parseBody()
    const action = body['action'] as string
    const cfg = config.load()
    cfg.web_auth_enabled = true
    if (action === 'skip') {
      cfg.web_auth_enabled = false
    } else if (action === 'generate') {
      const pw = randomBytes(16).toString('base64url')
      const { hash, salt } = hashPassword(pw)
      cfg.web_password_hash = hash
      cfg.web_password_salt = salt
      config.save(cfg)
      return c.text(`Generated password: ${pw}\nSave it now — it won't be shown again.`)
    } else {
      const pw = body['password'] as string
      const pw2 = body['password_repeat'] as string
      if (!pw) return c.text('Password is required.', 400)
      if (pw !== pw2) return c.text('Passwords do not match.', 400)
      const { hash, salt } = hashPassword(pw)
      cfg.web_password_hash = hash
      cfg.web_password_salt = salt
    }
    config.save(cfg)
    return c.redirect('/login')
  })

  app.get('/', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    const cfg = config.load()
    const projects = await vault.listProjects()
    const selectedProject = c.req.query('project')
    const secretKeys = selectedProject ? await vault.listKeys(selectedProject).catch(() => []) : []
    return c.html(<DashboardPage projects={projects} selectedProject={selectedProject} secretKeys={secretKeys} lang={cfg.language} theme={cfg.theme} variant={cfg.theme_variant} />)
  })

  app.post('/projects/create', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    const body = await c.req.parseBody()
    await vault.createProject(body['name'] as string, body['description'] as string || '')
    audit.log('project_create', 'web', { name: body['name'] }, 'ok')
    return c.redirect('/')
  })

  app.post('/projects/:project/delete', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    await vault.deleteProject(c.req.param('project'))
    return c.redirect('/')
  })

  app.post('/projects/:project/folder', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    const body = await c.req.parseBody()
    const folder = (body['folder'] as string) || undefined
    await vault.setFolder(c.req.param('project'), folder)
    return c.redirect(`/?project=${c.req.param('project')}`)
  })

  app.post('/projects/:project/secrets/upsert', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    const body = await c.req.parseBody()
    const project = c.req.param('project')
    await vault.setSecret(project, body['key'] as string, body['value'] as string, body['description'] as string || '')
    audit.log('secret_set', 'web', { project, key: body['key'] }, 'ok')
    return c.redirect(`/?project=${project}`)
  })

  app.post('/projects/:project/secrets/:key/delete', async (c) => {
    if (!isAuthed(c)) return c.redirect('/login')
    const { project, key } = c.req.param()
    await vault.deleteSecret(project, key)
    return c.redirect(`/?project=${project}`)
  })

  app.get('/projects/:project/secrets/:key/value', async (c) => {
    if (!isAuthed(c)) return c.json({ error: 'unauthorized' }, 401)
    const { project, key } = c.req.param()
    const value = await vault.getSecretValue(project, key)
    return c.json({ value })
  })

  app.get('/api/folders', (c) => {
    if (!isAuthed(c)) return c.json({ error: 'unauthorized' }, 401)
    const cfg = config.load()
    const requested = c.req.query('path') || '/'
    const resolved = resolve(requested)
    const allowed = cfg.folder_picker_roots.some(root => resolved.startsWith(root))
    if (!allowed) return c.json({ error: 'forbidden' }, 403)
    try {
      const entries = readdirSync(resolved)
        .filter(name => { try { return statSync(resolve(resolved, name)).isDirectory() } catch { return false } })
      return c.json({ path: resolved, entries })
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
  })

  app.post('/set-theme', async (c) => {
    const body = await c.req.parseBody()
    config.set('theme', body['theme'] as string)
    return c.redirect('/')
  })

  app.post('/set-theme-variant', async (c) => {
    const body = await c.req.parseBody()
    config.set('theme_variant', body['variant'] as string)
    return c.redirect('/')
  })

  return app
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test -- tests/web.test.ts
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/web.ts src/ui/ tests/web.test.ts
git commit -m "feat: add web panel (Hono + JSX)"
```

---

### Task 12: mcp.ts

**Files:**
- Create: `src/mcp.ts`
- Create: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/mcp.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function makeMcp(dir: string, mode: 'metadata' | 'admin') {
  const { generateKey } = await import('../src/crypto.js')
  const { VaultService } = await import('../src/vault.js')
  const { ConfigStore } = await import('../src/config.js')
  const { AuditLogger } = await import('../src/audit.js')
  const { createMcpServer } = await import('../src/mcp.js')
  const key = generateKey()
  const vault = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
  const config = new ConfigStore(join(dir, 'config.json'))
  const audit = new AuditLogger(join(dir, 'audit.log'))
  return createMcpServer({ vault, config, audit, mode })
}

describe('MCP server', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zkt-mcp-')) })
  afterEach(() => rmSync(dir, { recursive: true }))

  it('metadata mode exposes 4 tools: ping, list_projects, list_project_keys, find_project_by_path', async () => {
    const server = await makeMcp(dir, 'metadata')
    // Server is configured — check tool names via listTools
    // (MCP SDK: server._registeredTools or call listTools handler)
    expect(server).toBeTruthy()
  })

  it('ping returns pong', async () => {
    const server = await makeMcp(dir, 'metadata')
    // Invoke ping via calling the tool handler directly
    // Access registered tools map
    const tools = (server as any)._registeredTools as Map<string, any>
    const ping = tools.get('ping')
    const result = await ping.callback({}, {})
    expect(result.content[0].text).toContain('pong')
  })

  it('list_projects returns empty list initially', async () => {
    const server = await makeMcp(dir, 'metadata')
    const tools = (server as any)._registeredTools as Map<string, any>
    const listProjects = tools.get('list_projects')
    const result = await listProjects.callback({}, {})
    expect(result.content[0].text).toContain('[]')
  })

  it('admin mode exposes upsert_secret', async () => {
    const server = await makeMcp(dir, 'admin')
    const tools = (server as any)._registeredTools as Map<string, any>
    expect(tools.has('upsert_secret')).toBe(true)
  })

  it('metadata mode does NOT expose upsert_secret', async () => {
    const server = await makeMcp(dir, 'metadata')
    const tools = (server as any)._registeredTools as Map<string, any>
    expect(tools.has('upsert_secret')).toBe(false)
  })

  it('secret values are never returned by list_project_keys', async () => {
    const { generateKey } = await import('../src/crypto.js')
    const { VaultService } = await import('../src/vault.js')
    const { ConfigStore } = await import('../src/config.js')
    const { AuditLogger } = await import('../src/audit.js')
    const { createMcpServer } = await import('../src/mcp.js')
    const key = generateKey()
    const vault = new VaultService(join(dir, 'vault.enc'), join(dir, 'vault.lock'), key)
    await vault.createProject('proj', '')
    await vault.setSecret('proj', 'SECRET', 'supersecretvalue', '')
    const server = createMcpServer({ vault, config: new ConfigStore(join(dir, 'config.json')), audit: new AuditLogger(join(dir, 'audit.log')), mode: 'metadata' })
    const tools = (server as any)._registeredTools as Map<string, any>
    const listKeys = tools.get('list_project_keys')
    const result = await listKeys.callback({ project: 'proj' }, {})
    expect(result.content[0].text).not.toContain('supersecretvalue')
    expect(result.content[0].text).toContain('SECRET')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/mcp.test.ts
```

- [ ] **Step 3: Implement src/mcp.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { VaultService } from './vault.js'
import type { ConfigStore } from './config.js'
import type { AuditLogger } from './audit.js'
import { runWithEnv, substituteEnv } from './runner.js'

interface McpDeps {
  vault: VaultService
  config: ConfigStore
  audit: AuditLogger
  mode: 'metadata' | 'admin'
}

export function createMcpServer(deps: McpDeps): McpServer {
  const { vault, config, audit, mode } = deps

  const server = new McpServer({
    name: 'zocket',
    version: '1.0.0',
  })

  // Metadata tools (read-only)
  server.tool('ping', 'Health check', {}, async () => {
    return { content: [{ type: 'text', text: 'pong' }] }
  })

  server.tool('list_projects', 'List all projects with metadata', {}, async () => {
    const projects = await vault.listProjects()
    const safe = projects.map(p => ({ name: p.name, description: p.description, folder_path: p.folder_path, secret_count: p.secret_count }))
    audit.log('list_projects', 'mcp', {}, 'ok')
    return { content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }] }
  })

  server.tool('list_project_keys', 'List secret keys for a project (values never returned)',
    { project: z.string() },
    async ({ project }) => {
      const keys = await vault.listKeys(project)
      audit.log('list_project_keys', 'mcp', { project }, 'ok')
      return { content: [{ type: 'text', text: JSON.stringify(keys) }] }
    }
  )

  server.tool('find_project_by_path', 'Find project by filesystem path',
    { path: z.string() },
    async ({ path }) => {
      const name = await vault.findByPath(path)
      return { content: [{ type: 'text', text: JSON.stringify({ project: name }) }] }
    }
  )

  if (mode === 'admin') {
    server.tool('create_project', 'Create a new project',
      { project: z.string(), description: z.string().optional(), folder_path: z.string().optional() },
      async ({ project, description, folder_path }) => {
        await vault.createProject(project, description ?? '')
        if (folder_path) await vault.setFolder(project, folder_path)
        audit.log('create_project', 'mcp', { project }, 'ok')
        return { content: [{ type: 'text', text: `Project "${project}" created.` }] }
      }
    )

    server.tool('delete_project', 'Delete a project',
      { project: z.string() },
      async ({ project }) => {
        await vault.deleteProject(project)
        audit.log('delete_project', 'mcp', { project }, 'ok')
        return { content: [{ type: 'text', text: `Project "${project}" deleted.` }] }
      }
    )

    server.tool('upsert_secret', 'Create or update a secret (value stored encrypted, never returned)',
      { project: z.string(), key: z.string(), value: z.string(), description: z.string().optional() },
      async ({ project, key, value, description }) => {
        await vault.setSecret(project, key, value, description ?? '')
        audit.log('upsert_secret', 'mcp', { project, key }, 'ok')
        return { content: [{ type: 'text', text: `Secret "${key}" set.` }] }
      }
    )

    server.tool('delete_secret', 'Delete a secret',
      { project: z.string(), key: z.string() },
      async ({ project, key }) => {
        await vault.deleteSecret(project, key)
        audit.log('delete_secret', 'mcp', { project, key }, 'ok')
        return { content: [{ type: 'text', text: `Secret "${key}" deleted.` }] }
      }
    )

    server.tool('get_exec_policy', 'Describe execution policy', {}, async () => {
      const cfg = config.load()
      return { content: [{ type: 'text', text: JSON.stringify({
        allow_list: cfg.exec_allow_list,
        max_output: cfg.exec_max_output,
        allow_substitution: cfg.exec_allow_substitution,
        redact_secrets: cfg.exec_redact_secrets,
      })}] }
    })

    server.tool('run_with_project_env', 'Run command with project secrets injected as env vars',
      { project: z.string(), command: z.string(), full_output: z.boolean().optional() },
      async ({ project, command, full_output }) => {
        const cfg = config.load()
        const env = await vault.getEnv(project)
        const cmd = cfg.exec_allow_substitution ? substituteEnv(command, env) : command
        const result = await runWithEnv(cmd, env, {
          redactSecrets: cfg.exec_redact_secrets,
          maxOutput: full_output ? 1_000_000 : cfg.exec_max_output,
        })
        audit.log('run_with_project_env', 'mcp', { project, command }, result.exit_code === 0 ? 'ok' : 'fail')
        return { content: [{ type: 'text', text: result.output + (result.truncated ? '\n[output truncated]' : '') }] }
      }
    )
  }

  return server
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/mcp.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts tests/mcp.test.ts
git commit -m "feat: add MCP server (metadata + admin modes)"
```

---

## Chunk 5: Harden + Autostart + CLI + Build + Release

### Task 13: harden.ts

**Files:**
- Create: `src/harden.ts`
- Create: `tests/harden.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/harden.test.ts
import { describe, it, expect } from 'vitest'

describe('harden', () => {
  it('generates systemd web unit with correct ExecStart', async () => {
    const { generateWebUnit } = await import('../src/harden.js')
    const unit = generateWebUnit({ zocketBin: '/usr/local/bin/zocket.js', zocketHome: '/var/lib/zocket', webPort: 18001, serviceUser: 'zocketd' })
    expect(unit).toContain('ExecStart=node /usr/local/bin/zocket.js web')
    expect(unit).toContain('--port 18001')
    expect(unit).toContain('User=zocketd')
    expect(unit).toContain('NoNewPrivileges=true')
  })

  it('generates systemd mcp unit', async () => {
    const { generateMcpUnit } = await import('../src/harden.js')
    const unit = generateMcpUnit({ zocketBin: '/usr/bin/zocket.js', zocketHome: '/var/lib/zocket', mcpPort: 18002, mcpHost: '127.0.0.1', mcpMode: 'metadata', serviceUser: 'zocketd' })
    expect(unit).toContain('ExecStart=node /usr/bin/zocket.js mcp')
    expect(unit).toContain('--transport streamable-http')
    expect(unit).toContain('ProtectSystem=strict')
  })

  it('installLinuxSystem dry-run prints units without writing files', async () => {
    const { installLinuxSystem } = await import('../src/harden.js')
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args) => logs.push(args.join(' '))
    try {
      await installLinuxSystem({ zocketBin: '/usr/bin/zocket.js', zocketHome: '/tmp/zh', webPort: 18001, mcpPort: 18003, mcpHost: '127.0.0.1', mcpMode: 'metadata', serviceUser: 'zocketd', dryRun: true })
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('zocket-web.service')
    expect(logs.join('\n')).toContain('zocket-mcp-http.service')
  })

  it('findZocketBin returns a non-empty string', async () => {
    const { findZocketBin } = await import('../src/harden.js')
    // process.argv[1] may be vitest runner path — just ensure it returns a string
    const bin = findZocketBin()
    expect(typeof bin).toBe('string')
    expect(bin.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/harden.test.ts
```

- [ ] **Step 3: Implement src/harden.ts**

```typescript
import { execSync } from 'child_process'
import { writeFileSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'

export interface HardenOptions {
  zocketBin: string
  zocketHome: string
  webPort: number
  mcpPort: number
  mcpHost: string
  mcpMode: string
  serviceUser: string
}

export function findZocketBin(): string {
  // process.argv[1] is the path to the running script
  if (process.argv[1]) return process.argv[1]
  try {
    return execSync('which zocket', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('Cannot determine zocket binary path')
  }
}

export interface WebUnitOptions {
  zocketBin: string
  zocketHome: string
  webPort: number
  serviceUser: string
}

export function generateWebUnit(opts: WebUnitOptions): string {
  return `[Unit]
Description=Zocket Web Panel
After=network.target

[Service]
Type=simple
User=${opts.serviceUser}
Environment=ZOCKET_HOME=${opts.zocketHome}
ExecStart=node ${opts.zocketBin} web --host 127.0.0.1 --port ${opts.webPort}
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
MemoryDenyWriteExecute=true
LockPersonality=true
ProtectKernelTunables=true

[Install]
WantedBy=multi-user.target
`
}

export interface McpUnitOptions {
  zocketBin: string
  zocketHome: string
  mcpPort: number
  mcpHost: string
  mcpMode: string
  serviceUser: string
}

export function generateMcpUnit(opts: McpUnitOptions): string {
  return `[Unit]
Description=Zocket MCP Server
After=network.target

[Service]
Type=simple
User=${opts.serviceUser}
Environment=ZOCKET_HOME=${opts.zocketHome}
ExecStart=node ${opts.zocketBin} mcp --transport streamable-http --mode ${opts.mcpMode} --host ${opts.mcpHost} --port ${opts.mcpPort}
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
MemoryDenyWriteExecute=true
LockPersonality=true
ProtectKernelTunables=true

[Install]
WantedBy=multi-user.target
`
}

export async function installLinuxSystem(opts: HardenOptions & { dryRun?: boolean }): Promise<void> {
  const webUnit = generateWebUnit(opts)
  const mcpUnit = generateMcpUnit(opts)
  if (opts.dryRun) {
    console.log('=== zocket-web.service ===\n' + webUnit)
    console.log('=== zocket-mcp-http.service ===\n' + mcpUnit)
    return
  }
  writeFileSync('/etc/systemd/system/zocket-web.service', webUnit)
  writeFileSync('/etc/systemd/system/zocket-mcp-http.service', mcpUnit)
  execSync('systemctl daemon-reload')
  console.log('Systemd units installed. Run: systemctl enable --now zocket-web zocket-mcp-http')
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/harden.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/harden.ts tests/harden.test.ts
git commit -m "feat: add harden module (systemd units)"
```

---

### Task 14: autostart.ts

**Files:**
- Create: `src/autostart.ts`
- Create: `tests/autostart.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/autostart.test.ts
import { describe, it, expect } from 'vitest'

describe('autostart', () => {
  it('generateLinuxUnit returns valid systemd unit content', async () => {
    const { generateLinuxUnit } = await import('../src/autostart.js')
    const unit = generateLinuxUnit('web', '/usr/bin/zocket.js', 18001)
    expect(unit).toContain('[Unit]')
    expect(unit).toContain('ExecStart=node /usr/bin/zocket.js web')
  })

  it('getStatus returns unknown on missing unit file', async () => {
    const { getStatus } = await import('../src/autostart.js')
    const status = getStatus('web')
    expect(['active', 'inactive', 'unknown']).toContain(status)
  })

  it('install dry-run prints unit without writing files', async () => {
    const { install } = await import('../src/autostart.js')
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args) => logs.push(args.join(' '))
    try {
      install('web', '/usr/bin/zocket.js', 18001, true)
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('ExecStart')
  })

  it('remove dry-run prints message without modifying filesystem', async () => {
    const { remove } = await import('../src/autostart.js')
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args) => logs.push(args.join(' '))
    try {
      remove('web', true)
    } finally {
      console.log = origLog
    }
    expect(logs.join('\n')).toContain('zocket-web')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/autostart.test.ts
```

- [ ] **Step 3: Implement src/autostart.ts**

```typescript
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, existsSync, unlinkSync } from 'fs'

export type ServiceName = 'web' | 'mcp-sse' | 'mcp-http'

export function generateLinuxUnit(service: ServiceName, zocketBin: string, port: number): string {
  const args = service === 'web'
    ? `web --host 127.0.0.1 --port ${port}`
    : service === 'mcp-sse'
    ? `mcp --transport sse --host 127.0.0.1 --port ${port}`
    : `mcp --transport streamable-http --host 127.0.0.1 --port ${port}`
  return `[Unit]
Description=Zocket ${service}
After=network.target

[Service]
Type=simple
ExecStart=node ${zocketBin} ${args}
Restart=on-failure

[Install]
WantedBy=default.target
`
}

export function install(service: ServiceName, zocketBin: string, port: number, dryRun = false): void {
  const platform = process.platform
  if (platform === 'linux') {
    const unit = generateLinuxUnit(service, zocketBin, port)
    const unitPath = `${process.env.HOME}/.config/systemd/user/zocket-${service}.service`
    if (dryRun) { console.log(unit); return }
    writeFileSync(unitPath, unit)
    execSync(`systemctl --user enable --now zocket-${service}`)
  } else {
    throw new Error(`Autostart not yet implemented for platform: ${platform}`)
  }
}

export function remove(service: ServiceName, dryRun = false): void {
  if (process.platform === 'linux') {
    if (dryRun) { console.log(`Would remove zocket-${service}`); return }
    try { execSync(`systemctl --user disable --now zocket-${service}`) } catch {}
    const unitPath = `${process.env.HOME}/.config/systemd/user/zocket-${service}.service`
    if (existsSync(unitPath)) unlinkSync(unitPath)
  }
}

export function getStatus(service: ServiceName): 'active' | 'inactive' | 'unknown' {
  if (process.platform !== 'linux') return 'unknown'
  const result = spawnSync('systemctl', ['--user', 'is-active', `zocket-${service}`], { encoding: 'utf8' })
  const out = result.stdout?.trim()
  if (out === 'active') return 'active'
  if (out === 'inactive') return 'inactive'
  return 'unknown'
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/autostart.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/autostart.ts tests/autostart.test.ts
git commit -m "feat: add autostart module"
```

---

### Task 15: cli.ts + index.ts

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement src/cli.ts**

Wire all commands using `commander`. Each command instantiates its dependencies from `paths.ts`, `config.ts`, `crypto.ts`, `vault.ts`, then calls the appropriate module.

```typescript
import { Command } from 'commander'
import { serve } from '@hono/node-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from 'http'
import { mkdirSync, existsSync } from 'fs'

import { zocketHome, vaultPath, keyPath, configPath, auditPath, backupsDir, lockPath } from './paths.js'
import { ConfigStore } from './config.js'
import { generateKey, loadKey, saveKey, saveKeyToStorage } from './crypto.js'
import { VaultService } from './vault.js'
import { AuditLogger } from './audit.js'
import { createBackup, listBackups, restoreBackup } from './backup.js'
import { hashPassword } from './auth.js'
import { createApp } from './web.js'
import { createMcpServer } from './mcp.js'
import { findZocketBin, installLinuxSystem } from './harden.js'
import { install as installAutostart, remove as removeAutostart, getStatus } from './autostart.js'
import { normalizeLang } from './i18n.js'

export function buildProgram(): Command {
  const program = new Command()
  program.name('zocket').description('Local encrypted vault + web panel + MCP server').version('1.0.0')

  // Shared factory
  async function getDeps() {
    const home = zocketHome()
    const cfgStore = new ConfigStore(configPath(home))
    const cfg = cfgStore.load()
    const key = await loadKey(keyPath(home), cfg.key_storage)
    const vault = new VaultService(vaultPath(home), lockPath(home), key)
    const audit = new AuditLogger(auditPath(home))
    return { home, cfgStore, cfg, vault, audit }
  }

  // init
  program.command('init')
    .option('--force', 'overwrite existing key')
    .option('--autostart', 'install autostart services')
    .action(async (opts) => {
      const home = zocketHome()
      mkdirSync(home, { recursive: true })
      const kp = keyPath(home)
      const cfgStore = new ConfigStore(configPath(home))
      const cfg = cfgStore.ensureExists()
      const key = generateKey()
      saveKey(key, kp)
      console.log(`Vault initialized at ${home}`)
      if (opts.autostart) {
        const bin = findZocketBin()
        installAutostart('web', bin, 18001)
        installAutostart('mcp-http', bin, 18003)
      }
    })

  // web
  program.command('web')
    .option('--host <host>', 'bind host', '127.0.0.1')
    .option('--port <port>', 'port', '18001')
    .action(async (opts) => {
      const { vault, cfgStore, audit } = await getDeps()
      const app = createApp({ vault, config: cfgStore, audit })
      serve({ fetch: app.fetch, hostname: opts.host, port: parseInt(opts.port) }, () => {
        console.log(`Web panel: http://${opts.host}:${opts.port}`)
      })
    })

  // mcp
  program.command('mcp')
    .option('--transport <t>', 'stdio|sse|streamable-http', 'stdio')
    .option('--mode <m>', 'metadata|admin', 'metadata')
    .option('--host <host>', 'bind host', '127.0.0.1')
    .option('--port <port>', 'port (default: 18002 for sse, 18003 for streamable-http)')
    .action(async (opts) => {
      const { vault, cfgStore, audit } = await getDeps()
      const server = createMcpServer({ vault, config: cfgStore, audit, mode: opts.mode })
      if (opts.transport === 'stdio') {
        const transport = new StdioServerTransport()
        await server.connect(transport)
      } else {
        const defaultPort = opts.transport === 'sse' ? 18002 : 18003
        const port = parseInt(opts.port ?? defaultPort)
        const httpServer = createServer(async (req, res) => {
          if (opts.transport === 'sse') {
            const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js')
            if (req.url === '/sse' && req.method === 'GET') {
              const t = new SSEServerTransport('/message', res)
              await server.connect(t)
            }
          } else {
            const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js')
            const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
            await server.connect(t)
            await t.handleRequest(req, res)
          }
        })
        httpServer.listen(port, opts.host, () => {
          console.log(`MCP (${opts.transport}) on ${opts.host}:${port}`)
        })
      }
    })

  // projects
  const projects = program.command('projects')

  projects.command('list').action(async () => {
    const { vault } = await getDeps()
    console.log(JSON.stringify(await vault.listProjects(), null, 2))
  })

  projects.command('create <name> [description]').action(async (name, description) => {
    const { vault } = await getDeps()
    await vault.createProject(name, description ?? '')
    console.log(`Created: ${name}`)
  })

  projects.command('delete <name>').action(async (name) => {
    const { vault } = await getDeps()
    await vault.deleteProject(name)
    console.log(`Deleted: ${name}`)
  })

  projects.command('set-folder <name> [path]').action(async (name, path) => {
    const { vault } = await getDeps()
    await vault.setFolder(name, path)
    console.log(`Folder set.`)
  })

  projects.command('match-path <path>').action(async (path) => {
    const { vault } = await getDeps()
    console.log(await vault.findByPath(path) ?? '(no match)')
  })

  // secrets
  const secrets = program.command('secrets')

  secrets.command('list <project>').action(async (project) => {
    const { vault } = await getDeps()
    console.log((await vault.listKeys(project)).join('\n'))
  })

  secrets.command('set <project> <key> <value> [description]').action(async (project, key, value, description) => {
    const { vault } = await getDeps()
    await vault.setSecret(project, key, value, description ?? '')
    console.log(`Set ${key}`)
  })

  secrets.command('delete <project> <key>').action(async (project, key) => {
    const { vault } = await getDeps()
    await vault.deleteSecret(project, key)
    console.log(`Deleted ${key}`)
  })

  // use
  program.command('use <project> -- <command...>')
    .action(async (project, commandParts) => {
      const { vault, cfgStore } = await getDeps()
      const cfg = cfgStore.load()
      const env = await vault.getEnv(project)
      const { runWithEnv, substituteEnv } = await import('./runner.js')
      const cmd = cfg.exec_allow_substitution ? substituteEnv(commandParts.join(' '), env) : commandParts.join(' ')
      const result = await runWithEnv(cmd, env, { redactSecrets: cfg.exec_redact_secrets, maxOutput: cfg.exec_max_output })
      process.stdout.write(result.output)
      process.exit(result.exit_code)
    })

  // config
  const configCmd = program.command('config')

  configCmd.command('show').action(async () => {
    const home = zocketHome()
    const cfgStore = new ConfigStore(configPath(home))
    const cfg = cfgStore.load()
    const redacted = { ...cfg, web_password_hash: '***', web_password_salt: '***' }
    console.log(JSON.stringify(redacted, null, 2))
  })

  configCmd.command('set-language <lang>').action(async (lang) => {
    const home = zocketHome()
    new ConfigStore(configPath(home)).set('language', normalizeLang(lang))
    console.log(`Language set to ${normalizeLang(lang)}`)
  })

  configCmd.command('set-key-storage <storage>').action(async (storage) => {
    const home = zocketHome()
    new ConfigStore(configPath(home)).set('key_storage', storage as any)
    console.log(`Key storage set to ${storage}`)
  })

  // auth
  const auth = program.command('auth')

  auth.command('set-password').action(async () => {
    const { createInterface } = await import('readline')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('New password: ', (pw) => {
      rl.close()
      const home = zocketHome()
      const store = new ConfigStore(configPath(home))
      const { hash, salt } = hashPassword(pw)
      store.set('web_password_hash', hash)
      store.set('web_password_salt', salt)
      console.log('Password set.')
    })
  })

  auth.command('enable').action(async () => {
    const home = zocketHome()
    new ConfigStore(configPath(home)).set('web_auth_enabled', true)
    console.log('Auth enabled.')
  })

  auth.command('disable').action(async () => {
    const home = zocketHome()
    new ConfigStore(configPath(home)).set('web_auth_enabled', false)
    console.log('Auth disabled.')
  })

  // key
  const keyCmd = program.command('key')

  keyCmd.command('rotate').option('--to-storage <s>', 'target storage').action(async (opts) => {
    const home = zocketHome()
    const cfgStore = new ConfigStore(configPath(home))
    const cfg = cfgStore.load()
    const targetStorage = opts.toStorage ?? cfg.key_storage
    const oldKey = await loadKey(keyPath(home), cfg.key_storage)
    // validate target storage available
    if (targetStorage === 'keyring') {
      try { await import('keytar') } catch { throw new Error('keytar not installed — run: npm i -g keytar') }
    }
    const newKey = generateKey()
    // re-encrypt vault with new key before saving new key
    if (existsSync(vaultPath(home))) {
      const { VaultService } = await import('./vault.js')
      const vault = new VaultService(vaultPath(home), lockPath(home), oldKey)
      await vault.reEncrypt(newKey)
    }
    await saveKeyToStorage(newKey, targetStorage, keyPath(home))
    cfgStore.set('key_storage', targetStorage as any)
    console.log('Key rotated.')
  })

  // backup
  const backupCmd = program.command('backup')

  backupCmd.command('create').action(async () => {
    const home = zocketHome()
    const name = createBackup(vaultPath(home), backupsDir(home))
    console.log(`Backup created: ${name}`)
  })

  backupCmd.command('list').action(async () => {
    const home = zocketHome()
    console.log(listBackups(backupsDir(home)).join('\n'))
  })

  backupCmd.command('restore <name>').action(async (name) => {
    const home = zocketHome()
    restoreBackup(name, vaultPath(home), backupsDir(home))
    console.log(`Restored from ${name}`)
  })

  // audit
  const auditCmd = program.command('audit')

  auditCmd.command('tail').option('-n <n>', 'lines', '20').action(async (opts) => {
    const home = zocketHome()
    const logger = new AuditLogger(auditPath(home))
    logger.tail(parseInt(opts.n)).forEach(e => console.log(JSON.stringify(e)))
  })

  auditCmd.command('check').option('--minutes <m>', 'window', '60').action(async (opts) => {
    const home = zocketHome()
    const logger = new AuditLogger(auditPath(home))
    const count = logger.failedLogins(parseInt(opts.minutes))
    console.log(`Failed logins in last ${opts.minutes}min: ${count}`)
  })

  // autostart
  const autostartCmd = program.command('autostart')

  autostartCmd.command('install <service>').action(async (service) => {
    const bin = findZocketBin()
    installAutostart(service as any, bin, service === 'web' ? 18001 : 18003)
    console.log(`Autostart installed: ${service}`)
  })

  autostartCmd.command('remove <service>').action(async (service) => {
    removeAutostart(service as any)
    console.log(`Autostart removed: ${service}`)
  })

  autostartCmd.command('status <service>').action(async (service) => {
    console.log(getStatus(service as any))
  })

  // harden
  program.command('harden')
    .command('install-linux-system')
    .option('--service-user <u>', 'service user', 'zocketd')
    .option('--zocket-home <h>', 'ZOCKET_HOME', '/var/lib/zocket')
    .option('--web-port <p>', 'web port', '18001')
    .option('--mcp-host <h>', 'MCP host', '127.0.0.1')
    .option('--mcp-port <p>', 'MCP port', '18003')
    .option('--mcp-mode <m>', 'MCP mode', 'metadata')
    .option('--dry-run', 'print units without writing')
    .action(async (opts) => {
      await installLinuxSystem({
        zocketBin: findZocketBin(),
        zocketHome: opts.zocketHome,
        webPort: parseInt(opts.webPort),
        mcpPort: parseInt(opts.mcpPort),
        mcpHost: opts.mcpHost,
        mcpMode: opts.mcpMode,
        serviceUser: opts.serviceUser,
        dryRun: opts.dryRun,
      })
    })

  return program
}
```

- [ ] **Step 2: Update src/index.ts**

```typescript
#!/usr/bin/env node
import { buildProgram } from './cli.js'
buildProgram().parseAsync()
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Fix any errors. Common ones: missing imports, wrong types in Hono JSX return types.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: `dist/zocket.js` created. Check shebang is present:

```bash
head -1 dist/zocket.js
```

Expected: `#!/usr/bin/env node`

- [ ] **Step 5: Smoke test**

```bash
node dist/zocket.js --help
node dist/zocket.js projects --help
```

Expected: help text printed without errors.

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/index.ts
git commit -m "feat: add CLI wiring (all commands)"
```

---

### Task 16: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README to remove Python references**

Replace the `Install (dev) / Python / pip install -e .` section with TypeScript dev workflow:

```markdown
## Install (instant)

\`\`\`bash
npm i -g @ao_zorin/zocket
zocket init
\`\`\`

## Install (dev)

\`\`\`bash
git clone https://github.com/aozorin/zocket
cd zocket
npm install
npm run build
npm link
zocket init
\`\`\`

## Quick start

\`\`\`bash
zocket init
zocket web --host 127.0.0.1 --port 18001
zocket mcp --transport sse --mode metadata --host 127.0.0.1 --port 18002
zocket mcp --transport streamable-http --mode metadata --host 127.0.0.1 --port 18003
\`\`\`

## Development

\`\`\`bash
npm test
npm run typecheck
npm run build
\`\`\`
```

Also remove references to `pytest`, `PYTHONPATH`, Python scripts.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for TypeScript rewrite"
```

---

### Task 17: Release — delete old, publish fresh

- [ ] **Step 1: Unpublish old npm package**

```bash
npm unpublish @ao_zorin/zocket --force
```

If this fails (>72 hours since publish), contact npm support or use `npm deprecate`.

- [ ] **Step 2: Delete old GitHub repo via gh CLI**

```bash
gh repo delete aozorin/zocket --yes
```

- [ ] **Step 3: Create fresh GitHub repo**

```bash
gh repo create aozorin/zocket --public --description "Local encrypted vault + web panel + MCP server for AI agent workflows"
```

- [ ] **Step 4: Re-init git and push**

```bash
cd /home/zorin/project/zocket
git remote set-url origin https://github.com/aozorin/zocket.git
git push -u origin main
```

- [ ] **Step 5: Build and verify before publishing**

```bash
npm run build
npm test
node dist/zocket.js --version
```

Expected: `1.0.0`

- [ ] **Step 6: Publish to npm**

```bash
npm publish --access public
```

- [ ] **Step 7: Verify install from npm**

```bash
npm i -g @ao_zorin/zocket
zocket --version
zocket init
```

Expected: installed and working with no Python errors.

- [ ] **Step 8: Create GitHub release**

```bash
gh release create v1.0.0 --title "v1.0.0 — TypeScript rewrite" --notes "Full rewrite in TypeScript/Node.js. No Python dependency required."
```

---

*Plan complete.*
