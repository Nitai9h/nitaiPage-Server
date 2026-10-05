import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

/*
 * 数据存在 system 下，不占用 db/store：
 *   pairing  key=deviceId 待批准设备列表【配对码、凭证摘要、状态】
 *   tokens   key=token 摘要 凭证 → deviceId，用于请求的校验
 *   devices  key=deviceId 已授权设备列表
 */

const AUTH_DB = 'system'
const PAIRING_STORE = 'pairing'
const DEVICE_STORE = 'devices'
const TOKEN_STORE = 'tokens'

// 去掉 I、O、0、1
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const DEVICE_COOKIE = 'nps_device'

function hashToken(token) {
    return createHash('sha256').update(String(token)).digest('hex')
}

function sameHash(a, b) {
    const left = Buffer.from(String(a ?? ''))
    const right = Buffer.from(String(b ?? ''))
    if (!left.length || left.length !== right.length) return false
    return timingSafeEqual(left, right)
}

function makeCode() {
    const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    const group = () => Array.from({ length: 4 }, pick).join('')
    return `${group()}-${group()}`
}

const makeId = () => randomBytes(9).toString('base64url')
const makeToken = () => randomBytes(32).toString('base64url')

function cleanText(value, fallback, max = 40) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
    return text || fallback
}

// 忽略配对码的大小写与分隔符
export function normalizeCode(value) {
    return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * @param {object} store 存储后端
 */
export function createPairing(store) {
    const readPairing = (deviceId) => store.get(AUTH_DB, PAIRING_STORE, deviceId)

    // 清理过期的申请
    function sweep() {
        const now = Date.now()
        let removed = 0
        for (const record of store.getAll(AUTH_DB, PAIRING_STORE)) {
            if (record.expiresAt && record.expiresAt < now) {
                store.remove(AUTH_DB, PAIRING_STORE, record.deviceId)
                removed += 1
            }
        }
        return removed
    }

    function pending() {
        sweep()
        return store.getAll(AUTH_DB, PAIRING_STORE)
            .filter((record) => record.status === 'pending')
            .sort((a, b) => b.createdAt - a.createdAt)
    }

    function findByCode(code) {
        const wanted = normalizeCode(code)
        if (!wanted) return null
        sweep()
        return store.getAll(AUTH_DB, PAIRING_STORE)
            .find((record) => normalizeCode(record.code) === wanted) || null
    }

    const listDevices = () => store.getAll(AUTH_DB, DEVICE_STORE).sort((a, b) => b.createdAt - a.createdAt)

    // 给客户都调用
    function request({ name, platform, ip } = {}) {
        sweep()

        if (pending().length >= config.maxPendingPairings) {
            return { ok: false, error: 'too-many-pending' }
        }

        const deviceId = makeId()
        const secret = makeToken()
        const now = Date.now()

        store.put(AUTH_DB, PAIRING_STORE, deviceId, {
            deviceId,
            // code 与 secret 都只存摘要
            code: makeCode(),
            secretHash: hashToken(secret),
            name: cleanText(name, '未命名设备'),
            platform: cleanText(platform, '未知平台', 60),
            ip: cleanText(ip, '', 60),
            status: 'pending',
            createdAt: now,
            expiresAt: now + config.pairingTtlMs
        })

        const record = readPairing(deviceId)
        return { ok: true, deviceId, secret, code: record.code, expiresAt: record.expiresAt }
    }

    // 设备轮询，批准之后只给一次凭证
    function claim({ deviceId, secret } = {}) {
        const record = readPairing(deviceId)
        if (!record) return { ok: false, status: 'unknown' }

        if (record.expiresAt && record.expiresAt < Date.now()) {
            store.remove(AUTH_DB, PAIRING_STORE, deviceId)
            return { ok: false, status: 'expired' }
        }

        // 状态需要 secret 校验
        if (!sameHash(record.secretHash, hashToken(secret))) {
            return { ok: false, status: 'unknown' }
        }

        // 凭证只给一次
        if (record.status === 'claimed') {
            return { ok: true, status: 'claimed' }
        }
        if (record.status !== 'approved') {
            return { ok: true, status: record.status }
        }

        const token = makeToken()
        const tokenHash = hashToken(token)
        const now = Date.now()

        store.put(AUTH_DB, TOKEN_STORE, tokenHash, { deviceId, createdAt: now })
        store.put(AUTH_DB, DEVICE_STORE, deviceId, {
            deviceId,
            name: record.name,
            platform: record.platform,
            createdAt: now,
            lastSeenAt: now,
            tokens: [tokenHash]
        })

        record.status = 'claimed'
        record.claimedAt = now
        store.put(AUTH_DB, PAIRING_STORE, deviceId, record)

        return { ok: true, status: 'claimed', token, deviceId }
    }

    function approve(code) {
        const record = findByCode(code)
        if (!record) return { ok: false, error: 'not-found' }
        if (record.status !== 'pending') return { ok: false, error: 'already-decided', record }

        record.status = 'approved'
        record.approvedAt = Date.now()
        // 批准后的超时时间
        record.expiresAt = Date.now() + 86400000
        store.put(AUTH_DB, PAIRING_STORE, record.deviceId, record)
        return { ok: true, record }
    }

    function deny(code) {
        const record = findByCode(code)
        if (!record) return { ok: false, error: 'not-found' }
        if (record.status !== 'pending') return { ok: false, error: 'already-decided', record }

        record.status = 'denied'
        record.deniedAt = Date.now()
        store.put(AUTH_DB, PAIRING_STORE, record.deviceId, record)
        return { ok: true, record }
    }

    // 校验凭证，返回设备记录
    function verify(token) {
        const raw = String(token ?? '')
        if (!raw) return null

        const entry = store.get(AUTH_DB, TOKEN_STORE, hashToken(raw))
        if (!entry) return null

        const device = store.get(AUTH_DB, DEVICE_STORE, entry.deviceId)
        if (!device) {
            store.remove(AUTH_DB, TOKEN_STORE, hashToken(raw))
            return null
        }

        const now = Date.now()
        // 刷新 lastSeenAt（每小时刷新一次）
        if (!device.lastSeenAt || now - device.lastSeenAt > 3600000) {
            device.lastSeenAt = now
            store.put(AUTH_DB, DEVICE_STORE, device.deviceId, device)
        }
        return device
    }

    // 撤销设备，删除凭证摘要
    function revoke(deviceId) {
        const target = String(deviceId ?? '').trim()
        if (!target) return { ok: false, error: 'not-found' }

        const device = store.get(AUTH_DB, DEVICE_STORE, target)
        if (!device) return { ok: false, error: 'not-found' }

        for (const tokenHash of device.tokens || []) {
            store.remove(AUTH_DB, TOKEN_STORE, tokenHash)
        }
        store.remove(AUTH_DB, DEVICE_STORE, target)
        store.remove(AUTH_DB, PAIRING_STORE, target)
        return { ok: true, device }
    }

    /* 过期清理 */
    // 清理过期的申请 (定时器)
    function sweepTokens() {
        const now = Date.now()
        const ttl = config.deviceTokenMaxAge * 1000
        const devices = new Map(store.getAll(AUTH_DB, DEVICE_STORE).map((device) => [device.deviceId, device]))
        const removed = { tokens: 0, devices: 0 }

        for (const entry of store.getAllEntries(AUTH_DB, TOKEN_STORE)) {
            const device = devices.get(entry.value?.deviceId)
            // 清理 撤销中途失败、数据库内记录数据不对、凭证到期 的设备
            const expired = !device || !entry.value?.createdAt || now - entry.value.createdAt > ttl

            if (!expired) continue

            store.remove(AUTH_DB, TOKEN_STORE, entry.key)
            removed.tokens += 1

            if (device) device.tokens = (device.tokens || []).filter((tokenHash) => tokenHash !== entry.key)
        }

        for (const device of devices.values()) {
            // 清理没有凭证的设备
            if ((device.tokens || []).length === 0) {
                store.remove(AUTH_DB, DEVICE_STORE, device.deviceId)
                store.remove(AUTH_DB, PAIRING_STORE, device.deviceId)
                removed.devices += 1
                continue
            }
            store.put(AUTH_DB, DEVICE_STORE, device.deviceId, device)
        }

        return removed
    }

    return { request, claim, approve, deny, verify, revoke, pending, listDevices, sweep, sweepTokens, findByCode }
}
