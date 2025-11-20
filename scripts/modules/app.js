import { createUI } from './ui.js';
import { createExifForm } from './exifForm.js';
import { createMapBridge } from '../services/mapBridge.js';
import { reverseGeocode, geocodeAddress } from '../services/locationService.js';
import { readExifFields, writeExifData, removeExifData, isEditableFile } from '../services/exifService.js';
import { processBatch, downloadAsZip, formatFileSize } from '../services/batchService.js';

const ORIENTATION_TO_DEGREES = { 1: 0, 6: 90, 3: 180, 8: 270 };
const DEGREES_TO_ORIENTATION = { 0: 1, 90: 6, 180: 3, 270: 8 };

const WRITABLE_TYPES = [
  {
    description: 'Images',
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    }
  }
];

export function createApp() {
  const ui = createUI();
  const form = createExifForm();

  const elements = {
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    openFile: document.getElementById('openFile'),
    writableHint: document.getElementById('writableHint'),
    editor: document.getElementById('editor'),
    batchPanel: document.getElementById('batchPanel'),
    previewImage: document.getElementById('previewImage'),
    previewVideo: document.getElementById('previewVideo'),
    rotateLeft: document.getElementById('rotateLeft'),
    rotateRight: document.getElementById('rotateRight'),
    applyChanges: document.getElementById('applyChanges'),
    removeExif: document.getElementById('removeExif'),
    downloadImage: document.getElementById('downloadImage'),
    removeGPS: document.getElementById('removeGPS'),
    openMap: document.getElementById('openMap'),
    orientation: document.getElementById('orientation'),
    fileName: document.getElementById('fileName'),
    locationName: document.getElementById('locationName'),
    resolveLocation: document.getElementById('resolveLocation'),
    gpsAddress: document.getElementById('gpsAddress'),
    batchTableBody: document.getElementById('batchTableBody'),
    batchCount: document.getElementById('batchCount'),
    applyToAll: document.getElementById('applyToAll'),
    removeAllExif: document.getElementById('removeAllExif'),
    downloadZip: document.getElementById('downloadZip')
  };

  const state = {
    currentFile: null,
    currentUrl: null,
    previewMode: 'image',
    rotation: 0,
    batchItems: [],
    fileHandle: null,
    gpsLookupSeq: 0,
    desiredName: ''
  };

  const mapBridge = createMapBridge({
    onSelect: ({ lat, lng, address }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      form.setGPS(lat, lng);
      onGpsUpdated(lat, lng, address);
      ui.showToast('GPS 坐标已更新', 'success');
    }
  });

  setupTabs();
  setupFileOpener();
  setupFileInteraction();
  setupEditorActions();
  setupBatchActions();
  setupLocationActions();
  setupFileNameInput();
  setupGpsListeners();
  window.addEventListener('beforeunload', cleanupResources);

  return { state };

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(`${tabName}Tab`)?.classList.add('active');
      });
    });
  }

  function setupFileOpener() {
    if (!elements.openFile) return;
    const pickerSupported = Boolean(window.showOpenFilePicker);
    if (!pickerSupported) {
      elements.writableHint?.classList.add('hidden');
    } else {
      elements.writableHint?.classList.remove('hidden');
    }
    elements.openFile.addEventListener('click', async () => {
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({ multiple: false, types: WRITABLE_TYPES });
          if (!handle) return;
          const file = await handle.getFile();
          state.fileHandle = handle;
          await loadSingleImage(file);
        } catch (error) {
          if (error.name !== 'AbortError') {
            console.error(error);
            ui.showToast(error.message || '打开文件失败', 'error');
          }
        }
      } else {
        elements.fileInput?.click();
      }
    });
  }

  function setupFileInteraction() {
    elements.fileInput?.addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []);
      state.fileHandle = null;
      handleFiles(files);
      event.target.value = '';
    });
    elements.dropZone?.addEventListener('dragover', (event) => {
      event.preventDefault();
      elements.dropZone.classList.add('dragover');
    });
    elements.dropZone?.addEventListener('dragleave', (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove('dragover');
    });
    elements.dropZone?.addEventListener('drop', async (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove('dragover');
      const files = Array.from(event.dataTransfer?.files || []);
      state.fileHandle = null;
      if (files.length === 1) {
        state.fileHandle = await getFileHandleFromDataTransfer(event.dataTransfer);
      }
      handleFiles(files);
    });
  }

  function setupEditorActions() {
    elements.rotateLeft?.addEventListener('click', () => rotatePreview(-90));
    elements.rotateRight?.addEventListener('click', () => rotatePreview(90));
    elements.orientation?.addEventListener('change', () => {
      const value = Number(elements.orientation.value) || 1;
      state.rotation = ORIENTATION_TO_DEGREES[value] ?? 0;
      applyRotationToPreview();
    });
    elements.applyChanges?.addEventListener('click', applyChanges);
    elements.removeExif?.addEventListener('click', removeCurrentExif);
    elements.downloadImage?.addEventListener('click', downloadCurrentImage);
    elements.removeGPS?.addEventListener('click', () => {
      form.clearGPS();
      onGpsUpdated(null, null);
      ui.showToast('GPS 信息已清空', 'info');
    });
    elements.openMap?.addEventListener('click', () => {
      const lat = parseFloat(document.getElementById('latitude')?.value);
      const lng = parseFloat(document.getElementById('longitude')?.value);
      const address = elements.locationName?.value?.trim();
      mapBridge.open({
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        address
      });
    });
  }

  function setupBatchActions() {
    elements.applyToAll?.addEventListener('click', applyExifToBatch);
    elements.removeAllExif?.addEventListener('click', removeBatchExif);
    elements.downloadZip?.addEventListener('click', downloadBatchZip);
    elements.batchTableBody?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-batch-remove]');
      if (!button) return;
      const id = button.dataset.batchRemove;
      removeBatchItem(id);
    });
  }

  function setupLocationActions() {
    elements.resolveLocation?.addEventListener('click', async () => {
      const query = elements.locationName?.value?.trim();
      if (!query) {
        ui.showToast('请输入地点名称', 'warning');
        return;
      }
      ui.showProgress(10, '正在解析地点');
      const result = await geocodeAddress(query);
      if (result) {
        form.setGPS(result.lat, result.lng);
        onGpsUpdated(result.lat, result.lng, result.address || query);
        ui.showToast('地点解析成功', 'success');
      } else {
        ui.showToast('未找到对应地点', 'error');
      }
      ui.hideProgress();
    });
  }

  function setupFileNameInput() {
    if (!elements.fileName) return;
    elements.fileName.addEventListener('input', () => {
      state.desiredName = elements.fileName.value;
    });
    const sync = () => {
      syncDesiredNameFromInput();
      if (state.currentFile) {
        state.currentFile = renameFile(state.currentFile);
      }
    };
    elements.fileName.addEventListener('change', sync);
    elements.fileName.addEventListener('blur', sync);
  }

  function setupGpsListeners() {
    ['latitude', 'longitude'].forEach((id) => {
      document.getElementById(id)?.addEventListener('blur', () => {
        const lat = parseFloat(document.getElementById('latitude').value);
        const lng = parseFloat(document.getElementById('longitude').value);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          onGpsUpdated(lat, lng);
        }
      });
    });
  }

  async function handleFiles(files) {
    const validFiles = files.filter((file) => file && (file.type.startsWith('image/') || file.type.startsWith('video/')));
    if (!validFiles.length) {
      ui.showToast('请选择有效的图片或视频文件', 'error');
      return;
    }

    const imageFiles = validFiles.filter((file) => file.type.startsWith('image/'));
    const videoFiles = validFiles.filter((file) => file.type.startsWith('video/'));

    if (validFiles.length === 1 && videoFiles.length === 1) {
      await loadSingleVideo(videoFiles[0]);
      return;
    }

    if (validFiles.length === 1 && imageFiles.length === 1) {
      await loadSingleImage(imageFiles[0]);
      return;
    }

    if (!imageFiles.length) {
      ui.showToast('批量模式仅支持图片文件', 'warning');
      return;
    }

    enterBatchMode(imageFiles);
    if (videoFiles.length) {
      ui.showToast('批量模式已忽略视频文件', 'warning');
    }
  }

  async function loadSingleImage(file) {
    try {
      ui.showProgress(10, '加载图片');
      form.clear();
      resetFormExtras();
      resetBatch();
      showEditor();
      await updateImagePreview(file);
      ui.showProgress(40, '读取 EXIF');
      const data = await readExifFields(file);
      form.populate(data);
      syncOrientationFromForm();
      ensureDefaultDateTime();
      await ensureDefaultLocation(data);
      onGpsUpdated(data.GPSLatitude, data.GPSLongitude);
      applyFileName(file.name);
      ui.showToast('EXIF 数据已加载', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '图片加载失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  async function loadSingleVideo(file) {
    try {
      ui.showProgress(10, '加载视频');
      form.clear();
      resetFormExtras();
      resetBatch();
      showEditor();
      await updateVideoPreview(file);
      applyFileName(file.name);
      ui.showToast('视频已加载（暂不支持 EXIF 编辑）', 'info');
    } catch (error) {
      console.error(error);
      ui.showToast('视频加载失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  function enterBatchMode(files) {
    state.fileHandle = null;
    cleanupBatchUrls();
    state.batchItems = files.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      file,
      name: file.name,
      size: file.size,
      url: URL.createObjectURL(file),
      status: 'pending'
    }));
    form.clear();
    resetFormExtras();
    cleanupPreview();
    showBatchPanel();
    renderBatchTable();
  }

  function resetBatch() {
    cleanupBatchUrls();
    state.batchItems = [];
    elements.batchPanel?.classList.add('hidden');
  }

  function cleanupBatchUrls() {
    state.batchItems.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
  }

  function showEditor() {
    elements.editor?.classList.remove('hidden');
    elements.dropZone?.classList.add('hidden');
    elements.batchPanel?.classList.add('hidden');
  }

  function showBatchPanel() {
    elements.batchPanel?.classList.remove('hidden');
    elements.editor?.classList.add('hidden');
    elements.dropZone?.classList.add('hidden');
  }

  function showDropZone() {
    elements.dropZone?.classList.remove('hidden');
    elements.editor?.classList.add('hidden');
    elements.batchPanel?.classList.add('hidden');
  }

  async function updateImagePreview(file) {
    cleanupPreview();
    const url = URL.createObjectURL(file);
    state.currentUrl = url;
    state.currentFile = file;
    state.previewMode = 'image';
    state.rotation = 0;
    if (elements.previewImage) {
      elements.previewImage.src = url;
      applyRotationToPreview();
      elements.previewImage.classList.remove('hidden');
    }
    if (elements.previewVideo) {
      elements.previewVideo.classList.add('hidden');
      elements.previewVideo.src = '';
    }
  }

  async function updateVideoPreview(file) {
    cleanupPreview();
    const url = URL.createObjectURL(file);
    state.currentUrl = url;
    state.currentFile = file;
    state.previewMode = 'video';
    if (elements.previewVideo) {
      elements.previewVideo.src = url;
      elements.previewVideo.currentTime = 0;
      elements.previewVideo.classList.remove('hidden');
    }
    if (elements.previewImage) {
      elements.previewImage.classList.add('hidden');
      elements.previewImage.removeAttribute('src');
    }
  }

  function cleanupPreview() {
    if (state.currentUrl) {
      URL.revokeObjectURL(state.currentUrl);
      state.currentUrl = null;
    }
    if (elements.previewImage) {
      elements.previewImage.removeAttribute('src');
      elements.previewImage.classList.add('hidden');
    }
    if (elements.previewVideo) {
      elements.previewVideo.pause();
      elements.previewVideo.removeAttribute('src');
      elements.previewVideo.classList.add('hidden');
      elements.previewVideo.load();
    }
    state.currentFile = null;
  }

  function rotatePreview(degrees) {
    if (state.previewMode !== 'image') return;
    state.rotation = (state.rotation + degrees + 360) % 360;
    applyRotationToPreview();
    const orientation = DEGREES_TO_ORIENTATION[state.rotation % 360] ?? 1;
    if (elements.orientation) {
      elements.orientation.value = orientation;
    }
  }

  function applyRotationToPreview() {
    const normalized = ((state.rotation % 360) + 360) % 360;
    if (elements.previewImage) {
      elements.previewImage.style.transform = `rotate(${normalized}deg)`;
    }
  }

  function syncOrientationFromForm() {
    if (!elements.orientation) return;
    const value = Number(elements.orientation.value) || 1;
    state.rotation = ORIENTATION_TO_DEGREES[value] ?? 0;
    applyRotationToPreview();
  }

  async function applyChanges() {
    if (!state.currentFile) {
      ui.showToast('请先选择图片', 'error');
      return;
    }
    if (!isEditableFile(state.currentFile)) {
      ui.showToast('当前格式暂不支持写入 EXIF', 'warning');
      return;
    }
    try {
      ui.showProgress(30, '写入 EXIF');
      syncDesiredNameFromInput();
      state.currentFile = renameFile(state.currentFile);
      const updated = await writeExifData(state.currentFile, form.collect());
      state.currentFile = renameFile(updated);
      await updateImagePreview(state.currentFile);
      await persistToOriginal(state.currentFile);
      ui.showToast('EXIF 数据已更新', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '写入失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  async function removeCurrentExif() {
    if (!state.currentFile) {
      ui.showToast('请先选择图片', 'error');
      return;
    }
    if (!isEditableFile(state.currentFile)) {
      ui.showToast('当前格式暂不支持移除 EXIF', 'warning');
      return;
    }
    try {
      ui.showProgress(30, '移除 EXIF');
      syncDesiredNameFromInput();
      state.currentFile = renameFile(state.currentFile);
      const cleaned = await removeExifData(state.currentFile);
      state.currentFile = renameFile(cleaned);
      await updateImagePreview(state.currentFile);
      form.clear();
      resetFormExtras();
      await persistToOriginal(state.currentFile);
      ui.showToast('EXIF 信息已清空', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '移除失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  function downloadCurrentImage() {
    if (!state.currentFile) {
      ui.showToast('请先选择图片', 'error');
      return;
    }
    syncDesiredNameFromInput();
    state.currentFile = renameFile(state.currentFile);
    const url = URL.createObjectURL(state.currentFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = getDesiredFileName(state.currentFile.name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.showToast('下载已开始', 'success');
  }

  async function applyExifToBatch() {
    if (!state.batchItems.length) {
      ui.showToast('没有批量图片可处理', 'error');
      return;
    }
    const editableItems = state.batchItems.filter((item) => isEditableFile(item.file));
    if (!editableItems.length) {
      ui.showToast('所有批量图片格式均不支持写入 EXIF', 'warning');
      return;
    }
    const formData = form.collect();
    try {
      editableItems.forEach((item) => { item.status = 'processing'; });
      renderBatchTable();
      await processBatch(editableItems, async (item) => {
        const updated = await writeExifData(item.file, formData);
        item.file = updated;
        return updated;
      }, {
        onProgress: (progress, text) => ui.showProgress(progress * 100, text),
        onItemComplete: (item) => {
          item.status = 'completed';
          renderBatchTable();
        },
        onItemError: (item, error) => {
          console.error(error);
          item.status = 'error';
          ui.showToast(`${item.name}: ${error.message}`, 'error');
          renderBatchTable();
        }
      });
      ui.showToast('批量写入完成', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '批量写入失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  async function removeBatchExif() {
    if (!state.batchItems.length) {
      ui.showToast('没有批量图片可处理', 'error');
      return;
    }
    const editableItems = state.batchItems.filter((item) => isEditableFile(item.file));
    if (!editableItems.length) {
      ui.showToast('所有批量图片格式均不支持移除 EXIF', 'warning');
      return;
    }
    try {
      editableItems.forEach((item) => { item.status = 'processing'; });
      renderBatchTable();
      await processBatch(editableItems, async (item) => {
        const cleaned = await removeExifData(item.file);
        item.file = cleaned;
        return cleaned;
      }, {
        onProgress: (progress, text) => ui.showProgress(progress * 100, text),
        onItemComplete: (item) => {
          item.status = 'completed';
          renderBatchTable();
        },
        onItemError: (item, error) => {
          console.error(error);
          item.status = 'error';
          ui.showToast(`${item.name}: ${error.message}`, 'error');
          renderBatchTable();
        }
      });
      ui.showToast('批量移除完成', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '批量移除失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  async function downloadBatchZip() {
    if (!state.batchItems.length) {
      ui.showToast('没有批量图片可下载', 'error');
      return;
    }
    try {
      ui.showProgress(5, '正在准备 ZIP');
      await downloadAsZip(state.batchItems);
      ui.showToast('ZIP 文件创建完成', 'success');
    } catch (error) {
      console.error(error);
      ui.showToast(error.message || '创建 ZIP 失败', 'error');
    } finally {
      ui.hideProgress();
    }
  }

  function renderBatchTable() {
    if (!elements.batchTableBody || !elements.batchCount) return;
    elements.batchCount.textContent = `共 ${state.batchItems.length} 张图片`;
    elements.batchTableBody.innerHTML = state.batchItems.map((item) => `
      <tr>
        <td><img src="${item.url}" alt="${item.name}" class="batch-thumb"></td>
        <td title="${item.name}">${item.name}</td>
        <td>${formatFileSize(item.size)}</td>
        <td><span class="batch-status ${item.status}">${formatStatus(item.status)}</span></td>
        <td><button class="btn btn-sm btn-danger" data-batch-remove="${item.id}" type="button">移除</button></td>
      </tr>
    `).join('');
  }

  function formatStatus(status) {
    switch (status) {
      case 'processing':
        return '处理中';
      case 'completed':
        return '已完成';
      case 'error':
        return '失败';
      default:
        return '待处理';
    }
  }

  function removeBatchItem(id) {
    const index = state.batchItems.findIndex((item) => item.id === id);
    if (index === -1) return;
    const [removed] = state.batchItems.splice(index, 1);
    if (removed?.url) {
      URL.revokeObjectURL(removed.url);
    }
    if (!state.batchItems.length) {
      showDropZone();
    }
    renderBatchTable();
  }

  function resetFormExtras() {
    if (elements.orientation) {
      elements.orientation.value = '1';
    }
    state.rotation = 0;
    applyRotationToPreview();
    setLocationInputValue('');
    updateGpsAddressText('未设置');
  }

  async function ensureDefaultLocation(data) {
    if (Number.isFinite(data?.GPSLatitude) && Number.isFinite(data?.GPSLongitude)) {
      return;
    }
    if (!navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        form.setGPS(latitude, longitude);
        onGpsUpdated(latitude, longitude);
      },
      () => {
        onGpsUpdated(null, null);
      },
      { enableHighAccuracy: true, maximumAge: 300000, timeout: 10000 }
    );
  }

  function ensureDefaultDateTime() {
    const input = document.getElementById('datetime');
    if (input && !input.value) {
      input.value = formatDateTimeLocal(new Date());
    }
  }

  function applyFileName(name) {
    const normalized = name || '';
    state.desiredName = normalized;
    if (elements.fileName) {
      elements.fileName.value = normalized;
    }
  }

  function getDesiredFileName(fallback) {
    const desired = (state.desiredName ?? '').trim();
    if (!desired) return fallback;
    if (desired.includes('.')) return desired;
    const ext = fallback?.includes('.') ? fallback.split('.').pop() : '';
    return ext ? `${desired}.${ext}` : desired;
  }

  function renameFile(file) {
    if (!file) return file;
    syncDesiredNameFromInput();
    const desired = getDesiredFileName(file.name);
    if (!desired || desired === file.name) return file;
    const renamed = new File([file], desired, { type: file.type, lastModified: file.lastModified });
    state.desiredName = desired;
    if (elements.fileName) {
      elements.fileName.value = desired;
    }
    return renamed;
  }

  async function persistToOriginal(file) {
    if (!state.fileHandle || !file) return;
    try {
      const canWrite = await ensureWritePermission(state.fileHandle);
      if (!canWrite) {
        ui.showToast('浏览器未授予写入权限，请使用“导出”保存', 'warning');
        return;
      }
      const writable = await state.fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      if (state.fileHandle.name && getDesiredFileName(state.fileHandle.name) !== state.fileHandle.name) {
        ui.showToast(`原文件名保持为 ${state.fileHandle.name}`, 'warning');
      } else {
        ui.showToast('已写回原文件', 'success');
      }
    } catch (error) {
      console.warn('写回原文件失败:', error);
      ui.showToast('写回原文件失败：' + error.message, 'warning');
    }
  }

  function onGpsUpdated(lat, lng, address) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      updateGpsAddressText('未设置');
      setLocationInputValue('');
      return;
    }
    if (address) {
      setLocationInputValue(address);
      updateGpsAddressText(address);
      return;
    }
    updateGpsAddressText('正在解析位置...');
    resolveGpsAddress(lat, lng);
  }

  async function resolveGpsAddress(lat, lng) {
    const seq = ++state.gpsLookupSeq;
    const address = await reverseGeocode(lat, lng);
    if (seq !== state.gpsLookupSeq) return;
    if (address) {
      setLocationInputValue(address);
      updateGpsAddressText(address);
    } else {
      updateGpsAddressText('未找到对应地点');
    }
  }

  function setLocationInputValue(value) {
    if (elements.locationName) {
      elements.locationName.value = value || '';
    }
  }

  function updateGpsAddressText(text) {
    if (elements.gpsAddress) {
      elements.gpsAddress.textContent = text || '未设置';
    }
  }

  function formatDateTimeLocal(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }

  function syncDesiredNameFromInput() {
    if (elements.fileName) {
      state.desiredName = elements.fileName.value.trim();
    }
  }

  async function getFileHandleFromDataTransfer(dataTransfer) {
    if (!dataTransfer?.items) return null;
    const items = Array.from(dataTransfer.items);
    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (typeof item.getAsFileSystemHandle !== 'function') {
        return null;
      }
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle?.kind === 'file') {
          return handle;
        }
      } catch (error) {
        console.warn('无法从拖拽项目获取文件句柄:', error);
      }
    }
    return null;
  }

  async function ensureWritePermission(handle) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') {
      return true;
    }
    const descriptor = { mode: 'readwrite' };
    try {
      const status = await handle.queryPermission(descriptor);
      if (status === 'granted') {
        return true;
      }
      if (status === 'denied') {
        return false;
      }
      const request = await handle.requestPermission(descriptor);
      return request === 'granted';
    } catch (error) {
      console.warn('写入权限请求失败:', error);
      return false;
    }
  }

  function cleanupResources() {
    cleanupPreview();
    cleanupBatchUrls();
  }
}
