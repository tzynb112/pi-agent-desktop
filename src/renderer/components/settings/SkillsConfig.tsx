import React from 'react';
import { Plus, Trash2, Sparkles, MessageSquare } from 'lucide-react';
import type { Skill } from '../../types';

interface SkillsConfigProps {
  skills: Skill[];
  onToggle: (id: string) => void;
  onAddSkill: () => void;
  onDeleteSkill: (id: string) => void;
  onFieldChange: (id: string, field: 'name' | 'description' | 'prompt', value: string) => void;
}

const SkillsConfig: React.FC<SkillsConfigProps> = ({
  skills = [],
  onToggle,
  onAddSkill,
  onDeleteSkill,
  onFieldChange,
}) => {
  return (
    <div className="pkg-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: 10,
        }}
      >
        <div>
          <div className="pkg-title">
            自定义 Skills（系统级提示词拓展）
          </div>
          <div className="pkg-subtitle">
            启用的技能将被自动附加到大模型的 System Prompt 后部，赋予特殊的编程特长。
          </div>
        </div>
        <button
          onClick={onAddSkill}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent-primary)',
            color: 'white',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
        >
          <Plus size={13} />
          新建技能
        </button>
      </div>

      <div
        className="scrollbar-thin"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxHeight: '45vh',
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {skills.length === 0 ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
              border: '1px dashed var(--border-subtle)',
              borderRadius: 10,
            }}
          >
            暂无自定义技能，点击上方按钮新建一个吧
          </div>
        ) : (
          skills.map((skill) => {
            const isGlobal = skill.id.startsWith('global_skill_');
            return (
              <div
                key={skill.id}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: isGlobal ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                  opacity: skill.enabled ? 1 : 0.65,
                  transition: 'all 0.2s',
                  position: 'relative',
                }}
              >
                {isGlobal && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: 12,
                      background: 'var(--accent-primary)',
                      color: 'white',
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    }}
                  >
                    全局 PI 技能
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input
                      type="text"
                      disabled={isGlobal}
                      value={skill.name}
                      onChange={(e) => onFieldChange(skill.id, 'name', e.target.value)}
                      placeholder="技能名称 (例如: 单测专家)"
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-base)',
                        color: 'var(--text-primary)',
                        fontSize: 12.5,
                        fontWeight: 600,
                        outline: 'none',
                        width: '80%',
                        cursor: isGlobal ? 'default' : 'text',
                      }}
                    />
                    <input
                      type="text"
                      disabled={isGlobal}
                      value={skill.description}
                      onChange={(e) => onFieldChange(skill.id, 'description', e.target.value)}
                      placeholder="技能简短描述"
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-base)',
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        outline: 'none',
                        width: '95%',
                        cursor: isGlobal ? 'default' : 'text',
                      }}
                    />
                  </div>
                  <div className="settings-row">
                    {/* Enable Switch */}
                    <button
                      onClick={() => onToggle(skill.id)}
                      style={{
                        width: 32,
                        height: 18,
                        borderRadius: 9,
                        border: 'none',
                        background: skill.enabled ? 'var(--accent-primary)' : 'var(--bg-overlay)',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.2s',
                      }}
                      title={skill.enabled ? '已启用' : '已禁用'}
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: 2,
                          left: skill.enabled ? 16 : 2,
                          transition: 'all 0.2s',
                        }}
                      />
                    </button>
                    {/* Delete Button */}
                    {!isGlobal && (
                      <button
                        onClick={() => onDeleteSkill(skill.id)}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          border: 'none',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: 'var(--status-error)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
                        title="删除技能"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
  
                {/* Prompt Textarea */}
                <div style={{ position: 'relative' }}>
                  <textarea
                    readOnly={isGlobal}
                    value={skill.prompt}
                    onChange={(e) => onFieldChange(skill.id, 'prompt', e.target.value)}
                    placeholder="输入技能详细提示词系统指令..."
                    rows={2}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      fontSize: 11.5,
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      opacity: isGlobal ? 0.8 : 1,
                      cursor: isGlobal ? 'default' : 'text',
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default SkillsConfig;
