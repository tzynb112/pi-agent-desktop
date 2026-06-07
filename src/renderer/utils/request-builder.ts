/**
 * API request body builder for PianoAgent.
 * Handles tool selection, auto-reasoning params, and request construction.
 */

import type { Settings } from '../config/default-settings';
import { TOOLS_DEFINITION } from '../config/tools';
import { applyAutoReasoning } from './auto-reasoning';

export interface BuildRequestOptions {
  apiSettings: Settings;
  trimmedMessages: Array<{ role: string; content: string }>;
  mcpTools: any[];
  convId: string;
  /** Optional LLM call function for auto-reasoning analysis */
  analysisCallLLM?: (prompt: string) => Promise<string>;
}

export interface BuiltRequest {
  body: Record<string, unknown>;
  autoAnalysis?: unknown;
}

/**
 * Build the API request body with tools, auto-reasoning, and all parameters.
 */
export async function buildRequestBody(options: BuildRequestOptions): Promise<BuiltRequest> {
  const { apiSettings, trimmedMessages, mcpTools, convId, analysisCallLLM } = options;

  // 1. Filter enabled built-in tools
  const enabledToolsConf = { read: true, bash: true, edit: true, write: true, ...(apiSettings.enabledTools || {}) };
  const activeTools = TOOLS_DEFINITION.filter((t) => {
    const name = t.function.name;
    if (Object.prototype.hasOwnProperty.call(enabledToolsConf, name)) {
      return !!(enabledToolsConf as Record<string, boolean>)[name];
    }
    return true;
  });

  // 2. Append MCP tools
  const activeMcpTools = (mcpTools || []).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));

  const finalTools = [...activeTools, ...activeMcpTools];

  // 3. Auto reasoning: analyze task and adjust params
  let finalTemperature = apiSettings.temperature;
  let finalTopP = apiSettings.topP;
  let finalFrequencyPenalty = apiSettings.frequencyPenalty;
  let finalPresencePenalty = apiSettings.presencePenalty;
  let finalMaxTokens = apiSettings.maxTokens;
  let finalReasoningEffort = apiSettings.reasoningEffort;
  let autoAnalysis: unknown;

  if (apiSettings.reasoningEffort === 'auto' || !apiSettings.reasoningEffort) {
    const lastUserMessage = trimmedMessages.filter((m) => m.role === 'user').pop();

    if (lastUserMessage && analysisCallLLM) {
      try {
        const { params, analysis } = await applyAutoReasoning(
          lastUserMessage.content,
          {
            temperature: apiSettings.temperature,
            topP: apiSettings.topP,
            frequencyPenalty: apiSettings.frequencyPenalty,
            presencePenalty: apiSettings.presencePenalty,
            maxTokens: apiSettings.maxTokens,
            reasoningEffort: apiSettings.reasoningEffort === 'auto' ? undefined : apiSettings.reasoningEffort,
          },
          analysisCallLLM,
        );

        finalTemperature = params.temperature;
        finalTopP = params.topP;
        finalFrequencyPenalty = params.frequencyPenalty;
        finalPresencePenalty = params.presencePenalty;
        finalMaxTokens = params.maxTokens;
        finalReasoningEffort = params.reasoningEffort;
        autoAnalysis = analysis;

        console.log('[AutoReasoning] Task analysis:', analysis);
      } catch (err) {
        console.warn('[AutoReasoning] Failed, using defaults:', err);
      }
    }
  }

  // 4. Build request body
  const body: Record<string, unknown> = {
    model: apiSettings.model,
    messages: trimmedMessages,
    stream: true,
    prompt_cache_key: convId.slice(0, 64),
  };

  if (finalTools.length > 0) body.tools = finalTools;
  if (finalTemperature !== undefined) body.temperature = finalTemperature;
  if (finalMaxTokens !== undefined) body.max_tokens = finalMaxTokens;
  if (finalTopP !== undefined) body.top_p = finalTopP;
  if (finalFrequencyPenalty !== undefined) body.frequency_penalty = finalFrequencyPenalty;
  if (finalPresencePenalty !== undefined) body.presence_penalty = finalPresencePenalty;
  if (finalReasoningEffort && finalReasoningEffort !== 'auto') {
    body.reasoning_effort = finalReasoningEffort as 'low' | 'medium' | 'high';
  }

  return { body, autoAnalysis };
}
