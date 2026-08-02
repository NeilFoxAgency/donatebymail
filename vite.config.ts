import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const shellTag = '<script src="/site-shell.js" defer></script>';
const withSiteShell = (html: string) => html.includes('site-shell.js') ? html : html.replace('</body>', `${shellTag}</body>`);

export default defineConfig({
    plugins: [react(), { name: 'shared-site-shell', transformIndexHtml: withSiteShell, closeBundle() { const dist = resolve(process.cwd(), 'dist'); for (const file of readdirSync(dist)) { if (!file.endsWith('.html')) continue; const path = resolve(dist, file); writeFileSync(path, withSiteShell(readFileSync(path, 'utf8'))); } } }],
    base: '/',
    build: {
        rollupOptions: {
            input: ['index.html', 'donate-phone.html', 'articles.html'],
            maxParallelFileOps: 128,
        },
    },
});
