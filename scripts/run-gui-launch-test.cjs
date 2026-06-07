const { execFileSync } = require('child_process');
const { readdirSync, rmSync } = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, '.tmp-test');
const tscBin = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const testDir = path.join(rootDir, 'tests');
const testFiles = readdirSync(testDir)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => path.join(testDir, file));

try {
  if (testFiles.length === 0) {
    console.log('No test files found.');
    process.exit(0);
  }

  execFileSync(process.execPath, [
    tscBin,
    '--target', 'ES2020',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--rootDir', rootDir,
    '--outDir', outDir,
    ...testFiles,
  ], { stdio: 'inherit' });

  for (const file of testFiles) {
    const compiledTestFile = path.join(outDir, path.relative(rootDir, file)).replace(/\.ts$/, '.js');
    execFileSync(process.execPath, [compiledTestFile], { stdio: 'inherit' });
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
