/**
 * Context compaction utility for PianoAgent.
 * Handles manual /compact command execution.
 */

import type { Conversation, ChatMessage } from '../types';
import type { Settings } from '../config/default-settings';
import { compactConversation } from './compactor';
import { buildChatCompletionsUrl } from '../../shared/api-endpoints';

export interface CompactionResult {
  conversations: Conversation[];
  success: boolean;
  error?: string;
}

/**
 * Run manual context compaction on a conversation.
 * Returns updated conversations array with compaction result message.
 */
export async function runCompaction(
  convId: string,
  conversations: Conversation[],
  apiSettings: Settings,
  getActiveBranchMessages: (conv: Conversation | null) => ChatMessage[],
): Promise<CompactionResult> {
  const conv = conversations.find((c) => c.id === convId);
  if (!conv) return { conversations, success: false, error: "Conversation not found" };

  const activeBranch = getActiveBranchMessages(conv);
  const beforeChars = activeBranch.reduce((sum, m) => sum + (m.content || "").length, 0);

  try {
    const compactedConv = await compactConversation(
      conv,
      activeBranch,
      async (prompt: string) => {
        if (!window.electronAPI?.apiProxy) throw new Error('Electron API is not available');
        const apiResult = await window.electronAPI.apiProxy({
          url: buildChatCompletionsUrl(apiSettings.baseURL),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiSettings.apiKey,
            'X-Session-Id': convId,
          },
          body: JSON.stringify({
            model: apiSettings.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            prompt_cache_key: convId.slice(0, 64),
          }),
        });
        if (apiResult.status !== 200) throw new Error('API error: ' + apiResult.status + ' - ' + apiResult.body);
        return JSON.parse(apiResult.body).choices?.[0]?.message?.content || '';
      }
    );

    const afterChars = compactedConv.messages.reduce((sum, m) => sum + (m.content || "").length, 0);
    const savedChars = beforeChars - afterChars;

    const successMsg: ChatMessage = {
      id: 'msg_compact_success_' + Date.now(),
      role: 'assistant',
      content: '\ud83d\udce6 **\u4e0a\u4e0b\u6587\u624b\u52a8\u538b\u7f29\u6210\u529f!** \u5df2\u5728\u4e0a\u65b9\u751f\u6210\u5386\u53f2\u6280\u672f\u6458\u8981\u8282\u70b9\uff0c\u540e\u7eed\u5bf9\u8bdd\u5c06\u57fa\u4e8e\u6b64\u538b\u7f29\u540e\u7684\u4e0a\u4e0b\u6587\u7ee7\u7eed\u3002\n\n\u538b\u7f29\u524d: ' + beforeChars.toLocaleString() + ' \u5b57\u7b26 \u2192 \u538b\u7f29\u540e: ' + afterChars.toLocaleString() + ' \u5b57\u7b26 (\u8282\u7701 ' + savedChars.toLocaleString() + ' \u5b57\u7b26)',
      timestamp: Date.now(),
      parentId: compactedConv.activeMessageId,
    };

    const finalConv = {
      ...compactedConv,
      messages: [...compactedConv.messages, successMsg],
      activeMessageId: successMsg.id,
      updatedAt: Date.now(),
    };

    return {
      conversations: conversations.map((c) => c.id === convId ? finalConv : c),
      success: true,
    };
  } catch (err: any) {
    console.error('[Compaction] Failed:', err);
    const errorMsg: ChatMessage = {
      id: 'msg_compact_err_' + Date.now(),
      role: 'assistant',
      content: '\u274c **\u4e0a\u4e0b\u6587\u538b\u7f29\u5931\u8d25**:' + (err.message || err),
      timestamp: Date.now(),
    };
    return {
      conversations: conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, errorMsg], activeMessageId: errorMsg.id, updatedAt: Date.now() } : c
      ),
      success: false,
      error: err.message || String(err),
    };
  }
}
