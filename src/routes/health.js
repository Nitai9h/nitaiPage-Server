import { config } from '../config.js'

// 前端每 5s 检查一次状态
export default async function healthRoutes(app) {
    app.get('/api/health', async () => ({
        ok: true,
        version: config.version,
        time: Date.now()
    }))
}
