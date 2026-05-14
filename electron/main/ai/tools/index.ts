/**
 * AI Tools 模块入口
 * 工具创建、预处理管道与管理
 *
 * 架构：工具返回结构化数据（rawMessages） → 处理层执行预处理 + 格式化 → 生成 LLM 内容
 */

import type { AgentTool } from '@openchatlab/node-runtime'
import type { ToolContext, TruncationStrategy } from './types'
import { TOOL_REGISTRY } from './definitions'

const CORE_TOOL_NAMES = new Set(TOOL_REGISTRY.filter((e) => e.category === 'core').map((e) => e.name))
import { t as i18nT } from '../../i18n'
import { preprocessMessages, type PreprocessableMessage } from '../preprocessor'
import {
  formatMessageCompact,
  formatToolResultAsText,
  truncateFormattedMessages,
  anonymizeMessageNames,
  countTokens,
} from '@openchatlab/node-runtime'
import { getSkillConfig } from '../skills'
import { createActivateSkillTool as sharedCreateActivateSkillTool } from '@openchatlab/node-runtime'

const TRUNCATION_STRATEGY_MAP = new Map<string, TruncationStrategy>(
  TOOL_REGISTRY.filter((e) => e.truncationStrategy).map((e) => [e.name, e.truncationStrategy!])
)

// 导出类型
export * from './types'

/**
 * 翻译 AgentTool 的描述（工具级 + 参数级）
 *
 * i18n 键命名规则：
 * - 工具描述：ai.tools.{toolName}.desc
 * - 参数描述：ai.tools.{toolName}.params.{paramName}
 */
function translateTool(tool: AgentTool<any>): AgentTool<any> {
  const name = tool.name

  const descKey = `ai.tools.${name}.desc`
  const translatedDesc = i18nT(descKey)

  const params = tool.parameters as Record<string, unknown>
  if (params?.properties && typeof params.properties === 'object') {
    for (const [paramName, param] of Object.entries(params.properties as Record<string, Record<string, unknown>>)) {
      const paramKey = `ai.tools.${name}.params.${paramName}`
      const translated = i18nT(paramKey)
      if (translated !== paramKey) {
        param.description = translated
      }
    }
  }

  return {
    ...tool,
    description: translatedDesc !== descKey ? translatedDesc : tool.description,
  }
}

/**
 * 预处理包装层
 * 拦截工具的 execute 结果：如果 details 中包含 rawMessages，
 * 则执行预处理管道 + 格式化，替换为最终的 LLM 内容
 *
 * 工具约定：返回消息的工具在 details 中放置 rawMessages 字段（结构化消息数组），
 * 处理层负责 preprocess + formatMessageCompact，工具无需感知预处理逻辑。
 */
function wrapWithPreprocessing(tool: AgentTool<any>, context: ToolContext): AgentTool<any> {
  const originalExecute = tool.execute
  return {
    ...tool,
    execute: async (toolCallId: string, params: any, _signal?: AbortSignal, _onUpdate?: unknown) => {
      const result = await originalExecute(toolCallId, params)

      const details = result.details as Record<string, unknown> | undefined
      if (!details?.rawMessages || !Array.isArray(details.rawMessages)) {
        return result
      }

      const raw = details.rawMessages as PreprocessableMessage[]
      const processed = preprocessMessages(raw, context.preprocessConfig)

      let nameMapLine = ''
      if (context.preprocessConfig?.anonymizeNames) {
        nameMapLine = anonymizeMessageNames(processed, context.ownerInfo?.platformId)
      }

      let formatted = processed.map((m) => formatMessageCompact(m, context.locale))

      // Token-aware 截断：超出预算时按策略裁剪消息列表
      let wasTruncated = false
      const originalCount = formatted.length
      if (context.maxToolResultTokens && context.maxToolResultTokens > 0) {
        const truncResult = truncateFormattedMessages(
          formatted,
          context.maxToolResultTokens,
          TRUNCATION_STRATEGY_MAP.get(tool.name) ?? 'keep_last',
          countTokens
        )
        if (truncResult.wasTruncated) {
          formatted = truncResult.messages
          wasTruncated = true
        }
      }

      const { rawMessages: _rawMessages, ...restDetails } = details
      const finalDetails = { ...restDetails, messages: formatted, returned: formatted.length }

      let textContent = formatToolResultAsText(finalDetails)

      if (wasTruncated) {
        const strategy = TRUNCATION_STRATEGY_MAP.get(tool.name) ?? 'keep_last'
        const strategyDesc = strategy === 'keep_first' ? 'most relevant' : 'most recent'
        const notice = `⚠️ Results truncated: ${originalCount} messages found, showing ${formatted.length} ${strategyDesc} due to context limit. Use a narrower time range or more specific keywords for more precise results.`
        textContent = notice + '\n' + textContent
      }

      if (nameMapLine) {
        textContent = nameMapLine + '\n' + textContent
      }

      return {
        content: [{ type: 'text' as const, text: textContent }],
        details: finalDetails,
      }
    },
  }
}

/**
 * 获取所有可用的 AgentTool
 *
 * - Core 工具始终加载，不受 allowedTools 白名单影响
 * - Analysis 工具仅在 allowedTools 中显式列出时才加载（opt-in）
 *
 * @param context 工具上下文
 * @param allowedTools analysis 工具白名单（仅控制 analysis 工具）
 */
export function getAllTools(context: ToolContext, allowedTools?: string[]): AgentTool<any>[] {
  const coreTools = TOOL_REGISTRY.filter((e) => e.category === 'core').map((e) => e.factory(context))

  let analysisTools: AgentTool<any>[] = []
  if (allowedTools && allowedTools.length > 0) {
    analysisTools = TOOL_REGISTRY.filter((e) => e.category === 'analysis' && allowedTools.includes(e.name)).map((e) =>
      e.factory(context)
    )
  }

  return [...coreTools, ...analysisTools].map(translateTool).map((t) => wrapWithPreprocessing(t, context))
}

/**
 * 创建 activate_skill 元工具（AI 自选模式专用）
 * 委托给共享包的 createActivateSkillTool，注入 Electron 端的 getSkillConfig
 */
export function createActivateSkillTool(
  chatType: 'group' | 'private',
  allowedTools?: string[],
  locale: string = 'zh-CN'
): AgentTool<any> {
  return sharedCreateActivateSkillTool({
    chatType,
    allowedTools,
    locale,
    getSkillConfig: (id) => getSkillConfig(id),
    coreToolNames: CORE_TOOL_NAMES,
  })
}
