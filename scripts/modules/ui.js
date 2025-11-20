const THEME_KEY = 'exifeditor-theme';

export function createUI() {
  const toastContainer = document.getElementById('toastContainer');
  const progressBar = document.getElementById('progressBar');
  const progressFill = progressBar?.querySelector('.progress-fill');
  const progressText = progressBar?.querySelector('.progress-text');
  const themeToggle = document.getElementById('themeToggle');

  const ui = {
    showToast,
    showProgress,
    hideProgress
  };

  initTheme();

  return ui;

  function initTheme() {
    if (!themeToggle) return;
    const storedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const activeTheme = storedTheme || (prefersDark ? 'dark' : 'light');
    applyTheme(activeTheme);

    themeToggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem(THEME_KEY, nextTheme);
    });
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (themeToggle) themeToggle.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeToggle) themeToggle.textContent = '🌙';
    }
  }

  function showToast(message, type = 'info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">${getToastIcon(type)}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" type="button">×</button>
      </div>
    `;
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn?.addEventListener('click', () => toast.remove());
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(0)';
      toast.style.opacity = '1';
    });
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }

  function showProgress(percent = 0, text = '') {
    if (!progressBar || !progressFill || !progressText) return;
    progressBar.classList.remove('hidden');
    progressFill.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;
    progressText.textContent = text || `${Math.round(percent)}%`;
  }

  function hideProgress() {
    if (!progressBar || !progressFill) return;
    progressBar.classList.add('hidden');
    progressFill.style.width = '0%';
  }
}

function getToastIcon(type) {
  switch (type) {
    case 'success':
      return '✅';
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️';
    default:
      return 'ℹ️';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
