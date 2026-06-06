# 附件功能说明

## 功能概述

附件功能允许用户在发送消息时附加文件、图片或代码片段。

## 使用方法

### 1. 添加附件

点击输入框左侧的 📎 按钮，会打开文件选择对话框。

**支持的文件类型**:
- 📄 普通文件 (txt, pdf, doc 等)
- 🖼️ 图片文件 (jpg, png, gif, svg 等)
- 💻 代码文件 (js, ts, py, java, cpp, css, html 等)

### 2. 粘贴图片

直接在输入框中粘贴剪贴板中的图片：
- 按 `Ctrl+V` 粘贴截图或图片
- 图片会自动添加到附件列表

### 3. 拖拽上传

直接将文件拖拽到输入框区域：
- 拖拽时会显示紫色虚线边框和上传图标
- 支持同时拖拽多个文件
- 自动识别文件类型并添加到附件列表

### 4. 预览附件

添加附件后，会在输入框上方显示附件预览：
- 文件名
- 文件类型图标
- 文件大小
- 删除按钮

### 5. 发送附件

附件会随消息一起发送，AI 会自动分析附件内容。

## 功能特点

1. **多种添加方式**
   - 点击按钮选择文件
   - 粘贴剪贴板图片
   - 拖拽文件上传

2. **智能识别**
   - 自动识别文件类型
   - 代码文件语法高亮
   - 图片预览

3. **大小限制**
   - 单个文件最大 10MB
   - 总附件大小最大 50MB

4. **安全处理**
   - 文件内容加密传输
   - 敏感文件警告
   - 文件类型验证

## 支持的文件格式

### 代码文件
- JavaScript (.js, .jsx, .mjs)
- TypeScript (.ts, .tsx)
- Python (.py)
- Java (.java)
- C/C++ (.c, .cpp, .h)
- C# (.cs)
- Go (.go)
- Rust (.rs)
- PHP (.php)
- Ruby (.rb)
- Swift (.swift)
- Kotlin (.kt)
- SQL (.sql)
- Shell (.sh, .bash)
- PowerShell (.ps1)

### 样式文件
- CSS (.css)
- SCSS (.scss)
- SASS (.sass)
- LESS (.less)
- Tailwind (.tw)

### 标记语言
- HTML (.html, .htm)
- XML (.xml)
- Markdown (.md)
- YAML (.yml, .yaml)
- JSON (.json)
- TOML (.toml)

### 图片文件
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- SVG (.svg)
- WebP (.webp)
- BMP (.bmp)
- ICO (.ico)

### 文档文件
- Text (.txt)
- PDF (.pdf)
- Word (.doc, .docx)
- Excel (.xls, .xlsx)
- PowerPoint (.ppt, .pptx)

## 代码示例

### 添加附件
```typescript
// 点击附件按钮
const handleFileSelect = async () => {
  const filePath = await window.electronAPI.openDirectory();
  if (filePath) {
    await addAttachment(filePath);
  }
};
```

### 处理粘贴
```typescript
// 处理粘贴事件
const handlePaste = async (e: React.ClipboardEvent) => {
  const items = e.clipboardData?.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      // 处理图片...
    }
  }
};
```

### 处理拖拽
```typescript
// 处理拖拽事件
const handleDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  setIsDragging(false);
  
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      await addAttachmentFromFile(files[i]);
    }
  }
};
```

### 发送附件
```typescript
// 发送带附件的消息
const handleSubmit = () => {
  let message = input.trim();
  
  if (attachments.length > 0) {
    const attachmentInfo = attachments.map(att => 
      `[附件: ${att.name}]`
    ).join('\n');
    
    message = `${message}\n\n${attachmentInfo}`;
  }
  
  onSend(message, attachments);
};
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+V` | 粘贴图片 |
| `Ctrl+Shift+V` | 粘贴为纯文本 |
| `Delete` | 删除选中附件 |
| `Escape` | 取消文件选择 |
| 拖拽文件 | 上传附件 |

## 注意事项

1. **文件大小限制**
   - 单个文件不超过 10MB
   - 总附件大小不超过 50MB

2. **安全提示**
   - 不要附加敏感文件（如密码、密钥）
   - 检查文件内容再发送
   - 注意文件编码格式

3. **性能优化**
   - 大文件会自动压缩
   - 代码文件会截断过长内容
   - 图片会自动缩放

## 故障排除

### 无法添加附件
- 检查文件路径是否正确
- 确认文件存在且可读
- 检查文件权限

### 附件显示异常
- 刷新页面重试
- 检查文件格式是否支持
- 查看控制台错误信息

### 发送失败
- 检查网络连接
- 确认文件大小未超限
- 查看 API 错误信息

## 更新日志

### v1.1.0 (2026-05-28)
- 添加拖拽上传功能
- 支持多文件同时拖拽
- 拖拽时显示视觉反馈

### v1.0.0 (2026-05-28)
- 初始版本发布
- 支持文件选择
- 支持图片粘贴
- 支持附件预览
- 支持多种文件格式
