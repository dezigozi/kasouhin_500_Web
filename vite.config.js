import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import os from 'os'
import { execSync } from 'child_process'

/** public/data/master_data.csv の最終gitコミット日を取得 */
function getCsvCommitDate() {
  try {
    const out = execSync(
      'git log -1 --format=%ci -- public/data/master_data.csv',
      { encoding: 'utf8' }
    ).trim();
    if (!out) return null;
    const d = new Date(out);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __CSV_COMMIT_DATE__: JSON.stringify(getCsvCommitDate()),
  },
  // Dropbox 配下での同期ロック問題を回避するためキャッシュをシステムの一時フォルダに移動
  cacheDir: resolve(os.tmpdir(), 'vite-cache-kasouhin-500'),
})
