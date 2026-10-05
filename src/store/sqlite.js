import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'

// 库名 / store / key
const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
    db         TEXT    NOT NULL,
    store      TEXT    NOT NULL,
    k          TEXT    NOT NULL,
    v          TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (db, store, k)
);
CREATE INDEX IF NOT EXISTS kv_store_idx ON kv (db, store);
`

let connection = null

function handle() {
    if (!connection) throw new Error('[ERROR] 存储后端尚未初始化')
    return connection
}

export function initStore() {
    mkdirSync(dirname(config.dbPath), { recursive: true })

    connection = new Database(config.dbPath)
    connection.pragma('journal_mode = WAL')
    connection.pragma('synchronous = NORMAL')
    connection.exec(SCHEMA)
}

export function get(db, store, key) {
    const row = handle()
        .prepare('SELECT v FROM kv WHERE db = ? AND store = ? AND k = ?')
        .get(db, store, key)

    return row ? JSON.parse(row.v) : undefined
}

export function put(db, store, key, value) {
    const serialized = JSON.stringify(value ?? null)
    const bytes = Buffer.byteLength(serialized)

    // 大文件判断
    if (bytes > config.maxValueWarnBytes) {
        console.warn(`[WARN] kv 过大：${db}.${store}/${key} （${bytes} Byte），大文件请走 /api/files`)
    }

    handle()
        .prepare(`
            INSERT INTO kv (db, store, k, v, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (db, store, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at
        `)
        .run(db, store, key, serialized, Date.now())

    return true
}

export function remove(db, store, key) {
    return handle()
        .prepare('DELETE FROM kv WHERE db = ? AND store = ? AND k = ?')
        .run(db, store, key)
        .changes > 0
}

export function getAll(db, store) {
    return handle()
        .prepare('SELECT v FROM kv WHERE db = ? AND store = ? ORDER BY k')
        .all(db, store)
        .map((row) => JSON.parse(row.v))
}

// 整表替换，用新数据完全替换旧数据
export function replaceAll(db, store, entries) {
    const run = handle().transaction((list) => {
        const now = Date.now()
        handle().prepare('DELETE FROM kv WHERE db = ? AND store = ?').run(db, store)

        const insert = handle().prepare('INSERT INTO kv (db, store, k, v, updated_at) VALUES (?, ?, ?, ?, ?)')
        for (const item of list) {
            insert.run(db, store, String(item.key), JSON.stringify(item.value ?? null), now)
        }
    })

    run(entries)
    return entries.length
}

// 自增 store 的新 key
export function nextKey(db, store) {
    const row = handle()
        .prepare('SELECT MAX(CAST(k AS INTEGER)) AS max FROM kv WHERE db = ? AND store = ?')
        .get(db, store)

    return String((row?.max ?? 0) + 1)
}

// 导出全部行
export function exportAll(skipDbs = []) {
    const rows = handle()
        .prepare('SELECT db, store, k, v FROM kv ORDER BY db, store, k')
        .all()

    return rows
        .filter((row) => !skipDbs.includes(row.db))
        .map((row) => ({ db: row.db, store: row.store, key: row.k, value: JSON.parse(row.v) }))
}

// 读取整表，返回 key → 表
// 返回 [{ key: "xxx", value: {...} }, ...]
export function getAllEntries(db, store) {
    return handle()
        .prepare('SELECT k, v FROM kv WHERE db = ? AND store = ? ORDER BY k')
        .all(db, store)
        .map((row) => ({ key: row.k, value: JSON.parse(row.v) }))
}

// 各库的行数与占用
// LENGTH(v) 要先转 BLOB
export function stats() {
    const byDb = handle()
        .prepare('SELECT db, COUNT(*) AS rows, SUM(LENGTH(CAST(v AS BLOB))) AS bytes FROM kv GROUP BY db ORDER BY rows DESC')
        .all()

    const largest = handle()
        .prepare('SELECT db, store, k, LENGTH(CAST(v AS BLOB)) AS bytes FROM kv ORDER BY bytes DESC LIMIT 5')
        .all()

    return {
        path: config.dbPath,
        rows: byDb.reduce((sum, item) => sum + item.rows, 0),
        bytes: byDb.reduce((sum, item) => sum + (item.bytes || 0), 0),
        databases: byDb.map((item) => ({ db: item.db, rows: item.rows, bytes: item.bytes || 0 })),
        largest: largest.map((item) => ({ db: item.db, store: item.store, key: item.k, bytes: item.bytes })),
        oversized: largest.filter((item) => item.bytes > config.maxValueWarnBytes).length
    }
}

export function closeStore() {
    if (!connection) return
    connection.close()
    connection = null
}
