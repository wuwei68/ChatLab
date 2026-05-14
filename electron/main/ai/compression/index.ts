/**
 * 上下文压缩 — Electron 薄包装
 *
 * 实际逻辑已提取到 @openchatlab/node-runtime。
 * 此处提供与旧 API 兼容的函数签名，注入 Electron 的 LLM adapter 和 logger。
 */

export type { CompressionConfig, CompressionResult } from '@openchatlab/node-runtime'
export {
  checkAndCompress as sharedCheckAndCompress,
  manualCompress as sharedManualCompress,
} from '@openchatlab/node-runtime'
import type { CompressionConfig, CompressionResult, CompressionLlmAdapter } from '@openchatlab/node-runtime'
import {
  checkAndCompress as sharedCheckAndCompress,
  manualCompress as sharedManualCompress,
} from '@openchatlab/node-runtime'
import { buildPiModel, findModelDefinition } from '../llm'
import type { AIServiceConfig } from '../llm/types'
import { completeSimple, type PiTextContent } from '@openchatlab/node-runtime'
import { aiLogger } from '../logger'
import { getManager } from '../conversations'

const DEFAULT_CONTEXT_WINDOW = 128000

function createLlmAdapter(activeAIConfig: AIServiceConfig, onCompressing?: () => void): CompressionLlmAdapter {
  const modelDef = findModelDefinition(activeAIConfig.provider, activeAIConfig.model || '')
  const contextWindow = modelDef?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const piModel = buildPiModel(activeAIConfig)

  return {
    contextWindow,
    compress: async (prompt: string, maxTokens: number) => {
      onCompressing?.()
      try {
        const result = await completeSimple(
          piModel,
          {
            systemPrompt: undefined,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }] as any,
          },
          { apiKey: activeAIConfig.apiKey, maxTokens }
        )
        const text = result.content
          .filter((item): item is PiTextContent => item.type === 'text')
          .map((item) => item.text)
          .join('')
        return text || null
      } catch (error) {
        aiLogger.warn('Compression', 'LLM compression attempt failed', { error: String(error) })
        return null
      }
    },
  }
}

const electronLogger = {
  info: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.info(cat, msg, extra),
  warn: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.warn(cat, msg, extra),
  error: (cat: string, msg: string, extra?: Record<string, unknown>) => aiLogger.error(cat, msg, extra),
}

/**
 * 兼容旧 API：检查并执行上下文压缩
 */
export async function checkAndCompress(
  conversationId: string,
  config: CompressionConfig,
  systemPrompt: string,
  activeAIConfig: AIServiceConfig,
  onCompressing?: () => void
): Promise<CompressionResult> {
  return sharedCheckAndCompress(
    conversationId,
    config,
    systemPrompt,
    createLlmAdapter(activeAIConfig, onCompressing),
    getManager(),
    electronLogger
  )
}

/**
 * 兼容旧 API：手动压缩
 */
export async function manualCompress(
  conversationId: string,
  config: CompressionConfig,
  systemPrompt: string,
  activeAIConfig: AIServiceConfig
): Promise<CompressionResult> {
  return sharedManualCompress(
    conversationId,
    config,
    systemPrompt,
    createLlmAdapter(activeAIConfig),
    getManager(),
    electronLogger
  )
}
