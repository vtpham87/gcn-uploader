// popup.js — GCNDT Photos Uploader (v1.01)
const BATCH_SIZE = 5;
const GCN_URL = 'https://quantrigcn.vr.org.vn/quan-ly-file';

let queue = [];
let todayNames = [];
let settings = {
  filterBs: true,
  checkDuplicate: true,
  caseSensitive: false,
  errorAction: 'skip',
  renamePrefix: 'copy_',
};

const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadTodayNames();
  applySettingsUI();
  setupListeners();
  checkConnection();
  restoreFolderPath();
});

// ── Quản lý trạng thái kết nối & Tab an toàn (Không cướp tab đang làm việc) ──
function setConnectionUI(state, extraTabId = null) {
  const dot = $('statusDot');
  const notice = $('noticeNoTab');

  if (state === 'connected') {
    dot.className = 'status-dot connected';
    dot.title = 'Đã kết nối với trang Quản lý file GCN';
    notice.style.display = 'none';
  } else if (state === 'wrong_page') {
    dot.className = 'status-dot warning';
    dot.title = 'Đang ở trang khác của GCN (không phải Quản lý file)';
    notice.style.display = 'block';
    notice.innerHTML = `⚠️ Bạn đang ở trang khác của GCN. Để tránh mất dữ liệu đang nhập, hãy: <button class="btn-notice" id="btnOpenGcnTab">Mở tab Quản lý file mới</button>`;
    $('btnOpenGcnTab')?.addEventListener('click', () => openOrSwitchGcnTab());
  } else if (state === 'has_background_tab') {
    dot.className = 'status-dot warning';
    dot.title = 'Đã có tab Quản lý file đang mở';
    notice.style.display = 'block';
    notice.innerHTML = `ℹ️ Đã tìm thấy tab Quản lý file đang mở. <button class="btn-notice" id="btnSwitchGcnTab">Chuyển sang tab GCN</button>`;
    $('btnSwitchGcnTab')?.addEventListener('click', () => openOrSwitchGcnTab(extraTabId));
  } else {
    dot.className = 'status-dot disconnected';
    dot.title = 'Chưa kết nối với trang Quản lý file';
    notice.style.display = 'block';
    notice.innerHTML = `⏳ Chưa mở trang Quản lý file Cục ĐKVN. <button class="btn-notice" id="btnOpenGcnTab">Mở trang Quản lý file</button>`;
    $('btnOpenGcnTab')?.addEventListener('click', () => openOrSwitchGcnTab());
  }
}

async function checkConnection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';

    // 1. Tab hiện tại đúng là trang Quản lý file
    if (url.includes('quantrigcn.vr.org.vn/quan-ly-file')) {
      chrome.tabs.sendMessage(tab.id, { type: 'PING' }, async resp => {
        if (!chrome.runtime.lastError && resp?.ok) {
          setConnectionUI('connected');
          return;
        }
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          await sleep(300);
          chrome.tabs.sendMessage(tab.id, { type: 'PING' }, resp2 => {
            setConnectionUI(!chrome.runtime.lastError && resp2?.ok ? 'connected' : 'disconnected');
          });
        } catch {
          setConnectionUI('disconnected');
        }
      });
      return;
    }

    // 2. Tab hiện tại đang ở trang GCN khác (ví dụ thong-tin-phuong-tien) -> Không tự nhảy URL
    if (url.includes('quantrigcn.vr.org.vn')) {
      setConnectionUI('wrong_page');
      return;
    }

    // 3. Tab hiện tại là trang web khác -> Kiểm tra xem có tab Quản lý file nào đang mở sẵn không
    const gcnTabs = await chrome.tabs.query({ url: '*://quantrigcn.vr.org.vn/quan-ly-file*' });
    if (gcnTabs.length > 0) {
      setConnectionUI('has_background_tab', gcnTabs[0].id);
    } else {
      setConnectionUI('disconnected');
    }
  } catch {
    setConnectionUI('disconnected');
  }
}

async function openOrSwitchGcnTab(existingTabId = null) {
  if (existingTabId) {
    try {
      const tab = await chrome.tabs.get(existingTabId);
      if (tab) {
        await chrome.tabs.update(existingTabId, { active: true });
        window.close();
        return;
      }
    } catch (_) {}
  }

  const gcnTabs = await chrome.tabs.query({ url: '*://quantrigcn.vr.org.vn/quan-ly-file*' });
  if (gcnTabs.length > 0) {
    await chrome.tabs.update(gcnTabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url: GCN_URL });
  }
  window.close();
}

async function findTargetGcnTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.url?.includes('quantrigcn.vr.org.vn/quan-ly-file')) {
    return activeTab;
  }
  const gcnTabs = await chrome.tabs.query({ url: '*://quantrigcn.vr.org.vn/quan-ly-file*' });
  return gcnTabs.length > 0 ? gcnTabs[0] : null;
}

async function ensureContentScript(tabId) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, async resp => {
      if (!chrome.runtime.lastError && resp?.ok) {
        resolve();
        return;
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await sleep(350);
      } catch (_) {}
      resolve();
    });
  });
}

// ── Kiểm tra định dạng biển số & Lọc 2 bước độc lập ─────────────────────────
// Bảng chữ cái biển số VN: loại trừ O và I
const _L = '[A-HJ-NP-Z]';
// Hỗ trợ:
// 1. 2 số + 1 chữ + 5 số (e.g. 15A12345, 15C12345, 29B12345)
// 2. 2 số + 1 chữ + 5 số + đuôi màu (e.g. 15A12345T, 15A12345V)
// 3. 2 số + 2 chữ + 5 số (e.g. 15LD12345, 15KT12345)
// 4. 2 số + 1 chữ + 4 số (e.g. 15A1234)
// 5. 2 số + 2 chữ + 4 số (e.g. 15NN1234)
// 6. Hậu tố lần 2: l2, _l2
const PLATE_REGEX = new RegExp(
  `^[0-9]{2}(?:${_L}|${_L}{2})[0-9]{4,5}[A-Z]?(?:_?l2)?$`,
  'i'
);

function analyzeFile(originalName) {
  const ext = getExt(originalName);
  const base = getBase(originalName).trim();

  // Bước 1: Kiểm tra tiền tố / ký tự 'bs'
  const checkStr = settings.caseSensitive ? base : base.toLowerCase();
  const hasBs = checkStr.includes('bs');

  let cleanBase = settings.caseSensitive ? base.replace(/bs/g, '') : base.replace(/bs/gi, '');
  cleanBase = cleanBase.replace(/^[_\-\s]+|[_\-\s]+$/g, '');

  // Bước 2: Kiểm tra định dạng biển số
  const rawMatch = PLATE_REGEX.test(base);
  const cleanMatch = PLATE_REGEX.test(cleanBase);

  // Không phải ảnh biển số xe (tên linh tinh, 9 số thừa, hoặc chứa text không hợp lệ)
  if (!rawMatch && !cleanMatch) {
    return { validPlate: false, reason: 'Sai định dạng biển số' };
  }

  // Nếu có chứa 'bs' và bật tính năng lọc 'bs':
  if (hasBs && settings.filterBs) {
    if (settings.errorAction === 'rename') {
      const targetName = (cleanBase || 'file') + ext;
      return dupCheck(targetName, originalName, 'renamed', 'bs_removed');
    } else {
      return {
        validPlate: true,
        valid: false,
        status: 'bs',
        uploadName: originalName,
        originalName,
        reason: 'Có "bs" trong tên'
      };
    }
  }

  // Tên ảnh hợp lệ bình thường
  return dupCheck(originalName, originalName, 'ok', null);
}

function dupCheck(uploadName, originalName, status, reason) {
  if (settings.checkDuplicate) {
    const isDup = todayNames.some(n => {
      const a = settings.caseSensitive ? n : n.toLowerCase();
      const b = settings.caseSensitive ? uploadName : uploadName.toLowerCase();
      return a === b;
    });

    if (isDup) {
      if (settings.errorAction === 'rename') {
        const renamed = settings.renamePrefix + uploadName;
        return {
          validPlate: true,
          valid: true,
          status: 'renamed',
          uploadName: renamed,
          originalName,
          reason: (reason ? reason + '+' : '') + 'duplicate'
        };
      } else {
        return {
          validPlate: true,
          valid: false,
          status: 'dup',
          uploadName,
          originalName,
          reason: 'Trùng tên hôm nay'
        };
      }
    }
  }

  return {
    validPlate: true,
    valid: true,
    status,
    uploadName,
    originalName,
    reason
  };
}

// ── Quét và tạo hàng đợi ───────────────────────────────────────────────────────
async function scanAndQueue(files) {
  queue = [];
  $('resultBox').hidden = true;

  const allImages = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!allImages.length) {
    showScanMsg('Không tìm thấy file ảnh nào trong thư mục được chọn.', 'warn');
    renderQueue();
    updateBtn();
    return;
  }

  let countNew = 0;
  let countSkipDup = 0;
  let countSkipBs = 0;
  let countRenamed = 0;
  let countSkipPattern = 0;

  for (const file of allImages) {
    const analysis = analyzeFile(file.name);

    if (!analysis.validPlate) {
      countSkipPattern++;
      continue;
    }

    if (!analysis.valid) {
      if (analysis.status === 'bs') countSkipBs++;
      if (analysis.status === 'dup') countSkipDup++;
      continue;
    }

    if (analysis.status === 'renamed') {
      countRenamed++;
    }

    const dataUrl = await readDataUrl(file);
    queue.push({
      id: Date.now() + Math.random(),
      file,
      dataUrl,
      originalName: file.name,
      uploadName: analysis.uploadName,
      status: analysis.status,
      valid: true,
    });
    countNew++;
  }

  const parts = [];
  if (countNew > 0) parts.push(`<span class="s-ok">✓ ${countNew} ảnh sẵn sàng</span>`);
  if (countSkipDup > 0) parts.push(`<span class="s-skip">${countSkipDup} trùng tên hôm nay</span>`);
  if (countSkipBs > 0) parts.push(`<span class="s-skip">${countSkipBs} có "bs"</span>`);
  if (countRenamed > 0) parts.push(`<span class="s-rename">${countRenamed} đổi tên</span>`);
  if (countSkipPattern > 0) parts.push(`<span class="s-skip">${countSkipPattern} sai định dạng</span>`);
  if (countNew === 0) parts.unshift('<span class="s-warn">Không có ảnh nào đủ điều kiện</span>');

  $('scanSummary').hidden = false;
  $('scanMsg').innerHTML = parts.join(' · ');
  renderQueue();
  updateBtn();
}

function showScanMsg(msg, type) {
  $('scanSummary').hidden = false;
  $('scanMsg').innerHTML = `<span class="s-${type}">${msg}</span>`;
}

// ── Hiển thị hàng đợi ─────────────────────────────────────────────────────────
function renderQueue() {
  const wrap = $('queueWrap');
  if (!queue.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const n = queue.length;
  const batchN = Math.ceil(n / BATCH_SIZE);
  $('badgeTotal').textContent = n;
  $('okCount').textContent = `${n} ảnh`;

  const bc = $('batchCount');
  if (batchN > 1) {
    bc.textContent = `${batchN} đợt (× ${BATCH_SIZE})`;
    bc.hidden = false;
  } else {
    bc.hidden = true;
  }

  const list = $('fileList');
  list.innerHTML = '';

  queue.forEach((item, idx) => {
    if (idx > 0 && idx % BATCH_SIZE === 0) {
      const div = document.createElement('li');
      div.className = 'batch-divider';
      div.textContent = `— Đợt ${Math.floor(idx / BATCH_SIZE) + 1} —`;
      list.appendChild(div);
    }

    const li = document.createElement('li');
    li.className = 'file-item';
    const url = URL.createObjectURL(item.file);
    const bd = badgeInfo(item.status);
    const nameHtml = item.uploadName !== item.originalName
      ? `${esc(item.uploadName)} <em class="orig-name">(← ${esc(item.originalName)})</em>`
      : esc(item.uploadName);

    li.innerHTML = `
      <img class="fi-thumb" src="${url}" />
      <div class="fi-info">
        <div class="fi-name ${item.status === 'renamed' ? 'renamed' : ''}">${nameHtml}</div>
        <div class="fi-meta">${fmtSize(item.file.size)}</div>
      </div>
      <span class="fi-badge ${bd.cls}">${bd.text}</span>
      <button class="btn-rm" title="Xóa khỏi danh sách">×</button>
    `;

    li.querySelector('.btn-rm').onclick = () => {
      queue = queue.filter(q => q.id !== item.id);
      URL.revokeObjectURL(url);
      renderQueue();
      updateBtn();
    };
    list.appendChild(li);
  });
}

function updateBtn() {
  const n = queue.length;
  const btn = $('btnUpload');
  btn.disabled = n === 0;
  if (n === 0) {
    $('btnUploadText').textContent = 'Upload';
    return;
  }
  const b = Math.ceil(n / BATCH_SIZE);
  $('btnUploadText').textContent = b > 1
    ? `Upload ${n} ảnh (${b} đợt × ${BATCH_SIZE})`
    : `Upload ${n} ảnh`;
}

// ── Quá trình Upload từng đợt (Batch IPC an toàn) ─────────────────────────────
async function startUpload() {
  if (!queue.length) return;

  const btn = $('btnUpload');
  btn.classList.add('busy');
  btn.disabled = true;
  $('resultBox').hidden = true;

  const targetTab = await findTargetGcnTab();
  if (!targetTab) {
    showResult({
      error: 'Vui lòng mở trang Quản lý file (quantrigcn.vr.org.vn/quan-ly-file) trước khi nhấn Upload.'
    });
    btn.classList.remove('busy');
    updateBtn();
    return;
  }

  await ensureContentScript(targetTab.id);

  const batches = chunkArray(queue, BATCH_SIZE);
  const totalBatches = batches.length;
  const results = { success: [], skipped: [], renamed: [], batches: totalBatches };

  for (let i = 0; i < totalBatches; i++) {
    const currentBatch = batches[i];
    $('btnUploadText').textContent = `Đang tải đợt ${i + 1}/${totalBatches} (${currentBatch.length} ảnh)…`;

    // Chỉ gửi payload của mẻ hiện tại (5 ảnh), tránh vượt ngưỡng IPC 64MB của Chromium
    const batchPayload = currentBatch.map(item => ({
      name: item.originalName,
      uploadName: item.uploadName,
      dataUrl: item.dataUrl,
      type: item.file.type,
      size: item.file.size,
    }));

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          targetTab.id,
          { type: 'UPLOAD_BATCH', batch: batchPayload },
          res => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          }
        );
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Lỗi không xác định từ website');
      }

      // Đợt upload thành công -> lưu vào lịch sử
      const successItems = [];
      for (const item of currentBatch) {
        results.success.push(item.uploadName);
        successItems.push({ name: item.uploadName, status: 'success' });
        if (item.uploadName !== item.originalName) {
          results.renamed.push({ from: item.originalName, to: item.uploadName });
        }
      }
      await chrome.runtime.sendMessage({ type: 'ADD_HISTORY_BATCH', items: successItems });

    } catch (err) {
      for (const item of currentBatch) {
        results.skipped.push({ name: item.uploadName, reason: `Đợt ${i + 1}: ${err.message}` });
      }
    }

    if (i < totalBatches - 1) {
      await sleep(1000);
    }
  }

  // Kết thúc quá trình upload
  const doneSet = new Set(results.success);
  queue = queue.filter(q => !doneSet.has(q.uploadName) && !doneSet.has(q.originalName));
  await loadTodayNames();
  renderQueue();
  showResult(results);

  if (results.success.length > 0) {
    showScanMsg(
      `✓ Đã upload ${results.success.length} ảnh thành công lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
      'ok'
    );
  }

  btn.classList.remove('busy');
  updateBtn();
}

function showResult(result) {
  const box = $('resultBox');
  const msg = $('resultMsg');
  const list = $('resultList');
  box.hidden = false;
  list.innerHTML = '';

  if (result.error) {
    msg.className = 'result-msg error';
    msg.textContent = '✗ ' + result.error;
    return;
  }

  const total = result.success?.length || 0;
  const skipped = result.skipped?.length || 0;
  msg.className = total > 0 ? 'result-msg success' : 'result-msg warn';

  const batchNote = result.batches > 1 ? ` (${result.batches} đợt)` : '';
  msg.textContent = (result.message || `Xong: ${total} thành công`) + batchNote;

  const renamedTo = new Set((result.renamed || []).map(r => r.to));
  (result.success || []).forEach(name => {
    if (!renamedTo.has(name)) addResultItem(list, 'ok', name, '');
  });
  (result.renamed || []).forEach(r => addResultItem(list, 'ok', r.to, `← ${r.from}`));
  (result.skipped || []).forEach(s => addResultItem(list, 'skip', s.name, s.reason));
}

function addResultItem(list, type, name, sub) {
  const li = document.createElement('li');
  li.className = 'result-item';
  li.innerHTML = `
    <div class="ri-dot ${type}"></div>
    <div>
      <div class="ri-text">${esc(name)}</div>
      ${sub ? `<div class="ri-sub">${esc(sub)}</div>` : ''}
    </div>
  `;
  list.appendChild(li);
}

// ── Cài đặt & Dữ liệu ngày ─────────────────────────────────────────────────────
async function loadSettings() {
  return new Promise(r => {
    chrome.storage.local.get(['gcnSettings'], res => {
      if (res.gcnSettings) Object.assign(settings, res.gcnSettings);
      r();
    });
  });
}

function applySettingsUI() {
  $('filterBs').checked = settings.filterBs;
  $('checkDuplicate').checked = settings.checkDuplicate;
  $('caseSensitive').checked = settings.caseSensitive;
  $('errorAction').value = settings.errorAction;
  $('renamePrefix').value = settings.renamePrefix;
  togglePrefixRow();
}

function saveSettings() {
  settings.filterBs = $('filterBs').checked;
  settings.checkDuplicate = $('checkDuplicate').checked;
  settings.caseSensitive = $('caseSensitive').checked;
  settings.errorAction = $('errorAction').value;
  settings.renamePrefix = $('renamePrefix').value || 'copy_';
  chrome.storage.local.set({ gcnSettings: settings });
  toast('✓ Đã lưu cài đặt');
}

function togglePrefixRow() {
  $('prefixRow').style.display = $('errorAction').value === 'rename' ? 'flex' : 'none';
}

async function loadTodayNames() {
  return new Promise(r => {
    chrome.runtime.sendMessage({ type: 'GET_TODAY' }, res => {
      todayNames = res?.names || [];
      r();
    });
  });
}

function restoreFolderPath() {
  chrome.storage.local.get(['lastFolderPath'], res => setFolderPathUI(res.lastFolderPath || ''));
}

function setFolderPathUI(path) {
  const el = $('folderPath');
  if (path) {
    el.textContent = path;
    el.classList.remove('empty');
  } else {
    el.textContent = 'Chưa chọn thư mục ảnh';
    el.classList.add('empty');
  }
}

function getFolderDisplayName(files) {
  if (!files.length) return '';
  const firstPath = files[0].webkitRelativePath || '';
  if (firstPath && firstPath.includes('/')) {
    const folder = firstPath.split('/')[0];
    return `📁 ${folder} (${files.length} ảnh)`;
  }
  return files.length > 1 ? `${files[0].name} (+${files.length - 1} file)` : files[0].name;
}

// ── Lắng nghe sự kiện UI ───────────────────────────────────────────────────────
function setupListeners() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('tab-' + t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'settings') applySettingsUI();
    });
  });

  // Chọn & quét cả thư mục
  $('btnScanFolder').addEventListener('click', e => {
    e.stopPropagation();
    $('folderInput').click();
  });

  $('folderInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const displayName = getFolderDisplayName(files);
    chrome.storage.local.set({ lastFolderPath: displayName });
    setFolderPathUI(displayName);
    await loadTodayNames();
    await scanAndQueue(files);
    e.target.value = '';
  });

  // Chọn file thủ công
  $('btnManual').addEventListener('click', e => {
    e.stopPropagation();
    $('fileInput').click();
  });

  $('fileInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    await loadTodayNames();

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const analysis = analyzeFile(file.name);
      if (!analysis.validPlate || !analysis.valid) continue;
      if (queue.find(q => q.file.name === file.name && q.file.size === file.size)) continue;

      const dataUrl = await readDataUrl(file);
      queue.push({
        id: Date.now() + Math.random(),
        file,
        dataUrl,
        originalName: file.name,
        uploadName: analysis.uploadName,
        status: analysis.status,
        valid: true,
      });
    }

    renderQueue();
    updateBtn();
    e.target.value = '';
  });

  $('btnUpload').addEventListener('click', startUpload);

  $('btnClearQueue').addEventListener('click', () => {
    queue = [];
    $('scanSummary').hidden = true;
    renderQueue();
    updateBtn();
  });

  $('btnSave').addEventListener('click', saveSettings);
  $('errorAction').addEventListener('change', togglePrefixRow);
}

// ── Các hàm tiện ích ─────────────────────────────────────────────────────────
function getExt(n) {
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i) : '';
}

function getBase(n) {
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(0, i) : n;
}

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error('Không đọc được file ảnh'));
    r.readAsDataURL(file);
  });
}

function badgeInfo(status) {
  if (status === 'renamed') return { cls: 'renamed', text: 'Đổi tên' };
  return { cls: 'ok', text: '✓ Sẵn sàng' };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let _tt;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  clearTimeout(_tt);
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  document.body.appendChild(d);
  _tt = setTimeout(() => d.remove(), 2400);
}
