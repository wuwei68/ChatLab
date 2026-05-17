/**
 * Session summary generation — Electron adapter.
 *
 * Implements SummaryDeps by wiring Electron's database, LLM config, and i18n,
 * then delegates all logic to the shared @openchatlab/node-runtime module.
 */

import Database from 'better-sqlite3'
import { completeSimple, type PiTextContent } from '@openchatlab/node-runtime'
import { getFastModelConfig, buildPiModel } from '../llm'
import { getDbPath, openDatabase } from '../../database/core'
import { aiLogger } from '../logger'
import { t } from '../../i18n'
import {
  generateSessionSummary as generateCore,
  generateSessionSummaries as generateBatchCore,
  checkSessionsCanGenerateSummary as checkCore,
  type SummaryDeps,
} from '@openchatlab/node-runtime'

function buildDeps(dbSessionId: string): SummaryDeps {
  return {
    loadMessages(chatSessionId, limit = 500) {
      const db = openDatabase(dbSessionId, true)
      if (!db) return null
      try {
        const sql = `
          SELECT
            COALESCE(mb.group_nickname, mb.account_name, mb.platform_id) as senderName,
            m.content
          FROM message_context mc
          JOIN message m ON m.id = mc.message_id
          JOIN member mb ON mb.id = m.sender_id
          WHERE mc.session_id = ?
          ORDER BY m.ts ASC
          LIMIT ?
        `
        return db.prepare(sql).all(chatSessionId, limit) as Array<{ senderName: string; content: string | null }>
      } catch (error) {
        aiLogger.error('Summary', `Failed to get session messages: ${error}`)
        return null
      }
    },

    saveSummary(chatSessionId, summary) {
      const dbPath = getDbPath(dbSessionId)
      const db = new Database(dbPath)
      try {
        db.prepare('UPDATE chat_session SET summary = ? WHERE id = ?').run(summary, chatSessionId)
      } finally {
        db.close()
      }
    },

    getSummary(chatSessionId) {
      const db = openDatabase(dbSessionId, true)
      if (!db) return null
      try {
        const row = db.prepare('SELECT summary FROM chat_session WHERE id = ?').get(chatSessionId) as
          | { summary: string | null }
          | undefined
        return row?.summary || null
      } catch {
        return null
      }
    },

    async llmComplete(systemPrompt, userPrompt, options) {
      const fastConfig = getFastModelConfig()
      if (!fastConfig) throw new Error(t('llm.notConfigured'))

      const piModel = buildPiModel(fastConfig)
      const result = await completeSimple(
        piModel,
        { systemPrompt, messages: [{ role: 'user', content: userPrompt, timestamp: Date.now() }] },
        { apiKey: fastConfig.apiKey, temperature: options?.temperature, maxTokens: options?.maxTokens }
      )

      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        throw new Error(result.errorMessage || t('llm.callFailed'))
      }

      return result.content
        .filter((item): item is PiTextContent => item.type === 'text')
        .map((item) => item.text)
        .join('')
    },

    t,
    logger: aiLogger,
  }
}

export async function generateSessionSummary(
  dbSessionId: string,
  chatSessionId: number,
  locale: string = 'zh-CN',
  forceRegenerate: boolean = false
): Promise<{ success: boolean; summary?: string; error?: string }> {
  return generateCore(buildDeps(dbSessionId), chatSessionId, { locale, forceRegenerate })
}

export async function generateSessionSummaries(
  dbSessionId: string,
  chatSessionIds: number[],
  locale: string = 'zh-CN',
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  return generateBatchCore(buildDeps(dbSessionId), chatSessionIds, { locale }, onProgress)
}

export function checkSessionsCanGenerateSummary(
  dbSessionId: string,
  chatSessionIds: number[]
): Map<number, { canGenerate: boolean; reason?: string }> {
  return checkCore(buildDeps(dbSessionId), chatSessionIds)
}
