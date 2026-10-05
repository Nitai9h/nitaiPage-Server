import { config } from '../config.js'
import * as sqlite from './sqlite.js'

// 存储后端的选择与初始化
// 以后更换数据库时，直接修改下面的数据
const backends = {
    sqlite
}

export function createStore() {
    const backend = backends[config.storeEngine]
    if (!backend) {
        throw new Error(`[ERROR] 未知的存储后端：${config.storeEngine}`)
    }

    backend.initStore()
    return backend
}
