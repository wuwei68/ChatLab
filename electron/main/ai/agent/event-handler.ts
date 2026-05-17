/**
 * Agent event handler — Electron adapter.
 * Re-exports the shared AgentEventHandler from @openchatlab/node-runtime.
 */

export {
  AgentEventHandler,
  type EventHandlerConfig,
  type TokenUsage,
  type AgentRuntimeStatus,
  type AgentStreamChunk,
} from '@openchatlab/node-runtime'
