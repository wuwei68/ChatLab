/**
 * Web 模式下的 window.chatApi / window.aiApi 垫片
 *
 * chart-* 包和 MessageList 等组件直接调用 window.chatApi / window.aiApi，
 * 在非 Electron 环境下通过 pluginQuery 和 FetchAdapter 提供等价实现。
 */

import type { QueryAdapter } from './types'

interface TimeFilter {
  startTs?: number
  endTs?: number
  memberId?: number
}

interface PaginatedMessages {
  messages: any[]
  hasMore: boolean
  total?: number
}

const MSG_SELECT = `
  SELECT
    msg.id,
    m.id as senderId,
    COALESCE(m.group_nickname, m.account_name, m.platform_id) as senderName,
    m.platform_id as senderPlatformId,
    m.aliases,
    m.avatar,
    msg.content,
    msg.ts as timestamp,
    msg.type,
    msg.reply_to_message_id as replyToMessageId,
    reply_msg.content as replyToContent,
    COALESCE(reply_m.group_nickname, reply_m.account_name, reply_m.platform_id) as replyToSenderName
  FROM message msg
  JOIN member m ON msg.sender_id = m.id
  LEFT JOIN message reply_msg ON msg.reply_to_message_id = reply_msg.platform_message_id
  LEFT JOIN member reply_m ON reply_msg.sender_id = reply_m.id
`

function buildConditions(filter?: TimeFilter, senderId?: number, keywords?: string[]) {
  const conds: string[] = []
  const params: unknown[] = []

  if (filter?.startTs != null) {
    conds.push('msg.ts >= ?')
    params.push(filter.startTs)
  }
  if (filter?.endTs != null) {
    conds.push('msg.ts <= ?')
    params.push(filter.endTs)
  }
  if (senderId != null) {
    conds.push('msg.sender_id = ?')
    params.push(senderId)
  }
  if (keywords && keywords.length > 0) {
    const kwConds = keywords.map(() => 'msg.content LIKE ?')
    conds.push(`(${kwConds.join(' OR ')})`)
    params.push(...keywords.map((k) => `%${k}%`))
  }

  return { clause: conds.length > 0 ? 'AND ' + conds.join(' AND ') : '', params }
}

function pq<T>(adapter: QueryAdapter, sessionId: string, sql: string, params: unknown[] = []) {
  return adapter.pluginQuery<T>(sessionId, sql, params)
}

async function getMessagesBefore(
  adapter: QueryAdapter,
  sessionId: string,
  beforeId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): Promise<PaginatedMessages> {
  const { clause, params } = buildConditions(filter, senderId, keywords)
  const sql = `${MSG_SELECT} WHERE msg.id < ? ${clause} ORDER BY msg.id DESC LIMIT ?`
  const rows = await pq<any>(adapter, sessionId, sql, [beforeId, ...params, limit + 1])
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  return { messages: messages.reverse(), hasMore }
}

async function getMessagesAfter(
  adapter: QueryAdapter,
  sessionId: string,
  afterId: number,
  limit: number = 50,
  filter?: TimeFilter,
  senderId?: number,
  keywords?: string[]
): Promise<PaginatedMessages> {
  const { clause, params } = buildConditions(filter, senderId, keywords)
  const sql = `${MSG_SELECT} WHERE msg.id > ? ${clause} ORDER BY msg.id ASC LIMIT ?`
  const rows = await pq<any>(adapter, sessionId, sql, [afterId, ...params, limit + 1])
  const hasMore = rows.length > limit
  const messages = hasMore ? rows.slice(0, limit) : rows
  return { messages, hasMore }
}

async function getMessageContext(
  adapter: QueryAdapter,
  sessionId: string,
  messageIds: number | number[],
  contextSize: number = 20
): Promise<any[]> {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds]
  if (ids.length === 0) return []

  const allIds = new Set<number>()

  for (const id of ids) {
    allIds.add(id)
    if (contextSize > 0) {
      const before = await pq<{ id: number }>(
        adapter,
        sessionId,
        'SELECT id FROM message WHERE id < ? ORDER BY id DESC LIMIT ?',
        [id, contextSize]
      )
      before.forEach((r) => allIds.add(r.id))

      const after = await pq<{ id: number }>(
        adapter,
        sessionId,
        'SELECT id FROM message WHERE id > ? ORDER BY id ASC LIMIT ?',
        [id, contextSize]
      )
      after.forEach((r) => allIds.add(r.id))
    }
  }

  const idList = Array.from(allIds).sort((a, b) => a - b)
  const placeholders = idList.map(() => '?').join(', ')
  const sql = `${MSG_SELECT} WHERE msg.id IN (${placeholders}) ORDER BY msg.id ASC`
  return pq<any>(adapter, sessionId, sql, idList)
}

async function searchMessages(
  adapter: QueryAdapter,
  sessionId: string,
  keywords: string[],
  filter?: TimeFilter,
  limit: number = 100,
  offset: number = 0,
  senderId?: number
): Promise<{ messages: any[]; total: number }> {
  const { clause, params } = buildConditions(filter, senderId, keywords)
  const countSql = `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id WHERE 1=1 ${clause}`
  const countResult = await pq<{ total: number }>(adapter, sessionId, countSql, params)
  const total = countResult[0]?.total ?? 0

  const sql = `${MSG_SELECT} WHERE 1=1 ${clause} ORDER BY msg.ts DESC LIMIT ? OFFSET ?`
  const messages = await pq<any>(adapter, sessionId, sql, [...params, limit, offset])
  return { messages, total }
}

async function getAllRecentMessages(
  adapter: QueryAdapter,
  sessionId: string,
  filter?: TimeFilter,
  limit: number = 100
): Promise<{ messages: any[]; total: number }> {
  const { clause, params } = buildConditions(filter)
  const countSql = `SELECT COUNT(*) as total FROM message msg JOIN member m ON msg.sender_id = m.id WHERE 1=1 ${clause}`
  const countResult = await pq<{ total: number }>(adapter, sessionId, countSql, params)
  const total = countResult[0]?.total ?? 0

  const sql = `${MSG_SELECT} WHERE 1=1 ${clause} ORDER BY msg.ts DESC LIMIT ?`
  const messages = await pq<any>(adapter, sessionId, sql, [...params, limit])
  return { messages: messages.reverse(), total }
}

/**
 * 注入 window.chatApi 和 window.aiApi 垫片
 */
export function installWebApiShims(adapter: QueryAdapter): void {
  if (!window.chatApi) {
    ;(window as any).chatApi = {}
  }
  if (!(window as any).aiApi) {
    ;(window as any).aiApi = {}
  }

  const chatApi = (window as any).chatApi
  const aiApi = (window as any).aiApi

  // ===== window.chatApi 垫片 =====
  chatApi.pluginQuery = <T>(sid: string, sql: string, params?: unknown[]) => adapter.pluginQuery<T>(sid, sql, params)
  chatApi.pluginCompute = <T>(fnString: string, input: unknown): Promise<T> => {
    const fn = new Function('return ' + fnString)()
    return Promise.resolve(fn(input))
  }
  chatApi.getMemberActivity = (sid: string, f?: any) => adapter.getMemberActivity(sid, f)
  chatApi.getAvailableYears = (sid: string) => adapter.getAvailableYears(sid)

  // ===== window.aiApi 消息查询垫片 =====
  aiApi.getMessagesBefore = (
    sid: string,
    beforeId: number,
    limit: number,
    filter?: any,
    senderId?: number,
    kw?: string[]
  ) => getMessagesBefore(adapter, sid, beforeId, limit, filter, senderId, kw)
  aiApi.getMessagesAfter = (
    sid: string,
    afterId: number,
    limit: number,
    filter?: any,
    senderId?: number,
    kw?: string[]
  ) => getMessagesAfter(adapter, sid, afterId, limit, filter, senderId, kw)
  aiApi.getMessageContext = (sid: string, msgIds: number | number[], ctxSize?: number) =>
    getMessageContext(adapter, sid, msgIds, ctxSize)
  aiApi.searchMessages = (
    sid: string,
    kw: string[],
    filter?: any,
    limit?: number,
    offset?: number,
    senderId?: number
  ) => searchMessages(adapter, sid, kw, filter, limit, offset, senderId)
  aiApi.getAllRecentMessages = (sid: string, filter?: any, limit?: number) =>
    getAllRecentMessages(adapter, sid, filter, limit)
}
