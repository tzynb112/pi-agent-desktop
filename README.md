# PianoAgent

Electron + React + TypeScript desktop app for chat-driven coding, file operations, tool execution, and goal queue workflows.

## Download

- Latest Windows release: [GitHub Releases](https://github.com/tzynb112/pi-agent-desktop/releases/latest)
- Source build: `npm run start`

## Quick Start

1. Double-click `start.bat`.
2. Or run:

```bash
npm run start
```

The app starts the renderer on `http://localhost:9000` and opens the Electron window once the main process is ready.

## Scripts

```bash
npm run start
npm run build
npm run typecheck
npm test
```

- `start`: runs the renderer dev server and Electron main process together
- `build`: builds the renderer bundle and the Electron main bundle
- `typecheck`: runs TypeScript without emitting files
- `test`: runs `verify_all.py`

## Project Layout

- `src/main/`: Electron main process, IPC handlers, file access, tool execution, persistence
- `src/renderer/`: React UI, chat flow, goal runtime, settings, file tree, styles
- `dist/`: build output

Key entry points:

- `src/main/main.ts`
- `src/main/preload.ts`
- `src/renderer/index.tsx`
- `src/renderer/index.html`

## Notes

- `src/renderer/index.html` is the renderer template used by webpack.
- `node_modules/`, `dist/`, logs, and local tool directories are ignored from version control.
- Local Codex workspace data lives under `.arts/` and `.codeartsdoer/` and is treated as environment state, not product code.

## 中文说明

PianoAgent 是一个基于 Electron + React + TypeScript 的桌面端 AI 编程助手，支持：

- 对话式编程
- 文件读写与 shell 工具调用
- 自定义工具与 MCP 工具
- 目标队列与自动恢复

### 下载

- 最新 Windows 安装包： [GitHub Releases](https://github.com/tzynb112/pi-agent-desktop/releases/latest)
- 源码运行：`npm run start`

### 本地构建

```bash
npm run build
npm run package:win
```
