import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'
import { config } from './config.js'
import { REF_PATTERN } from './routes/files.js'

const SKIP_DBS = ['system', 'translate']

const PREFS_DB = 'nitaiPageDB'
const PREFS_STORE = 'prefs'

const ENTRY_NAME = 'backup.json'
const FILES_PREFIX = 'files/'

// 压缩级别
const MEDIA_LEVEL = 0
const JSON_LEVEL = 6

// 版本使用前端版本
function backupVersion() {
    try {
        const stamp = JSON.parse(readFileSync(join(config.frontendDir, '.frontend.json'), 'utf8'))
        const ref = String(stamp?.ref || '').replace(/^v/, '')
        if (/^\d+\.\d+\.\d+/.test(ref)) return ref
    } catch (error) { }
    return config.version
}

function extensionOf(name) {
    const ext = extname(String(name || '')).toLowerCase()
    return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

// 对齐前端
function collect(store) {
    const localStorageData = {}
    const grouped = new Map()
    const refs = []

    for (const row of store.exportAll(SKIP_DBS)) {
        const value = row.value

        if (row.db === PREFS_DB && row.store === PREFS_STORE) {
            if (value && typeof value === 'object' && typeof value.id === 'string') {
                localStorageData[value.id] = String(value.value ?? '')
            }
            continue
        }

        if (!grouped.has(row.db)) grouped.set(row.db, new Map())
        const stores = grouped.get(row.db)
        if (!stores.has(row.store)) stores.set(row.store, [])
        stores.get(row.store).push(value)

        // 带 ref 的行指向 files 目录里的文件
        if (value && typeof value === 'object' && typeof value.ref === 'string' && REF_PATTERN.test(value.ref)) {
            refs.push({ ref: value.ref, value })
        }
    }

    // 先确定包内路径再替换 ref
    const media = refs.map((item, index) => {
        const path = `${FILES_PREFIX}${index}${extensionOf(item.ref)}`
        item.value.zipPath = path
        delete item.value.ref
        return { path, ref: item.ref }
    })

    const databases = []
    for (const [name, stores] of grouped) {
        const data = {}
        for (const [storeName, list] of stores) data[storeName] = list
        databases.push({ name, data })
    }

    return {
        payload: {
            version: backupVersion(),
            backupTime: new Date().toISOString(),
            localStorage: localStorageData,
            cookies: {},
            indexedDB: { databases }
        },
        media
    }
}

/**
 * 支持边生成边递交 zip byte
 * @param {object} store 存储后端
 * @param {(chunk: Uint8Array) => void} write 每段 zip byte
 * @returns {Promise<number>} 打包进去的文件数
 */
export function streamBackupArchive(store, write) {
    const { payload, media } = collect(store)

    return new Promise((resolve, reject) => {
        let failure = null

        const archive = new Zip((error, chunk) => {
            if (error) {
                failure = error
                return
            }
            if (chunk && chunk.length) write(chunk)
        })

        const main = new ZipDeflate(ENTRY_NAME, { level: JSON_LEVEL })
        archive.add(main)
        main.push(strToU8(JSON.stringify(payload)), true)

        // 逐个读、逐个写，读完释放
        const step = async (index) => {
            if (failure) {
                reject(failure)
                return
            }

            if (index >= media.length) {
                archive.end()
                if (failure) reject(failure)
                else resolve(media.length)
                return
            }

            const item = media[index]
            try {
                const bytes = await readFile(join(config.filesDir, item.ref))
                const entry = new ZipPassThrough(item.path)
                archive.add(entry)
                entry.push(new Uint8Array(bytes), true)
            } catch (error) {
                // 跳过不存在的文件
            }

            setImmediate(() => { step(index + 1).catch(reject) })
        }

        step(0).catch(reject)
    })
}
