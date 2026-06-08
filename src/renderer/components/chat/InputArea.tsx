import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { UsageStats } from '../../types';
import { Send, Square, Paperclip, Sparkles, Shield, FileText, Target, X, File, Image, Code, Upload, Plus, ChevronDown, Terminal } from 'lucide-react';
import type { PromptTemplate } from '../../utils/prompt-templates';
import { loadAllTemplates, expandTemplate } from '../../utils/prompt-templates';
import type { Settings } from '../../config/default-settings';
import { safeStorage } from '../../utils/storage';

const SYSTEM_COMMANDS: PromptTemplate[] = [
  {
    name: 'help',
    description: '显示所有可用命令的帮助信息',
    content: '/help',
    source: 'global',
    filePath: 'system_help',
  },
  {
    name: 'clear',
    description: '清空当前会话的聊天历史',
    content: '/clear',
    source: 'global',
    filePath: 'system_clear',
  },
  {
    name: 'compact',
    description: '手动压缩当前会话的上下文以节省 Token',
    content: '/compact',
    source: 'global',
    filePath: 'system_compact',
  },
  {
    name: 'settings',
    description: '打开 PianoAgent 的系统设置窗口',
    content: '/settings',
    source: 'global',
    filePath: 'system_settings',
  },
  {
    name: 'model',
    description: '查看当前 LLM 配置，或使用 `/model <名称>` 切换模型',
    content: '/model',
    source: 'global',
    filePath: 'system_model',
    argumentHint: ' [名称]',
  },
  {
    name: 'tokens',
    description: '统计和显示当前会话的 Token 使用状态',
    content: '/tokens',
    source: 'global',
    filePath: 'system_tokens',
  },
  {
    name: 'export',
    description: '将当前聊天历史记录导出到本地文件',
    content: '/export',
    source: 'global',
    filePath: 'system_export',
  },
  {
    name: 'doctor',
    description: '诊断本地 API 配置和 MCP 服务器运行环境状态',
    content: '/doctor',
    source: 'global',
    filePath: 'system_doctor',
  },
  {
    name: 'status',
    description: '查看系统的当前运行状态（如闲置、运行中）',
    content: '/status',
    source: 'global',
    filePath: 'system_status',
  },
  {
    name: 'goal',
    description: '启动高级目标规划执行，格式如 `/goal <描述>`',
    content: '/goal ',
    source: 'global',
    filePath: 'system_goal',
    argumentHint: ' <描述>',
  }
];
interface Attachment {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'image' | 'code';
  content?: string;
  size?: number;
}
interface InputAreaProps {
  onSend: (content: string, attachments?: Attachment[]) => void;
  isStreaming: boolean;
  onStop?: () => void;
  usageStats?: UsageStats | null;
  rootPath?: string | null;
  apiSettings?: Settings;
  onUpdateSettings?: (settings: Settings) => void;
  draftPrompt?: { id: number; text: string } | null;
  contextTokens?: number;
  onOpenSettings?: () => void;
}
const InputArea: React.FC<InputAreaProps> = ({ 
  onSend, isStreaming, onStop, usageStats, rootPath,
  apiSettings, onUpdateSettings, draftPrompt, contextTokens = 0,
  onOpenSettings
}) => {
  const [input, setInput] = useState(() => {
    return safeStorage.getItem('piano-draft') || '';
  });
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [isComposerHovered, setIsComposerHovered] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [goalPromptOpen, setGoalPromptOpen] = useState(false);
  const [goalPromptValue, setGoalPromptValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showModelMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        const toggleBtn = document.querySelector('.model-name-btn');
        if (toggleBtn && toggleBtn.contains(e.target as Node)) {
          return;
        }
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showModelMenu]);

  const hasInput = input.trim().length > 0 || attachments.length > 0;
  const maxTokens = apiSettings?.maxTokens || 4096;
  const contextPercent = Math.min(100, Math.round((contextTokens / maxTokens) * 100));
  const contextLevel = contextPercent < 60 ? 'low' : contextPercent < 85 ? 'medium' : 'high';
  useEffect(() => {
    const timer = setTimeout(() => {
      if (input.trim()) safeStorage.setItem('piano-draft', input);
      else safeStorage.removeItem('piano-draft');
    }, 500);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    try {
      const stored = safeStorage.getItem('piano-input-history');
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (err) {
      console.error('[InputArea] Failed to load history:', err);
    }
  }, []);

  const addToHistory = (text: string) => {
    setHistory(prev => {
      if (prev.length > 0 && prev[0] === text) {
        return prev;
      }
      const updated = [text, ...prev.filter(item => item !== text)].slice(0, 50);
      safeStorage.setItem('piano-input-history', JSON.stringify(updated));
      return updated;
    });
  };
  useEffect(() => {
    const lt = async () => {
      if (window.electronAPI) {
        try {
          const loaded = await loadAllTemplates(
            async (path: string) => await window.electronAPI!.readFile(path),
            async (path: string) => await window.electronAPI!.readDirectory(path),
            'C:\\Users\\Administrator\\.pi\\agent\\prompts',
            rootPath ? `${rootPath}\\.piano\\prompts` : undefined
          );
          setTemplates(loaded);
        } catch (err) { console.error('[InputArea] Failed to load templates:', err); }
      }
    };
    lt();
  }, [rootPath]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = Math.max(window.innerHeight * 0.5, 300);
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }
  }, [input]);
  useEffect(() => {
    const focusInput = () => textareaRef.current?.focus();
    window.addEventListener('piano-focus-input', focusInput);
    return () => window.removeEventListener('piano-focus-input', focusInput);
  }, []);
  useEffect(() => {
    if (!draftPrompt) return;
    setInput(draftPrompt.text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [draftPrompt]);
  const filteredTemplates = useCallback(() => {
    const allItems = [...SYSTEM_COMMANDS, ...templates];
    if (!filterText) return allItems;
    return allItems.filter(t => 
      t.name.toLowerCase().includes(filterText.toLowerCase()) ||
      t.description.toLowerCase().includes(filterText.toLowerCase())
    );
  }, [templates, filterText]);
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setHistoryIndex(-1);
    const lastLine = value.split('\n').pop() || '';
    if (lastLine.startsWith('/')) {
      setFilterText(lastLine.substring(1));
      setShowSuggestions(true);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  };
  const handleSelectTemplate = (template: PromptTemplate) => {
    setHistoryIndex(-1);
    const lines = input.split('\n');
    const lastLineIndex = lines.length - 1;
    const lastLine = lines[lastLineIndex];
    const commandMatch = lastLine.match(/^\/\S+\s*(.*)/);
    const args = commandMatch ? commandMatch[1].split(/\s+/).filter(Boolean) : [];
    const expandedContent = expandTemplate(template.content, args);
    lines[lastLineIndex] = expandedContent;
    setInput(lines.join('\n'));
    setShowSuggestions(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };
  const addAttachmentFromFile = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const content = event.target?.result as string;
        const fileName = file.name;
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        let type: Attachment['type'] = 'file';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) type = 'image';
        else if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'json', 'xml', 'md'].includes(ext)) type = 'code';
        setAttachments(prev => [...prev, { id: `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, name: fileName, path: file.name, type, content, size: file.size }]);
        resolve();
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };
  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(att => att.id !== id));
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragCounter(prev => {
      const newCounter = prev - 1;
      if (newCounter === 0) setIsDragging(false);
      return newCounter;
    });
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); setDragCounter(0);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setIsLoadingFile(true);
      try { for (let i = 0; i < files.length; i++) await addAttachmentFromFile(files[i]); }
      catch (err) { console.error('[InputArea] Failed to process dropped files:', err); }
      finally { setIsLoadingFile(false); }
    }
  }, []);
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64 = event.target?.result as string;
          setAttachments(prev => [...prev, { id: `att_${Date.now()}`, name: `clipboard-image-${Date.now()}.png`, path: 'clipboard', type: 'image', content: base64, size: base64.length }]);
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      const suggestions = filteredTemplates();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1)); break;
        case 'ArrowUp': e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); break;
        case 'Tab':
        case 'Enter':
          if (suggestions.length > 0) { e.preventDefault(); handleSelectTemplate(suggestions[selectedIndex]); }
          break;
        case 'Escape': e.preventDefault(); setShowSuggestions(false); break;
      }
    } else {
      if (e.key === 'ArrowUp') {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const textBeforeCursor = textarea.value.substring(0, textarea.selectionStart);
        const isAtFirstLine = !textBeforeCursor.includes('\n');
        if (isAtFirstLine && history.length > 0) {
          const nextIndex = historyIndex + 1;
          if (nextIndex < history.length) {
            e.preventDefault();
            if (historyIndex === -1) {
              setHistoryDraft(input);
            }
            setHistoryIndex(nextIndex);
            setInput(history[nextIndex]);
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = history[nextIndex].length;
            }, 0);
          }
        }
      } else if (e.key === 'ArrowDown') {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const textAfterCursor = textarea.value.substring(textarea.selectionEnd);
        const isAtLastLine = !textAfterCursor.includes('\n');
        if (isAtLastLine && historyIndex >= 0) {
          e.preventDefault();
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          const nextInput = nextIndex === -1 ? historyDraft : history[nextIndex];
          setInput(nextInput);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = nextInput.length;
          }, 0);
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };
  const handleSubmit = () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    let message = input.trim();
    if (attachments.length > 0) {
      const attachmentInfo = attachments.map(att => {
        if (att.type === 'image') return `[附件: ${att.name} (图片)]`;
        return '[\u9644\u4EF6: ' + att.name + ']\n```\n' + (att.content?.substring(0, 500)) + ((att.content?.length || 0) > 500 ? '\n...(\u5DF2\u622A\u65AD)' : '') + '\n```';
      }).join('\n\n');
      message = message ? message + '\n\n' + attachmentInfo : attachmentInfo;
    }
    if (input.trim()) {
      addToHistory(input.trim());
    }
    setHistoryIndex(-1);
    onSend(message, attachments);
    setInput('');
    setAttachments([]);
  };
  const getFileIcon = (type: Attachment['type']) => {
    switch (type) {
      case 'image': return <Image size={14} className="input-attach-icon-image" />;
      case 'code': return <Code size={14} className="input-attach-icon-code" />;
      default: return <File size={14} className="input-attach-icon-file" />;
    }
  };
  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  return (
    <div
      className="input-area"
      onMouseEnter={() => setIsComposerHovered(true)}
      onMouseLeave={() => { setIsComposerHovered(false); setShowActionMenu(false); }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {usageStats && (
        <div className={'input-stats-bar ' + (isComposerHovered ? 'input-stats-bar--visible' : 'input-stats-bar--hidden')}>
          <span className="input-stats-model">{usageStats.model}</span>
          <span>{usageStats.totalTokens.toLocaleString()} tokens</span>
          <span>{usageStats.responseTime < 1000 ? usageStats.responseTime + 'ms' : (usageStats.responseTime / 1000).toFixed(1) + 's'}</span>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="input-attachments">
          {attachments.map(att => (
            <div key={att.id} className="input-attachment-chip">
              {getFileIcon(att.type)}
              <span className="input-attachment-name">{att.name}</span>
              {att.size && <span className="input-attachment-size">{formatSize(att.size)}</span>}
              <button className="input-attachment-remove" onClick={() => removeAttachment(att.id)}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {contextTokens > 0 && (
        <div className="input-context-bar-wrap" title={'~' + contextTokens.toLocaleString() + ' / ' + maxTokens.toLocaleString() + ' tokens (' + contextPercent + '%)'}>
          <div className={'context-bar context-bar--' + contextLevel} style={{ width: contextPercent + '%' }} />
        </div>
      )}
      <div className="input-composer-area">
        {isDragging && (
          <div className="drag-overlay">
            <Upload size={32} className="drag-overlay-icon" />
            <div className="drag-overlay-text">拖放文件到此处</div>
          </div>
        )}
        {showSuggestions && (() => {
          const suggestions = filteredTemplates();
          if (suggestions.length === 0) return null;
          return (
            <div className="suggestions-dropdown scrollbar-thin">
              {suggestions.map((template, index) => {
                const isSystem = template.filePath.startsWith('system_');
                return (
                  <div
                    key={template.filePath}
                    className={'suggestion-item' + (index === selectedIndex ? ' suggestion-item--active' : '')}
                    onClick={() => handleSelectTemplate(template)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="loading-file-row">
                      {isSystem ? (
                        <Terminal size={13} className="loading-file-icon" style={{ color: 'var(--accent-color, #8b5cf6)' }} />
                      ) : (
                        <FileText size={13} className="loading-file-icon" />
                      )}
                      <div className="loading-file-info">
                        <div className="suggestion-name">
                          /{template.name}
                          {template.argumentHint && <span className="suggestion-hint">{template.argumentHint}</span>}
                        </div>
                        <div className="suggestion-desc">{template.description}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div className="composer-row">
          <div className="composer-plus-wrap">
            <button className="plus-btn" onClick={() => setShowActionMenu(!showActionMenu)}>
              <Plus size={16} />
            </button>
            {showActionMenu && (
              <div className="action-menu">
                {[
                  { icon: <Target size={14} />, label: '执行目标', action: () => { if (!isStreaming) { setGoalPromptValue(''); setGoalPromptOpen(true); } } },
                  { icon: <FileText size={14} />, label: '压缩上下文', action: () => !isStreaming && onSend('/compact') },
                  { icon: <Sparkles size={14} />, label: 'Token 统计', action: () => !isStreaming && onSend('/tokens') },
                ].map((item) => (
                  <button key={item.label} className="action-menu-item" onClick={() => { item.action(); setShowActionMenu(false); }}>
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-input-wrap">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息... (Enter 发送)"
              className="composer-input"
              rows={1}
            />
          </div>
          <div className="composer-send-wrap">
            <button
              onClick={isStreaming ? onStop : (hasInput ? handleSubmit : undefined)}
              disabled={!isStreaming && !hasInput}
              className={`send-btn ${(!hasInput && !isStreaming) ? 'send-btn--disabled' : ''}`}
            >
              {isStreaming ? <Square size={16} /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
      {apiSettings && onUpdateSettings && (
        <div className="input-footer">
          <div className="input-footer-left" style={{ position: 'relative' }}>
            <button
              className="model-name-btn"
              onClick={() => setShowModelMenu(!showModelMenu)}
            >
              {(() => {
                const activeProfile = (apiSettings.modelProfiles || []).find(p => p.id === apiSettings.activeModelProfileId);
                if (!activeProfile) return apiSettings.model;
                const hasModelInName = activeProfile.name.includes(activeProfile.model);
                return hasModelInName ? activeProfile.name : `${activeProfile.name} (${activeProfile.model})`;
              })()}
            </button>

            {showModelMenu && (
              <div
                ref={popoverRef}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 8,
                  width: 320,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 130,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  padding: 14,
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>⚙️ 快速配置模型</span>
                  <button 
                    onClick={() => setShowModelMenu(false)} 
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Profile Selector */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>当前配置方案</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={apiSettings.activeModelProfileId}
                      onChange={(e) => {
                        const profileId = e.target.value;
                        const profile = (apiSettings.modelProfiles || []).find(p => p.id === profileId);
                        if (profile) {
                          const newSettings = {
                            ...apiSettings,
                            activeModelProfileId: profileId,
                            model: profile.model,
                            apiKey: profile.apiKey,
                            baseURL: profile.baseURL,
                            reasoningEffort: profile.reasoningEffort || 'none',
                            maxTokens: profile.maxTokens || 4096,
                          };
                          onUpdateSettings(newSettings);
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {(apiSettings.modelProfiles || []).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        onOpenSettings?.();
                        setShowModelMenu(false);
                      }}
                      title="进入高级配置中心进行新增或删除..."
                      style={{
                        padding: '0 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'var(--bg-hover)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {/* Model ID */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>开发模型名称 (Model ID)</label>
                  <input
                    type="text"
                    value={apiSettings.model}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      const updatedProfiles = (apiSettings.modelProfiles || []).map(p => {
                        if (p.id === apiSettings.activeModelProfileId) {
                          const updatedName = (p.name === '新模型配置' || p.name.startsWith('默认配置 (')) 
                            ? `默认配置 (${newModel})` 
                            : p.name;
                          return { ...p, model: newModel, name: updatedName };
                        }
                        return p;
                      });
                      onUpdateSettings({
                        ...apiSettings,
                        model: newModel,
                        modelProfiles: updatedProfiles,
                      });
                    }}
                    placeholder="如 deepseek-v4-pro..."
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  
                  {/* Quick Preset Selector */}
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 500 }}>
                      ⚡ 快速切换同 API 下的模型：
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[
                        'deepseek-v4-flash',
                        'deepseek-v4-pro',
                        'gpt-5.5-cyber',
                        'claude-sonnet-4.6',
                        'gemini-3.5-flash',
                      ].map((m) => {
                        const isActive = apiSettings.model === m;
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              const updatedProfiles = (apiSettings.modelProfiles || []).map(p => {
                                if (p.id === apiSettings.activeModelProfileId) {
                                  const updatedName = (p.name === '新模型配置' || p.name.startsWith('默认配置 (')) 
                                    ? `默认配置 (${m})` 
                                    : p.name;
                                  return { ...p, model: m, name: updatedName };
                                }
                                return p;
                              });
                              onUpdateSettings({
                                ...apiSettings,
                                model: m,
                                modelProfiles: updatedProfiles,
                              });
                            }}
                            style={{
                              padding: '3px 6px',
                              borderRadius: 4,
                              border: '1px solid ' + (isActive ? 'var(--accent-primary)' : 'var(--border-subtle)'),
                              background: isActive ? 'rgba(139, 92, 246, 0.12)' : 'var(--bg-elevated)',
                              color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                              fontSize: 10.5,
                              cursor: 'pointer',
                              transition: 'all 0.1s',
                              fontWeight: isActive ? 600 : 400,
                            }}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>API Base URL</label>
                  <input
                    type="text"
                    value={apiSettings.baseURL}
                    onChange={(e) => {
                      const newURL = e.target.value;
                      const updatedProfiles = (apiSettings.modelProfiles || []).map(p => {
                        if (p.id === apiSettings.activeModelProfileId) {
                          return { ...p, baseURL: newURL };
                        }
                        return p;
                      });
                      onUpdateSettings({
                        ...apiSettings,
                        baseURL: newURL,
                        modelProfiles: updatedProfiles,
                      });
                    }}
                    placeholder="https://api.deepseek.com"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* API Key */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>API Key</label>
                  <input
                    type="password"
                    value={apiSettings.apiKey}
                    onChange={(e) => {
                      const newKey = e.target.value;
                      const updatedProfiles = (apiSettings.modelProfiles || []).map(p => {
                        if (p.id === apiSettings.activeModelProfileId) {
                          return { ...p, apiKey: newKey };
                        }
                        return p;
                      });
                      onUpdateSettings({
                        ...apiSettings,
                        apiKey: newKey,
                        modelProfiles: updatedProfiles,
                      });
                    }}
                    placeholder="sk-..."
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Advanced Shortcut */}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    onClick={() => {
                      onOpenSettings?.();
                      setShowModelMenu(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'var(--accent-primary)',
                      color: 'white',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      transition: 'background 0.15s',
                    }}
                  >
                    ⚙️ 进入高级配置中心...
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="input-footer-right">
            <div className="reasoning-toggle-group">
              <span className="reasoning-toggle-label">推理:</span>
              <div className="reasoning-toggle-bar">
                {(['none', 'auto', 'low', 'medium', 'high'] as const).map((level) => {
                  const isActive = (apiSettings.reasoningEffort ?? 'none') === level;
                  return (
                    <button
                      key={level}
                      className={'reasoning-toggle-btn' + (isActive ? ' reasoning-toggle-btn--active' : '')}
                      onClick={() => {
                        const newSettings = { ...apiSettings, reasoningEffort: level };
                        if (newSettings.modelProfiles && newSettings.activeModelProfileId) {
                          newSettings.modelProfiles = newSettings.modelProfiles.map(
                            p => p.id === newSettings.activeModelProfileId ? { ...p, reasoningEffort: level } : p
                          );
                        }
                        onUpdateSettings(newSettings);
                      }}
                    >
                      {level === 'none' ? 'Off' : level === 'auto' ? 'Auto' : level === 'low' ? 'Low' : level === 'medium' ? 'Med' : 'High'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="input-brand">PianoAgent</div>
        </div>
      )}
      {goalPromptOpen && (
        <div className="goal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setGoalPromptOpen(false); }}>
          <div className="animate-scale-in goal-modal">
            <div className="goal-modal-header">
              <div className="goal-modal-icon">
                <Target size={16} className="goal-modal-target-icon" />
              </div>
              <span className="goal-modal-title">启动自动追踪目标 (Launch Goal Mode)</span>
            </div>
            <div className="goal-modal-desc">
              自动追踪模式（Goal Mode）允许 AI 在后台自动规划并执行一系列子任务。
            </div>
            <textarea
              autoFocus
              value={goalPromptValue}
              onChange={(e) => setGoalPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (goalPromptValue.trim()) { onSend('/goal ' + goalPromptValue.trim()); setGoalPromptOpen(false); }
                } else if (e.key === 'Escape') setGoalPromptOpen(false);
              }}
              placeholder="请输入该会话需要 AI 自动达成的最终目标..."
              className="composer-input goal-modal-textarea"
            />
            <div className="goal-modal-actions">
              <button className="goal-btn goal-btn--cancel" onClick={() => setGoalPromptOpen(false)}>取消</button>
              <button
                className={'goal-btn goal-btn--confirm' + (!goalPromptValue.trim() ? '' : '')}
                disabled={!goalPromptValue.trim()}
                onClick={() => { if (goalPromptValue.trim()) { onSend('/goal ' + goalPromptValue.trim()); setGoalPromptOpen(false); } }}
              >
                确认启动
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default memo(InputArea);
