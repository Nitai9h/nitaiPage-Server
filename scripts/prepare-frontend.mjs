// 用于拉取并构建前端产物
// 手动拉取并构建：node scripts/prepare-frontend.mjs
// ref 、ONLY_SERVER 、 SERVER_URL 没变时跳过构建
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../src/config.js'

const STAMP = '.frontend.json'
const stampPath = join(config.frontendDir, STAMP)

// Windows 兼容
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const log = (message) => console.log(`[frontend] ${message}`)

function git(args, cwd) {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

function run(command, args, cwd, env) {
    log(`$ ${command} ${args.join(' ')}`)
    // Windows 兼容
    execFileSync(command, args, {
        cwd,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: env ? { ...process.env, ...env } : process.env
    })
}

function readStamp() {
    try {
        return JSON.parse(readFileSync(stampPath, 'utf8'))
    } catch {
        return null
    }
}

function hasArtifact() {
    return existsSync(join(config.publicDir, 'index.html'))
}

// 构建失败时列出可用标签
function listRefs() {
    try {
        return git(['tag', '--list'], config.frontendDir).split('\n').filter(Boolean).slice(-8).join(', ')
    } catch {
        return ''
    }
}

// 远端 tag 列表
function remoteTags() {
    try {
        return git(['ls-remote', '--tags', '--refs', config.frontendRepo], process.cwd())
            .split('\n')
            .map((line) => line.split('refs/tags/')[1])
            .filter(Boolean)
    } catch {
        return []
    }
}

function fetchAndCheckout() {
    const dir = config.frontendDir

    if (existsSync(join(dir, '.git'))) {
        log(`[WARN] 更换到 ${config.frontendRef}`)
        git(['fetch', '--depth', '1', '--tags', 'origin', config.frontendRef], dir)
        git(['checkout', '--force', 'FETCH_HEAD'], dir)
        return
    }

    log(`[WARN] 没有发现源码，首次拉取： ${config.frontendRepo} @ ${config.frontendRef}`)
    mkdirSync(config.frontendDir, { recursive: true })
    git(['clone', '--depth', '1', '--branch', config.frontendRef, config.frontendRepo, dir])
}

function build() {
    const dir = config.frontendDir
    log(`[INFO] 安装依赖并构建`)

    // 有 lockfile 时先用 ci
    try {
        run(NPM, ['ci', '--no-audit', '--no-fund'], dir)
    } catch {
        log('[WARN] npm ci 失败，回退到 npm install')
        run(NPM, ['install', '--no-audit', '--no-fund'], dir)
    }

    // 数据存储
    log(`[INFO] ONLY_SERVER=${config.onlyServer} SERVER_URL=${config.serverUrl || '使用同源 /api'}`)
    run(NPM, ['run', 'build'], dir, {
        ONLY_SERVER: config.onlyServer ? 'true' : 'false',
        SERVER_URL: config.serverUrl
    })
}

// 构建参数改变后重建
function buildKey() {
    return `${config.onlyServer ? 'server' : 'local'}|${config.serverUrl}`
}

// 注入提交号
function injectVersion(sha) {
    const target = join(config.publicDir, 'version.js')
    writeFileSync(target, `window.__NITAI_PAGE_COMMIT__ = ${JSON.stringify(sha)}\n`, 'utf8')
    log(`[INFO] 提交号已注入 ${target}`)
}

function main() {
    if (!config.prepareFrontend) {
        log('[WARN] 检测到 PREPARE_FRONTEND=false，将跳过构建，直接用现有产物')
        return
    }

    if (!config.frontendRepo || !config.frontendRef) {
        throw new Error('[WARN] 未指定前端来源：请设置 FRONTEND_REPO 与 FRONTEND_REF')
    }

    const stamp = readStamp()
    if (stamp && stamp.ref === config.frontendRef && stamp.buildKey === buildKey() && hasArtifact()) {
        log(`[INFO] 已是 ${stamp.ref} @ ${stamp.sha}，跳过构建`)
        return
    }

    if (stamp && !hasArtifact()) {
        log('[WARN] 有构建记录但产物缺失，重新构建')
    }

    const tags = remoteTags()
    if (tags.length && !tags.includes(config.frontendRef)) {
        throw new Error(
            `[ERROR] 未找到 ${config.frontendRef}，请在 FRONTEND_REF 中填写正确的 tag\n` +
            `[INFO] 目前找到的可用 tag：${tags.slice(-8).join(', ')}`
        )
    }

    try {
        fetchAndCheckout()
    } catch (error) {
        const refs = existsSync(join(config.frontendDir, '.git')) ? listRefs() : ''
        throw new Error(
            `[ERROR] 拉取 ${config.frontendRef} 失败：${error.message}` +
            (refs ? `\n[INFO] 目前找到的可用 tag：${refs}` : '')
        )
    }

    build()

    if (!hasArtifact()) {
        throw new Error(`[ERROR] 构建完成但未找到 ${join(config.publicDir, 'index.html')}，请确认该 ref 的构建输出目录`)
    }

    const sha = git(['rev-parse', '--short=7', 'HEAD'], config.frontendDir)
    const fullSha = git(['rev-parse', 'HEAD'], config.frontendDir)

    injectVersion(sha)

    writeFileSync(stampPath, JSON.stringify({
        ref: config.frontendRef,
        sha,
        fullSha,
        buildKey: buildKey(),
        onlyServer: config.onlyServer,
        serverUrl: config.serverUrl,
        builtAt: new Date().toISOString()
    }, null, 2), 'utf8')

    log(`完成：${config.frontendRef} @ ${sha}`)
}

try {
    main()
} catch (error) {
    log(`[ERROR] 失败：${error.message}`)
    process.exit(1)
}
