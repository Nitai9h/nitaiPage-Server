import { PassThrough } from 'node:stream'
import { streamBackupArchive } from '../backup.js'

export default async function backupRoutes(app, { store }) {
    // 触发立刻下载
    app.get('/backup/download', async (request, reply) => {
        const stream = new PassThrough()

        reply
            .header('Content-Type', 'application/zip')
            .header('Content-Disposition', `attachment; filename="nitaiPage-backup-${Date.now()}.zip"`)
            .header('Cache-Control', 'no-store')
            .header('X-Content-Type-Options', 'nosniff')

        reply.send(stream)

        try {
            const files = await streamBackupArchive(store, (chunk) => stream.write(Buffer.from(chunk)))
            request.log.info({ files }, '备份已导出')
            stream.end()
        } catch (error) {
            request.log.error(error, '生成备份失败')
            stream.destroy(error)
        }
    })
}
