/**
 * 适配器工厂
 *
 * 根据编译时常量选择正确的 QueryAdapter 实现：
 * - Electron: ElectronAdapter (window.chatApi IPC)
 * - CLI serve Web: FetchAdapter (/_web/ HTTP API)
 * - 在线版 Web: BrowserSqlAdapter (sql.js Web Worker)
 *
 * 使用 initAdapter() 初始化（异步，动态 import 按需加载），
 * 之后通过 getAdapter() 同步获取。
 */

import { IS_ELECTRON, IS_BROWSER_STANDALONE } from '@/utils/platform'
import type { QueryAdapter } from './types'

let _adapter: QueryAdapter | null = null

/**
 * 初始化适配器（应在 app 启动时调用一次）
 */
export async function initAdapter(): Promise<QueryAdapter> {
  if (_adapter) return _adapter

  if (IS_ELECTRON) {
    const { ElectronAdapter } = await import('./electron')
    _adapter = new ElectronAdapter()
  } else if (IS_BROWSER_STANDALONE) {
    // Phase 3B: BrowserSqlAdapter
    throw new Error('BrowserSqlAdapter is not yet implemented.')
  } else {
    const { FetchAdapter } = await import('./fetch')
    _adapter = new FetchAdapter()

    const { installWebApiShims } = await import('./web-api-shim')
    installWebApiShims(_adapter)
  }

  return _adapter!
}

/**
 * 同步获取已初始化的适配器（initAdapter 之后可用）
 */
export function getAdapter(): QueryAdapter {
  if (!_adapter) {
    throw new Error('Adapter not initialized. Call initAdapter() first.')
  }
  return _adapter
}

export type { QueryAdapter, AdapterCapabilities } from './types'
