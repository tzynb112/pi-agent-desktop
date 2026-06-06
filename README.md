# Pi Agent Desktop

Unofficial desktop client for the open-source Pi coding agent.

## Quick Start

1. Install dependencies with `npm install`.
2. Run the app with `npm run start` or double-click `start.bat` on Windows.

The renderer runs on `http://localhost:9000` during development.

## Downloads

Published installers are attached to [GitHub Releases](https://github.com/tzynb112/pi-agent-desktop/releases).

- Windows: `.exe` installer
- macOS: `.dmg` and `.zip`
- Linux: `.AppImage`

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
