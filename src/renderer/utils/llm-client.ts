import { electronSafe } from './electron-safe';

export interface ChatMessageLike {
  role: string;
  content: string;
}

export interface CallLLMOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessageLike[];
  temperature?: number;
  maxTokens?: number;
  convId: string;
}

export async function callLLMApi({
  baseURL,
  apiKey,
  model,
  messages,
  temperature = 0.3,
  maxTokens,
  convId,
}: CallLLMOptions): Promise<string> {
  const body: any = {
    model,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    temperature,
    prompt_cache_key: convId.slice(0, 64),
  };
  
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }

  const apiResult = await electronSafe.apiProxy({
    url: `${baseURL}/chat/completions`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Session-Id': convId,
    },
    body: JSON.stringify(body),
  });

  if (apiResult.status !== 200) {
    throw new Error(`API error: ${apiResult.status} - ${apiResult.body}`);
  }

  const parsed = JSON.parse(apiResult.body);
  return parsed.choices?.[0]?.message?.content || '';
}
