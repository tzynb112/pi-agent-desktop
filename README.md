# Pi Agent Desktop

Pi Agent Desktop 是一个面向普通用户的桌面客户端，基于开源 Pi coding agent 构建。

## Download / 下载

Current release: `v1.0.5`

- GitHub Releases: [Latest release](https://github.com/tzynb112/pi-agent-desktop/releases/latest)
- Windows installer: [PianoAgent Desktop Setup 1.0.5.exe](https://github.com/tzynb112/pi-agent-desktop/releases/download/v1.0.5/PianoAgent.Desktop.Setup.1.0.5.exe)
- Windows portable: [PianoAgent Desktop 1.0.5.exe](https://github.com/tzynb112/pi-agent-desktop/releases/download/v1.0.5/PianoAgent.Desktop.1.0.5.exe)
- Source build: `npm run start`

## Quick Start

1. Install dependencies with `npm install`.
2. Run the app with `npm run start` or double-click `start.bat` on Windows.

The renderer runs on `http://localhost:9000` during development.

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
- `test`: runs the TypeScript typecheck

## Project Layout

- `src/main/`: Electron main process, IPC handlers, file access, tool execution, persistence
- `src/renderer/`: React UI, chat flow, goal runtime, settings, file tree, styles
- `src/shared/`: shared IPC types and workflow logic

Key entry points:

- `src/main/main.ts`
- `src/main/preload.ts`
- `src/renderer/index.tsx`

## Notes

- `src/renderer/index.html` is the renderer template used by webpack.
- `node_modules/` and `dist/` are build outputs and stay out of version control.
- 发布版本在 [GitHub Releases](https://github.com/tzynb112/pi-agent-desktop/releases/latest) 页面下载。
- 目前正式发布包只有 Windows 版本。
