import React, { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, Edit3, Save, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { PromptTemplate } from '../../utils/prompt-templates';
import { loadAllTemplates, saveTemplate, deleteTemplate } from '../../utils/prompt-templates';

interface PromptTemplatesConfigProps {
  globalDir?: string;
  projectDir?: string;
  readFile: (path: string) => Promise<string | null>;
  readDir: (path: string) => Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  writeFile: (path: string, content: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;
  onTemplatesChange?: (templates: PromptTemplate[]) => void;
}

const PromptTemplatesConfig: React.FC<PromptTemplatesConfigProps> = ({
  globalDir = 'C:\\Users\\Administrator\\.pi\\agent\\prompts',
  projectDir,
  readFile,
  readDir,
  writeFile,
  deleteFile,
  onTemplatesChange,
}) => {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formContent, setFormContent] = useState('');

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const loaded = await loadAllTemplates(readFile, readDir, globalDir, projectDir);
      setTemplates(loaded);
      onTemplatesChange?.(loaded);
    } catch (err) {
      console.error('[PromptTemplatesConfig] Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [globalDir, projectDir]);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingId(null);
    setFormName('');
    setFormDescription('');
    setFormContent('');
  };

  const handleEdit = (template: PromptTemplate) => {
    setEditingId(template.filePath);
    setIsCreating(false);
    setFormName(template.name);
    setFormDescription(template.description);
    setFormContent(template.content);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;

    const targetDir = globalDir;
    const success = await saveTemplate(formName, formDescription, formContent, targetDir, writeFile);

    if (success) {
      await loadTemplates();
      setIsCreating(false);
      setEditingId(null);
      setFormName('');
      setFormDescription('');
      setFormContent('');
    }
  };

  const handleDelete = async (template: PromptTemplate) => {
    if (!confirm(`确定要删除模板 "${template.name}" 吗？`)) return;

    const success = await deleteTemplate(template.filePath, deleteFile);
    if (success) {
      await loadTemplates();
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormName('');
    setFormDescription('');
    setFormContent('');
  };

  const renderForm = () => (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: '1px solid var(--accent-primary)',
        background: 'var(--bg-elevated)',
        marginBottom: 12,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          模板名称 (命令名)
        </label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="例如: review, test, refactor"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          使用时输入 /{formName || 'name'} 即可触发
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          描述
        </label>
        <input
          type="text"
          value={formDescription}
          onChange={(e) => setFormDescription(e.target.value)}
          placeholder="简要描述模板的用途"
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
          模板内容
        </label>
        <textarea
          value={formContent}
          onChange={(e) => setFormContent(e.target.value)}
          placeholder="输入模板内容...&#10;&#10;支持参数:&#10;$1, $2, ... - 位置参数&#10;$@ 或 $ARGUMENTS - 所有参数&#10;${@:N} - 从第N个参数开始&#10;${@:N:L} - 从第N个参数开始的L个参数"
          rows={8}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'var(--font-mono)',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={handleCancel}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <X size={14} />
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!formName.trim()}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            background: 'var(--accent-primary)',
            color: 'white',
            fontSize: 12,
            cursor: formName.trim() ? 'pointer' : 'not-allowed',
            opacity: formName.trim() ? 1 : 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Save size={14} />
          保存
        </button>
      </div>
    </div>
  );

  const renderTemplate = (template: PromptTemplate) => {
    const isExpanded = expandedId === template.filePath;
    const isEditing = editingId === template.filePath;

    if (isEditing) {
      return renderForm();
    }

    return (
      <div
        key={template.filePath}
        style={{
          padding: 12,
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          opacity: 1,
          transition: 'all 0.2s',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
          onClick={() => setExpandedId(isExpanded ? null : template.filePath)}
        >
          <div className="settings-row">
            <FileText size={16} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <div className="pkg-card-name">
                /{template.name}
                {template.argumentHint && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {template.argumentHint}
                  </span>
                )}
              </div>
              <div className="pkg-card-desc">
                {template.description}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                background: template.source === 'global' ? 'var(--accent-primary)' : 'var(--accent-secondary)',
                color: 'white',
              }}
            >
              {template.source === 'global' ? '全局' : '项目'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(template);
              }}
              style={{
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
              title="编辑"
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(template);
              }}
              style={{
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
              title="删除"
            >
              <Trash2 size={14} />
            </button>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </div>

        {isExpanded && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 6,
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {template.content}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
            提示模板 (Prompt Templates)
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
            创建可复用的提示模板，输入 /名称 快速调用。支持 $1、$@ 等参数占位符。
          </div>
        </div>
        <button
          onClick={handleCreate}
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
          新建模板
        </button>
      </div>

      {isCreating && renderForm()}

      <div
        className="scrollbar-thin"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: '45vh',
          overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {loading ? (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            加载中...
          </div>
        ) : templates.length === 0 ? (
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
            暂无提示模板，点击上方按钮新建一个吧
          </div>
        ) : (
          templates.map(renderTemplate)
        )}
      </div>

      <div
        style={{
          padding: 12,
          borderRadius: 8,
          background: 'var(--bg-overlay)',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>💡 使用说明</div>
        <div>• 在输入框中输入 <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>/模板名</code> 即可触发模板</div>
        <div>• 支持参数: <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>$1</code> <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>$2</code> 位置参数，<code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>$@</code> 所有参数</div>
        <div>• 模板保存位置: <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3 }}>~/.pi/agent/prompts/</code></div>
      </div>
    </div>
  );
};

export default PromptTemplatesConfig;
