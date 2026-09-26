// background.js — GCNDT Photos Uploader (v1.01)

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['uploadHistory'], r => {
    if (!r.uploadHistory) chrome.storage.local.set({ uploadHistory: {} });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Lấy danh sách tên file đã upload thành công hôm nay
  if (msg.type === 'GET_TODAY') {
    const key = todayKey();
    chrome.storage.local.get(['uploadHistory'], r => {
      const h = r.uploadHistory || {};
      const entries = h[key] || [];
      // CHỈ lấy các file có status === 'success' để chống trùng tên
      // Các file 'failed' hoặc 'skipped' không bị khóa nhầm, cho phép thử lại
      const successEntries = entries.filter(f => f.status === 'success');
      sendResponse({ names: successEntries.map(f => f.name) });
    });
    return true;
  }

  // Thêm danh sách file vào lịch sử theo lô (Batch)
  if (msg.type === 'ADD_HISTORY_BATCH') {
    const key = todayKey();
    chrome.storage.local.get(['uploadHistory'], r => {
      const h = r.uploadHistory || {};
      if (!h[key]) h[key] = [];
      const now = new Date().toISOString();
      for (const item of (msg.items || [])) {
        const idx = h[key].findIndex(f => f.name === item.name);
        if (idx >= 0) {
          h[key][idx] = { name: item.name, time: now, status: item.status };
        } else {
          h[key].push({ name: item.name, time: now, status: item.status });
        }
      }
      // Dọn lịch sử cũ > 30 ngày
      const cutoff = cutoffKey(30);
      for (const k in h) { if (k < cutoff) delete h[k]; }
      chrome.storage.local.set({ uploadHistory: h }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  // Thêm file lẻ vào lịch sử
  if (msg.type === 'ADD_HISTORY') {
    const key = todayKey();
    chrome.storage.local.get(['uploadHistory'], r => {
      const h = r.uploadHistory || {};
      if (!h[key]) h[key] = [];
      const idx = h[key].findIndex(f => f.name === msg.name);
      if (idx >= 0) {
        h[key][idx] = { name: msg.name, time: new Date().toISOString(), status: msg.status };
      } else {
        h[key].push({ name: msg.name, time: new Date().toISOString(), status: msg.status });
      }
      // Dọn lịch sử cũ > 30 ngày
      const cutoff = cutoffKey(30);
      for (const k in h) { if (k < cutoff) delete h[k]; }
      chrome.storage.local.set({ uploadHistory: h }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }
});

// Trả về YYYY-MM-DD theo giờ ĐỊA PHƯƠNG của máy chạy extension (không dùng UTC).
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
}

function cutoffKey(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKey(d);
}
