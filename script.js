// Settings Nilai Default
const DEFAULT_API_KEY = 'AIzaSyBJyOWGFsKwOtjOSUlXHwB-qwuhrbr3m2M';
const DEFAULT_FOLDER_ID = '18D_Xnk5soc0BaDBdlI0jvt9BC0i391RC';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_INTERVAL = 5; 
const DEFAULT_SYNC_INTERVAL = 1; 

// Awalan Kunci Unik berdasarkan Default Folder ID agar tidak bentrok dengan app lain
const STORAGE_PREFIX = 'app_' + DEFAULT_FOLDER_ID.substring(0, 8) + '_';

let mediaList = [];
let currentIndex = 0;
let slideTimer = null;
let syncTimer = null;
let idleTimer = null;

// Service Worker Registration
if ('serviceWorker' in navigator) {
  const swCode = `
    const CACHE_NAME = 'media-slider-v3';
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('activate', e => self.clients.claim());
    self.addEventListener('fetch', e => {
      e.respondWith(
        caches.match(e.request).then(res => res || fetch(e.request))
      );
    });
  `;
  const blob = new Blob([swCode], { type: 'application/javascript' });
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(console.error);
}

// Mengambil data terkonfigurasi (Storage / Default HTML)
function getApiKey() { return localStorage.getItem(STORAGE_PREFIX + 'drive_api_key') || DEFAULT_API_KEY; }
function getFolderId() { return localStorage.getItem(STORAGE_PREFIX + 'drive_folder_id') || DEFAULT_FOLDER_ID; }
function getAdminPassword() { return localStorage.getItem(STORAGE_PREFIX + 'admin_password') || DEFAULT_PASSWORD; }
function getSlideInterval() { return parseInt(localStorage.getItem(STORAGE_PREFIX + 'slide_interval')) || DEFAULT_INTERVAL; }
function getSyncInterval() { return parseInt(localStorage.getItem(STORAGE_PREFIX + 'sync_interval')) || DEFAULT_SYNC_INTERVAL; }

window.onload = () => {
  document.getElementById('drive-api-key').value = getApiKey();
  document.getElementById('drive-folder-id').value = getFolderId();
  document.getElementById('slide-interval').value = getSlideInterval();
  document.getElementById('sync-interval').value = getSyncInterval();

  loadMedia();
  startSlider();
  startAutoSync();
  resetIdleTimer();
};

// Fitur Auto-Hide UI saat Idle untuk Layar TV
function resetIdleTimer() {
  document.body.classList.remove('hide-cursor');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    document.body.classList.add('hide-cursor');
  }, 3000);
}

window.addEventListener('mousemove', resetIdleTimer);
window.addEventListener('touchstart', resetIdleTimer);
window.addEventListener('keydown', (e) => {
  resetIdleTimer();
  // Shortcut Keyboard/Remote TV
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'a' || e.key === 'A') openAdminModal();
});

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

// Fetch Google Drive File List
async function fetchFromDrive(folderId, apiKey) {
  if (!folderId || !apiKey || folderId.includes('MASUKKAN_') || apiKey.includes('MASUKKAN_')) {
    return [];
  }

  const query = encodeURIComponent(`'${folderId.trim()}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,mimeType,name,modifiedTime)&key=${apiKey.trim()}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.error) {
      console.error("Drive API Error:", data.error.message);
      return [];
    }

    if (!data.files) return [];

    data.files.sort((a, b) => a.name.localeCompare(b.name));

    const timestamp = new Date().getTime();
    return data.files.map(file => ({
      id: file.id,
      modifiedTime: file.modifiedTime,
      url: `https://lh3.googleusercontent.com/d/${file.id}?t=${timestamp}`,
      type: file.mimeType.startsWith('video/') ? 'video' : 'image'
    }));
  } catch (err) {
    console.warn("Gagal terhubung ke Drive, menggunakan offline cache...", err);
    return [];
  }
}

// Load & Synchronize Media
async function loadMedia(silent = false) {
  const apiKey = getApiKey();
  const folderId = getFolderId();
  const indicator = document.getElementById('sync-indicator');

  if (silent && navigator.onLine) {
    indicator.classList.add('show');
  }

  if (navigator.onLine) {
    const driveMedia = await fetchFromDrive(folderId, apiKey);
    
    if (driveMedia.length > 0) {
      const currentHash = mediaList.map(m => m.id + '_' + (m.modifiedTime || '')).join(',');
      const newHash = driveMedia.map(m => m.id + '_' + (m.modifiedTime || '')).join(',');

      if (currentHash !== newHash) {
        mediaList = driveMedia;
        
        if ('caches' in window) {
          caches.delete('media-cache-v1');
          const cache = await caches.open('media-cache-v1');
          mediaList.forEach(m => cache.add(m.url).catch(() => {}));
        }
        
        localStorage.setItem(STORAGE_PREFIX + 'cached_media_list', JSON.stringify(mediaList));

        if (currentIndex >= mediaList.length) {
          currentIndex = 0;
        }
        showMedia(currentIndex);
      }
    } else if (mediaList.length === 0) {
      loadFromLocalCache();
    }
  } else {
    loadFromLocalCache();
  }

  setTimeout(() => {
    indicator.classList.remove('show');
  }, 2000);
}

function loadFromLocalCache() {
  const stored = localStorage.getItem(STORAGE_PREFIX + 'cached_media_list');
  if (stored) {
    mediaList = JSON.parse(stored);
  }
  showMedia(currentIndex);
}

function startAutoSync() {
  const intervalMs = getSyncInterval() * 60 * 1000;
  clearInterval(syncTimer);
  
  syncTimer = setInterval(() => {
    if (navigator.onLine) {
      loadMedia(true);
    }
  }, intervalMs);
}

function showMedia(index) {
  const display = document.getElementById('media-display');
  if (mediaList.length === 0) {
    display.innerHTML = '<h3 style="color:white; text-align:center; padding: 20px;">Belum ada konten.<br><small style="font-size:0.8rem; color:#aaa;">Buka menu Admin untuk mengatur API Key & Folder ID.</small></h3>';
    return;
  }

  if (index >= mediaList.length) {
    currentIndex = 0;
    index = 0;
  }

  const item = mediaList[index];
  if (item.type === 'video') {
    display.innerHTML = `<video src="${item.url}" autoplay muted loop style="max-width:100vw; max-height:100vh;"></video>`;
  } else {
    display.innerHTML = `<img src="${item.url}" style="max-width:100vw; max-height:100vh;">`;
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

  // Menerapkan logika reset kunci jika dikosongkan/sesuai default
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
    alert('Pengaturan dan Password Admin baru disimpan!');
  } else {
    alert('Pengaturan disimpan!');
  }

  mediaList = [];
  loadMedia();
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