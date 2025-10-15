#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const requiredArtifacts = [
  'wasm/cluster-lights.wasm',
  'wasm/cluster-lights-simd.wasm',
  'wasm/cluster-lights-asm.js',
];

const missing = requiredArtifacts.filter((relativePath) => {
  const absolutePath = path.join(projectRoot, relativePath);
  return !fs.existsSync(absolutePath);
});

if (missing.length) {
  console.error(
    `Missing prebuilt WebAssembly artifacts:\n${missing
      .map((file) => ` - ${file}`)
      .join('\n')}\n\nRun the appropriate wasm build scripts before publishing.`
  );
  process.exit(1);
}

console.log('All prebuilt WebAssembly artifacts are present.');
