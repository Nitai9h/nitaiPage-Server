// 清理无引用文件
// npm run gc 执行清理（默认只清理超过一小时的文件）
// npm run gc -- --dry-run 只列出，不删除
// npm run gc -- --grace=30 宽限期改为 30 分钟

import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config.js'
import { createStore } from '../store/index.js'
import { REF_PATTERN } from '../routes/files.js'

const args = process.argv.slice(2)
const flags = args.filter((arg) => arg.startsWith('--'))
const dryRun = flags.includes('--dry-run')

const graceArg = flags.find((arg) => arg.startsWith('--grace='))
const graceMinutes = graceArg ? Number(graceArg.slice('--grace='.length)) : 60
if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    console.error('[ERROR] --grace 需要是 ≥ 0 的分钟数，例如 --grace=30')
    process.exit(1)
}

// 收集所有 ref
function collectRefs(value, out) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
        for (const item of value) collectRefs(item, out)
        return
    }
    for (const [key, item] of Object.entries(value)) {
        if (key === 'ref' && typeof item === 'string') out.add(item)
        else collectRefs(item, out)
    }
}

const store = createStore()

try {
    const referenced = new Set()
    for (const row of store.exportAll()) collectRefs(row.value, referenced)

    let entries = []
    try {
        entries = await readdir(config.filesDir, { withFileTypes: true })
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }

    // 文件名必须与上传时一致
    const files = entries.filter((entry) => entry.isFile() && REF_PATTERN.test(entry.name))

    const graceMs = graceMinutes * 60 * 1000
    const now = Date.now()
    const removed = []
    let kept = 0
    let skippedYoung = 0

    for (const entry of files) {
        if (referenced.has(entry.name)) {
            kept += 1
            continue
        }

        const target = join(config.filesDir, entry.name)
        const info = await stat(target)
        if (now - info.mtimeMs < graceMs) {
            skippedYoung += 1
            continue
        }

        if (!dryRun) {
            try {
                await unlink(target)
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.warn(`[WARN] 删除失败：${entry.name}（${error.message}）`)
                }
            }
        }
        removed.push({ name: entry.name, size: info.size })
    }

    const bytes = removed.reduce((sum, item) => sum + item.size, 0)

    console.log(`[INFO] 共 ${files.length} 个文件，可清理 ${removed.length} 个${dryRun ? '（未删除，待清理）' : ''}`)
    if (skippedYoung > 0) {
        console.log(`[INFO] 还有 ${skippedYoung} 个文件可清理，但仍处于 ${graceMinutes} 分钟 限期内，本次跳过清理`)
    }
    if (removed.length > 0) {
        for (const item of removed.slice(0, 20)) {
            console.log(`  ${dryRun ? '·' : '-'} ${item.name}  ${Math.max(1, Math.round(item.size / 1024))} KB`)
        }
        if (removed.length > 20) console.log(`  …… 还有 ${removed.length - 20} 个`)
        console.log(`[INFO] ${dryRun ? '可回收' : '已回收'} ${(bytes / 1024 / 1024).toFixed(2)} MB`)
    } else {
        console.log('[INFO] 没有需要清理的文件')
    }
} catch (error) {
    console.error(`[ERROR] 失败：${error.message}`)
    console.error(`[ERROR] 数据库：${config.dbPath}`)
    console.error(`[ERROR] 文件目录：${config.filesDir}`)
    process.exitCode = 1
} finally {
    store.closeStore()
}
