// scripts/generate-headers.mjs (ESM; Node 18+)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// Toggle threads headers with: THREADS=1 npm run build
const THREADS = process.env.THREADS === "1";

const coopCoepBlock = THREADS
  ? `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n`
  : ``;

// --- Netlify & Cloudflare Pages: dist/_headers ---
// We cover BOTH places Vite may put wasm:
//  - root (because you copy from public/ → dist/)
//  - /assets (if a plugin emits there)
const headers_netlify_cf =
`${coopCoepBlock}${coopCoepBlock ? "\n" : ""}/*.wasm
  Content-Type: application/wasm
  Cache-Control: public, max-age=31536000, immutable
${THREADS ? "  Cross-Origin-Resource-Policy: same-origin\n" : ""}
/assets/*.wasm
  Content-Type: application/wasm
  Cache-Control: public, max-age=31536000, immutable
${THREADS ? "  Cross-Origin-Resource-Policy: same-origin\n" : ""}`.trim();

// --- Optional: Vercel at repo root ---
const vercelJson = {
  headers: [
    ...(THREADS
      ? [{
          source: "/(.*)",
          headers: [
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
            { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          ],
        }]
      : []),
    {
      source: "/:path*.wasm",
      headers: [
        { key: "Content-Type", value: "application/wasm" },
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ...(THREADS
          ? [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }]
          : []),
      ],
    },
  ],
};

// --- Optional: Render static sites ---
const staticJson = {
  routes: [],
  headers: [
    ...(THREADS
      ? [
          { path: "/*", name: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { path: "/*", name: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ]
      : []),
    { path: "/*.wasm", name: "Content-Type", value: "application/wasm" },
    { path: "/*.wasm", name: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ...(THREADS
      ? [{ path: "/*.wasm", name: "Cross-Origin-Resource-Policy", value: "same-origin" }]
      : []),
  ],
};

// --- S3/CloudFront + Nginx/Apache helper notes (optional artifacts) ---
const s3Md =
`# S3 + CloudFront
Set on each .wasm object:
- Content-Type: application/wasm
- Cache-Control: public, max-age=31536000, immutable
${THREADS ? `
Add response headers (CloudFront Response Headers Policy):
- Cross-Origin-Opener-Policy: same-origin
- Cross-Origin-Embedder-Policy: require-corp
- Cross-Origin-Resource-Policy: same-origin` : ``}`.trim();

const nginxConf =
`# Nginx snippet
${THREADS ? `add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";` : ``}

types { application/wasm wasm; }

location ~* \\.wasm$ {
  default_type application/wasm;
  add_header Cache-Control "public, max-age=31536000, immutable";
  ${THREADS ? `add_header Cross-Origin-Resource-Policy "same-origin";` : ``}
}`.trim();

const htaccess =
`${THREADS ? `Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp"` : ``}

<FilesMatch "\\.(wasm)$">
  ForceType application/wasm
  Header set Cache-Control "public, max-age=31536000, immutable"
  ${THREADS ? `Header set Cross-Origin-Resource-Policy "same-origin"` : ``}
</FilesMatch>`.trim();

// --- write files ---
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, "_headers"), headers_netlify_cf + "\n");
fs.writeFileSync(path.join(ROOT, "vercel.json"), JSON.stringify(vercelJson, null, 2) + "\n");
fs.writeFileSync(path.join(ROOT, "static.json"), JSON.stringify(staticJson, null, 2) + "\n");
fs.writeFileSync(path.join(DIST, "headers.s3.md"), s3Md + "\n");
fs.writeFileSync(path.join(DIST, "headers.nginx.conf"), nginxConf + "\n");
fs.writeFileSync(path.join(DIST, ".htaccess.example"), htaccess + "\n");

console.log(`✅ Emitted:
- dist/_headers (Netlify/Cloudflare)
- vercel.json (repo root, optional)
- static.json (Render, optional)
- dist/headers.s3.md
- dist/headers.nginx.conf
- dist/.htaccess.example
${THREADS ? "(Threads-ready: COOP/COEP included)" : "(SIMD-only)"}`);
