/**
 * SSE streaming handler for PianoAgent.
 * Extracted from App.tsx streamOnce function.
 * Handles real-time SSE parsing, tool call assembly, and RAF-throttled UI updates.
 */

import { splitSseFrames } from './streaming';
import type { StreamedChatCompletion, ToolCallPart } from './streaming';
import { sanitizeAssistantDisplayContent } from './message-sanitize';
import { tryParseJson } from './json-heal';
import type { ChatMessage } from '../types';
import { electronSafe } from './electron-safe';
import { buildChatCompletionsUrl } from '../../shared/api-endpoints';

export interface StreamOnceParams {
  /** API base URL */
  baseURL: string;
  /** API key for authorization */
  apiKey: string;
  /** Conversation ID for session tracking */
  convId: string;
  /** The request body to send to the API */
  requestBody: Record<string, unknown>;
  /** Callback to update the assistant message in the UI */
  onUpdate: (patch: Partial<ChatMessage>) => void;
}

/**
 * Create a single SSE streaming request.
 * Returns a promise that resolves with the complete response.
 */
export async function streamOnce(params: StreamOnceParams): Promise<StreamedChatCompletion> {
  const { baseURL, apiKey, convId, requestBody, onUpdate } = params;

  if (!window.electronAPI?.apiProxyStream || !window.electronAPI.onApiProxyStreamEvent) {
    throw new Error('Streaming API is not available');
  }

  const streamId = 'stream_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  let sseBuffer = '';
  let fullResponse = '';
  let fullReasoning = '';
  let responseStatus = 0;
  let settled = false;
  const streamedToolCalls = new Map<number, ToolCallPart>();

  let rafId: number | null = null;
  const scheduleStreamUpdate = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      applyStreamUpdate();
    });
  };

  const cleanupRaf = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const applyStreamUpdate = () => {
    if (settled) return;
    const visibleToolCalls = Array.from(streamedToolCalls.values())
      .filter((tc) => tc.name)
      .map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments || '{}',
      }));

    onUpdate({
      content: sanitizeAssistantDisplayContent(fullResponse),
      reasoningContent: fullReasoning ? sanitizeAssistantDisplayContent(fullReasoning) : undefined,
      toolCalls: visibleToolCalls.length > 0 ? visibleToolCalls : undefined,
      isStreaming: true,
    });
  };
  return new Promise<StreamedChatCompletion>((resolve, reject) => {
    const CHUNK_TIMEOUT_MS = 30_000;
    const TOTAL_TIMEOUT_MS = 300_000;
    let chunkTimer: NodeJS.Timeout | null = null;
    let totalTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      if (totalTimer) clearTimeout(totalTimer);
    };

    const resetChunkTimer = () => {
      if (chunkTimer) clearTimeout(chunkTimer);
      chunkTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          cleanupRaf();
          clearTimers();
          const err = new Error('Stream chunk timeout: 30s no data') as Error & { status?: number; partialContent?: string };
          err.status = responseStatus;
          err.partialContent = fullResponse;
          reject(err);
        }
      }, CHUNK_TIMEOUT_MS);
    };

    totalTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        const err = new Error('Stream total timeout: 5min exceeded') as Error & { status?: number; partialContent?: string };
        err.status = responseStatus;
        err.partialContent = fullResponse;
        reject(err);
      }
    }, TOTAL_TIMEOUT_MS);

    resetChunkTimer();

    const cleanup = electronSafe.onApiProxyStreamEvent((event) => {
      if (event.streamId !== streamId || settled) return;

      if (event.type === 'start') {
        responseStatus = event.status || 0;
        return;
      }

      if (event.type === 'error') {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        const err = new Error('API error: ' + (event.status || 0) + ' - ' + (event.body || '')) as Error & { status?: number; body?: string; partialContent?: string };
        err.status = event.status || 0;
        err.body = event.body || '';
        err.partialContent = fullResponse;
        reject(err);
        return;
      }

      if (event.type === 'chunk' && event.text) {
        resetChunkTimer();
        sseBuffer += event.text;
        const { frames, rest } = splitSseFrames(sseBuffer);
        sseBuffer = rest;

        for (const frame of frames) {
          const dataLines = frame.split('\n')
            .filter((line: string) => line.startsWith('data:'))
            .map((line: string) => line.slice(5).trimStart());

          for (const dataLine of dataLines) {
            if (dataLine === '[DONE]') {
              settled = true;
              cleanup();
              cleanupRaf();
              clearTimers();
              resolve({
                content: fullResponse,
                reasoningContent: fullReasoning,
                toolCalls: Array.from(streamedToolCalls.values())
                  .filter((tc) => tc.name)
                  .map((tc) => ({
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments || '{}',
                  })),
              });
              return;
            }

            try {
              const parsed = JSON.parse(dataLine);
              const choice = parsed.choices?.[0];
              const delta = choice?.delta || {};
              const contentDelta = delta.content || '';
              const reasoningDelta = delta.reasoning_content || delta.reasoning || '';
              let changed = false;

              if (contentDelta) {
                fullResponse += contentDelta;
                changed = true;
              }

              if (reasoningDelta) {
                fullReasoning += reasoningDelta;
                changed = true;
              }

              if (Array.isArray(delta.tool_calls)) {
                for (const toolDelta of delta.tool_calls) {
                  const idx = toolDelta.index ?? streamedToolCalls.size;
                  const existing = streamedToolCalls.get(idx) || {
                    id: toolDelta.id || 'tool_' + Date.now() + '_' + idx,
                    name: '',
                    arguments: '',
                  };
                  if (toolDelta.id) existing.id = toolDelta.id;
                  if (toolDelta.function?.name) existing.name += toolDelta.function.name;
                  if (toolDelta.function?.arguments) existing.arguments += toolDelta.function.arguments;
                  streamedToolCalls.set(idx, existing);
                  changed = true;
                }
              }

              if (delta.function_call) {
                const existing = streamedToolCalls.get(0) || {
                  id: 'tool_' + Date.now() + '_0',
                  name: '',
                  arguments: '',
                };
                if (delta.function_call.name) existing.name += delta.function_call.name;
                if (delta.function_call.arguments) existing.arguments += delta.function_call.arguments;
                streamedToolCalls.set(0, existing);
                changed = true;
              }

              if (changed) {
                scheduleStreamUpdate();
              }

              if (choice?.finish_reason && choice.finish_reason !== 'tool_calls') {
                continue;
              }
            } catch (parseErr) {
              console.warn('[Stream] Failed to parse SSE frame:', parseErr, dataLine);
            }
          }
        }
        return;
      }

      if (event.type === 'end') {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        resolve({
          content: fullResponse,
          reasoningContent: '',
          toolCalls: Array.from(streamedToolCalls.values())
            .filter((tc) => tc.name)
            .map((tc) => {
              let args = tc.arguments || '{}';
              const { parsed, repaired } = tryParseJson(args);
              if (repaired && parsed) {
                console.log('[JSON-Heal] Repaired malformed JSON for tool ' + tc.name);
                args = JSON.stringify(parsed);
              }
              return { id: tc.id, name: tc.name, arguments: args };
            }),
        });
      }
    });

    electronSafe.apiProxyStream({
      streamId,
      url: buildChatCompletionsUrl(baseURL),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': convId,
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(requestBody),
    }).then((apiResult) => {
      if (!settled && apiResult.status !== 200) {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        const err = new Error('API error: ' + apiResult.status + ' - ' + apiResult.body) as Error & { status?: number; body?: string; partialContent?: string };
        err.status = apiResult.status;
        err.body = apiResult.body;
        err.partialContent = fullResponse;
        reject(err);
      } else if (!settled && responseStatus === 200) {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        resolve({
          content: fullResponse,
          reasoningContent: fullReasoning,
          toolCalls: Array.from(streamedToolCalls.values())
            .filter((tc) => tc.name)
            .map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments || '{}',
            })),
        });
      }
    }).catch((err) => {
      if (!settled) {
        settled = true;
        cleanup();
        cleanupRaf();
        clearTimers();
        reject(err);
      }
    });
  });
}
