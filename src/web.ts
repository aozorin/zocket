import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createHmac, randomBytes } from 'crypto'
import { readdirSync, statSync, existsSync } from 'fs'
import { join, resolve as resolvePath, dirname } from 'path'
import type { VaultService } from './vault.js'
import type { ConfigStore } from './config.js'
import type { AuditLogger } from './audit.js'
import { hashPassword, verifyPassword } from './auth.js'
import { applyDefence, normalizeDefence } from './defence.js'
import { t, normalizeLang, type Lang } from './i18n.js'

// ── Session helpers ───────────────────────────────────────────────────────────

const COOKIE = 'zs'

function signSession(data: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 20)
  return `${payload}.${sig}`
}

function parseSession(value: string, secret: string): Record<string, unknown> | null {
  const dot = value.lastIndexOf('.')
  if (dot === -1) return null
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(payload).digest('hex').slice(0, 20)
  if (sig !== expected) return null
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()) }
  catch { return null }
}

// ── Folder picker helpers ─────────────────────────────────────────────────────

function safeResolve(p: string) { return resolvePath(p.replace(/^~/, process.env.HOME ?? '')) }

function isSubPath(child: string, parent: string) {
  return child === parent || child.startsWith(parent + '/')
}

// ── HTML templates ────────────────────────────────────────────────────────────

const CSS_COMMON = `
@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap");
:root{--p:#0088cc;--pd:#006699;--bg:#f4faff;--bga:#eaf4fb;--card:rgba(255,255,255,.92);--text:#1b2b37;--muted:#607889;--bdr:rgba(0,136,204,.23);--danger:#be123c;--ok:#0f766e}
*{box-sizing:border-box}
body{margin:0;font-family:"Manrope","Segoe UI",sans-serif;color:var(--text)}
input,button,textarea,select{width:100%;border-radius:11px;padding:9px 10px;font:inherit;margin-bottom:8px}
input,textarea,select{border:1px solid var(--bdr);background:rgba(255,255,255,.95)}
input:focus,textarea:focus{outline:2px solid rgba(0,136,204,.28);border-color:var(--p)}
button{border:0;cursor:pointer;color:#fff;font-weight:800;background:linear-gradient(95deg,var(--p),#00a7ff);box-shadow:0 10px 22px rgba(0,136,204,.23)}
button:hover{transform:translateY(-1px)}
.btn-primary{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;color:#fff;font-weight:800;background:linear-gradient(95deg,var(--p),#00a7ff);box-shadow:0 10px 22px rgba(0,136,204,.23);border-radius:11px;padding:9px 12px}
.btn-primary:hover{transform:translateY(-1px)}
.danger{background:linear-gradient(95deg,var(--danger),#e11d48)!important;box-shadow:0 10px 22px rgba(190,18,60,.25)!important}
.mono{font-family:"JetBrains Mono","Fira Code",monospace;font-size:13px;word-break:break-word}
.inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.inline form{margin:0}
.btn-sm{width:auto;margin-bottom:0;padding:7px 11px}
.inline input,.inline select{width:auto;margin-bottom:0}
.icon-btn{width:38px;height:38px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.icon-btn svg{width:18px;height:18px}
.stack{display:flex;flex-direction:column;gap:10px}
.panel{border:1px solid var(--bdr);border-radius:14px;padding:12px;background:rgba(255,255,255,.85)}
.panel h4{margin:0 0 8px;font-size:14px;color:var(--muted)}
.file-input{max-width:320px}
.tabs{display:flex;gap:8px;margin:6px 0 12px}
.tab{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bdr);border-radius:999px;padding:6px 12px;background:rgba(255,255,255,.85);color:var(--pd);text-decoration:none;font-weight:700}
.tab.active{background:linear-gradient(95deg,var(--p),#00a7ff);color:#fff;border-color:transparent}
.muted{color:var(--muted);font-size:13px}
.error{margin-bottom:12px;padding:10px 12px;border:1px solid #fecdd3;background:#fff1f2;color:#9f1239;border-radius:12px}
.notice{margin-bottom:12px;padding:10px 12px;border:1px solid #99f6e4;background:#f0fdfa;color:#115e59;border-radius:12px}
`

function pageShell(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>${CSS_COMMON}
body{background:radial-gradient(40vw 40vw at 6% 0%,rgba(0,136,204,.20),transparent 55%),radial-gradient(45vw 45vw at 95% 100%,rgba(0,136,204,.17),transparent 60%),linear-gradient(140deg,var(--bg) 0%,var(--bga) 100%);min-height:100vh;padding:16px}
.app{max-width:1320px;margin:0 auto}
.top{border:1px solid var(--bdr);border-radius:20px;background:var(--card);box-shadow:0 18px 55px rgba(0,63,94,.17);backdrop-filter:blur(8px);padding:16px;display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:14px}
.brand{font-size:clamp(22px,3vw,32px);font-weight:800;letter-spacing:-.03em}
.brand span{background:linear-gradient(95deg,var(--p),#00a7ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.meta a{text-decoration:none;color:var(--pd);font-weight:700}
.layout{display:grid;grid-template-columns:360px 1fr;gap:14px}
.card{border:1px solid var(--bdr);border-radius:20px;background:var(--card);box-shadow:0 16px 42px rgba(0,70,110,.14);backdrop-filter:blur(8px);padding:14px}
h2,h3{margin:0 0 10px;letter-spacing:-.015em}
p{margin:0 0 10px;color:var(--muted)}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;border-bottom:1px solid rgba(0,136,204,.15);padding:8px 7px;vertical-align:top}
th{font-size:13px;color:var(--muted)}
.folder-field{display:flex;gap:8px;align-items:center}
.folder-field input{margin-bottom:0}
.modal[hidden]{display:none}
.modal{position:fixed;inset:0;background:rgba(17,31,41,.62);display:flex;align-items:center;justify-content:center;padding:16px}
.modal-card{width:min(820px,96vw);max-height:90vh;overflow:auto;border:1px solid var(--bdr);border-radius:18px;background:#fff;padding:14px}
.modal-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--bdr);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.8);color:var(--muted);font-size:13px}
.folder-list{max-height:280px;overflow:auto;border:1px solid var(--bdr);border-radius:10px;padding:8px}
.folder-list button{width:100%;text-align:left;margin-bottom:6px}
.folder-list button:last-child{margin-bottom:0}
hr{border:none;border-top:1px solid var(--bdr);margin:12px 0}
@media(max-width:1040px){.layout{grid-template-columns:1fr}}
@media(max-width:700px){.top{flex-direction:column;align-items:flex-start}}
</style></head>
<body><div class="app">${body}</div></body></html>`
}

function loginPage(lang: Lang, error: string | undefined, missingPassword: boolean): string {
  const body = `
<style>
body{display:grid;place-items:center;min-height:100vh;padding:20px}
.shell{width:min(680px,100%);border-radius:22px;border:1px solid var(--bdr);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(255,255,255,.93));box-shadow:0 24px 70px rgba(0,62,95,.20);backdrop-filter:blur(7px);padding:22px}
.head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}
.logo{font-size:24px;font-weight:800;letter-spacing:-.02em}
.logo span{background:linear-gradient(95deg,var(--p),#00a9ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.lang a{color:var(--pd);text-decoration:none;font-weight:700;margin-left:10px}
h1{margin:4px 0 6px;font-size:clamp(22px,4.6vw,32px);line-height:1.1;letter-spacing:-.02em}
h2{margin:0 0 8px;font-size:17px;letter-spacing:-.01em}
.section{border:1px solid var(--bdr);border-radius:14px;background:rgba(255,255,255,.82);padding:12px;margin-bottom:10px}
.section.warn{border-color:rgba(190,18,60,.30);background:#fff7f9}
.checkline{display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;color:#374151}
.checkline input{width:auto;margin:4px 0 0;padding:0}
</style>
<div class="shell">
  <div class="head">
    <div class="logo">zocket <span>pretty</span></div>
    <div class="lang"><a href="/login?lang=en">EN</a><a href="/login?lang=ru">RU</a></div>
  </div>
  ${error ? `<div class="error">${error}</div>` : ''}
  ${missingPassword ? `
    <h1>${t('ui.first_setup_title', lang)}</h1>
    <p>${t('ui.first_setup_subtitle', lang)}</p>
    <div class="section">
      <h2>${t('ui.set_password', lang)}</h2>
      <form method="post" action="/setup/first-run">
        <input type="hidden" name="mode" value="set_password"/>
        <input type="password" name="password" placeholder="${t('ui.password', lang)}" required/>
        <input type="password" name="password_repeat" placeholder="${t('ui.password_repeat', lang)}" required/>
        <button type="submit">${t('ui.save_and_enter', lang)}</button>
      </form>
    </div>
    <div class="section">
      <h2>${t('ui.generate_password', lang)}</h2>
      <p>${t('ui.generate_password_hint', lang)}</p>
      <form method="post" action="/setup/first-run">
        <input type="hidden" name="mode" value="generate_password"/>
        <button type="submit">${t('ui.generate_and_enter', lang)}</button>
      </form>
    </div>
    <div class="section warn">
      <h2>${t('ui.continue_without_password', lang)}</h2>
      <p>${t('ui.insecure_warning', lang)}</p>
      <form method="post" action="/setup/first-run" onsubmit="return confirm('${t('ui.insecure_confirm_dialog', lang)}')">
        <input type="hidden" name="mode" value="no_password"/>
        <label class="checkline">
          <input type="checkbox" name="confirm_no_password" value="1" required/>
          <span>${t('ui.i_understand_risk', lang)}</span>
        </label>
        <button class="danger" type="submit">${t('ui.continue_anyway', lang)}</button>
      </form>
    </div>
  ` : `
    <h1>${t('ui.sign_in', lang)}</h1>
    <form method="post" action="/login">
      <input type="password" name="password" placeholder="${t('ui.password', lang)}" required/>
      <button type="submit">${t('ui.login', lang)}</button>
    </form>
  `}
</div>`

  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>zocket</title><style>${CSS_COMMON}</style></head><body>${body}</body></html>`
}

function mainPage(opts: {
  lang: Lang
  projects: Array<{ name: string; description: string; folder_path?: string; secret_count: number; allowed_domains?: string[] | null }>
  selected: string | null
  secrets: Array<{ key: string; description: string; updated_at: string }>
  showValues: boolean
  secretValues: Record<string, string>
  tab: string
  mcp_loading: string
  defence_level: string
  error?: string
  notice?: string
}): string {
  const { lang, projects, selected, secrets, showValues, secretValues, tab, mcp_loading, defence_level, error, notice } = opts
  const selInfo = projects.find(p => p.name === selected)
  const folderIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>'
  const activeTab = tab === 'transfer' ? 'transfer' : (tab === 'settings' ? 'settings' : 'secrets')
  const showParam = showValues ? '&show_values=1' : ''
  const tabParam = `&tab=${enc(activeTab)}`
  const transferBlock = `
<div class="stack">
  <div class="panel">
    <h4>${t('ui.export', lang)}</h4>
    <a class="btn-sm btn-primary" href="/export" download>${t('ui.export', lang)}</a>
  </div>
  <div class="panel">
    <h4>${t('ui.import', lang)}</h4>
    <form method="post" action="/import" enctype="multipart/form-data">
      <input class="file-input" type="file" name="file" accept="application/json" required/>
      <select name="mode">
        <option value="merge">${t('ui.import_merge', lang)}</option>
        <option value="replace">${t('ui.import_replace', lang)}</option>
      </select>
      <button class="btn-sm btn-primary" type="submit">${t('ui.import', lang)}</button>
    </form>
  </div>
</div>`
  const settingsBlock = `
<form method="post" action="/settings/mode">
  <label class="chip">${t('ui.mcp_loading', lang)}</label>
  <select name="mcp_loading">
    <option value="eager" ${mcp_loading === 'eager' ? 'selected' : ''}>${t('ui.loading_eager', lang)}</option>
    <option value="lazy" ${mcp_loading === 'lazy' ? 'selected' : ''}>${t('ui.loading_lazy', lang)}</option>
  </select>
  <label class="chip">${t('ui.defence_level', lang)}</label>
  <select name="defence_level">
    <option value="low" ${defence_level === 'low' ? 'selected' : ''}>${t('ui.low_defence', lang)}</option>
    <option value="decent" ${defence_level === 'decent' ? 'selected' : ''}>${t('ui.decent_defence', lang)}</option>
    <option value="high" ${defence_level === 'high' ? 'selected' : ''}>${t('ui.high_defence', lang)}</option>
  </select>
  <button class="btn-sm" type="submit">${t('ui.save_settings', lang)}</button>
</form>
<p class="muted">${t('ui.high_defence_note', lang)}</p>`

  const sidebar = `
<aside class="card">
  <h2>${t('ui.projects', lang)}</h2>
  <table>
    <thead><tr><th>${t('ui.name', lang)}</th><th>${t('ui.keys_count', lang)}</th></tr></thead>
    <tbody>
      ${projects.map(p => `<tr><td><a href="/?project=${enc(p.name)}${showParam}${tabParam}">${esc(p.name)}</a></td><td>${p.secret_count}</td></tr>`).join('')}
    </tbody>
  </table>
  <hr/>
  <h3>${t('ui.new_project', lang)}</h3>
  <form method="post" action="/projects/create">
    <input name="name" placeholder="project-name" required/>
    <input name="description" placeholder="${t('ui.optional_desc', lang)}"/>
    <div class="folder-field">
      <input id="cf" name="folder_path" placeholder="${t('ui.optional_folder', lang)}" readonly/>
      <button class="btn-sm icon-btn" type="button" onclick="openPicker('cf')" aria-label="${t('ui.choose_folder', lang)}" title="${t('ui.choose_folder', lang)}">${folderIcon}</button>
    </div>
    <button type="submit">${t('ui.create', lang)}</button>
  </form>
</aside>`

  const tabs = `
<div class="tabs">
  <a class="tab ${activeTab === 'secrets' ? 'active' : ''}" href="/?${selected ? `project=${enc(selected)}&` : ''}tab=secrets${showParam}">${t('ui.secrets', lang)}</a>
  <a class="tab ${activeTab === 'transfer' ? 'active' : ''}" href="/?${selected ? `project=${enc(selected)}&` : ''}tab=transfer${showParam}">${t('ui.transfer', lang)}</a>
  <a class="tab ${activeTab === 'settings' ? 'active' : ''}" href="/?${selected ? `project=${enc(selected)}&` : ''}tab=settings${showParam}">${t('ui.settings', lang)}</a>
</div>`

  let main = `<main class="card">${tabs}`
  if (!selected) {
    if (activeTab === 'transfer') {
      main += `<h2>${t('ui.transfer', lang)}</h2>${transferBlock}`
    } else if (activeTab === 'settings') {
      main += `<h2>${t('ui.settings', lang)}</h2>${settingsBlock}`
    } else {
      main += `<h2>${t('ui.no_projects', lang)}</h2><p>${t('ui.create_left', lang)}</p>`
    }
  } else {
    const domains = selInfo?.allowed_domains
    const domainsStr = domains ? domains.join(', ') : ''
    main += `
<h2>${esc(selected)}</h2>
<p>${t('ui.project_folder', lang)}: ${selInfo?.folder_path ? `<span class="mono">${esc(selInfo.folder_path)}</span>` : t('ui.not_set', lang)}</p>

<form method="post" action="/projects/${enc(selected)}/folder">
  <div class="folder-field">
    <input id="ef" name="folder_path" placeholder="${t('ui.optional_folder', lang)}" value="${esc(selInfo?.folder_path ?? '')}" readonly/>
    <button class="btn-sm icon-btn" type="button" onclick="openPicker('ef')" aria-label="${t('ui.choose_folder', lang)}" title="${t('ui.choose_folder', lang)}">${folderIcon}</button>
  </div>
  <button type="submit">${t('ui.save_folder', lang)}</button>
</form>
${selInfo?.folder_path ? `
<form method="post" action="/projects/${enc(selected)}/folder" onsubmit="return confirm('${t('ui.clear_folder', lang)}?')">
  <input type="hidden" name="clear" value="1"/>
  <button class="danger btn-sm" type="submit">${t('ui.clear_folder', lang)}</button>
</form>` : ''}

<p>Domains: ${domains ? `<span class="mono">${esc(domainsStr)}</span>` : t('ui.not_set', lang)}</p>
<form method="post" action="/projects/${enc(selected)}/domains">
  <input name="domains" placeholder="api.example.com, api2.example.com (empty to remove)" value="${esc(domainsStr)}"/>
  <button type="submit" class="btn-sm">Save domains</button>
</form>

<p>
  ${showValues
    ? `${t('ui.real_values_visible', lang)} <a href="/?project=${enc(selected)}&tab=${activeTab}">${t('ui.hide_values', lang)}</a>`
    : `${t('ui.masked_values_visible', lang)} <a href="/?project=${enc(selected)}&tab=${activeTab}&show_values=1">${t('ui.show_values', lang)}</a>`}
</p>
<div class="inline">
  <form method="post" action="/projects/${enc(selected)}/delete" onsubmit="return confirm('${t('ui.delete_project', lang)}?')">
    <button class="danger btn-sm" type="submit">${t('ui.delete_project', lang)}</button>
  </form>
</div>

${activeTab === 'transfer' ? `<h3>${t('ui.transfer', lang)}</h3>${transferBlock}` : ''}
${activeTab === 'settings' ? `<h3>${t('ui.settings', lang)}</h3>${settingsBlock}` : ''}
${activeTab === 'secrets' ? `
<h3>${t('ui.secrets', lang)}</h3>
<table>
  <thead><tr><th>KEY</th><th>${t('ui.value', lang)}</th><th>${t('ui.description', lang)}</th><th>${t('ui.updated_at', lang)}</th><th></th></tr></thead>
  <tbody>
    ${secrets.map(s => `<tr>
      <td class="mono">${esc(s.key)}</td>
      <td class="mono">${showValues ? esc(secretValues[s.key] ?? '') : '***'}</td>
      <td>${esc(s.description)}</td>
      <td>${esc(s.updated_at.slice(0, 16).replace('T', ' '))}</td>
      <td>
        <form method="post" action="/projects/${enc(selected)}/secrets/${enc(s.key)}/delete" onsubmit="return confirm('Delete ${esc(s.key)}?')">
          <button class="danger btn-sm" type="submit">${t('ui.delete', lang)}</button>
        </form>
      </td>
    </tr>`).join('')}
  </tbody>
</table>

<h3>${t('ui.add_or_update_secret', lang)}</h3>
<form method="post" action="/projects/${enc(selected)}/secrets/upsert">
  <input name="key" placeholder="API_KEY" required/>
  <input name="value" placeholder="${t('ui.value', lang)}" required/>
  <input name="description" placeholder="${t('ui.optional_desc', lang)}"/>
  <button type="submit">${t('ui.save', lang)}</button>
</form>` : ''}`
  }
  main += `</main>`

  const folderScript = `
<script>
const ps={targetId:null,current:null,parent:null};
const pm=document.getElementById('fp-modal');
const pc=document.getElementById('fp-cur');
const pl=document.getElementById('fp-list');
const pe=document.getElementById('fp-err');
const pu=document.getElementById('fp-up');
const psel=document.getElementById('fp-sel');
function _setErr(m){if(!m){pe.style.display='none';pe.textContent='';return}pe.style.display='block';pe.textContent=m}
function _renderBtns(rows){pl.innerHTML='';if(!rows||!rows.length){pl.innerHTML='<p>${t('ui.no_subfolders', lang)}</p>';return}for(const r of rows){const b=document.createElement('button');b.type='button';b.textContent=r.name;b.addEventListener('click',()=>_load(r.path));pl.appendChild(b)}}
async function _load(path){_setErr('');pl.innerHTML='<p>${t('ui.loading', lang)}</p>';const q=path?'?path='+encodeURIComponent(path):'';const r=await fetch('/api/folders'+q,{credentials:'same-origin'});const d=await r.json();if(!r.ok||!d.ok){_setErr(d&&d.error?d.error:'${t('ui.folder_picker_failed', lang)}');pl.innerHTML='';return}ps.current=d.current;ps.parent=d.parent;pc.textContent=d.current||'${t('ui.roots', lang)}';pu.disabled=!d.parent;psel.disabled=!d.current;_renderBtns(d.directories||[])}
function openPicker(id){ps.targetId=id;pm.hidden=false;const inp=document.getElementById(id);_load(inp&&inp.value?inp.value:'')}
function closePicker(){pm.hidden=true;ps.targetId=null;ps.current=null;ps.parent=null}
function pickerUp(){if(ps.parent)_load(ps.parent)}
function pickerRoots(){_load('')}
function pickerSelect(){if(!ps.targetId||!ps.current)return;const inp=document.getElementById(ps.targetId);if(inp)inp.value=ps.current;closePicker()}
</script>`

  const topBar = `
<div class="top">
  <div>
    <div class="brand">zocket <span>pretty</span></div>
    <p style="margin:0;color:var(--muted)">${t('app.tagline', lang)}</p>
  </div>
  <div class="meta">
    <span>${t('ui.lang', lang)}:</span>
    <a href="/?lang=en${selected ? `&project=${enc(selected)}` : ''}${showParam}${tabParam}">EN</a>
    <a href="/?lang=ru${selected ? `&project=${enc(selected)}` : ''}${showParam}${tabParam}">RU</a>
    <form method="post" action="/logout"><button class="btn-sm" type="submit">${t('ui.logout', lang)}</button></form>
  </div>
</div>`

  const folderModal = `
<div id="fp-modal" class="modal" hidden>
  <div class="modal-card">
    <div class="modal-head">
      <h3>${t('ui.folder_picker', lang)}</h3>
      <button class="btn-sm danger" type="button" onclick="closePicker()">${t('ui.close', lang)}</button>
    </div>
    <p>${t('ui.current_path', lang)}: <span class="mono" id="fp-cur">-</span></p>
    <div class="inline">
      <button class="btn-sm" type="button" id="fp-up" onclick="pickerUp()">${t('ui.parent_folder', lang)}</button>
      <button class="btn-sm" type="button" onclick="pickerRoots()">${t('ui.roots', lang)}</button>
      <button class="btn-sm" type="button" id="fp-sel" onclick="pickerSelect()">${t('ui.select_folder', lang)}</button>
    </div>
    <div id="fp-err" class="error" style="display:none"></div>
    <div id="fp-list" class="folder-list"></div>
  </div>
</div>`

  const content = `
${topBar}
${error ? `<div class="error">${esc(error)}</div>` : ''}
${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
<div class="layout">${sidebar}${main}</div>
${folderModal}
${folderScript}`

  return pageShell(lang, 'zocket', content)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function enc(s: string) { return encodeURIComponent(s) }

// ── App factory ───────────────────────────────────────────────────────────────

export interface WebServices {
  vault:  VaultService
  config: ConfigStore
  audit:  AuditLogger
}

export function createWebApp(services: WebServices): Hono {
  const { vault, config, audit } = services
  const app = new Hono()

  // ── Lang helper ─────────────────────────────────────────────────────────────

  function getLang(cookieLang: string | undefined, queryLang: string | undefined): Lang {
    const raw = queryLang ?? cookieLang ?? config.load().language
    return normalizeLang(raw)
  }

  // ── Session helpers ─────────────────────────────────────────────────────────

  function isAuthenticated(sessionCookie: string | undefined, secret: string): boolean {
    if (!config.load().web_auth_enabled) return true
    if (!sessionCookie) return false
    const sess = parseSession(sessionCookie, secret)
    return sess?.auth === true
  }

  function hasPassword(): boolean {
    const cfg = config.load()
    return !!(cfg.web_password_hash && cfg.web_password_salt)
  }

  // ── Auth middleware ─────────────────────────────────────────────────────────

  function requireAuth(next: (cfg: ReturnType<ConfigStore['load']>) => Promise<Response> | Response) {
    return async (c: Parameters<typeof app.get>[1] extends (...args: infer A) => unknown ? A[0] : never) => {
      const cfg = config.load()
      const lang = getLang(getCookie(c, 'lang'), c.req.query('lang'))
      if (c.req.query('lang')) setCookie(c, 'lang', lang, { path: '/', sameSite: 'Lax' })
      const sess = getCookie(c, COOKIE)
      if (!isAuthenticated(sess, cfg.session_secret)) {
        const dest = c.req.path
        return c.redirect(`/login${dest !== '/' ? `?next=${enc(dest)}` : ''}`)
      }
      return next(cfg)
    }
  }

  // ── Login ───────────────────────────────────────────────────────────────────

  app.get('/login', c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), c.req.query('lang'))
    if (c.req.query('lang')) setCookie(c, 'lang', lang, { path: '/', sameSite: 'Lax' })
    if (!cfg.web_auth_enabled) return c.redirect('/')
    const sess = getCookie(c, COOKIE)
    if (isAuthenticated(sess, cfg.session_secret)) return c.redirect('/')
    return c.html(loginPage(lang, c.req.query('error'), !hasPassword()))
  })

  app.post('/login', async c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), undefined)
    const body = await c.req.parseBody()
    const password = String(body.password ?? '')
    const ok = verifyPassword(password, String(cfg.web_password_hash), String(cfg.web_password_salt))
    if (!ok) {
      audit.log('web.login', 'web', { remote: c.req.header('x-forwarded-for') ?? 'local' }, 'fail')
      return c.redirect(`/login?error=${enc(t('ui.invalid_login', lang))}`)
    }
    setCookie(c, COOKIE, signSession({ auth: true }, cfg.session_secret), { path: '/', httpOnly: true, sameSite: 'Lax' })
    audit.log('web.login', 'web', {}, 'ok')
    const next = c.req.query('next') ?? '/'
    return c.redirect(next)
  })

  app.post('/setup/first-run', async c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), undefined)
    if (hasPassword()) return c.redirect('/login')
    const body = await c.req.parseBody()
    const mode = String(body.mode ?? '')

    if (mode === 'set_password') {
      const pw = String(body.password ?? ''), pw2 = String(body.password_repeat ?? '')
      if (!pw) return c.redirect(`/login?error=${enc(t('ui.password_required', lang))}`)
      if (pw !== pw2) return c.redirect(`/login?error=${enc(t('ui.passwords_do_not_match', lang))}`)
      const { salt, hash } = hashPassword(pw)
      cfg.web_password_salt = salt; cfg.web_password_hash = hash; cfg.web_auth_enabled = true
      config.save(cfg)
      setCookie(c, COOKIE, signSession({ auth: true }, cfg.session_secret), { path: '/', httpOnly: true, sameSite: 'Lax' })
      audit.log('web.setup', 'web', { mode: 'set_password' }, 'ok')
      return c.redirect('/')
    }

    if (mode === 'generate_password') {
      const generated = randomBytes(18).toString('base64url')
      const { salt, hash } = hashPassword(generated)
      cfg.web_password_salt = salt; cfg.web_password_hash = hash; cfg.web_auth_enabled = true
      config.save(cfg)
      setCookie(c, COOKIE, signSession({ auth: true }, cfg.session_secret), { path: '/', httpOnly: true, sameSite: 'Lax' })
      setCookie(c, 'genpw', generated, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 60 })
      audit.log('web.setup', 'web', { mode: 'generate_password' }, 'ok')
      return c.redirect('/')
    }

    if (mode === 'no_password') {
      if (String(body.confirm_no_password) !== '1')
        return c.redirect(`/login?error=${enc(t('ui.confirm_insecure_required', lang))}`)
      cfg.web_auth_enabled = false; cfg.web_password_hash = ''; cfg.web_password_salt = ''
      config.save(cfg)
      setCookie(c, COOKIE, signSession({ auth: true }, cfg.session_secret), { path: '/', httpOnly: true, sameSite: 'Lax' })
      audit.log('web.setup', 'web', { mode: 'no_password' }, 'ok')
      return c.redirect('/')
    }

    return c.redirect(`/login?error=${enc(t('ui.invalid_setup_option', lang))}`)
  })

  app.post('/logout', c => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.redirect('/login')
  })

  // ── Folder picker API ───────────────────────────────────────────────────────

  app.get('/api/folders', c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.json({ ok: false, error: 'Unauthorized' }, 401)

    const roots = (cfg.folder_picker_roots ?? ['/home', '/srv', '/opt', '/var/www']).filter(r => {
      try { return existsSync(r) && statSync(r).isDirectory() }
      catch { return false }
    })
    if (!roots.length) return c.json({ ok: false, error: 'No folder picker roots configured' }, 500)

    const requested = c.req.query('path')?.trim() ?? ''
    if (!requested) {
      const rows = roots.map(r => ({ name: r, path: r }))
      return c.json({ ok: true, current: null, parent: null, roots: rows, directories: rows })
    }

    const current = safeResolve(requested)
    if (!roots.some(r => isSubPath(current, r)))
      return c.json({ ok: false, error: 'Folder is outside allowed roots.' }, 403)
    if (!existsSync(current) || !statSync(current).isDirectory())
      return c.json({ ok: false, error: 'Folder not found.' }, 404)

    let dirs: Array<{ name: string; path: string }> = []
    try {
      dirs = readdirSync(current, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ name: e.name, path: join(current, e.name) }))
        .filter(d => roots.some(r => isSubPath(d.path, r)))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch { dirs = [] }

    const parent_ = dirname(current)
    const parent = parent_ !== current && roots.some(r => isSubPath(parent_, r)) ? parent_ : null
    return c.json({ ok: true, current, parent, roots: roots.map(r => ({ name: r, path: r })), directories: dirs })
  })

  // ── Export / Import ────────────────────────────────────────────────────────

  app.get('/export', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const data = await vault.exportData()
    audit.log('web.export', 'web', {}, 'ok')
    const json = JSON.stringify(data, null, 2)
    return new Response(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="zocket-export.json"',
      },
    })
  })

  app.post('/import', async c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), undefined)
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const body = await c.req.parseBody()
    const mode = String(body.mode ?? 'merge') === 'replace' ? 'replace' : 'merge'
    const file = body.file as any
    if (!file || typeof file.text !== 'function') {
      return c.redirect(`/?error=${enc('No import file provided')}`)
    }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      await vault.importData(parsed, mode)
      audit.log('web.import', 'web', { mode }, 'ok')
      return c.redirect(`/?tab=transfer&notice=${enc(`${t('ui.import', lang)} (${mode}) ok`)}`)
    } catch (e) {
      audit.log('web.import', 'web', { mode }, 'fail')
      return c.redirect(`/?tab=transfer&error=${enc(String(e))}`)
    }
  })

  // ── Settings ──────────────────────────────────────────────────────────────

  app.post('/settings/mode', async c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), undefined)
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const body = await c.req.parseBody()
    const loading = String(body.mcp_loading ?? 'eager') === 'lazy' ? 'lazy' : 'eager'
    const defence = normalizeDefence(String(body.defence_level ?? 'decent'))
    try {
      const next = applyDefence(cfg, defence)
      next.mcp_loading = loading
      config.save(next)
      audit.log('web.settings', 'web', { loading, defence }, 'ok')
      return c.redirect(`/?tab=settings&notice=${enc(t('ui.save_settings', lang))}`)
    } catch (e) {
      audit.log('web.settings', 'web', { loading, defence }, 'fail')
      return c.redirect(`/?tab=settings&error=${enc(String(e))}`)
    }
  })

  // ── Main panel ──────────────────────────────────────────────────────────────

  app.get('/', async c => {
    const cfg = config.load()
    const lang = getLang(getCookie(c, 'lang'), c.req.query('lang'))
    if (c.req.query('lang')) setCookie(c, 'lang', lang, { path: '/', sameSite: 'Lax' })
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')

    const projects = await vault.listProjects()
    const reqProject = c.req.query('project')
    const selected = reqProject ?? (projects[0]?.name ?? null)
    const showValues = c.req.query('show_values') === '1'
    const tab = c.req.query('tab') ?? 'secrets'
    const notice_raw = getCookie(c, 'genpw')
    if (notice_raw) deleteCookie(c, 'genpw', { path: '/' })
    const noticeParam = c.req.query('notice')

    let secrets: Array<{ key: string; description: string; updated_at: string }> = []
    let secretValues: Record<string, string> = {}
    if (selected) {
      try {
        secrets = await vault.listSecrets(selected)
        if (showValues) secretValues = await vault.getEnv(selected)
      } catch { secrets = [] }
    }

    return c.html(mainPage({
      lang,
      projects,
      selected,
      secrets,
      showValues,
      secretValues,
      tab,
      mcp_loading: cfg.mcp_loading,
      defence_level: cfg.defence_level,
      error: c.req.query('error'),
      notice: noticeParam ? noticeParam : (notice_raw ? `${t('ui.generated_password_notice', lang)}\n${notice_raw}\n${t('ui.generated_password_save_now', lang)}` : undefined),
    }))
  })

  // ── Project CRUD ────────────────────────────────────────────────────────────

  app.post('/projects/create', async c => {
    const cfg = config.load(); const lang = getLang(getCookie(c, 'lang'), undefined)
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const body = await c.req.parseBody()
    const name = String(body.name ?? '').trim()
    const description = String(body.description ?? '')
    const folder_path = String(body.folder_path ?? '').trim() || undefined
    try {
      await vault.createProject(name, description)
      if (folder_path) await vault.setFolder(name, folder_path)
      audit.log('web.project.create', 'web', { name, folder_path }, 'ok')
    } catch (e) {
      audit.log('web.project.create', 'web', { name }, 'fail')
      return c.redirect(`/?error=${enc(String(e))}`)
    }
    return c.redirect(`/?project=${enc(name)}`)
  })

  app.post('/projects/:project/delete', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const project = c.req.param('project')
    try {
      await vault.deleteProject(project)
      audit.log('web.project.delete', 'web', { project }, 'ok')
    } catch (e) {
      return c.redirect(`/?error=${enc(String(e))}`)
    }
    return c.redirect('/')
  })

  app.post('/projects/:project/folder', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const project = c.req.param('project')
    const body = await c.req.parseBody()
    const clear = body.clear === '1'
    const folder_path = clear ? undefined : String(body.folder_path ?? '').trim() || undefined
    try {
      await vault.setFolder(project, folder_path)
      audit.log('web.project.folder', 'web', { project, folder_path }, 'ok')
    } catch (e) {
      return c.redirect(`/?project=${enc(project)}&error=${enc(String(e))}`)
    }
    return c.redirect(`/?project=${enc(project)}`)
  })

  app.post('/projects/:project/domains', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const project = c.req.param('project')
    const body = await c.req.parseBody()
    const raw = String(body.domains ?? '').trim()
    const domains = raw ? raw.split(/[\s,]+/).map(d => d.trim()).filter(Boolean) : null
    try {
      await vault.setAllowedDomains(project, domains)
      audit.log('web.project.domains', 'web', { project, domains }, 'ok')
    } catch (e) {
      return c.redirect(`/?project=${enc(project)}&error=${enc(String(e))}`)
    }
    return c.redirect(`/?project=${enc(project)}`)
  })

  // ── Secret CRUD ─────────────────────────────────────────────────────────────

  app.post('/projects/:project/secrets/upsert', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const project = c.req.param('project')
    const body = await c.req.parseBody()
    const key = String(body.key ?? '').trim()
    const value = String(body.value ?? '')
    const description = String(body.description ?? '')
    try {
      await vault.setSecret(project, key, value, description)
      audit.log('web.secret.upsert', 'web', { project, key }, 'ok')
    } catch (e) {
      audit.log('web.secret.upsert', 'web', { project, key }, 'fail')
      return c.redirect(`/?project=${enc(project)}&error=${enc(String(e))}`)
    }
    return c.redirect(`/?project=${enc(project)}`)
  })

  app.post('/projects/:project/secrets/:key/delete', async c => {
    const cfg = config.load()
    const sess = getCookie(c, COOKIE)
    if (!isAuthenticated(sess, cfg.session_secret)) return c.redirect('/login')
    const project = c.req.param('project')
    const key = c.req.param('key')
    try {
      await vault.deleteSecret(project, key)
      audit.log('web.secret.delete', 'web', { project, key }, 'ok')
    } catch (e) {
      return c.redirect(`/?project=${enc(project)}&error=${enc(String(e))}`)
    }
    return c.redirect(`/?project=${enc(project)}`)
  })

  return app
}
