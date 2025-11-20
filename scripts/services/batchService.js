export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

export async function processBatch(items, handler, callbacks = {}) {
  const results = [];
  const errors = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    try {
      callbacks.onProgress?.((i + 1) / items.length, `处理 ${item.name}`);
      const payload = await handler(item, i);
      results.push({ item, index: i, value: payload });
      callbacks.onItemComplete?.(item, payload, i);
    } catch (error) {
      errors.push({ item, index: i, error });
      callbacks.onItemError?.(item, error, i);
    }
  }
  callbacks.onProgress?.(1, '处理完成');
  return { results, errors };
}

export async function downloadAsZip(items, filename = 'exif_batch.zip') {
  if (!window.JSZip || !window.saveAs) {
    throw new Error('压缩组件未加载');
  }
  const zip = new window.JSZip();
  for (const item of items) {
    const buffer = await item.file.arrayBuffer();
    zip.file(item.name, buffer);
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  window.saveAs(blob, filename);
}
