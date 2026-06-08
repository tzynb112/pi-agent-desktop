import React, { useState, useEffect } from 'react';
import { X, Save, RotateCcw, Settings as SettingsIcon, Puzzle, Cpu, Shield, Sparkles, FileText, Package } from 'lucide-react';
import SkillsConfig from './SkillsConfig';
import McpConfig, { McpServerConfig } from './McpConfig';
import PromptTemplatesConfig from './PromptTemplatesConfig';
import PackageManager from './PackageManager';
import type { Skill } from '../../types';
import { Settings, DEFAULT_SETTINGS, ModelProfile } from '../../config/default-settings';


const COMMON_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'gpt-5.5-instant',
  'gpt-5.5-cyber',
  'gpt-5.4-mini',
  'claude-sonnet-4.6',
  'claude-opus-4.8',
  'claude-haiku-4.5',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: Settings) => void;
  rootPath?: string | null;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, rootPath }) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'api' | 'skills' | 'mcp' | 'safety' | 'aesthetic' | 'templates' | 'packages'>('api');

  useEffect(() => {
    const savedSettings = localStorage.getItem('piano-settings');
    let loadedSettings = DEFAULT_SETTINGS;
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        loadedSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          enabledTools: {
            ...DEFAULT_SETTINGS.enabledTools,
            ...(parsed.enabledTools || {}),
          },
          skills: parsed.skills ?? DEFAULT_SETTINGS.skills,
          mcpServers: parsed.mcpServers ?? DEFAULT_SETTINGS.mcpServers,
          sandboxType: parsed.sandboxType ?? DEFAULT_SETTINGS.sandboxType,
          dangerousKeywords: parsed.dangerousKeywords ?? DEFAULT_SETTINGS.dangerousKeywords,
          autoResumeGoals: parsed.autoResumeGoals ?? DEFAULT_SETTINGS.autoResumeGoals,
          autoResumeDelaySeconds: parsed.autoResumeDelaySeconds ?? DEFAULT_SETTINGS.autoResumeDelaySeconds,
          goalSchedulerMaxConcurrent: parsed.goalSchedulerMaxConcurrent ?? DEFAULT_SETTINGS.goalSchedulerMaxConcurrent,
          autoCompactionThreshold: parsed.autoCompactionThreshold ?? DEFAULT_SETTINGS.autoCompactionThreshold,
          trustMode: parsed.trustMode ?? DEFAULT_SETTINGS.trustMode,
        };

        // Auto-initialize profiles if empty or missing
        if (!loadedSettings.modelProfiles || loadedSettings.modelProfiles.length === 0) {
          const defaultProfile: ModelProfile = {
            id: 'profile_default',
            name: '默认配置 (' + (loadedSettings.model || 'Unknown') + ')',
            baseURL: loadedSettings.baseURL || DEFAULT_SETTINGS.baseURL,
            apiKey: loadedSettings.apiKey || DEFAULT_SETTINGS.apiKey,
            model: loadedSettings.model || DEFAULT_SETTINGS.model,
            reasoningEffort: loadedSettings.reasoningEffort || DEFAULT_SETTINGS.reasoningEffort,
            temperature: loadedSettings.temperature || DEFAULT_SETTINGS.temperature,
            maxTokens: loadedSettings.maxTokens || DEFAULT_SETTINGS.maxTokens,
          };
          loadedSettings.modelProfiles = [defaultProfile];
          loadedSettings.activeModelProfileId = 'profile_default';
        }
      } catch {
        loadedSettings = DEFAULT_SETTINGS;
      }
    }

    if (!isOpen || !window.electronAPI) {
      setSettings(loadedSettings);
      return;
    }

    const scanSkillsFromDir = async (dirPath: string, prefix: string, source: 'global' | 'project'): Promise<Skill[]> => {
      const scanned: Skill[] = [];
      try {
        const entries = await window.electronAPI!.readDirectory(dirPath);
        const folders = entries.filter((e) => e.isDirectory);
        for (const folder of folders) {
          const skillMdPath = `${folder.path}\\SKILL.md`;
          const content = await window.electronAPI!.readFile(skillMdPath);
          if (content) {
            const fmMatch = /^\s*---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/.exec(content);
            let name = folder.name;
            let description = source === 'global' ? 'Global Pi Skill' : 'Project Skill';
            let prompt = content;
            if (fmMatch) {
              const fm = fmMatch[1];
              prompt = fmMatch[2].trim();
              const nameMatch = /name:\s*(.*)/.exec(fm);
              const descMatch = /description:\s*(.*)/.exec(fm);
              if (nameMatch) name = nameMatch[1].trim();
              if (descMatch) description = descMatch[1].trim();
            }
            const baseDirNormalized = folder.path.replace(/\\/g, '/');
            const resolvedPrompt = prompt.replace(/{baseDir}/g, baseDirNormalized);
            scanned.push({
              id: `${source}_skill_${folder.name}`,
              name: `${prefix} ${name}`,
              description,
              enabled: false,
              prompt: resolvedPrompt,
            });
          }
        }
      } catch {
        // Directory may not exist — that's fine
      }
      return scanned;
    };

    const scanAllSkills = async () => {
      try {
        const globalSkills = await scanSkillsFromDir('C:\\Users\\Administrator\\.pi\\agent\\skills', '🌐', 'global');
        const projectSkills = rootPath
          ? await scanSkillsFromDir(`${rootPath}\\.piano\\skills`, '📂', 'project')
          : [];
        const allScanned = [...globalSkills, ...projectSkills];
        console.log(`[SettingsModal] Found ${globalSkills.length} global + ${projectSkills.length} project skills`);

        const currentSkills = loadedSettings.skills ?? [];
        const mergedSkills = [...currentSkills];
        for (const ss of allScanned) {
          const idx = mergedSkills.findIndex((s) => s.id === ss.id);
          if (idx === -1) {
            mergedSkills.push(ss);
          } else {
            mergedSkills[idx] = { ...mergedSkills[idx], name: ss.name, description: ss.description, prompt: ss.prompt };
          }
        }
        setSettings({ ...loadedSettings, skills: mergedSkills });
      } catch (err) {
        console.error('[SettingsModal] Error scanning skills:', err);
        setSettings(loadedSettings);
      }
    };

    scanAllSkills();
  }, [isOpen]);

  // Synchronized Profile & Root Field Updater
  const updateProfileAndRoot = (updates: Partial<Settings>) => {
    const updatedProfiles = (settings.modelProfiles || []).map((p) => {
      if (p.id === settings.activeModelProfileId) {
        const profileUpdates: any = {};
        if (updates.apiKey !== undefined) profileUpdates.apiKey = updates.apiKey;
        if (updates.baseURL !== undefined) profileUpdates.baseURL = updates.baseURL;
        if (updates.model !== undefined) profileUpdates.model = updates.model;
        if (updates.reasoningEffort !== undefined) profileUpdates.reasoningEffort = updates.reasoningEffort;
        if (updates.temperature !== undefined) profileUpdates.temperature = updates.temperature;
        if (updates.maxTokens !== undefined) profileUpdates.maxTokens = updates.maxTokens;
        return { ...p, ...profileUpdates };
      }
      return p;
    });
    setSettings({
      ...settings,
      ...updates,
      modelProfiles: updatedProfiles,
    });
  };

  const handleSelectProfile = (profileId: string) => {
    const profile = (settings.modelProfiles || []).find((p) => p.id === profileId);
    if (!profile) return;

    setSettings({
      ...settings,
      activeModelProfileId: profileId,
      apiKey: profile.apiKey,
      baseURL: profile.baseURL,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort || 'medium',
      temperature: profile.temperature !== undefined ? profile.temperature : 0.7,
      maxTokens: profile.maxTokens !== undefined ? profile.maxTokens : 4096,
    });
  };

  const handleAddProfile = () => {
    const newProfile: ModelProfile = {
      id: `profile_${Date.now()}`,
      name: '新模型配置',
      baseURL: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'medium',
      temperature: 0.7,
      maxTokens: 4096,
    };

    setSettings({
      ...settings,
      modelProfiles: [...(settings.modelProfiles || []), newProfile],
      activeModelProfileId: newProfile.id,
      apiKey: newProfile.apiKey,
      baseURL: newProfile.baseURL,
      model: newProfile.model,
      reasoningEffort: newProfile.reasoningEffort,
      temperature: newProfile.temperature,
      maxTokens: newProfile.maxTokens,
    });
  };

  const handleDeleteProfile = (profileId: string) => {
    const remaining = (settings.modelProfiles || []).filter((p) => p.id !== profileId);
    if (remaining.length === 0) return;

    let nextActiveId = settings.activeModelProfileId;
    let nextSettingsUpdates = {};

    if (settings.activeModelProfileId === profileId) {
      const nextProfile = remaining[0];
      nextActiveId = nextProfile.id;
      nextSettingsUpdates = {
        apiKey: nextProfile.apiKey,
        baseURL: nextProfile.baseURL,
        model: nextProfile.model,
        reasoningEffort: nextProfile.reasoningEffort || 'medium',
        temperature: nextProfile.temperature !== undefined ? nextProfile.temperature : 0.7,
        maxTokens: nextProfile.maxTokens !== undefined ? nextProfile.maxTokens : 4096,
      };
    }

    setSettings({
      ...settings,
      ...nextSettingsUpdates,
      modelProfiles: remaining,
      activeModelProfileId: nextActiveId,
    });
  };

  const handleProfileNameChange = (profileId: string, newName: string) => {
    setSettings({
      ...settings,
      modelProfiles: (settings.modelProfiles || []).map((p) =>
        p.id === profileId ? { ...p, name: newName } : p
      ),
    });
  };

  const handleSave = () => {
    localStorage.setItem('piano-settings', JSON.stringify(settings));
    onSave(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem('piano-settings');
  };

  // Custom Skills Handlers
  const handleSkillToggle = (id: string) => {
    setSettings({
      ...settings,
      skills: (settings.skills ?? []).map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    });
  };

  const handleSkillAdd = () => {
    const newSkill: Skill = {
      id: `skill_${Date.now()}`,
      name: '新技能',
      description: '简要描述该技能的作用。',
      enabled: false,
      prompt: '作为该技能启用时附加的系统级提示词内容。',
    };
    setSettings({
      ...settings,
      skills: [...(settings.skills ?? []), newSkill],
    });
  };

  const handleSkillDelete = (id: string) => {
    setSettings({
      ...settings,
      skills: (settings.skills ?? []).filter((s) => s.id !== id),
    });
  };

  const handleSkillFieldChange = (id: string, field: 'name' | 'description' | 'prompt', value: string) => {
    setSettings({
      ...settings,
      skills: (settings.skills ?? []).map((s) =>
        s.id === id ? { ...s, [field]: value } : s
      ),
    });
  };

  // MCP Servers Handlers
  const handleMcpToggle = (id: string) => {
    setSettings({
      ...settings,
      mcpServers: (settings.mcpServers ?? []).map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    });
  };

  const handleMcpAdd = () => {
    const newServer: McpServerConfig = {
      id: `mcp_${Date.now()}`,
      name: '新 mcp 扩展',
      command: 'node',
      args: '',
      env: '',
      enabled: false,
    };
    setSettings({
      ...settings,
      mcpServers: [...(settings.mcpServers ?? []), newServer],
    });
  };

  const handleMcpDelete = (id: string) => {
    setSettings({
      ...settings,
      mcpServers: (settings.mcpServers ?? []).filter((s) => s.id !== id),
    });
  };

  const handleMcpFieldChange = (id: string, field: 'name' | 'command' | 'args' | 'env', value: string) => {
    setSettings({
      ...settings,
      mcpServers: (settings.mcpServers ?? []).map((s) =>
        s.id === id ? { ...s, [field]: value } : s
      ),
    });
  };

  const toggleTool = (tool: 'read' | 'bash' | 'edit' | 'write') => {
    const currentTools = settings.enabledTools || DEFAULT_SETTINGS.enabledTools!;
    setSettings({
      ...settings,
      enabledTools: {
        ...currentTools,
        [tool]: !currentTools[tool],
      },
    });
  };

  const handlePresetSelect = (preset: 'pi-violet' | 'nordic-slate' | 'ocean-breeze' | 'zen-garden' | 'amber-hacker' | 'sakura-twilight') => {
    let accent = '#8b5cf6';
    let density: 'comfortable' | 'compact' | 'minimalist' = 'comfortable';
    let bubble: 'flat' | 'glow' | 'glass' = 'glow';
    let avatar = '🤖';

    switch (preset) {
      case 'pi-violet':
        accent = '#8b5cf6';
        density = 'comfortable';
        bubble = 'glow';
        avatar = '🤖';
        break;
      case 'nordic-slate':
        accent = '#94a3b8';
        density = 'minimalist';
        bubble = 'flat';
        avatar = '☕';
        break;
      case 'ocean-breeze':
        accent = '#0ea5e9';
        density = 'compact';
        bubble = 'glow';
        avatar = '🌊';
        break;
      case 'zen-garden':
        accent = '#10b981';
        density = 'comfortable';
        bubble = 'glass';
        avatar = '🍃';
        break;
      case 'amber-hacker':
        accent = '#f59e0b';
        density = 'compact';
        bubble = 'flat';
        avatar = '👾';
        break;
      case 'sakura-twilight':
        accent = '#fb7185';
        density = 'comfortable';
        bubble = 'glass';
        avatar = '🌸';
        break;
    }

    setSettings({
      ...settings,
      themePreset: preset,
      accentColor: accent,
      interfaceDensity: density,
      bubbleStyle: bubble,
      agentAvatar: avatar,
    });
  };

  if (!isOpen) return null;

  const renderTabButton = (tabId: typeof activeTab, icon: React.ReactNode, label: string) => {
    const isActive = activeTab === tabId;
    return (
      <button
        onClick={() => setActiveTab(tabId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderRadius: 8,
          border: 'none',
          background: isActive ? 'var(--bg-active)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 12.5,
          fontWeight: isActive ? 650 : 500,
          textAlign: 'left',
          width: '100%',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent';
        }}
      >
        {icon}
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(7, 5, 12, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 16,
          border: '1px solid var(--border-subtle)',
          width: 800,
          height: 600,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 650, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚙️ 配置中心
          </h2>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Split Container */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Vertical Sidebar */}
          <div
            style={{
              width: 200,
              background: 'var(--bg-base)',
              borderRight: '1px solid var(--border-subtle)',
              padding: '16px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              overflowY: 'auto'
            }}
            className="scrollbar-thin"
          >
            {renderTabButton('api', <SettingsIcon size={13} />, '模型与工具配置')}
            {renderTabButton('skills', <Puzzle size={13} />, 'Skills 技能书')}
            {renderTabButton('mcp', <Cpu size={13} />, 'MCP 扩展协议')}
            {renderTabButton('safety', <Shield size={13} />, '执行安全沙箱')}
            {renderTabButton('aesthetic', <Sparkles size={13} />, '个性化定制')}
            {renderTabButton('templates', <FileText size={13} />, '提示模板')}
            {renderTabButton('packages', <Package size={13} />, '包管理器')}
          </div>

          {/* Right Scrollable Content Body */}
          <div
            className="scrollbar-thin"
            style={{
              flex: 1,
              padding: '24px 28px',
              overflowY: 'auto',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {activeTab === 'api' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Tip Alert */}
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(139, 92, 246, 0.08)',
                  border: '1px dashed var(--accent-primary)',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>💡</span>
                  <div>
                    <b>多模型配置提示</b>：您可以在此点击右侧“+ 新增模型配置”，并分别为每个配置填写其 API Key、接口地址和模型名称。保存后，在<b>主界面左下角模型按钮</b>即可直接快速切换不同模型！
                  </div>
                </div>
              {/* Model Profile Manager */}
              <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                    📋 多模型配置管理
                  </span>
                  <button
                    onClick={handleAddProfile}
                    style={{
                      padding: '4px 8px', borderRadius: 6, border: 'none',
                      background: 'var(--accent-primary)', color: 'white',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-secondary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent-primary)')}
                  >
                    + 新增模型配置
                  </button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(settings.modelProfiles || []).map((profile) => (
                    <div
                      key={profile.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 8,
                        background: settings.activeModelProfileId === profile.id ? 'var(--bg-active)' : 'var(--bg-overlay)',
                        border: settings.activeModelProfileId === profile.id 
                          ? '1px solid var(--accent-primary)' 
                          : '1px solid var(--border-subtle)',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                        <input
                          type="radio"
                          name="activeProfile"
                          checked={settings.activeModelProfileId === profile.id}
                          onChange={() => handleSelectProfile(profile.id)}
                          style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                        />
                        <input
                          type="text"
                          value={profile.name}
                          onChange={(e) => handleProfileNameChange(profile.id, e.target.value)}
                          placeholder="模型别名，如 DeepSeek Pro"
                          style={{
                            border: 'none', background: 'transparent',
                            color: settings.activeModelProfileId === profile.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                            fontSize: 12.5, fontWeight: settings.activeModelProfileId === profile.id ? 700 : 500,
                            outline: 'none', width: '80%', padding: '2px 4px',
                          }}
                        />
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {profile.model.slice(0, 15) + (profile.model.length > 15 ? '..' : '')}
                        </span>
                        {(settings.modelProfiles || []).length > 1 && (
                          <button
                            onClick={() => handleDeleteProfile(profile.id)}
                            style={{
                              border: 'none', background: 'transparent', color: 'var(--status-error)',
                              cursor: 'pointer', padding: 2, borderRadius: 4,
                            }}
                            title="删除此配置"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="settings-label settings-label--light">
                  API Key
                </label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => updateProfileAndRoot({ apiKey: e.target.value })}
                  placeholder="输入授权 Bearer Token..."
                  className="settings-input"
                />
              </div>

              {/* Base URL */}
              <div>
                <label className="settings-label settings-label--light">
                  API Base URL
                </label>
                <input
                  type="text"
                  value={settings.baseURL}
                  onChange={(e) => updateProfileAndRoot({ baseURL: e.target.value })}
                  placeholder="https://api.deepseek.com"
                  className="settings-input"
                />
              </div>

              {/* Model Select / Manual Input */}
              <div>
                <label className="settings-label settings-label--light">
                  开发模型名称 (Model)
                </label>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(e) => updateProfileAndRoot({ model: e.target.value })}
                  placeholder="输入自定义模型名，如 deepseek-chat..."
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {COMMON_MODELS.map((m) => (
                    <button
                      key={m}
                      onClick={() => updateProfileAndRoot({ model: m })}
                      style={{
                        padding: '4px 8px', borderRadius: 6,
                        background: settings.model === m ? 'var(--bg-active)' : 'var(--bg-overlay)',
                        color: settings.model === m ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                        fontSize: 11, cursor: 'pointer', transition: 'all 0.15s',
                        border: settings.model === m ? '1px solid var(--border-strong)' : '1px solid transparent',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hyperparameters: Temperature and Max Tokens */}
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      采样温度 (Temp)
                    </label>
                    <span style={{ fontSize: 11.5, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {(settings.temperature ?? 0.7).toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={settings.temperature ?? 0.7}
                    onChange={(e) => updateProfileAndRoot({ temperature: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>精确</span>
                    <span>创意</span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="settings-label settings-label--light">
                    最大生成数 (Max Tokens)
                  </label>
                  <input
                    type="number"
                    value={settings.maxTokens ?? 4096}
                    onChange={(e) => updateProfileAndRoot({ maxTokens: parseInt(e.target.value) || 4096 })}
                    style={{
                      width: '100%', padding: '7px 10px', borderRadius: 8,
                      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
              </div>
              
              {/* Advanced Reasoning Parameters */}
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      Top P (核采样)
                    </label>
                    <span style={{ fontSize: 11.5, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {(settings.topP ?? 0.9).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.topP ?? 0.9}
                    onChange={(e) => setSettings({ ...settings, topP: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>聚焦</span>
                    <span>多样</span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      推理强度 (Reasoning)
                    </label>
                    <span style={{ fontSize: 11.5, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {settings.reasoningEffort ?? 'none'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['none', 'auto', 'low', 'medium', 'high'] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => updateProfileAndRoot({ reasoningEffort: level })}
                        style={{
                          flex: 1,
                          padding: '8px 2px',
                          borderRadius: 8,
                          border: (settings.reasoningEffort ?? 'none') === level
                            ? '1px solid var(--accent-primary)'
                            : '1px solid var(--border-subtle)',
                          background: (settings.reasoningEffort ?? 'none') === level
                            ? level === 'auto' 
                              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                              : 'var(--accent-primary)'
                            : 'var(--bg-elevated)',
                          color: (settings.reasoningEffort ?? 'none') === level
                            ? 'white'
                            : 'var(--text-secondary)',
                          fontSize: 11,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          fontWeight: 500,
                        }}
                      >
                        {level === 'none' ? 'None' : level === 'auto' ? 'Auto' : level === 'low' ? '快速' : level === 'medium' ? '平衡' : '深度'}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
                    {settings.reasoningEffort === 'none' && '❌ 关闭推理能力，适用于标准非推理模型'}
                    {settings.reasoningEffort === 'auto' && '🤖 自动根据任务难度调整推理参数'}
                    {settings.reasoningEffort === 'low' && '⚡ 快速响应，减少思考时间'}
                    {settings.reasoningEffort === 'medium' && '⚖️ 平衡速度与质量'}
                    {settings.reasoningEffort === 'high' && '🧠 深度思考，更高质量'}
                    {!settings.reasoningEffort && '❌ 关闭推理能力，适用于标准非推理模型'}
                  </div>
                </div>
              </div>
              
              {/* Frequency and Presence Penalty */}
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      频率惩罚 (Freq Penalty)
                    </label>
                    <span style={{ fontSize: 11.5, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {(settings.frequencyPenalty ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    value={settings.frequencyPenalty ?? 0}
                    onChange={(e) => setSettings({ ...settings, frequencyPenalty: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>重复</span>
                    <span>新颖</span>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      存在惩罚 (Presence Penalty)
                    </label>
                    <span style={{ fontSize: 11.5, color: 'var(--accent-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {(settings.presencePenalty ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    value={settings.presencePenalty ?? 0}
                    onChange={(e) => setSettings({ ...settings, presencePenalty: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>聚焦</span>
                    <span>探索</span>
                  </div>
                </div>
              </div>

              {/* Built-in Tool Switches */}
              <div>
                <label className="settings-label settings-label--light">
                  开启的内置系统工具 (Built-in Tools)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {(['read', 'bash', 'edit', 'write'] as const).map((tool) => {
                    const isEnabled = (settings.enabledTools || DEFAULT_SETTINGS.enabledTools!)[tool];
                    return (
                      <button
                        key={tool}
                        onClick={() => toggleTool(tool)}
                        style={{
                          padding: '8px 4px', borderRadius: 8,
                          border: isEnabled ? '1px solid var(--border-strong)' : '1px solid var(--border-subtle)',
                          background: isEnabled ? 'var(--bg-hover)' : 'var(--bg-base)',
                          color: isEnabled ? 'var(--text-primary)' : 'var(--text-muted)',
                          fontSize: 12, cursor: 'pointer', transition: 'all 0.2s',
                          fontWeight: 500, fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {tool} {isEnabled ? '✓' : '✗'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom System Prompt Override */}
              <div>
                <label className="settings-label settings-label--light">
                  附加的系统提示词 (Append Global Instructions)
                </label>
                <textarea
                  value={settings.customSystemPrompt || ''}
                  onChange={(e) => setSettings({ ...settings, customSystemPrompt: e.target.value })}
                  placeholder="追加全局开发约定（如：必须使用 TypeScript 且加 JSDoc 注释）..."
                  rows={2}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === 'skills' && (
            <SkillsConfig
              skills={settings.skills ?? []}
              onToggle={handleSkillToggle}
              onAddSkill={handleSkillAdd}
              onDeleteSkill={handleSkillDelete}
              onFieldChange={handleSkillFieldChange}
            />
          )}

          {activeTab === 'mcp' && (
            <McpConfig
              servers={settings.mcpServers ?? []}
              onToggle={handleMcpToggle}
              onAddServer={handleMcpAdd}
              onDeleteServer={handleMcpDelete}
              onFieldChange={handleMcpFieldChange}
            />
          )}

          {activeTab === 'safety' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: 'pointer',
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-primary)' }}>
                      自动调度未完成目标
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                      检测到 /goal 断点或后台队列项后，等待一小段时间自动续跑。建议只在可信工作区开启。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoResumeGoals ?? false}
                    onChange={(e) => setSettings({ ...settings, autoResumeGoals: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                  />
                </label>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>续跑延迟</span>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={settings.autoResumeDelaySeconds ?? 8}
                    onChange={(e) => setSettings({ ...settings, autoResumeDelaySeconds: Math.max(3, Math.min(60, parseInt(e.target.value) || 8)) })}
                    disabled={!settings.autoResumeGoals}
                    style={{
                      width: 72,
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: settings.autoResumeGoals ? 'var(--bg-base)' : 'var(--bg-overlay)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>秒</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 10 }}>最大并发</span>
                  <input
                    type="number"
                    min={1}
                    max={1}
                    value={settings.goalSchedulerMaxConcurrent ?? 1}
                    onChange={(e) => setSettings({ ...settings, goalSchedulerMaxConcurrent: Math.max(1, Math.min(1, parseInt(e.target.value) || 1)) })}
                    disabled={!settings.autoResumeGoals}
                    style={{
                      width: 56,
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: settings.autoResumeGoals ? 'var(--bg-base)' : 'var(--bg-overlay)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>当前版本保守单执行</span>
                </div>
              </div>

              {/* Auto-compaction threshold */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-primary)' }}>
                      自动上下文压缩阈值 (Auto-compaction Threshold)
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                      当活跃分支的总字符数超过此阈值时，自动触发上下文压缩。增大此值可保留更多历史上下文，但会消耗更多 token。
                    </span>
                  </span>
                </label>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>阈值</span>
                  <input
                    type="number"
                    min={4000}
                    max={50000}
                    step={1000}
                    value={settings.autoCompactionThreshold ?? 12000}
                    onChange={(e) => setSettings({ ...settings, autoCompactionThreshold: Math.max(4000, Math.min(50000, parseInt(e.target.value) || 12000)) })}
                    style={{
                      width: 80,
                      padding: '5px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-base)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>字符</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>默认 12000 · 推荐 8000-20000</span>
                </div>
              </div>

              {/* Sandbox Type */}
              <div>
                <label className="settings-label">
                  沙箱执行类型 (Execution Sandbox)
                </label>
                <select
                  value={settings.sandboxType ?? 'guard'}
                  onChange={(e) => setSettings({ ...settings, sandboxType: e.target.value as any })}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    cursor: 'pointer',
                  }}
                >
                  <option value="none">无沙箱 (直接在宿主机执行 - 高性能)</option>
                  <option value="guard">高危拦截模式 (拦截危险指令并警告 - 推荐)</option>
                  <option value="docker">Docker 容器沙箱 (在 Node 镜像容器中隔离运行)</option>
                </select>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  {settings.sandboxType === 'docker' 
                    ? '💡 提示：使用 Docker 沙箱需要您的主机已安装并运行 Docker Desktop。工作目录将被挂载至容器的 /workspace 中。' 
                    : settings.sandboxType === 'guard'
                    ? '💡 提示：高危拦截模式会自动检测并拦截包含 rm、del、rd、format 等高危破坏性关键字的指令，供您二次确认。'
                    : '💡 提示：直接在宿主机运行不提供隔离保护。请确保您绝对信任模型所生成的指令。'}
                </p>
              </div>

              {/* Dangerous Keywords */}
              <div>
                <label className="settings-label">
                  高危指令拦截关键字 (逗号分隔)
                </label>
                <input
                  type="text"
                  value={settings.dangerousKeywords ?? 'rm ,del ,format,rd ,rmdir ,shutdown'}
                  onChange={(e) => setSettings({ ...settings, dangerousKeywords: e.target.value })}
                  placeholder="rm ,del ,format,rd ,rmdir"
                  className="settings-input"
                />
              </div>

              {/* Trust Mode (权限全开免询问模式) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border-subtle)',
                  marginTop: 8,
                }}
              >
                <div style={{ flex: 1, paddingRight: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>
                    权限全开模式 (Trust Mode)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                    开启后，所有 AI 脚本和高危指令（如 del、rm、rmdir 等）都将直接在宿主机自动运行，不再弹出任何确认拦截提示。请在确认环境安全后启用。
                  </div>
                </div>
                <div
                  onClick={() => setSettings({ ...settings, trustMode: !settings.trustMode })}
                  style={{
                    width: 44,
                    height: 22,
                    background: settings.trustMode ? 'var(--accent-primary)' : 'var(--bg-muted)',
                    borderRadius: 11,
                    position: 'relative',
                    transition: 'background-color 0.2s',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      background: 'var(--text-inverse)',
                      borderRadius: '50%',
                      position: 'absolute',
                      top: 2,
                      left: settings.trustMode ? 24 : 2,
                      transition: 'left 0.2s',
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'aesthetic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Custom Agent Name */}
              <div>
                <label className="settings-label">
                  专属 AI 助手名称 (Agent Identity Name)
                </label>
                <input
                  type="text"
                  value={settings.agentName ?? 'PianoAgent'}
                  onChange={(e) => setSettings({ ...settings, agentName: e.target.value })}
                  placeholder="给您的专属助手起一个名字"
                  className="settings-input"
                />
              </div>

              {/* Custom Agent Avatar */}
              <div>
                <label className="settings-label">
                  专属 AI 助手头像 (Emoji)
                </label>
                <input
                  type="text"
                  value={settings.agentAvatar ?? '🤖'}
                  onChange={(e) => setSettings({ ...settings, agentAvatar: e.target.value })}
                  placeholder="输入任意 Emoji 作为头像"
                  className="settings-input"
                />
              </div>

              {/* Theme Preset Cards */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 8 }}>
                  极简美学主题模板 (Minimalist Presets)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[
                    { id: 'pi-violet', name: '极简紫', desc: 'Cyber Violet', color: '#8b5cf6' },
                    { id: 'nordic-slate', name: '极简灰', desc: 'Nordic Slate', color: '#94a3b8' },
                    { id: 'ocean-breeze', name: '静谧蓝', desc: 'Ocean Breeze', color: '#0ea5e9' },
                    { id: 'zen-garden', name: '禅意绿', desc: 'Zen Garden', color: '#10b981' },
                    { id: 'amber-hacker', name: '黑金客', desc: 'Amber Hacker', color: '#f59e0b' },
                    { id: 'sakura-twilight', name: '浪漫粉', desc: 'Sakura Twilight', color: '#fb7185' },
                  ].map((p) => {
                    const isSelected = settings.themePreset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => handlePresetSelect(p.id as any)}
                        className={'settings-preset-btn' + (isSelected ? ' settings-preset-btn--selected' : '')}
                      >
                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: p.color, boxShadow: '0 0 6px ' + p.color }} />
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Picker */}
              <div>
                <label className="settings-label">
                  自定义主题色 (Custom Accent Color)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="color"
                    value={settings.accentColor ?? '#8b5cf6'}
                    onChange={(e) => setSettings({ ...settings, accentColor: e.target.value, themePreset: 'custom' })}
                    className="settings-color-input"
                  />
                  <input
                    type="text"
                    value={settings.accentColor ?? '#8b5cf6'}
                    onChange={(e) => setSettings({ ...settings, accentColor: e.target.value, themePreset: 'custom' })}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)', fontSize: 12, outline: 'none', fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
              </div>

              {/* Layout Density & Bubble style */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="settings-label">
                    界面排版密度 (Density)
                  </label>
                  <select
                    value={settings.interfaceDensity ?? 'comfortable'}
                    onChange={(e) => setSettings({ ...settings, interfaceDensity: e.target.value as any })}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', cursor: 'pointer',
                    }}
                  >
                    <option value="comfortable">舒适体验 (Comfortable)</option>
                    <option value="compact">紧凑布局 (Compact)</option>
                    <option value="minimalist">极简命令行 (Minimalist)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="settings-label">
                    气泡框美学设计 (Bubble Style)
                  </label>
                  <select
                    value={settings.bubbleStyle ?? 'glow'}
                    onChange={(e) => setSettings({ ...settings, bubbleStyle: e.target.value as any })}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', cursor: 'pointer',
                    }}
                  >
                    <option value="flat">极简无边框 (Flat)</option>
                    <option value="glow">炫光发光边框 (Glow)</option>
                    <option value="glass">毛玻璃透明 (Glass)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'templates' && (
            <PromptTemplatesConfig
              globalDir="C:\\Users\\Administrator\\.pi\\agent\\prompts"
              readFile={async (path) => {
                if (window.electronAPI) {
                  return await window.electronAPI.readFile(path);
                }
                return null;
              }}
              readDir={async (path) => {
                if (window.electronAPI) {
                  return await window.electronAPI.readDirectory(path);
                }
                return [];
              }}
              writeFile={async (path, content) => {
                if (window.electronAPI) {
                  return await window.electronAPI.writeFile(path, content);
                }
                return false;
              }}
              deleteFile={async (path) => {
                // Electron API doesn't have deleteFile, so we'll need to implement it
                // For now, return false
                return false;
              }}
            />
          )}
          
          {activeTab === 'packages' && (
            <PackageManager
              readSettings={async () => {
                const saved = localStorage.getItem('piano-settings');
                return saved ? JSON.parse(saved) : {};
              }}
              writeSettings={async (newSettings) => {
                localStorage.setItem('piano-settings', JSON.stringify(newSettings));
                return true;
              }}
              executeCommand={async (command) => {
                if (window.electronAPI) {
                  const result = await window.electronAPI.executeTool('bash', JSON.stringify({ command }));
                  return result.success ? result.result || '' : `Error: ${result.error}`;
                }
                return 'Error: Electron API not available';
              }}
              deleteDirectory={async (path) => {
                if (window.electronAPI) {
                  const escapedPath = path.replace(/'/g, "''");
                  const result = await window.electronAPI.executeTool('bash', JSON.stringify({ command: `Remove-Item -LiteralPath '${escapedPath}' -Recurse -Force` }));
                  return result.success;
                }
                return false;
              }}
              readDir={async (path) => {
                if (window.electronAPI) {
                  return await window.electronAPI.readDirectory(path);
                }
                return [];
              }}
              readFile={async (path) => {
                if (window.electronAPI) {
                  return await window.electronAPI.readFile(path);
                }
                return null;
              }}
            />
          )}
        </div>
      </div>

      {/* Footer */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px', borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
          }}
        >
          <button
            onClick={handleReset}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
              borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <RotateCcw size={13} /> 恢复默认
          </button>
          <button
            onClick={handleSave}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px',
              borderRadius: 8, border: 'none',
              background: saved ? 'var(--color-success, #22c55e)' : 'var(--accent-primary)',
              color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s',
            }}
          >
            <Save size={14} /> {saved ? '已保存 ✓' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
export { DEFAULT_SETTINGS };
export type { Settings };
export type { McpServerConfig };
