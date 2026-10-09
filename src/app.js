import { mkdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { config } from './config.js'
import {
    DEVICE_COOKIE,
    SESSION_COOKIE,
    clearLoginFailures,
    deviceCookieOptions,
    issueSession,
    loginBlocked,
    noteLoginFailure,
    sessionCookieOptions,
    verifyPassword,
    verifyRequest,
    verifySession
} from './auth.js'
import { backupPage, loginPage, pairPage, missingFrontendPage } from './pages.js'
import healthRoutes from './routes/health.js'
import dbRoutes from './routes/db.js'
import fileRoutes from './routes/files.js'
import backupRoutes from './routes/backup.js'

// 免鉴权
const PUBLIC_PATHS = new Set([
    '/login',
    '/api/login',
    '/pair',
    '/api/pair/request',
    '/api/pair/claim',
    '/api/health',
    '/api/version',
    '/favicon.ico'
])

// 同源判断
function isSameOriginRequest(request) {
    const site = request.headers['sec-fetch-site']
    if (typeof site === 'string') return site === 'same-origin' || site === 'none'

    const expected = `${request.protocol}://${request.headers.host}`
    const origin = request.headers.origin
    if (origin) return origin === expected

    const referer = String(request.headers.referer || '')
    if (referer) {
        try {
            return new URL(referer).origin === expected
        } catch {
            return false
        }
    }
    return false
}

function pathOf(request) {
    return request.url.split('?')[0]
}

// 校验跳转地址是否安全
// 只允许跳转到站内路径，避免开放重定向攻击
// 同时排除一些特殊路径，避免用户登录后打开登录页或者接口
function safeTarget(value) {
    const target = String(value || '')
    if (!target.startsWith('/') || target.startsWith('//')) return ''

    const path = target.split('?')[0]
    if (path === '/' || path === '/login' || path === '/pair' || path === '/backup/download') return ''
    if (path.startsWith('/api/') || path.startsWith('/files/')) return ''
    return target
}

// 跳转 (?next=)
function nextOf(url) {
    try {
        return safeTarget(new URL(url, 'http://local').searchParams.get('next') || '')
    } catch (error) {
        return ''
    }
}

// 比较两个字符串是否相等
// 即使字符串长度不同也会比较完整内容，防止计时攻击
function safeEqual(a, b) {
    const left = Buffer.from(String(a ?? ''))
    const right = Buffer.from(String(b ?? ''))
    if (!left.length || left.length !== right.length) return false
    return timingSafeEqual(left, right)
}

function bearerOf(request) {
    const header = String(request.headers.authorization || '')
    return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

// 解析前端构建版本
function readFrontendStamp() {
    try {
        return JSON.parse(readFileSync(join(config.frontendDir, '.frontend.json'), 'utf8'))
    } catch {
        return null
    }
}

/**
 * Fastify 实例
 * @param {object} store 存储后端
 * @param {object} pairing 设备配对
 * @param {'web'|'api'} mode
 *   web 前端鉴权走 cookie
 *   api 鉴权走 Bearer
 */
export async function buildApp({ store, pairing, mode = 'web' }) {
    const isApiMode = mode === 'api'
    const isPasswordMode = config.authMode === 'password'

    // web 只需 cookie 有效即可
    // api 需 Bearer
    const authorized = (request) => {
        if (isPasswordMode) {
            if (isApiMode) return !!config.apiToken && safeEqual(bearerOf(request), config.apiToken)
            return verifySession(request.cookies[SESSION_COOKIE])
        }
        return Boolean(verifyRequest(request, pairing, { cookie: !isApiMode }))
    }

    const app = Fastify({
        logger: { level: config.logLevel },
        bodyLimit: config.maxBodyBytes,
        // 用于在部署反代后判断协议与客户端 IP
        trustProxy: true
    })

    // 上传原始二进制 body
    app.addContentTypeParser('application/octet-stream', (request, payload, done) => {
        done(null, payload)
    })

    await app.register(cookie)

    app.addHook('onRequest', async (request, reply) => {
        if (isApiMode) {
            reply.header('Access-Control-Allow-Origin', '*')
            reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            if (request.method === 'OPTIONS') return reply.code(204).send()
            // API 端口 只响应 /api 开头的路径
            if (!pathOf(request).startsWith('/api/')) return
        } else if (pathOf(request).startsWith('/api/') && !isSameOriginRequest(request)) {
            return reply.code(403).send({
                ok: false,
                error: 'use_api_port',
                hint: '客户端请使用 API 端口'
            })
        }

        if (PUBLIC_PATHS.has(pathOf(request))) return
        if (authorized(request)) return

        if (pathOf(request).startsWith('/api/')) {
            return reply.code(401).send({ ok: false, error: 'unauthorized' })
        }

        // 校验完跳转回原页面
        const entry = isPasswordMode ? '/login' : '/pair'
        const next = safeTarget(request.url)
        return reply.redirect(next ? `${entry}?next=${encodeURIComponent(next)}` : entry)
    })

    /* 入口页，页面由 web 负责*/

    if (!isApiMode && isPasswordMode) {
        app.get('/login', async (request, reply) => {
            if (verifySession(request.cookies[SESSION_COOKIE])) return reply.redirect(nextOf(request.url) || '/')
            return reply.type('text/html; charset=utf-8').send(loginPage({ version: config.version }))
        })

        app.post('/api/login', async (request, reply) => {
            const ip = request.ip
            if (loginBlocked(ip)) {
                return reply.code(429).send({ ok: false, error: 'too-many-attempts' })
            }

            if (!await verifyPassword(request.body?.password)) {
                noteLoginFailure(ip)
                return reply.code(401).send({ ok: false, error: 'invalid-password' })
            }

            clearLoginFailures(ip)
            reply.setCookie(SESSION_COOKIE, issueSession(), sessionCookieOptions(request))
            return { ok: true }
        })

        app.post('/api/logout', async (request, reply) => {
            reply.clearCookie(SESSION_COOKIE, { path: '/' })
            return { ok: true }
        })
    }

    if (!isApiMode && !isPasswordMode) {
        app.get('/pair', async (request, reply) => {
            if (authorized(request)) return reply.redirect(nextOf(request.url) || '/')
            return reply.type('text/html; charset=utf-8').send(pairPage({
                version: config.version,
                ttlMinutes: Math.round(config.pairingTtlMs / 60000)
            }))
        })
    }

    // 导出备份页
    if (!isApiMode) {
        app.get('/backup', async (request, reply) => {
            return reply.type('text/html; charset=utf-8').send(backupPage({
                version: config.version,
                authMode: config.authMode
            }))
        })
    }

    /* 配对接口（仅 pair 开启才能用） */

    if (!isPasswordMode) {
        // 设备申请配对，返回配对码和设备凭证
        app.post('/api/pair/request', async (request) => {
            const result = pairing.request({
                name: request.body?.name,
                platform: request.body?.platform,
                ip: request.ip
            })

            if (!result.ok) return { ok: false, error: result.error }
            return {
                ok: true,
                deviceId: result.deviceId,
                secret: result.secret,
                code: result.code,
                expiresAt: result.expiresAt
            }
        })

        // 用于设备获取凭证
        app.post('/api/pair/claim', async (request, reply) => {
            const result = pairing.claim({
                deviceId: request.body?.deviceId,
                secret: request.body?.secret
            })

            if (!result.ok) return { ok: false, status: result.status }
            if (result.status !== 'claimed') return { ok: true, status: result.status }

            // 只有签发新凭证时才写 cookie，防止覆盖已有的凭证
            if (result.token && !isApiMode) {
                reply.setCookie(DEVICE_COOKIE, result.token, deviceCookieOptions(request))
            }
            return { ok: true, status: 'claimed', deviceId: result.deviceId, token: result.token }
        })

        // 设备主动撤销凭证
        app.post('/api/pair/revoke-self', async (request, reply) => {
            const device = verifyRequest(request, pairing, { cookie: !isApiMode })
            if (!device) return reply.code(401).send({ ok: false, error: 'unauthorized' })

            pairing.revoke(device.deviceId)
            if (!isApiMode) reply.clearCookie(DEVICE_COOKIE, { path: '/' })
            return { ok: true }
        })
    }

    // 用于查询服务端版本信息，供客户端做版本校验
    app.get('/api/version', async () => {
        const frontend = readFrontendStamp()
        return {
            ok: true,
            server: config.version,
            authMode: config.authMode,
            frontend: frontend
                ? { ref: frontend.ref, commit: frontend.sha, builtAt: frontend.builtAt }
                : null
        }
    })

    await app.register(healthRoutes)
    await app.register(dbRoutes, { store })
    await app.register(fileRoutes)
    // 备份下载只由 web 提供
    if (!isApiMode) await app.register(backupRoutes, { store })

    app.setErrorHandler((error, request, reply) => {
        request.log.error(error)
        const status = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500

        if (pathOf(request).startsWith('/api/')) {
            return reply.code(status).send({ ok: false, error: error.code || 'internal-error' })
        }
        return reply.code(status).type('text/plain; charset=utf-8').send(String(status))
    })

    if (isApiMode) {
        app.setNotFoundHandler((request, reply) => reply.code(404).send({ ok: false, error: 'not-found' }))
        return app
    }

    // 前端产物目录不存在时先创建目录，防止插件注册失败
    mkdirSync(config.publicDir, { recursive: true })
    await app.register(fastifyStatic, {
        root: config.publicDir,
        index: ['index.html']
    })

    // 未命中的 GET 请求返回 index.html
    // /api 和其他方法保持 404
    app.setNotFoundHandler(async (request, reply) => {
        if (request.method !== 'GET' || pathOf(request).startsWith('/api/')) {
            return reply.code(404).send({ ok: false, error: 'not-found' })
        }

        try {
            const html = await readFile(join(config.publicDir, 'index.html'), 'utf8')
            return reply.type('text/html; charset=utf-8').send(html)
        } catch {
            return reply
                .code(503)
                .type('text/html; charset=utf-8')
                .send(missingFrontendPage({ publicDir: config.publicDir }))
        }
    })

    return app
}
