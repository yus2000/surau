// Settings Nilai Default
const DEFAULT_API_KEY = 'AIzaSyBJyOWGFsKwOtjOSUlXHwB-qwuhrbr3m2M';
const DEFAULT_FOLDER_ID = '18D_Xnk5soc0BaDBdlI0jvt9BC0i391RC';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_INTERVAL = 10; 
const DEFAULT_SYNC_INTERVAL = 5; // Ditingkatkan ke 5 menit agar hemat bandwith

const STORAGE_PREFIX = 'app_' + DEFAULT_FOLDER_ID.substring(0, 8) + '_';

// Inisialisasi Database Offline (IndexedDB)
const db = new Dexie("MediaDisplayDB");
db.version(1).stores({
  media: 'id, modifiedTime, type, blob, name'
});

let mediaList = []; // Menyimpan Blob Object & Blob URL
let currentIndex = 0;
let slideTimer = null;
let syncTimer = null;
let idleTimer = null;

function getApiKey() { return localStorage.getItem(STORAGE_PREFIX + 'drive_api_key') || DEFAULT_API_KEY; }
function getFolderId() { return localStorage.getItem(STORAGE_PREFIX + 'drive_folder_id') || DEFAULT_FOLDER_ID; }
function getAdminPassword() { return localStorage.getItem(STORAGE_PREFIX + 'admin_password') || DEFAULT_PASSWORD; }
function getSlideInterval() { return parseInt(localStorage.getItem(STORAGE_PREFIX + 'slide_interval')) || DEFAULT_INTERVAL; }
function getSyncInterval() { return parseInt(localStorage.getItem(STORAGE_PREFIX + 'sync_interval')) || DEFAULT_SYNC_INTERVAL; }

window.onload = async () => {
  document.getElementById('drive-api-key').value = getApiKey();
  document.getElementById('drive-folder-id').value = getFolderId();
  document.getElementById('slide-interval').value = getSlideInterval();
  document.getElementById('sync-interval').value = getSyncInterval();

  setupAutoHideUI();
  
  // 1. Muat konten dari memori offline (IndexedDB) terlebih dahulu
  await loadMediaFromOffline();
  startSlider();

  // 2. Cek pembaruan latar belakang jika ada koneksi internet
  if (navigator.onLine) {
    syncWithDrive();
  }
  
  startAutoSync();
};

// ============================================================
// SYSTEM MEMORI OFFLINE (IndexedDB)
// ============================================================
async function loadMediaFromOffline() {
  try {
    const items = await db.media.toArray();
    // Revoke Blob URL lama jika ada untuk mencegah memory leak
    mediaList.forEach(m => { if (m.blobUrl) URL.revokeObjectURL(m.blobUrl); });

    mediaList = items.map(item => ({
      id: item.id,
      modifiedTime: item.modifiedTime,
      type: item.type,
      blobUrl: URL.createObjectURL(item.blob)
    }));

    if (mediaList.length > 0 && currentIndex >= mediaList.length) {
      currentIndex = 0;
    }
    
    showMedia(currentIndex);
  } catch (err) {
    console.error("Gagal membaca memori offline:", err);
  }
}

// Synchronize latar belakang tanpa me-refresh halaman
async function syncWithDrive() {
  if (!navigator.onLine) return;

  const apiKey = getApiKey();
  const folderId = getFolderId();
  const indicator = document.getElementById('sync-indicator');

  if (!folderId || !apiKey || folderId.includes('MASUKKAN_') || apiKey.includes('MASUKKAN_')) return;

  const query = encodeURIComponent(`'${folderId.trim()}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,mimeType,name,modifiedTime)&key=${apiKey.trim()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!data.files) return;

    data.files.sort((a, b) => a.name.localeCompare(b.name));

    // Ambil metadata lokal
    const localItems = await db.media.toArray();
    const localMap = new Map(localItems.map(item => [item.id, item.modifiedTime]));
    
    let isUpdated = false;
    const driveIds = new Set(data.files.map(f => f.id));

    // 1. Hapus file offline yang sudah dihapus dari Drive
    for (const local of localItems) {
      if (!driveIds.has(local.id)) {
        await db.media.delete(local.id);
        isUpdated = true;
      }
    }

    // 2. Download hanya file baru atau yang telah diperbarui
    for (const file of data.files) {
      const localModifiedTime = localMap.get(file.id);

      if (!localModifiedTime || localModifiedTime !== file.modifiedTime) {
        if (indicator) indicator.classList.add('show');
        
        try {
          const downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${apiKey.trim()}`;
          const fileRes = await fetch(downloadUrl);
          const blob = await fileRes.blob();

          await db.media.put({
            id: file.id,
            name: file.name,
            modifiedTime: file.modifiedTime,
            type: file.mimeType.startsWith('video/') ? 'video' : 'image',
            blob: blob
          });

          isUpdated = true;
        } catch (downloadErr) {
          console.warn(`Gagal mengunduh file ${file.name}:`, downloadErr);
        }
      }
    }

    if (indicator) {
      setTimeout(() => indicator.classList.remove('show'), 1500);
    }

    // Jika ada pembaruan file, perbarui daftar media secara mulus di memori
    if (isUpdated) {
      await loadMediaFromOffline();
    }

  } catch (err) {
    console.warn("Koneksi Google Drive gagal, tetap menggunakan data memori lokal.", err);
  }
}

function startAutoSync() {
  const intervalMs = getSyncInterval() * 60 * 1000;
  clearInterval(syncTimer);
  
  syncTimer = setInterval(() => {
    if (navigator.onLine) {
      syncWithDrive();
    }
  }, intervalMs);
}

// Monitor perubahan koneksi online/offline otomatis
window.addEventListener('online', () => syncWithDrive());

// ============================================================
// LOGIKA SLIDER & UI
// ============================================================
function showMedia(index) {
  const display = document.getElementById('media-display');
  
  if (mediaList.length === 0) {
    display.innerHTML = '<h3 style="color:white; text-align:center; padding: 20px;">Belum ada konten offline.<br><small style="font-size:0.8rem; color:#aaa;">Hubungkan ke internet sekali untuk mengunduh konten dari Google Drive.</small></h3>';
    return;
  }

  if (index >= mediaList.length) {
    currentIndex = 0;
    index = 0;
  }

  const item = mediaList[index];
  
  if (item.type === 'video') {
    display.innerHTML = `<video src="${item.blobUrl}" autoplay muted loop style="max-width:100vw; max-height:100vh;"></video>`;
  } else {
    display.innerHTML = `<img src="${item.blobUrl}" style="max-width:100vw; max-height:100vh;">`;
  }
}

function startSlider() {
  const intervalMs = getSlideInterval() * 1000;
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    if (mediaList.length > 0) {
      currentIndex = (currentIndex + 1) % mediaList.length;
      showMedia(currentIndex);
    }
  }, intervalMs);
}

// ============================================================
// AUTO-HIDE UI (LIGHTWEIGHT)
// ============================================================
function setupAutoHideUI() {
  const controls = document.querySelector('.controls-container');
  if (!controls) return;

  function showUI() {
    controls.classList.remove('hide-ui');
    document.body.classList.remove('hide-cursor');

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controls.classList.add('hide-ui');
      document.body.classList.add('hide-cursor');
    }, 3000);
  }

  let isTicking = false;
  window.addEventListener('mousemove', () => {
    if (!isTicking) {
      window.requestAnimationFrame(() => {
        showUI();
        isTicking = false;
      });
      isTicking = true;
    }
  });

  window.addEventListener('touchstart', showUI);
  window.addEventListener('keydown', showUI);
  showUI();
}

function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
    else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
    else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
  }
}

function loginAdmin() {
  const passInput = document.getElementById('admin-pass').value;
  if (passInput === getAdminPassword()) {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('admin-controls').classList.remove('hidden');
  } else {
    alert('Password Admin Salah!');
  }
}

function saveSettings() {
  const apiKeyInput = document.getElementById('drive-api-key').value.trim();
  const folderIdInput = document.getElementById('drive-folder-id').value.trim();
  const intervalInput = document.getElementById('slide-interval').value;
  const syncIntervalInput = document.getElementById('sync-interval').value;
  const newPassInput = document.getElementById('new-admin-pass').value.trim();

  if (apiKeyInput && apiKeyInput !== DEFAULT_API_KEY) {
    localStorage.setItem(STORAGE_PREFIX + 'drive_api_key', apiKeyInput);
  } else {
    localStorage.removeItem(STORAGE_PREFIX + 'drive_api_key');
    document.getElementById('drive-api-key').value = DEFAULT_API_KEY;
  }

  if (folderIdInput && folderIdInput !== DEFAULT_FOLDER_ID) {
    localStorage.setItem(STORAGE_PREFIX + 'drive_folder_id', folderIdInput);
  } else {
    localStorage.removeItem(STORAGE_PREFIX + 'drive_folder_id');
    document.getElementById('drive-folder-id').value = DEFAULT_FOLDER_ID;
  }

  if (intervalInput) localStorage.setItem(STORAGE_PREFIX + 'slide_interval', intervalInput);
  if (syncIntervalInput) localStorage.setItem(STORAGE_PREFIX + 'sync_interval', syncIntervalInput);

  if (newPassInput) {
    localStorage.setItem(STORAGE_PREFIX + 'admin_password', newPassInput);
  }

  alert('Pengaturan disimpan!');
  
  if (navigator.onLine) {
    syncWithDrive();
  }
  startSlider();
  startAutoSync();
  closeAdminModal();
}

function openAdminModal() { 
  document.getElementById('admin-modal').classList.remove('hidden'); 
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('admin-controls').classList.add('hidden');
  document.getElementById('admin-pass').value = '';
  document.getElementById('new-admin-pass').value = '';
}

function logoutAdmin() {
  closeAdminModal();
}
