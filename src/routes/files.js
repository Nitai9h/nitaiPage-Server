import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { extname, join } from 'node:path'
import { config } from '../config.js'

// ref 格式，防止路径穿越
export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}(?:\.[A-Za-z0-9]{1,8})?$/

const MIME_TYPES = {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webm': 'video/webm',
    '.webp': 'image/webp'
}

function extensionOf(name) {
    const ext = extname(String(name || '')).toLowerCase()
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

// 支持边收边写 带 强制上限
// 返回 { size } 或 { oversize: true }
function receive(source, target) {
    return new Promise((resolve, reject) => {
        const output = createWriteStream(target)
        let size = 0
        let oversize = false
        let settled = false

        const settle = (result, error) => {
            if (settled) return
            settled = true
            if (error) reject(error)
            else resolve(result)
        }

        source.on('data', (chunk) => {
            size += chunk.length

            if (size > config.maxUploadBytes) {
                // 超限后读完剩余内容，但不写入
                // 防止客户端收到的是 413 而不是连接中断
                oversize = true
                if (size > config.maxUploadBytes * 4) {
                    source.destroy()
                    output.destroy()
                }
                return
            }

            if (!output.write(chunk)) source.pause()
        })

        output.on('drain', () => source.resume())
        source.on('end', () => {
            if (oversize) output.destroy()
            else output.end()
        })
        source.on('error', (error) => settle(null, error))
        output.on('error', (error) => settle(null, error))
        output.on('close', () => settle(oversize ? { oversize: true } : { size }))
    })
}

export default async function fileRoutes(app) {
    await mkdir(config.filesDir, { recursive: true })

    // 上传文件：POST /api/files?name=wallpaper.jpg
    // body 直接是文件的二进制内容
    app.post('/api/files', async (request, reply) => {
        const declared = Number(request.headers['content-length'] || 0)
        if (declared > config.maxUploadBytes) {
            return reply.code(413).send({ ok: false, error: 'too-large', limit: config.maxUploadBytes })
        }

        const ref = `${randomBytes(16).toString('hex')}${extensionOf(request.query?.name)}`
        const target = join(config.filesDir, ref)

        let result
        try {
            result = await receive(request.body, target)
        } catch (error) {
            await unlink(target).catch(() => { })
            request.log.error(error, '写入上传文件失败')
            return reply.code(500).send({ ok: false, error: 'write-failed' })
        }

        if (result.oversize) {
            await unlink(target).catch(() => { })
            return reply.code(413).send({ ok: false, error: 'too-large', limit: config.maxUploadBytes })
        }

        return { ok: true, ref, size: result.size }
    })

    // 下载文件：GET /files/:ref 或 GET /api/files/:ref
    // 文件名生成后不会改变，所以浏览器 HTTP 长期缓存
    // /files 是给同源页面直接使用，/api/files 给跨源客户端用
    async function sendFile(request, reply) {
        const { ref } = request.params
        if (!REF_PATTERN.test(ref)) {
            return reply.code(400).send({ ok: false, error: 'invalid-ref' })
        }

        const target = join(config.filesDir, ref)

        let info
        try {
            info = await stat(target)
            if (!info.isFile()) throw new Error('not a file')
        } catch {
            return reply.code(404).send({ ok: false, error: 'not-found' })
        }

        return reply
            .type(MIME_TYPES[extname(ref).toLowerCase()] || 'application/octet-stream')
            .header('Content-Length', String(info.size))
            .header('Cache-Control', 'public, max-age=31536000, immutable')
            .send(createReadStream(target))
    }

    app.get('/files/:ref', sendFile)
    app.get('/api/files/:ref', sendFile)

    // 删除文件：DELETE /api/files/:ref
    // 换壁纸、删壁纸时调用，防止出现无用文件
    app.delete('/api/files/:ref', async (request, reply) => {
        const { ref } = request.params
        if (!REF_PATTERN.test(ref)) {
            return reply.code(400).send({ ok: false, error: 'invalid-ref' })
        }

        try {
            await unlink(join(config.filesDir, ref))
        } catch (error) {
            // 未找到文件也算删除成功
            if (error.code !== 'ENOENT') {
                return reply.code(500).send({ ok: false, error: 'delete-failed' })
            }
        }

        return { ok: true, removed: true }
    })
}
