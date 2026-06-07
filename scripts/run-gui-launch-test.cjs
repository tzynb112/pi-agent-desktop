const { execFileSync } = require('child_process');
const { rmSync } = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, '.tmp-test');
const tscBin = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const testFile = path.join(rootDir, 'tests', 'gui-launch-detection.test.ts');
const compiledTestFile = path.join(outDir, 'tests', 'gui-launch-detection.test.js');

try {
  execFileSync(process.execPath, [
    tscBin,
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--rootDir', rootDir,
    '--outDir', outDir,
    testFile,
  ], { stdio: 'inherit' });

  execFileSync(process.execPath, [compiledTestFile], { stdio: 'inherit' });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
