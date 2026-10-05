// 设备配对管理
// npm run pair 列出所有等待批准的设备
// npm run pair -- AB3F9K2M 批准设备
// npm run pair -- --deny AB3F9K2M 拒绝设备
// npm run pair -- --devices 列出所有已授权设备
// npm run pair -- --revoke <id> 撤销某个已授权设备
// npm run pair -- --sweep 马上清理过期的申请和过期的凭证（服务端每每 60 秒清一次）

import { config } from '../config.js'
import { createStore } from '../store/index.js'
import { createPairing, normalizeCode } from '../pairing.js'

const time = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—')
const left = (expiresAt) => {
    const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
    return seconds > 0 ? `${Math.ceil(seconds / 60)} 分钟后过期` : '已过期'
}

const store = createStore()
const pairing = createPairing(store)

try {
    const args = process.argv.slice(2)
    const flags = args.filter((arg) => arg.startsWith('--'))
    const rest = args.filter((arg) => !arg.startsWith('--'))
    const value = rest[0] || ''
    const normalized = normalizeCode(value)

    if (flags.includes('--sweep')) {
        const pairings = pairing.sweep()
        const { tokens, devices } = pairing.sweepTokens()
        console.log(`[INFO] 清理完成：过期申请 ${pairings} 条，过期凭证 ${tokens} 条，空设备 ${devices} 个。`)
    } else if (flags.includes('--devices')) {
        const devices = pairing.listDevices()
        if (!devices.length) {
            console.log('[INFO] 还没有已授权的设备。')
        } else {
            console.log(`[INFO] 已授权设备（${devices.length}）：\n`)
            for (const device of devices) {
                console.log(`  ${device.name}  ·  ${device.platform}`)
                console.log(`    设备 id   ${device.deviceId}`)
                console.log(`    授权时间  ${time(device.createdAt)}   最近活跃  ${time(device.lastSeenAt)}`)
                console.log('')
            }
        }
    } else if (flags.includes('--revoke')) {
        const result = pairing.revoke(value)
        if (!result.ok) {
            console.error(`[ERROR] 未找到设备 ${value}，npm run pair -- --devices 列出所有已授权设备`)
            process.exitCode = 1
        } else {
            console.log(`[INFO] 已撤销 ${result.device.name} 授权`)
        }
    } else if (flags.includes('--deny')) {
        const result = pairing.deny(normalized)
        if (!result.ok) {
            console.error(result.error === 'already-decided'
                ? `[ERROR] 这条申请已经处理过了（${result.record.status}）`
                : '[ERROR] 没有找到这个配对码')
            process.exitCode = 1
        } else {
            console.log(`[INFO] 已拒绝「${result.record.name}」的申请。`)
        }
    } else if (normalized) {
        const result = pairing.approve(normalized)
        if (!result.ok) {
            console.error(result.error === 'already-decided'
                ? `[ERROR] 这条申请已经处理过了（${result.record.status}）`
                : '[ERROR] 没有找到这个配对码')
            process.exitCode = 1
        } else {
            console.log(`[INFO] 已批准「${result.record.name}」（${result.record.platform}）。`)
        }
    } else {
        const pending = pairing.pending()
        if (!pending.length) {
            console.log('[INFO] 没有等待批准的设备')
        } else {
            console.log(`[INFO] 等待批准（${pending.length}）：\n`)
            for (const record of pending) {
                console.log(`  ${record.code}   ${record.name}  ·  ${record.platform}`)
                console.log(`    ${time(record.createdAt)} 提交   ${left(record.expiresAt)}${record.ip ? `   来自 ${record.ip}` : ''}`)
                console.log('')
            }
            console.log(`[INFO] 批准：npm run pair -- ${pending[0].code.replace('-', '')}`)
        }
    }
} catch (error) {
    console.error(`[ERROR] 失败：${error.message}`)
    console.error(`[ERROR] 数据库：${config.dbPath}`)
    process.exitCode = 1
} finally {
    store.closeStore()
}
