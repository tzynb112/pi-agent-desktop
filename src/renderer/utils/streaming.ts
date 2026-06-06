/**
 * SSE Streaming utilities for PianoAgent.
 * Handles Server-Sent Events parsing, retry logic, and stream lifecycle.
 */

import type { ToolCall } from '../types';

/** Parsed streaming API response */
export interface StreamedChatCompletion {
  content: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
}

/** In-progress tool call being assembled from deltas */
export interface ToolCallPart {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Split a raw SSE buffer into complete frames and remaining partial data.
 * SSE frames are separated by double newlines.
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return {
    frames: parts.slice(0, -1),
    rest: parts[parts.length - 1] || '',
  };
}

/**
 * Check if an HTTP status code is retryable.
 * Retryable: network failures (0), rate limits (429), server errors (500-504).
 */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Calculate retry delay with exponential backoff and jitter.
 * Starts at 1s, caps at 8s. Adds random jitter to avoid thundering herd.
 */
export function getRetryDelay(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
  const jitter = Math.random() * 500; // 0-500ms jitter
  return base + jitter;
}

/**
 * Get a human-readable description of why a retry is happening.
 */
export function getRetryReason(status: number): string {
  switch (status) {
    case 0: return '网络连接失败';
    case 429: return '请求频率限制';
    case 500: return '服务器内部错误';
    case 502: return '网关错误';
    case 503: return '服务暂不可用';
    case 504: return '网关超时';
    default: return `HTTP ${status}`;
  }
}
