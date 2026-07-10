// scripts/build.js
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const templates = ['index.html', 'johor.html'];
templates.forEach(name => {
  const src = path.join(__dirname, '..', 'src', 'template', name);
  const dest = path.join(publicDir, name);
  fs.copyFileSync(src, dest);
  console.log(`✓ Build complete → public/${name}`);
});
