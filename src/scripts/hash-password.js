import { hashPassword } from '../password.js'

function readAll(stream) {
    return new Promise((resolve, reject) => {
        let text = ''
        stream.setEncoding('utf8')
        stream.on('data', (chunk) => {
            text += chunk
        })
        stream.on('end', () => resolve(text))
        stream.on('error', reject)
    })
}

// 输入时不显示字符
function readHidden(prompt) {
    return new Promise((resolve) => {
        const input = process.stdin

        process.stdout.write(prompt)
        input.setRawMode(true)
        input.setEncoding('utf8')
        input.resume()

        let value = ''
        const onData = (chunk) => {
            for (const char of chunk) {
                if (char === '\r' || char === '\n') {
                    input.setRawMode(false)
                    input.pause()
                    input.off('data', onData)
                    process.stdout.write('\n')
                    resolve(value)
                    return
                }
                if (char === '\u0003') {
                    process.stdout.write('\n')
                    process.exit(1)
                }
                if (char === '\u007f' || char === '\b') {
                    value = value.slice(0, -1)
                    continue
                }
                value += char
            }
        }

        input.on('data', onData)
    })
}

async function readPassword() {
    const fromArgv = process.argv[2]
    if (fromArgv) {
        console.warn('[WARN] 不建议直接将口令写在命令行中')
        return fromArgv
    }
    if (process.stdin.isTTY) return readHidden('[INFO] 请输入访问口令：')

    return (await readAll(process.stdin)).trim()
}

const password = String(await readPassword()).trim()

if (password.length < 8) {
    console.error('[ERROR] 口令至少需要 8 位')
    process.exit(1)
}

const hash = await hashPassword(password)

console.log('')
console.log('[INFO] 请将以下内容写入 .env：')
console.log('')
console.log(`APP_PASSWORD_HASH=${hash}`)
console.log('')
