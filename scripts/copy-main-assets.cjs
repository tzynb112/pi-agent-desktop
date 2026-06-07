const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'src', 'main');
const targetDir = path.join(root, 'dist', 'main');
const assets = ['icon.png', 'icon.ico'];

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of assets) {
  const sourcePath = path.join(sourceDir, fileName);
  const targetPath = path.join(targetDir, fileName);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing main asset: ${sourcePath}`);
  }

  fs.copyFileSync(sourcePath, targetPath);
}

console.log(`Copied main assets to ${targetDir}`);
