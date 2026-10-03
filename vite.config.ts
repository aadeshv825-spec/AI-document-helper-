
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  // Android release builds must point at an explicit HTTPS backend.
  // The CI release workflow sets REQUIRE_API_BASE_URL=true.
  if (command === 'build' && process.env.REQUIRE_API_BASE_URL === 'true') {
    const apiBaseUrl = process.env.VITE_API_BASE_URL || '';

    if (!/^https:\/\/[^/\s]+/i.test(apiBaseUrl)) {
      throw new Error(
        'VITE_API_BASE_URL must be set to the production https:// backend URL for this build.'
      );
    }

    if (/ais-dev-|localhost|127\.0\.0\.1/i.test(apiBaseUrl)) {
      throw new Error(
        'VITE_API_BASE_URL points to a development backend; use the production URL.'
      );
    }
  }

  return {
    // Required for Android WebView's nested asset path.
    base: './',

    plugins: [react(), tailwindcss()],

    build: {
      rollupOptions: {
        output: {
          // The Android WebView asset loader may not know the .mjs MIME
          // type, and module workers require a JavaScript MIME type, so
          // emit the PDF.js worker with a .js extension.
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] || assetInfo.name || '';
            return name.endsWith('.mjs')
              ? 'assets/[name]-[hash].js'
              : 'assets/[name]-[hash][extname]';
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
