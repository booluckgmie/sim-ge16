// scripts/build.js
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const src = path.join(__dirname, '..', 'src', 'template', 'index.html');
const dest = path.join(publicDir, 'index.html');
fs.copyFileSync(src, dest);
console.log('✓ Build complete → public/index.html');
