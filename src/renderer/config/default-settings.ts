import type { Skill } from '../types';
import type { McpServerConfig } from '../components/settings/McpConfig';

export interface ModelProfile {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  reasoningEffort?: 'none' | 'auto' | 'low' | 'medium' | 'high';
  temperature?: number;
  maxTokens?: number;
}

export interface Settings {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  reasoningEffort?: 'none' | 'auto' | 'low' | 'medium' | 'high';
  customSystemPrompt?: string;
  skills: Skill[];
  enabledTools?: {
    read: boolean;
    bash: boolean;
    edit: boolean;
    write: boolean;
  };
  mcpServers?: McpServerConfig[];
  sandboxType?: 'none' | 'docker' | 'guard';
  dangerousKeywords?: string;
  autoResumeGoals?: boolean;
  autoResumeDelaySeconds?: number;
  goalSchedulerMaxConcurrent?: number;
  autoCompactionThreshold?: number;
  agentName?: string;
  accentColor?: string;
  interfaceDensity?: 'comfortable' | 'compact' | 'minimalist';
  bubbleStyle?: 'flat' | 'glow' | 'glass';
  agentAvatar?: string;
  themePreset?: 'custom' | 'pi-violet' | 'nordic-slate' | 'ocean-breeze' | 'zen-garden' | 'amber-hacker' | 'sakura-twilight';
  modelProfiles?: ModelProfile[];
  activeModelProfileId?: string;
  trustMode?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  temperature: 0.7,
  maxTokens: 4096,
  trustMode: true,
  topP: 0.9,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: 'medium',
  customSystemPrompt: '',
  skills: [
    {
      id: 'skill_review',
      name: '代码审查专家',
      description: '对生成的代码实施极为苛刻的单测与安全审查，规避潜在缺陷。',
      enabled: false,
      prompt: 'Perform detailed code audits on every solution, calling out potential memory leaks, security holes, and performance degradation.',
    }
  ],
  enabledTools: {
    read: true,
    bash: true,
    edit: true,
    write: true,
  },
  mcpServers: [],
  sandboxType: 'guard',
  dangerousKeywords: 'rm ,del ,format,rd ,rmdir ,shutdown',
  autoResumeGoals: false,
  autoResumeDelaySeconds: 8,
  goalSchedulerMaxConcurrent: 1,
  autoCompactionThreshold: 12000,
  agentName: 'PianoAgent',
  accentColor: '#8b5cf6',
  interfaceDensity: 'comfortable',
  bubbleStyle: 'glow',
  agentAvatar: '🤖',
  themePreset: 'pi-violet',
  modelProfiles: [
    {
      id: 'profile_default',
      name: '默认配置 (deepseek-v4-flash)',
      baseURL: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'medium',
      temperature: 0.7,
      maxTokens: 4096,
    }
  ],
  activeModelProfileId: 'profile_default',
};
