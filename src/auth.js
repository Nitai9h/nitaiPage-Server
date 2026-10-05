import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'
import { verifyPassword as verifyPasswordHash } from './password.js'
import { DEVICE_COOKIE } from './pairing.js'

export { DEVICE_COOKIE }

/* pair 模式 */

export function readToken(request, { cookie = true } = {}) {
    const header = String(request.headers.authorization || '')
    if (header.startsWith('Bearer ')) return header.slice(7).trim()
    if (!cookie) return ''
    return request.cookies?.[DEVICE_COOKIE] || ''
}

// 校验设备凭证，通过则返回设备记录
export function verifyRequest(request, pairing, options) {
    return pairing.verify(readToken(request, options))
}

// 反代转 https 时自动加固
// http 不加 Secure，防止本地起服务拿不到 cookie
export function deviceCookieOptions(request) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: config.deviceTokenMaxAge,
        secure: request.protocol === 'https'
    }
}

/* token 模式 */

export const SESSION_COOKIE = 'nps_session'

function safeEqual(a, b) {
    const left = Buffer.from(String(a ?? ''))
    const right = Buffer.from(String(b ?? ''))
    if (!left.length || left.length !== right.length) return false
    return timingSafeEqual(left, right)
}

// 先 APP_PASSWORD_HASH，再 APP_PASSWORD
export async function verifyPassword(password) {
    const input = String(password ?? '')
    if (!input) return false

    if (config.passwordPlain) return safeEqual(input, config.passwordPlain)
    return verifyPasswordHash(input, config.passwordHash)
}

// 由 password 生成密钥
function secret() {
    const material = config.passwordPlain || config.passwordHash
    return createHash('sha256').update(String(material)).digest('hex')
}

function sign(issuedAt) {
    return createHmac('sha256', secret()).update(String(issuedAt)).digest('hex')
}

// cookie 为 时间 + HMAC
export function issueSession() {
    const issuedAt = Date.now()
    return `${issuedAt}.${sign(issuedAt)}`
}

export function verifySession(token) {
    if (typeof token !== 'string') return false

    const [issuedAtText, mac] = token.split('.')
    const issuedAt = Number(issuedAtText)
    if (!issuedAtText || !mac || !Number.isFinite(issuedAt)) return false
    if (Date.now() - issuedAt > config.sessionMaxAge * 1000) return false

    return safeEqual(mac, sign(issuedAt))
}

export function sessionCookieOptions(request) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionMaxAge,
        secure: request.protocol === 'https'
    }
}

/* 登录失败限流 */

const failures = new Map()

export function loginBlocked(ip) {
    const entry = failures.get(ip)
    if (!entry) return false
    if (Date.now() > entry.resetAt) {
        failures.delete(ip)
        return false
    }
    return entry.count >= config.loginMaxFailures
}

export function noteLoginFailure(ip) {
    const now = Date.now()
    const entry = failures.get(ip)

    if (!entry || now > entry.resetAt) {
        failures.set(ip, { count: 1, resetAt: now + config.loginWindowMs })
        return
    }
    entry.count += 1
}

export function clearLoginFailures(ip) {
    failures.delete(ip)
}

// 定期清理过期请求
export function sweepLoginFailures() {
    const now = Date.now()
    for (const [ip, entry] of failures) {
        if (now > entry.resetAt) failures.delete(ip)
    }
}
