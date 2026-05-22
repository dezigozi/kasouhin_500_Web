/**
 * CSV ローダー
 *
 * パフォーマンスのコア設計:
 *  1. fetch + パース処理は Web Worker に委譲（メインスレッドを止めない）
 *  2. ETag による条件付きGET → 内容に変更がなければ 304 で通信短絡
 *  3. パース済みデータを IndexedDB にキャッシュ → 2回目以降は瞬時表示
 *
 * onProgress(message) を渡せばロード経過のメッセージを受け取れる。
 */
import CsvWorker from './csvWorker.js?worker';
import { getCache, setCache } from './db.js';

const CSV_URL = '/data/master_data.csv';
const CACHE_KEY_DATA = 'csv_parsed_v1';
const CACHE_KEY_ETAG = 'csv_etag_v1';

export async function loadCsvData(onProgress) {
  const notify = (msg) => { try { onProgress?.(msg); } catch { /* noop */ } };

  let cachedData = null;
  let cachedEtag = null;
  try {
    [cachedData, cachedEtag] = await Promise.all([
      getCache(CACHE_KEY_DATA),
      getCache(CACHE_KEY_ETAG),
    ]);
  } catch (err) {
    console.warn('IndexedDB 読み込みに失敗:', err);
  }

  if (cachedData) {
    notify('キャッシュを確認中...');
  } else {
    notify('初回ロード中（少し時間がかかります）...');
  }

  let workerResult;
  try {
    workerResult = await runCsvWorker({
      url: CSV_URL,
      etag: cachedEtag,
      onProgress: notify,
    });
  } catch (err) {
    if (cachedData) {
      console.warn('CSV取得失敗のためキャッシュを使用:', err);
      notify('オフライン: 保存済みデータを表示');
      return cachedData;
    }
    throw err;
  }

  if (workerResult.notModified) {
    if (cachedData) {
      notify('更新なし: キャッシュから読み込み完了');
      return cachedData;
    }
    console.warn('304 だがキャッシュなし。再フェッチします');
    workerResult = await runCsvWorker({ url: CSV_URL, etag: null, onProgress: notify });
  }

  const { result, etag } = workerResult;
  if (!result) {
    throw new Error('Worker からデータが返りませんでした');
  }

  notify('データを保存中...');
  try {
    await setCache(CACHE_KEY_DATA, result);
    if (etag) await setCache(CACHE_KEY_ETAG, etag);
  } catch (err) {
    console.warn('IndexedDB 書き込みに失敗（キャッシュ無効化）:', err);
  }

  return result;
}

function runCsvWorker({ url, etag, onProgress }) {
  return new Promise((resolve, reject) => {
    const worker = new CsvWorker();
    let settled = false;

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.message);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      if (msg.ok) {
        resolve(msg);
      } else {
        reject(new Error(msg.error || 'Worker error'));
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(err.message || 'Worker crashed'));
    };

    worker.postMessage({ url, etag });
  });
}
