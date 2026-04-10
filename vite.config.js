import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import os from 'os'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dropbox 配下での同期ロック問題を回避するためキャッシュをシステムの一時フォルダに移動
  cacheDir: resolve(os.tmpdir(), 'vite-cache-kasouhin-500'),
})
