import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64
const SCHEME = 'scrypt'

export async function hashPassword(password) {
    const salt = randomBytes(16)
    const derived = await scrypt(password, salt, KEY_LENGTH)
    // 存成 scrypt$<salt>$<hash>
    return `${SCHEME}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password, stored) {
    const [scheme, saltHex, hashHex] = String(stored || '').split('$')
    if (scheme !== SCHEME || !saltHex || !hashHex) return false

    const expected = Buffer.from(hashHex, 'hex')
    if (expected.length === 0) return false

    // 定长时间校验，按存下来的哈希长度重新生成
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
    return timingSafeEqual(expected, derived)
}
