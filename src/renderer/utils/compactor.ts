import { Conversation, ChatMessage, ToolCall } from '../types';

/**
 * Extracts a unique list of file paths that were edited or created in the given messages.
 */
function extractEditedFiles(messages: ChatMessage[]): string[] {
  const files = new Set<string>();
  
  for (const m of messages) {
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        if (tc.name === 'write' || tc.name === 'edit') {
          try {
            const args = JSON.parse(tc.arguments);
            if (args.file_path) {
              files.add(args.file_path);
            }
          } catch {
            // Ignore JSON parsing issues
          }
        }
      }
    }
  }
  
  return Array.from(files);
}

/**
 * Summarizes the older section of the active branch messages and inserts a single summary node.
 * Rewires the active branch to start from the summary node.
 */
export async function compactConversation(
  conversation: Conversation,
  activeBranch: ChatMessage[],
  callLLM: (prompt: string) => Promise<string>,
  keepCount = 12
): Promise<Conversation> {
  if (activeBranch.length <= keepCount + 2) {
    // Too few messages to warrant compaction
    return conversation;
  }

  const splitIndex = activeBranch.length - keepCount;
  const messagesToSummarize = activeBranch.slice(0, splitIndex);
  const messagesToKeep = activeBranch.slice(splitIndex);

  console.log(`[Compactor] Compacting ${messagesToSummarize.length} messages, keeping ${messagesToKeep.length} messages.`);

  // 1. Extract edited files list
  const editedFiles = extractEditedFiles(messagesToSummarize);
  const fileListText = editedFiles.length > 0
    ? `以下是在此部分历史对话中被编辑或创建的文件列表：\n${editedFiles.map(f => `- ${f}`).join('\n')}\n\n`
    : '';

  // 2. Format history for the LLM
  const historyText = messagesToSummarize
    .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n\n');

  let summary = '';
  try {
    const prompt = `你是一个高级系统架构师和AI助手上下文压缩器。请为以下历史对话进行高密度的技术总结。
  要求：
  1. 提取并总结出此段对话中达成的核心技术方案、系统架构决策以及代码库的重要状态变更。
  2. 语言必须极其简练，保留关键的文件路径、修改逻辑和技术栈信息。
  3. 如果在此部分对话中编辑或创建了文件，请在总结的最后列出文件清单。
  ${fileListText}需要总结的对话内容如下：
  ${historyText}`;
      summary = await callLLM(prompt);
  } catch (err: any) {
    console.error('[Compactor] LLM summarization failed:', err);
    throw new Error(`Context compaction failed during summarization: ${err.message || err}`);
  }

  if (!summary || summary.trim().length === 0) {
    throw new Error('Context compaction returned an empty summary');
  }

  // 4. Create summary message node
  const summaryMsgId = `compaction_summary_${Date.now()}`;
  const rootParentId = messagesToSummarize[0].parentId; // Connect to whatever was before the compaction

  const summaryMsg: ChatMessage = {
    id: summaryMsgId,
    role: 'system',
    content: `📝 **[历史对话已压缩]**\n\n${summary}`,
    timestamp: Date.now(),
    parentId: rootParentId,
  };

  // 5. Rewire the parentId of the first kept message to point to the summary Msg
  const firstKeptMsg = messagesToKeep[0];
  const updatedFirstKeptMsg = {
    ...firstKeptMsg,
    parentId: summaryMsgId,
  };

  // 6. Assemble the new messages list
  // We remove the old summarized messages from the conversation and insert the summary node.
  // We keep all other messages in the conversation that are NOT part of the summarized branch segment 
  // (to preserve alternate sibling branches!).
  // IMPORTANT: Do NOT remove messages that are still referenced as parentId by other messages,
  // as that would break the tree structure for alternate branches.
  const summarizedIds = new Set(messagesToSummarize.map(m => m.id));
  const parentIds = new Set(conversation.messages.filter(m => m.parentId).map(m => m.parentId!));
  
  const filteredMessages = conversation.messages.filter(m => {
    if (!summarizedIds.has(m.id)) return true;
    // Keep this message if another message still references it as parent
    return parentIds.has(m.id);
  });
  
  // Replace the first kept message with its updated parentId version
  const finalMessages = filteredMessages.map(m => {
    if (m.id === firstKeptMsg.id) {
      return updatedFirstKeptMsg;
    }
    return m;
  });

  // Append the summary node
  finalMessages.push(summaryMsg);

  console.log(`[Compactor] Successfully compacted conversation tree. Total messages count reduced from ${conversation.messages.length} to ${finalMessages.length}.`);

  return {
    ...conversation,
    messages: finalMessages,
    updatedAt: Date.now(),
  };
}
