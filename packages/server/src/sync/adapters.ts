/**
 * Server-side implementations of @openchatlab/sync abstractions.
 *
 * NodeFetcher: uses Node.js fetch API
 * DirectImporter: uses DatabaseManager + streamImport/importData
 * NoopNotifier: placeholder (future: SSE push)
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import type { HttpFetcher, DataImporter, SyncNotifier, ImportResult, FetchParams, SyncLogger } from '@openchatlab/sync'
import { NOOP_LOGGER } from '@openchatlab/sync'
import { buildPullUrl } from '@openchatlab/sync'
import type { DatabaseManager } from '@openchatlab/node-runtime'
import { openBetterSqliteDatabase } from '@openchatlab/node-runtime'
import { CHAT_DB_SCHEMA, FTS_TABLE_SCHEMA } from '@openchatlab/core'
import { parseFile } from '../import/chatlab-reader'
import { importData } from '../import/importer'

function getTempFilePath(ext: string): string {
  const id = crypto.randomBytes(8).toString('hex')
  return path.join(os.tmpdir(), `chatlab-pull-${id}${ext}`)
}

// ==================== NodeFetcher ====================

export class NodeFetcher implements HttpFetcher {
  async fetchToTempFile(baseUrl: string, remoteSessionId: string, token: string, params: FetchParams): Promise<string> {
    const url = buildPullUrl(baseUrl, remoteSessionId, params)
    const headers: Record<string, string> = {
      Accept: 'application/json, application/x-ndjson',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || 'application/json'
    const isJsonl = contentType.includes('ndjson') || contentType.includes('jsonl')
    const tempFile = getTempFilePath(isJsonl ? '.jsonl' : '.json')

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(tempFile, buffer)
    return tempFile
  }
}

// ==================== DirectImporter ====================

function resolveNativeBinding(): string | undefined {
  if (process.versions.electron) return undefined
  const nativePath = path.resolve(__dirname, '../../native/better_sqlite3.node')
  if (fs.existsSync(nativePath)) return nativePath
  return undefined
}

export class DirectImporter implements DataImporter {
  private dbManager: DatabaseManager
  private nativeBinding: string | undefined
  private logger: SyncLogger

  constructor(dbManager: DatabaseManager, logger?: SyncLogger) {
    this.dbManager = dbManager
    this.nativeBinding = resolveNativeBinding()
    this.logger = logger ?? NOOP_LOGGER
  }

  sessionExists(sessionId: string): boolean {
    const dbPath = this.dbManager.getDbPath(sessionId)
    return fs.existsSync(dbPath)
  }

  async importFile(tempFile: string, targetSessionId: string | undefined, externalId: string): Promise<ImportResult> {
    if (targetSessionId && this.sessionExists(targetSessionId)) {
      return this.incrementalImportFile(targetSessionId, tempFile)
    }

    return this.fullImportFile(tempFile, externalId)
  }

  private async incrementalImportFile(sessionId: string, tempFile: string): Promise<ImportResult> {
    try {
      const data = await parseFile(tempFile)

      this.dbManager.close(sessionId)
      const result = await importData(this.dbManager, data, {
        sessionId,
        nativeBinding: this.nativeBinding,
      })

      if (result.success) {
        this.logger.info(`[DirectImporter] Incremental OK: +${result.messageCount - result.duplicateCount} messages`)
        return {
          success: true,
          newMessageCount: result.messageCount - result.duplicateCount,
          sessionId,
        }
      }

      if (result.error?.includes('not found') || result.error?.includes('session_not_found')) {
        return { success: false, newMessageCount: 0, sessionId, needFullResync: true }
      }

      return { success: false, newMessageCount: 0, sessionId, error: result.error }
    } catch (err: any) {
      this.logger.error(`[DirectImporter] Incremental import failed`, err)
      return { success: false, newMessageCount: 0, sessionId, error: err.message }
    }
  }

  private async fullImportFile(tempFile: string, externalId: string): Promise<ImportResult> {
    try {
      const data = await parseFile(tempFile)

      const dbPath = this.dbManager.getDbPath(externalId)
      const db = openBetterSqliteDatabase(dbPath, { nativeBinding: this.nativeBinding })
      db.exec(CHAT_DB_SCHEMA)

      db.prepare(
        `INSERT INTO meta (name, platform, type, imported_at, schema_version)
         VALUES (?, ?, ?, ?, 4)`
      ).run(data.meta.name, data.meta.platform, data.meta.type, Math.floor(Date.now() / 1000))

      const insertMember = db.prepare(
        `INSERT OR IGNORE INTO member (platform_id, account_name, group_nickname) VALUES (?, ?, ?)`
      )
      for (const m of data.members) {
        insertMember.run(m.platformId, m.accountName || m.platformId, m.groupNickname || null)
      }

      const memberRows = db.prepare('SELECT id, platform_id FROM member').all() as Array<{
        id: number
        platform_id: string
      }>
      const memberIdMap = new Map<string, number>()
      for (const r of memberRows) memberIdMap.set(r.platform_id, r.id)

      const insertMsg = db.prepare(
        `INSERT INTO message (sender_id, sender_account_name, sender_group_nickname, ts, type, content, platform_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )

      let written = 0
      const BATCH = 5000

      for (let i = 0; i < data.messages.length; i += BATCH) {
        const batch = data.messages.slice(i, i + BATCH)
        db.transaction(() => {
          for (const msg of batch) {
            let senderId = memberIdMap.get(msg.senderPlatformId)
            if (!senderId) {
              insertMember.run(msg.senderPlatformId, msg.senderAccountName || msg.senderPlatformId, null)
              senderId = (
                db.prepare('SELECT id FROM member WHERE platform_id = ?').get(msg.senderPlatformId) as { id: number }
              )?.id
              if (senderId) memberIdMap.set(msg.senderPlatformId, senderId)
            }
            if (!senderId) continue

            insertMsg.run(
              senderId,
              msg.senderAccountName || null,
              msg.senderGroupNickname || null,
              msg.timestamp,
              msg.type,
              msg.content,
              msg.platformMessageId || null
            )
            written++
          }
        })
      }

      try {
        db.exec(FTS_TABLE_SCHEMA)
        const textMsgs = db
          .prepare("SELECT id, content FROM message WHERE type = 0 AND content IS NOT NULL AND content != ''")
          .all() as Array<{ id: number; content: string }>
        const insertFts = db.prepare('INSERT INTO message_fts(rowid, content) VALUES (?, ?)')
        for (let i = 0; i < textMsgs.length; i += BATCH) {
          const b = textMsgs.slice(i, i + BATCH)
          db.transaction(() => {
            for (const row of b) insertFts.run(row.id, row.content)
          })
        }
      } catch {
        /* FTS indexing is non-critical */
      }

      db.close()

      return { success: true, newMessageCount: written, sessionId: externalId }
    } catch (err: any) {
      this.logger.error(`[DirectImporter] Full import failed`, err)
      return { success: false, newMessageCount: 0, error: err.message }
    }
  }
}

// ==================== NoopNotifier ====================

const noop = () => {}

export class NoopNotifier implements SyncNotifier {
  onSessionListChanged = noop
  onPullResult = noop
}
