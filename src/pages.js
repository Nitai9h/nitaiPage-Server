function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]))
}

/* 配对页 */

// pair 模式
export function pairPage({ version = '', ttlMinutes = 10, dockerHint = 'docker compose exec nitaipage' } = {}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pairing | NitaiPage</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #1c1c1b; color: #f1efe8;
    font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: min(92vw, 480px) }
  h1 { margin: 0 0 6px; font-size: 18px; font-weight: 500 }
  .hint { margin: 0 0 22px; color: #b4b2a9; font-size: 13px }
  .code {
    display: block; width: 100%; padding: 16px; margin: 0 0 6px;
    border-radius: 12px; border: 1px dashed #5f5e5a; background: #2c2c2a;
    font: 600 28px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: .12em; text-align: center; color: #f1efe8;
  }
  .ttl { margin: 0 0 20px; color: #b4b2a9; font-size: 12.5px }
  .step { margin: 0 0 8px; font-size: 13px; color: #b4b2a9 }
  pre {
    margin: 0 0 18px; padding: 12px; overflow-x: auto;
    border-radius: 8px; border: 1px solid #3c3c3a; background: #232322;
    font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d9d6cd;
  }
  .status { display: flex; align-items: center; gap: 8px; min-height: 22px; font-size: 13px; color: #b4b2a9 }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #f9b44e; animation: pulse 1.8s ease-in-out infinite }
  .status.ok { color: #9fe1cb } .status.ok .dot { background: #9fe1cb; animation: none }
  .status.error { color: #f09595 } .status.error .dot { background: #f09595; animation: none }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
</style>
</head>
<body>
<div class="card">
  <h1>授权这台设备：</h1>
  <p class="hint">${version ? `nitaiPage Server · v${escapeHtml(version)} · ` : ''}等待手动批准</p>

  <span class="code" id="code">······</span>
  <p class="ttl" id="ttl"></p>

  <p class="step">在容器内执行：</p>
  <pre id="cmd">npm run pair -- 配对码</pre>
  <p class="step" id="docker-step" hidden>或直接在主机上执行：</p>
  <pre id="docker-cmd" hidden>${escapeHtml(dockerHint)} npm run pair -- 配对码</pre>

  <div class="status" id="status"><span class="dot"></span><span id="status-text">正在配对…</span></div>
</div>
<script>
(function () {
  'use strict'

  var POLL_MS = 2000
  var codeEl = document.getElementById('code')
  var ttlEl = document.getElementById('ttl')
  var cmdEl = document.getElementById('cmd')
  var dockerStep = document.getElementById('docker-step')
  var dockerCmd = document.getElementById('docker-cmd')
  var statusEl = document.getElementById('status')
  var statusText = document.getElementById('status-text')

  var session = null
  var expiresAt = 0

  function setStatus(text, kind) {
    statusText.textContent = text
    statusEl.className = kind ? 'status ' + kind : 'status'
  }

  // 选取设备名
  function deviceName() {
    var ua = navigator.userAgent
    var browser = /Edg\\//.test(ua) ? 'Edge'
      : /OPR\\//.test(ua) ? 'Opera'
      : /Firefox\\//.test(ua) ? 'Firefox'
      : /Chrome\\//.test(ua) ? 'Chrome'
      : /Safari\\//.test(ua) ? 'Safari' : '浏览器'
    var os = /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'macOS'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Linux/.test(ua) ? 'Linux' : ''
    return os ? browser + ' / ' + os : browser
  }

  function showCode(data) {
    session = data
    expiresAt = data.expiresAt
    codeEl.textContent = data.code
    // 去掉显示的分隔符
    var plain = data.code.replace('-', '')
    cmdEl.textContent = 'npm run pair -- ' + plain
    if (dockerCmd) dockerCmd.textContent = '${escapeHtml(dockerHint)} npm run pair -- ' + plain
    if (dockerStep) dockerStep.hidden = false
    if (dockerCmd) dockerCmd.hidden = false
    setStatus('等待批准…')
  }

  async function requestPairing() {
    try {
      var response = await fetch('/api/pair/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deviceName(), platform: navigator.platform || '' })
      })
      var data = await response.json().catch(function () { return {} })

      if (!response.ok || !data.ok) {
        setStatus(data.error === 'too-many-pending'
          ? '待批准的设备数超过上线，请稍后再试'
          : '申请配对失败，请刷新页面重试', 'error')
        return false
      }
      showCode(data)
      return true
    } catch (error) {
      setStatus('无法连接到服务', 'error')
      return false
    }
  }

${NEXT_TARGET_SNIPPET}

  async function poll() {
    if (!session) return

    try {
      var response = await fetch('/api/pair/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: session.deviceId, secret: session.secret })
      })
      var data = await response.json().catch(function () { return {} })

      if (data.status === 'claimed') {
        setStatus('已授权', 'ok')
        location.replace(nextTarget())
        return
      }
      if (data.status === 'denied') {
        setStatus('已拒绝此设备的请求', 'error')
        return
      }
      if (data.status === 'expired' || data.status === 'unknown') {
        setStatus('当前配对码过期，等待重新获取…')
        if (await requestPairing()) setTimeout(poll, POLL_MS)
        return
      }
      setStatus('等待批准…')
    } catch (error) {
      setStatus('等待服务响应…')
    }
    setTimeout(poll, POLL_MS)
  }

  function tickTtl() {
    if (!expiresAt) return
    var left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
    ttlEl.textContent = left > 0
      ? '配对码 ' + Math.ceil(left / 60) + ' 分钟内有效'
      : '配对码已过期'
  }

  setInterval(tickTtl, 1000)

  // 与扩展通信防止重定向到离线页
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      channel: 'nppext', type: 'notice', id: 'pair-' + Date.now(), method: 'site.ready', params: {}
    }, '*')
  }

  requestPairing().then(function (ok) {
    tickTtl()
    if (ok) setTimeout(poll, POLL_MS)
  })
})()
</script>
</body>
</html>`
}

// password 模式
export function loginPage({ version = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>login · NitaiPage</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #1c1c1b; color: #f1efe8;
    font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: min(92vw, 380px) }
  h1 { margin: 0 0 6px; font-size: 18px; font-weight: 500 }
  .hint { margin: 0 0 20px; color: #b4b2a9; font-size: 13px }
  input, button {
    width: 100%; padding: 10px 12px; border-radius: 8px; font: inherit;
    border: 1px solid #5f5e5a; background: #2c2c2a; color: inherit;
  }
  input:focus { outline: none; border-color: #85b7eb }
  button {
    margin-top: 12px; cursor: pointer; font-weight: 500;
    background: #0c447c; border-color: #378add;
  }
  button:disabled { opacity: .6; cursor: default }
  .error { min-height: 20px; margin-top: 10px; font-size: 13px; color: #f09595 }
  .warn { margin: 18px 0 0; padding-top: 14px; border-top: 1px solid #3c3c3a; color: #b4b2a9; font-size: 12px }
</style>
</head>
<body>
<div class="card">
  <h1>NitaiPage</h1>
  <p class="hint">${version ? `nitaiPage Server · v${escapeHtml(version)} · ` : ''}等待输入密码</p>
  <form id="form">
    <input id="password" type="password" autocomplete="current-password" placeholder="访问密码" autofocus>
    <button id="submit" type="submit">进入</button>
  </form>
  <div class="error" id="error"></div>
  <p class="warn">不安全的验证方式</p>
</div>
<script>
const form = document.getElementById('form')
const input = document.getElementById('password')
const button = document.getElementById('submit')
const error = document.getElementById('error')

${NEXT_TARGET_SNIPPET}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  error.textContent = ''
  button.disabled = true

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value })
    })
    const data = await response.json().catch(() => ({}))

    if (response.ok && data.ok) {
      location.replace(nextTarget())
      return
    }
    error.textContent = response.status === 429 ? '尝试次数过多，请稍后再试' : '密码不正确'
  } catch {
    error.textContent = '无法连接到服务'
  } finally {
    button.disabled = false
  }
})
</script>
</body>
</html>`
}

// public 目录没有前端构建产物时
export function missingFrontendPage({ publicDir = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WARN · NitaiPage</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #1c1c1b; color: #f1efe8;
    font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: min(92vw, 460px) }
  h1 { margin: 0 0 12px; font-size: 18px; font-weight: 500 }
  code { background: #2c2c2a; padding: 2px 6px; border-radius: 4px; font-size: 13px }
  p { margin: 0 0 10px; color: #b4b2a9 }
</style>
</head>
<body>
<div class="card">
  <h1>未找到前端构建产物</h1>
  <p>但数据服务已启动</p>
</div>
</body>
</html>`
}

// ?next= 跳转
const NEXT_TARGET_SNIPPET = `
function nextTarget() {
  var value = new URLSearchParams(location.search).get('next') || ''
  return /^\\/(?!\\/|api\\/|files\\/|login|pair)/.test(value) ? value : '/'
}
`

// 备份下载页（已验证过）
export function backupPage({ version = '', authMode = 'pairing' } = {}) {
  const hint = authMode === 'password' ? 'password 模式' : 'pair 模式'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Export Backup · NitaiPage</title>
<style>
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #1c1c1b; color: #f1efe8;
    font: 14px/1.7 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card { width: min(92vw, 420px) }
  h1 { margin: 0 0 6px; font-size: 18px; font-weight: 500 }
  .hint { margin: 0 0 20px; color: #b4b2a9; font-size: 13px }
  a.button {
    display: block; text-align: center; padding: 10px 12px; border-radius: 8px;
    font-weight: 500; text-decoration: none;
    background: #0c447c; border: 1px solid #378add; color: inherit;
  }
  a.button:hover { background: #14588f }
  .note { margin: 16px 0 0; color: #b4b2a9; font-size: 13px }
  .warn { margin: 18px 0 0; padding-top: 14px; border-top: 1px solid #3c3c3a; color: #b4b2a9; font-size: 12px }
</style>
</head>
<body>
<div class="card">
  <h1>导出备份</h1>
  <p class="hint">${version ? `nitaiPage Server · v${escapeHtml(version)} · ${hint} · ` : ''}打包并下载数据</p>
  <a class="button" href="/backup/download">下载文件</a>
</div>
</body>
</html>`
}
