export function looksLikeCompletionResponse(response: string): boolean {
  const normalized = response.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  return /(\bgoal completed\b|\btask completed\b|\bcompleted\b|\bcomplete\b|\bdone\b|\bfinished\b|\bsummary\b|\bfinal\b|\bresult\b|no tool actions were needed|已完成|完成了|任务完成|总结|汇总|结果如下|最终|收尾|结束)/i.test(normalized);
}

export function buildNoToolCallHint(contextLine: string, response: string, attempt: number): string {
  const trimmedResponse = response.trim().slice(0, 500) || '(empty)';
  const normalizedContextLine = contextLine.trim();

  return [
    'No XML tool call was emitted in the previous assistant response, and the task is not complete yet.',
    'A structure or outline is not enough.',
    'Do not stop at a structure, outline, or architecture summary.',
    '',
    normalizedContextLine,
    '',
    'Previous assistant response:',
    trimmedResponse,
    '',
    'You must now either:',
    '1. Emit exactly one XML tool call (<read>, <write>, <edit>, or <bash>) for the next concrete step, or',
    '2. If you are truly finished, provide a concise completion summary only.',
    '',
    'Do not output explanatory prose without a tool call.',
    `This is no-tool-call attempt #${attempt + 1}.`,
  ].filter(Boolean).join('\n');
}
