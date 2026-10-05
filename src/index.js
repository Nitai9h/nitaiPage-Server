import { config } from './config.js'
import { buildApp } from './app.js'
import { createStore } from './store/index.js'
import { createPairing } from './pairing.js'
import { sweepLoginFailures } from './auth.js'

const store = createStore()
const pairing = createPairing(store)
const started = []
const isPasswordMode = config.authMode === 'password'

// 定期清理过期的配对申请
const sweepTimer = setInterval(() => {
    if (!isPasswordMode) {
        pairing.sweep()
        pairing.sweepTokens()
    }
    sweepLoginFailures()
}, 60000)
sweepTimer.unref()

let closing = false

async function shutdown() {
    if (closing) return
    closing = true

    clearInterval(sweepTimer)
    try {
        await Promise.all(started.map(({ app }) => app.close()))
        store.closeStore()
    } finally {
        process.exit(0)
    }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        shutdown()
    })
}

// 前端
const web = await buildApp({ store, pairing, mode: 'web' })
started.push({ app: web, name: 'web' })
await web.listen({ port: config.webPort, host: config.host })
web.log.info(`[INFO] NitaiPage 已启动： http://localhost:${config.webPort}/`)

if (isPasswordMode) {
    web.log.warn('[WARN] 当前鉴权模式：password')
    web.log.warn('[WARN] 此鉴权方式安全等级较低，若暴露在公网，建议修改此鉴权方式')
} else {
    web.log.info('[INFO] 当前鉴权模式：pairing')
    web.log.info('[INFO] 配对请使用 `npm run pair -- <配对码>`')
}

if (config.apiPort !== config.webPort) {
    const api = await buildApp({ store, pairing, mode: 'api' })
    started.push({ app: api, name: 'api' })
    await api.listen({ port: config.apiPort, host: config.host })
    api.log.info(`[INFO] 数据服务已启动： http://localhost:${config.apiPort}/api`)

    if (isPasswordMode && !config.apiToken) {
        api.log.warn('[WARN] 未配置 API_TOKEN，后端服务将禁止通行')
    }
}
