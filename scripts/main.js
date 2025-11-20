import { createApp } from './modules/app.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.exifEditorApp = createApp();
  });
} else {
  window.exifEditorApp = createApp();
}
