import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function num(name, fallback) {
    const value = Number(process.env[name])
    return Number.isFinite(value) && value > 0 ? value : fallback
}

// 鉴权方式: pairing（默认，推荐）或 password
const authMode = process.env.AUTH_MODE === 'password' ? 'password' : 'pairing'

const dataDir = resolve(process.env.DATA_DIR || './data')

// 前端产物目录
const frontendDir = resolve(process.env.FRONTEND_DIR || './frontend')

export const config = {
    version: pkg.version,

    webPort: num('WEB_PORT', num('PORT', 11123)),
    apiPort: num('API_PORT', 11125),
    host: process.env.HOST || '0.0.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',

    dataDir,
    dbPath: process.env.DB_PATH ? resolve(process.env.DB_PATH) : resolve(dataDir, 'nitaiPage.sqlite'),
    filesDir: process.env.FILES_DIR ? resolve(process.env.FILES_DIR) : resolve(dataDir, 'files'),

    // 前端源码
    frontendDir,
    publicDir: resolve(process.env.PUBLIC_DIR || resolve(frontendDir, 'dist')),
    frontendRepo: process.env.FRONTEND_REPO || pkg.nitaiPage?.repo || '',
    // 构建的版本
    frontendRef: process.env.FRONTEND_REF || pkg.nitaiPage?.ref || '',
    prepareFrontend: process.env.PREPARE_FRONTEND !== 'false',

    // # true 则锁定数据库存储
    onlyServer: process.env.ONLY_SERVER === 'true',
    // 指定 api 地址，同源不用填
    serverUrl: process.env.SERVER_URL || '',

    // 后端数据库
    storeEngine: process.env.STORE_ENGINE || 'sqlite',

    // 鉴权
    authMode,
    // AUTH_MODE=password 时：
    //    APP_PASSWORD_HASH  使用 `npm run hash-password` 手动生成
    //    APP_PASSWORD 设置密码（修改密码后所有设备都要重新验证）
    passwordPlain: process.env.APP_PASSWORD || '',
    passwordHash: process.env.APP_PASSWORD_HASH || '',
    sessionMaxAge: num('SESSION_MAX_AGE', 2592000),
    loginMaxFailures: num('LOGIN_MAX_FAILURES', 10),
    loginWindowMs: num('LOGIN_WINDOW_MS', 900000),

    apiToken: process.env.API_TOKEN || '',

    // 配对超时
    pairingTtlMs: num('PAIRING_TTL', 600000),
    // 最大未批准配对数
    maxPendingPairings: num('MAX_PENDING_PAIRINGS', 20),
    // 一次授权凭证能使用的时间（秒），默认 180 天
    deviceTokenMaxAge: num('DEVICE_TOKEN_MAX_AGE', 15552000),

    maxBodyBytes: num('MAX_BODY_BYTES', 33554432),
    maxUploadBytes: num('MAX_UPLOAD_BYTES', 209715200),
    // kv 单条值的上限（byte）【超过只警告，大文件应走 /api/files】
    maxValueWarnBytes: num('MAX_VALUE_WARN_BYTES', 262144)
}

// 未配置 token
if (authMode === 'password' && !config.passwordPlain && !process.env.APP_PASSWORD_HASH) {
    console.error('[ERROR] AUTH_MODE=password 时必须填写 APP_PASSWORD_HASH 或 APP_PASSWORD')
    console.error('[INFO] 请使用 npm run hash-password 手动生成 APP_PASSWORD_HASH')
    process.exit(1)
}
