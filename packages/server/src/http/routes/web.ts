/**
 * ChatLab Internal Web API — /_web/ routes
 *
 * 供 CLI serve Web 前端使用的内部 API（无认证、UI 友好的响应格式）。
 * 数据格式直接对齐 QueryAdapter 接口，避免前端二次转换。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { FastifyInstance } from 'fastify'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import type { TimeFilter } from '@openchatlab/shared-types'
import {
  getSessionMeta,
  getSessionOverview,
  getTimeRange,
  getAvailableYears,
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMessageTypeStats,
  getDatabaseSchema,
  executeReadonlySql,
} from '@openchatlab/core'
import { streamImport, detectFormat, detectAllFormats, getSupportedFormats, scanMultiChatFile } from '../../import'

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = path.resolve(__dirname, '../../../native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

function ensureDb(dbManager: DatabaseManager, sessionId: string) {
  const db = dbManager.open(sessionId)
  if (!db) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { statusCode: 404 })
  }
  return db
}

function parseTimeFilter(query: Record<string, string | undefined>): TimeFilter | undefined {
  const { startTs, endTs, memberId } = query
  if (!startTs && !endTs && !memberId) return undefined
  const filter: TimeFilter = {}
  if (startTs) filter.startTs = parseInt(startTs, 10)
  if (endTs) filter.endTs = parseInt(endTs, 10)
  if (memberId) filter.memberId = parseInt(memberId, 10)
  return filter
}

export function registerWebRoutes(server: FastifyInstance, dbManager: DatabaseManager): void {
  // ==================== 会话管理 ====================

  server.get('/_web/sessions', async () => {
    const sessionIds = dbManager.listSessionIds()
    return sessionIds
      .map((id) => {
        const db = dbManager.open(id)
        if (!db) return null
        const meta = getSessionMeta(db)
        if (!meta) return null
        const overview = getSessionOverview(db)
        return {
          id,
          name: meta.name,
          platform: meta.platform,
          type: meta.type,
          importedAt: meta.importedAt ?? 0,
          messageCount: overview.totalMessages,
          memberCount: overview.totalMembers,
          dbPath: '',
          groupId: meta.groupId ?? null,
          groupAvatar: meta.groupAvatar ?? null,
          ownerId: meta.ownerId ?? null,
          memberAvatar: null,
          lastMessageTs: overview.lastMessageTs ?? null,
          summaryCount: 0,
          aiConversationCount: 0,
        }
      })
      .filter(Boolean)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const meta = getSessionMeta(db)
    if (!meta) return null
    const overview = getSessionOverview(db)
    return {
      id: request.params.id,
      name: meta.name,
      platform: meta.platform,
      type: meta.type,
      importedAt: meta.importedAt ?? 0,
      messageCount: overview.totalMessages,
      memberCount: overview.totalMembers,
      dbPath: '',
      groupId: meta.groupId ?? null,
      groupAvatar: meta.groupAvatar ?? null,
      ownerId: meta.ownerId ?? null,
      memberAvatar: null,
      lastMessageTs: overview.lastMessageTs ?? null,
      summaryCount: 0,
      aiConversationCount: 0,
    }
  })

  server.delete<{ Params: { id: string } }>('/_web/sessions/:id', async (request, reply) => {
    const { id } = request.params
    try {
      dbManager.close(id)
      const dbPath = dbManager.getDbPath(id)
      const fs = await import('fs')
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath)
        return { success: true }
      }
      return reply.code(404).send({ success: false, error: 'File not found' })
    } catch (err) {
      return reply.code(500).send({ success: false, error: String(err) })
    }
  })

  server.patch<{ Params: { id: string }; Body: { name: string } }>('/_web/sessions/:id/name', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const { name } = request.body
    db.prepare('UPDATE meta SET name = ?').run(name)
    return { success: true }
  })

  server.patch<{ Params: { id: string }; Body: { ownerId: string | null } }>(
    '/_web/sessions/:id/owner',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const { ownerId } = request.body
      db.prepare('UPDATE meta SET owner_id = ?').run(ownerId ?? null)
      return { success: true }
    }
  )

  // ==================== 时间范围 ====================

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/years', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getAvailableYears(db)
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/time-range', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    return getTimeRange(db)
  })

  // ==================== 统计分析 ====================

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/member-activity', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMemberActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/hourly', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getHourlyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/daily', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getDailyActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/weekday', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getWeekdayActivity(db, filter)
  })

  server.get<{
    Params: { id: string }
    Querystring: { startTs?: string; endTs?: string; memberId?: string }
  }>('/_web/sessions/:id/stats/message-types', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const filter = parseTimeFilter(request.query)
    return getMessageTypeStats(db, filter)
  })

  // ==================== 成员管理 ====================

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/members', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const rows = db
      .prepare(
        `SELECT
          m.id, m.platform_id as platformId,
          m.account_name as accountName,
          m.group_nickname as groupNickname,
          m.aliases, m.avatar,
          (SELECT COUNT(*) FROM message WHERE sender_id = m.id) as messageCount
        FROM member m
        WHERE COALESCE(m.account_name, '') != '系统消息'
        ORDER BY messageCount DESC`
      )
      .all() as any[]
    return rows.map((r: any) => ({
      ...r,
      aliases: r.aliases ? (typeof r.aliases === 'string' ? JSON.parse(r.aliases) : r.aliases) : [],
    }))
  })

  server.get<{
    Params: { id: string }
    Querystring: { page?: string; pageSize?: string; search?: string; sortOrder?: string }
  }>('/_web/sessions/:id/members/paginated', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const page = Math.max(1, parseInt(request.query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '20', 10)))
    const search = request.query.search?.trim() || ''
    const sortOrder = request.query.sortOrder === 'asc' ? 'ASC' : 'DESC'

    let whereClause = ''
    const params: unknown[] = []
    if (search) {
      whereClause = `WHERE (m.account_name LIKE ? OR m.group_nickname LIKE ? OR m.platform_id LIKE ? OR m.aliases LIKE ?)`
      const searchParam = `%${search}%`
      params.push(searchParam, searchParam, searchParam, searchParam)
    }

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM member m ${whereClause}`).get(...params) as {
      total: number
    }
    const total = countRow.total
    const totalPages = Math.ceil(total / pageSize)
    const offset = (page - 1) * pageSize

    const rows = db
      .prepare(
        `SELECT
          m.id, m.platform_id as platformId,
          m.account_name as accountName,
          m.group_nickname as groupNickname,
          m.aliases, m.avatar,
          COUNT(msg.id) as messageCount
        FROM member m
        LEFT JOIN message msg ON m.id = msg.sender_id
        ${whereClause}
        GROUP BY m.id
        ORDER BY messageCount ${sortOrder}
        LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as any[]

    return {
      items: rows.map((r: any) => ({
        ...r,
        aliases: r.aliases ? (typeof r.aliases === 'string' ? JSON.parse(r.aliases) : r.aliases) : [],
      })),
      total,
      page,
      pageSize,
      totalPages,
    }
  })

  server.patch<{ Params: { id: string; memberId: string }; Body: { aliases: string[] } }>(
    '/_web/sessions/:id/members/:memberId/aliases',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)
      const { aliases } = request.body
      db.prepare('UPDATE member SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), memberId)
      return { success: true }
    }
  )

  server.delete<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)
      db.prepare('DELETE FROM message WHERE sender_id = ?').run(memberId)
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId)
      return { success: true }
    }
  )

  server.post<{ Params: { id: string }; Body: { memberId1: number; memberId2: number } }>(
    '/_web/sessions/:id/members/merge',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const { memberId1, memberId2 } = request.body
      db.prepare('UPDATE message SET sender_id = ? WHERE sender_id = ?').run(memberId1, memberId2)
      db.prepare('DELETE FROM member WHERE id = ?').run(memberId2)
      return { success: true }
    }
  )

  server.get<{ Params: { id: string; memberId: string } }>(
    '/_web/sessions/:id/members/:memberId/history',
    async (request) => {
      const db = ensureDb(dbManager, request.params.id)
      const memberId = parseInt(request.params.memberId, 10)

      const rows = db
        .prepare(
          `SELECT
            sender_account_name as accountName,
            sender_group_nickname as groupNickname,
            MIN(ts) as startTs,
            MAX(ts) as endTs
          FROM message
          WHERE sender_id = ?
          GROUP BY sender_account_name, sender_group_nickname
          ORDER BY startTs`
        )
        .all(memberId) as any[]

      const history: Array<{ nameType: string; name: string; startTs: number; endTs: number | null }> = []
      for (const row of rows) {
        if (row.accountName) {
          history.push({ nameType: 'account_name', name: row.accountName, startTs: row.startTs, endTs: row.endTs })
        }
        if (row.groupNickname) {
          history.push({ nameType: 'group_nickname', name: row.groupNickname, startTs: row.startTs, endTs: row.endTs })
        }
      }
      return history
    }
  )

  // ==================== SQL Lab ====================

  server.post<{ Params: { id: string }; Body: { sql: string } }>('/_web/sessions/:id/sql', async (request, reply) => {
    const db = ensureDb(dbManager, request.params.id)
    const { sql } = request.body || {}
    if (!sql || typeof sql !== 'string') {
      return reply.code(400).send({ error: 'Missing sql parameter' })
    }
    try {
      return executeReadonlySql(db, sql)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'SQL execution error'
      return reply.code(400).send({ error: message })
    }
  })

  server.get<{ Params: { id: string } }>('/_web/sessions/:id/schema', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const tables = getDatabaseSchema(db)
    return tables.map((t) => {
      const columns = db.prepare(`PRAGMA table_info('${t.name}')`).all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
      }>
      return {
        name: t.name,
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          notnull: c.notnull === 1,
          pk: c.pk === 1,
        })),
      }
    })
  })

  // ==================== 插件查询（参数化只读 SQL） ====================

  server.post<{
    Params: { id: string }
    Body: { sql: string; params?: unknown[] | Record<string, unknown> }
  }>('/_web/sessions/:id/query', async (request) => {
    const db = ensureDb(dbManager, request.params.id)
    const { sql, params = [] } = request.body as { sql: string; params?: unknown[] | Record<string, unknown> }

    if (!sql || typeof sql !== 'string') {
      throw Object.assign(new Error('Missing or invalid "sql" field'), { statusCode: 400 })
    }

    const stmt = db.prepare(sql.trim())

    if (!stmt.readonly) {
      throw Object.assign(new Error('Only READ-ONLY statements are allowed'), { statusCode: 403 })
    }

    if (Array.isArray(params)) {
      return stmt.all(...params)
    }
    return stmt.all(params)
  })

  // ==================== 导入管线 ====================

  server.get('/_web/supported-formats', async () => {
    return getSupportedFormats()
  })

  server.post('/_web/detect-format', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-detect-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const format = detectFormat(tmpPath)
      const allFormats = detectAllFormats(tmpPath)
      return { format, allFormats }
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  server.post('/_web/scan-multi-chat', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-scan-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    try {
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk)
      }
      fs.writeFileSync(tmpPath, Buffer.concat(chunks))

      const chats = await scanMultiChatFile(tmpPath)
      return { chats }
    } finally {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })

  server.post('/_web/import', async (request, reply) => {
    const data = await (request as any).file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlab-import-'))
    const tmpPath = path.join(tmpDir, data.filename || 'upload')

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    fs.writeFileSync(tmpPath, Buffer.concat(chunks))

    const formatId = (data.fields?.formatId as any)?.value as string | undefined
    const chatIndexStr = (data.fields?.chatIndex as any)?.value as string | undefined
    const chatIndex = chatIndexStr !== undefined ? parseInt(chatIndexStr, 10) : undefined

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    function sendEvent(event: string, data: unknown) {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const nativeBinding = resolveNativeBinding()
      const result = await streamImport(dbManager, tmpPath, {
        formatId,
        chatIndex,
        nativeBinding,
        onProgress: (p) => {
          sendEvent('progress', p)
        },
      })

      if (result.success) {
        sendEvent('done', {
          success: true,
          sessionId: result.sessionId,
          messageCount: result.messageCount,
          memberCount: result.memberCount,
        })
      } else {
        sendEvent('error', { success: false, error: result.error })
      }
    } catch (err) {
      sendEvent('error', { success: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reply.raw.end()
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir)
      } catch {
        /* ignore */
      }
    }
  })
}
