# Pi Agent Desktop

Pi Agent Desktop is an unofficial desktop client for the open-source Pi coding agent.

Pi Agent Desktop 是一个面向通用用户的桌面客户端，基于开源 Pi coding agent 构建。

## Download / 下载

Current release: `v1.0.16`

- GitHub Releases: [Latest release](https://github.com/tzynb112/pi-agent-desktop/releases/latest)
- Windows installer: [PianoAgent Desktop Setup 1.0.16.exe](https://github.com/tzynb112/pi-agent-desktop/releases/download/v1.0.16/PianoAgent.Desktop.Setup.1.0.16.exe)
- Windows portable: [PianoAgent Desktop 1.0.16.exe](https://github.com/tzynb112/pi-agent-desktop/releases/download/v1.0.16/PianoAgent.Desktop.1.0.16.exe)
- Source build: `npm run start`

## Quick Start / 快速开始

1. Double-click `start.bat`.
2. Or run:

The app starts the renderer on `http://localhost:9000` and opens the Electron window once the main process is ready.

## Scripts / 脚本

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

## Project Layout / 项目结构

- `src/main/`: Electron main process, IPC handlers, file access, tool execution, persistence
- `src/renderer/`: React UI, chat flow, goal runtime, settings, file tree, styles
- `dist/`: build output

Key entry points:

- `src/main/main.ts`
- `src/main/preload.ts`
- `src/renderer/index.tsx`
- `src/renderer/index.html`

## Notes / 说明

- `src/renderer/index.html` is the renderer template used by webpack.
- `node_modules/`, `dist/`, logs, and local tool directories are ignored from version control.
- Local Codex workspace data lives under `.arts/` and `.codeartsdoer/` and is treated as environment state, not product code.
- At the moment, the official release package is for Windows only.
- Conversations and settings are stored in the local user profile, so reinstalling the app does not clear them automatically.

