const NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/

function invalid(...names) {
    return names.some((name) => !NAME_PATTERN.test(String(name ?? '')))
}

export default async function dbRoutes(app, { store }) {
    app.get('/api/db/:db/:store/:key', async (request, reply) => {
        const { db, store: table, key } = request.params
        if (invalid(db, table, key)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        const value = store.get(db, table, key)
        if (value === undefined) {
            return reply.code(404).send({ ok: false, error: 'not-found' })
        }

        return { ok: true, value }
    })

    app.put('/api/db/:db/:store/:key', async (request, reply) => {
        const { db, store: table, key } = request.params
        if (invalid(db, table, key)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        store.put(db, table, key, request.body)
        return { ok: true }
    })

    app.delete('/api/db/:db/:store/:key', async (request, reply) => {
        const { db, store: table, key } = request.params
        if (invalid(db, table, key)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        return { ok: true, removed: store.remove(db, table, key) }
    })

    app.get('/api/db/:db/:store', async (request, reply) => {
        const { db, store: table } = request.params
        if (invalid(db, table)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        return { ok: true, values: store.getAll(db, table) }
    })

    // 自增 store 的新 key 由服务端生成
    app.post('/api/db/:db/:store', async (request, reply) => {
        const { db, store: table } = request.params
        if (invalid(db, table)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        const key = store.nextKey(db, table)
        store.put(db, table, key, request.body)
        return { ok: true, key }
    })

    // 整表替换（对应 dbReplaceAll）
    app.put('/api/db/:db/:store/_all', async (request, reply) => {
        const { db, store: table } = request.params
        if (invalid(db, table)) {
            return reply.code(400).send({ ok: false, error: 'invalid-name' })
        }

        const entries = request.body?.entries
        if (!Array.isArray(entries)) {
            return reply.code(400).send({ ok: false, error: 'invalid-body' })
        }
        if (entries.some((item) => !item || invalid(item.key))) {
            return reply.code(400).send({ ok: false, error: 'invalid-key' })
        }

        return { ok: true, count: store.replaceAll(db, table, entries) }
    })

    // 诊断 kv 中是否存在大文件
    app.get('/api/stats', async () => ({ ok: true, ...store.stats() }))
}
