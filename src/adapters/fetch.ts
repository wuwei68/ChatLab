/**
 * FetchAdapter — 通过 HTTP 调用 /_web/ 内部 API
 *
 * 用于 CLI serve Web 场景：前端 SPA 通过 fetch 访问 chatlab serve 后端。
 * 所有请求发往同源 /_web/ 前缀，无需 token 认证。
 */

import type {
  QueryAdapter,
  AdapterCapabilities,
  SQLResult,
  TableSchema,
  PaginationParams,
  PaginatedResult,
  MentionGraphData,
  MessageLengthDistribution,
  ImportProgress,
  ImportResult,
  FormatInfo,
  MultiChatEntry,
} from './types'
import type { AnalysisSession, MessageType } from '@/types/base'
import type { TimeFilter } from '@openchatlab/shared-types'
import type {
  MemberActivity,
  MemberWithStats,
  MemberNameHistory,
  HourlyActivity,
  DailyActivity,
  WeekdayActivity,
  MonthlyActivity,
  CatchphraseAnalysis,
  MentionAnalysis,
  LaughAnalysis,
  ClusterGraphData,
  ClusterGraphOptions,
  RelationshipStats,
} from '@/types/analysis'
import type { LanguagePreferenceResult } from '@/types/quotes/languagePreference'

function buildFilterParams(filter?: TimeFilter): string {
  if (!filter) return ''
  const params = new URLSearchParams()
  if (filter.startTs) params.set('startTs', String(filter.startTs))
  if (filter.endTs) params.set('endTs', String(filter.endTs))
  if (filter.memberId) params.set('memberId', String(filter.memberId))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

function notImplemented(method: string): never {
  throw new Error(
    `[FetchAdapter] ${method} is not yet implemented on the server side. ` +
      'This feature requires additional backend query support.'
  )
}

export class FetchAdapter implements QueryAdapter {
  getCapabilities(): AdapterCapabilities {
    return {
      ai: false,
      nlp: false,
      fts: true,
      nativeFileDialog: false,
      osIntegration: false,
      demoImport: false,
      plugin: false,
      migration: false,
      merge: false,
      incrementalImport: false,
    }
  }

  // ==================== 会话管理 ====================

  getSessions(): Promise<AnalysisSession[]> {
    return get('/_web/sessions')
  }

  getSession(sessionId: string): Promise<AnalysisSession | null> {
    return get(`/_web/sessions/${sessionId}`)
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await del<{ success: boolean }>(`/_web/sessions/${sessionId}`)
    return result.success
  }

  async renameSession(sessionId: string, newName: string): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/_web/sessions/${sessionId}/name`, {
      name: newName,
    })
    return result.success
  }

  async updateSessionOwnerId(sessionId: string, ownerId: string | null): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/_web/sessions/${sessionId}/owner`, {
      ownerId,
    })
    return result.success
  }

  // ==================== 时间范围 ====================

  getAvailableYears(sessionId: string): Promise<number[]> {
    return get(`/_web/sessions/${sessionId}/years`)
  }

  getTimeRange(sessionId: string): Promise<{ start: number; end: number } | null> {
    return get(`/_web/sessions/${sessionId}/time-range`)
  }

  // ==================== 统计分析 ====================

  getMemberActivity(sessionId: string, filter?: TimeFilter): Promise<MemberActivity[]> {
    return get(`/_web/sessions/${sessionId}/stats/member-activity${buildFilterParams(filter)}`)
  }

  getHourlyActivity(sessionId: string, filter?: TimeFilter): Promise<HourlyActivity[]> {
    return get(`/_web/sessions/${sessionId}/stats/hourly${buildFilterParams(filter)}`)
  }

  getDailyActivity(sessionId: string, filter?: TimeFilter): Promise<DailyActivity[]> {
    return get(`/_web/sessions/${sessionId}/stats/daily${buildFilterParams(filter)}`)
  }

  getWeekdayActivity(sessionId: string, filter?: TimeFilter): Promise<WeekdayActivity[]> {
    return get(`/_web/sessions/${sessionId}/stats/weekday${buildFilterParams(filter)}`)
  }

  getMonthlyActivity(_sessionId: string, _filter?: TimeFilter): Promise<MonthlyActivity[]> {
    notImplemented('getMonthlyActivity')
  }

  getYearlyActivity(_sessionId: string, _filter?: TimeFilter): Promise<Array<{ year: number; messageCount: number }>> {
    notImplemented('getYearlyActivity')
  }

  getMessageLengthDistribution(_sessionId: string, _filter?: TimeFilter): Promise<MessageLengthDistribution> {
    notImplemented('getMessageLengthDistribution')
  }

  getMessageTypeDistribution(
    sessionId: string,
    filter?: TimeFilter
  ): Promise<Array<{ type: MessageType; count: number }>> {
    return get(`/_web/sessions/${sessionId}/stats/message-types${buildFilterParams(filter)}`)
  }

  // ==================== 成员管理 ====================

  getMembers(sessionId: string): Promise<MemberWithStats[]> {
    return get(`/_web/sessions/${sessionId}/members`)
  }

  getMembersPaginated(sessionId: string, params: PaginationParams): Promise<PaginatedResult<MemberWithStats>> {
    const qs = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    })
    if (params.search) qs.set('search', params.search)
    if (params.sortOrder) qs.set('sortOrder', params.sortOrder)
    return get(`/_web/sessions/${sessionId}/members/paginated?${qs}`)
  }

  getMemberNameHistory(sessionId: string, memberId: number): Promise<MemberNameHistory[]> {
    return get(`/_web/sessions/${sessionId}/members/${memberId}/history`)
  }

  async updateMemberAliases(sessionId: string, memberId: number, aliases: string[]): Promise<boolean> {
    const result = await patch<{ success: boolean }>(`/_web/sessions/${sessionId}/members/${memberId}/aliases`, {
      aliases,
    })
    return result.success
  }

  async mergeMembers(sessionId: string, memberId1: number, memberId2: number): Promise<boolean> {
    const result = await post<{ success: boolean }>(`/_web/sessions/${sessionId}/members/merge`, {
      memberId1,
      memberId2,
    })
    return result.success
  }

  async deleteMember(sessionId: string, memberId: number): Promise<boolean> {
    const result = await del<{ success: boolean }>(`/_web/sessions/${sessionId}/members/${memberId}`)
    return result.success
  }

  // ==================== 社交分析（渐进实现） ====================

  getCatchphraseAnalysis(_sessionId: string, _filter?: TimeFilter): Promise<CatchphraseAnalysis> {
    notImplemented('getCatchphraseAnalysis')
  }

  getLanguagePreferenceAnalysis(
    _sessionId: string,
    _locale: string,
    _filter?: TimeFilter,
    _dictType?: string
  ): Promise<LanguagePreferenceResult> {
    notImplemented('getLanguagePreferenceAnalysis')
  }

  getMentionAnalysis(_sessionId: string, _filter?: TimeFilter): Promise<MentionAnalysis> {
    notImplemented('getMentionAnalysis')
  }

  getMentionGraph(_sessionId: string, _filter?: TimeFilter): Promise<MentionGraphData> {
    notImplemented('getMentionGraph')
  }

  getClusterGraph(_sessionId: string, _filter?: TimeFilter, _options?: ClusterGraphOptions): Promise<ClusterGraphData> {
    notImplemented('getClusterGraph')
  }

  getLaughAnalysis(_sessionId: string, _filter?: TimeFilter, _keywords?: string[]): Promise<LaughAnalysis> {
    notImplemented('getLaughAnalysis')
  }

  getRelationshipStats(
    _sessionId: string,
    _filter?: TimeFilter,
    _options?: { perseveranceThreshold?: number }
  ): Promise<RelationshipStats> {
    notImplemented('getRelationshipStats')
  }

  // ==================== SQL Lab ====================

  executeSQL(sessionId: string, sql: string): Promise<SQLResult> {
    return post(`/_web/sessions/${sessionId}/sql`, { sql })
  }

  getSchema(sessionId: string): Promise<TableSchema[]> {
    return get(`/_web/sessions/${sessionId}/schema`)
  }

  // ==================== 导入管线 ====================

  async importFile(
    file: File,
    options?: { formatId?: string; chatIndex?: number },
    onProgress?: (p: ImportProgress) => void
  ): Promise<ImportResult> {
    const form = new FormData()
    form.append('file', file)
    if (options?.formatId) form.append('formatId', options.formatId)
    if (options?.chatIndex !== undefined) form.append('chatIndex', String(options.chatIndex))

    const res = await fetch('/_web/import', { method: 'POST', body: form })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `HTTP ${res.status}: ${text}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { success: false, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: ImportResult = { success: false, error: 'Unknown error' }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          if (eventType === 'progress') {
            onProgress?.(data as ImportProgress)
          } else if (eventType === 'done') {
            result = data as ImportResult
          } else if (eventType === 'error') {
            result = data as ImportResult
          }
          eventType = ''
        }
      }
    }

    return result
  }

  async detectFormat(file: File): Promise<FormatInfo | null> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/_web/detect-format', { method: 'POST', body: form })
    if (!res.ok) return null
    const data = (await res.json()) as { format: FormatInfo | null }
    return data.format
  }

  async scanMultiChatFile(file: File): Promise<MultiChatEntry[]> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/_web/scan-multi-chat', { method: 'POST', body: form })
    if (!res.ok) return []
    const data = (await res.json()) as { chats: MultiChatEntry[] }
    return data.chats
  }

  async getSupportedFormats(): Promise<FormatInfo[]> {
    return get('/_web/supported-formats')
  }

  // ==================== 插件系统 ====================

  pluginQuery<T = Record<string, unknown>>(sessionId: string, sql: string, params?: unknown[]): Promise<T[]> {
    return post<T[]>(`/_web/sessions/${sessionId}/query`, { sql, params: params ?? [] })
  }

  pluginCompute<T = unknown>(_fnString: string, _input: unknown): Promise<T> {
    notImplemented('pluginCompute')
  }
}
