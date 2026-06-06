/**
 * Auto Reasoning - 智能推理强度自动调节系统
 * 使用 LLM 自分析任务难度，自动调整推理参数
 */

export interface ReasoningParams {
  temperature: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  maxTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high';
}

export interface TaskAnalysis {
  difficulty: 'easy' | 'medium' | 'hard';
  category: 'code' | 'creative' | 'analysis' | 'conversation' | 'math' | 'writing';
  confidence: number; // 0-1
  suggestedParams: ReasoningParams;
  reasoning: string;
}

/**
 * 使用 LLM 分析任务难度
 */
export async function analyzeTaskWithLLM(
  input: string,
  callLLM: (prompt: string) => Promise<string>
): Promise<TaskAnalysis> {
  const prompt = `你是一个任务分析专家。请分析以下用户输入的任务，判断其难度和类别。

用户输入:
"""
${input}
"""

请严格按照以下 JSON 格式返回分析结果，不要包含任何其他内容:

{
  "difficulty": "easy 或 medium 或 hard",
  "category": "code 或 creative 或 analysis 或 conversation 或 math 或 writing",
  "reasoning": "简要说明你的判断依据"
}

难度判断标准:
- easy: 简单问题、日常对话、基础概念、短问题
- medium: 中等复杂度、需要一定思考、代码实现、文档写作
- hard: 复杂问题、需要深度思考、架构设计、算法分析、多步骤任务

类别判断标准:
- code: 编程、代码、开发、调试、重构
- creative: 创意、设计、写作、故事、营销
- analysis: 分析、评估、研究、对比、审计
- conversation: 对话、闲聊、问候、推荐
- math: 数学、计算、证明、公式
- writing: 文档、报告、文章、教程、邮件`;

  try {
    const response = await callLLM(prompt);
    
    // 解析 JSON 响应
    let parsed: any;
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.warn('[AutoReasoning] Failed to parse LLM response, using defaults');
      return getDefaultAnalysis(input);
    }
    
    // 验证并规范化结果
    const difficulty = validateDifficulty(parsed.difficulty);
    const category = validateCategory(parsed.category);
    const reasoning = parsed.reasoning || 'LLM 分析';
    
    // 根据分析结果生成参数
    const suggestedParams = generateParams(difficulty, category);
    
    return {
      difficulty,
      category,
      confidence: 0.85, // LLM 分析的置信度较高
      suggestedParams,
      reasoning
    };
  } catch (error) {
    console.error('[AutoReasoning] LLM analysis failed:', error);
    return getDefaultAnalysis(input);
  }
}

/**
 * 快速分析（不需要 LLM，用于 fallback）
 */
export function analyzeTaskQuick(input: string): TaskAnalysis {
  const lowerInput = input.toLowerCase();
  
  // 简单的规则判断
  let difficulty: TaskAnalysis['difficulty'] = 'medium';
  let category: TaskAnalysis['category'] = 'conversation';
  
  // 难度判断
  const easyIndicators = ['你好', 'hello', 'hi', '谢谢', '什么是', '简单'];
  const hardIndicators = ['架构', '算法', '设计模式', '优化', '分析', '对比', '评估'];
  
  const easyCount = easyIndicators.filter(k => lowerInput.includes(k)).length;
  const hardCount = hardIndicators.filter(k => lowerInput.includes(k)).length;
  
  if (easyCount > hardCount && easyCount > 0) {
    difficulty = 'easy';
  } else if (hardCount > easyCount && hardCount > 0) {
    difficulty = 'hard';
  }
  
  // 类别判断
  if (/[{}();]/.test(input) || /代码|函数|组件|class|function/.test(lowerInput)) {
    category = 'code';
  } else if (/数学|计算|积分|公式|证明/.test(lowerInput)) {
    category = 'math';
  } else if (/分析|评估|研究|对比/.test(lowerInput)) {
    category = 'analysis';
  } else if (/创意|设计|故事|写作/.test(lowerInput)) {
    category = 'creative';
  } else if (/文档|报告|文章|教程/.test(lowerInput)) {
    category = 'writing';
  }
  
  const suggestedParams = generateParams(difficulty, category);
  
  return {
    difficulty,
    category,
    confidence: 0.6, // 快速分析的置信度较低
    suggestedParams,
    reasoning: '快速规则分析'
  };
}

/**
 * 根据难度和类别生成参数
 */
function generateParams(difficulty: TaskAnalysis['difficulty'], category: TaskAnalysis['category']): ReasoningParams {
  // 基础参数（按难度）
  const baseParams: Record<TaskAnalysis['difficulty'], ReasoningParams> = {
    easy: {
      temperature: 0.3,
      topP: 0.5,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 2048,
      reasoningEffort: 'low'
    },
    medium: {
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 4096,
      reasoningEffort: 'medium'
    },
    hard: {
      temperature: 0.3,
      topP: 0.5,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxTokens: 8192,
      reasoningEffort: 'high'
    }
  };
  
  const params = { ...baseParams[difficulty] };
  
  // 根据类别微调
  switch (category) {
    case 'code':
      params.temperature = Math.max(params.temperature - 0.2, 0);
      params.topP = Math.max(params.topP - 0.3, 0.1);
      params.maxTokens = Math.max(params.maxTokens, 4096);
      break;
      
    case 'creative':
      params.temperature = Math.min(params.temperature + 0.3, 1.5);
      params.topP = Math.min(params.topP + 0.1, 1);
      params.frequencyPenalty = 0.3;
      params.presencePenalty = 0.3;
      break;
      
    case 'analysis':
      params.temperature = 0.4;
      params.topP = 0.7;
      params.reasoningEffort = 'high';
      break;
      
    case 'math':
      params.temperature = 0;
      params.topP = 0.1;
      params.reasoningEffort = 'high';
      break;
      
    case 'writing':
      params.temperature = 0.6;
      params.topP = 0.8;
      params.maxTokens = Math.max(params.maxTokens, 8192);
      break;
      
    case 'conversation':
      params.temperature = 0.7;
      params.topP = 0.9;
      params.maxTokens = 2048;
      break;
  }
  
  return params;
}

/**
 * 验证难度值
 */
function validateDifficulty(value: any): TaskAnalysis['difficulty'] {
  const validValues = ['easy', 'medium', 'hard'];
  return validValues.includes(value) ? value : 'medium';
}

/**
 * 验证类别值
 */
function validateCategory(value: any): TaskAnalysis['category'] {
  const validValues = ['code', 'creative', 'analysis', 'conversation', 'math', 'writing'];
  return validValues.includes(value) ? value : 'conversation';
}

/**
 * 获取默认分析结果
 */
function getDefaultAnalysis(input: string): TaskAnalysis {
  const difficulty: TaskAnalysis['difficulty'] = 'medium';
  const category: TaskAnalysis['category'] = 'conversation';
  
  return {
    difficulty,
    category,
    confidence: 0.5,
    suggestedParams: generateParams(difficulty, category),
    reasoning: '默认分析（LLM 不可用）'
  };
}

/**
 * 应用自动推理参数
 */
export async function applyAutoReasoning(
  input: string,
  currentParams: Partial<ReasoningParams>,
  callLLM?: (prompt: string) => Promise<string>
): Promise<{ params: ReasoningParams; analysis: TaskAnalysis }> {
  let analysis: TaskAnalysis;
  
  if (callLLM) {
    // 使用 LLM 分析（更准确）
    analysis = await analyzeTaskWithLLM(input, callLLM);
  } else {
    // 使用快速分析（fallback）
    analysis = analyzeTaskQuick(input);
  }
  
  // 合并参数（用户设置优先）
  const params: ReasoningParams = {
    temperature: currentParams.temperature ?? analysis.suggestedParams.temperature,
    topP: currentParams.topP ?? analysis.suggestedParams.topP,
    frequencyPenalty: currentParams.frequencyPenalty ?? analysis.suggestedParams.frequencyPenalty,
    presencePenalty: currentParams.presencePenalty ?? analysis.suggestedParams.presencePenalty,
    maxTokens: currentParams.maxTokens ?? analysis.suggestedParams.maxTokens,
    reasoningEffort: currentParams.reasoningEffort ?? analysis.suggestedParams.reasoningEffort
  };
  
  return { params, analysis };
}

/**
 * 获取推理强度描述
 */
export function getReasoningDescription(params: ReasoningParams): string {
  const parts: string[] = [];
  
  if (params.temperature < 0.3) {
    parts.push('精确模式');
  } else if (params.temperature < 0.7) {
    parts.push('平衡模式');
  } else {
    parts.push('创意模式');
  }
  
  if (params.reasoningEffort === 'high') {
    parts.push('深度思考');
  } else if (params.reasoningEffort === 'low') {
    parts.push('快速响应');
  }
  
  return parts.join(' · ');
}

/**
 * 生成参数预览
 */
export function formatParamsPreview(params: ReasoningParams): string {
  return [
    `Temp: ${params.temperature.toFixed(1)}`,
    `TopP: ${params.topP.toFixed(2)}`,
    `推理: ${params.reasoningEffort === 'low' ? '快速' : params.reasoningEffort === 'medium' ? '平衡' : '深度'}`,
    `Tokens: ${params.maxTokens}`
  ].join(' | ');
}
