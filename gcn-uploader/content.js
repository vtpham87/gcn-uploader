// content.js — GCNDT Photos Uploader (v1.01)
// IIFE guard: chống inject/khai báo lại khi content script chạy nhiều lần
(function() {
  if (window.__GCNDT_LOADED__) return;
  window.__GCNDT_LOADED__ = true;

  const BATCH_SIZE = 5;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true });
      return;
    }

    // Nhận 1 batch đơn lẻ (tối đa 5 file) do popup.js điều phối
    if (msg.type === 'UPLOAD_BATCH') {
      uploadBatch(msg.batch)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Hỗ trợ chế độ tải toàn bộ danh sách (Legacy / All-in-one)
    if (msg.type === 'START_UPLOAD') {
      handleUploadAll(msg.files, msg.settings)
        .then(result => sendResponse({ ok: true, result }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });

  // ── Upload 1 batch ─────────────────────────────────────────────────────────────
  async function uploadBatch(batch) {
    if (!batch || !batch.length) return { count: 0 };

    // 1. Chờ và đóng dialog cũ nếu còn sót
    const startWait = Date.now();
    while (Date.now() - startWait < 2000 && findUploadDialog()) {
      await sleep(150);
    }
    const staleDialog = findUploadDialog();
    if (staleDialog) {
      closeDialog(staleDialog);
      await sleep(300);
    }

    // 2. Tìm nút "Up files" trên trang Quản lý file
    const upBtn = findUpFilesButton();
    if (!upBtn) throw new Error('Không tìm thấy nút "Up files". Hãy chắc chắn đang ở trang Quản lý file.');
    upBtn.click();
    await sleep(600);

    // 3. Chờ dialog xuất hiện
    const dialog = await waitFor(() => findUploadDialog(), 6000, 200);
    if (!dialog) throw new Error('Dialog upload không xuất hiện sau khi nhấn "Up files".');

    // 4. Chờ input file mount trong dialog
    const fileInput = await waitFor(
      () => dialog.querySelector('input[type="file"]') || document.querySelector('input[type="file"]'),
      4000,
      150
    );
    if (!fileInput) throw new Error('Không tìm thấy ô chọn file trong dialog upload.');

    // 5. Chuyển đổi dataUrl sang File và gán vào input
    const dt = new DataTransfer();
    for (const fd of batch) {
      const f = await dataUrlToFile(fd.dataUrl, fd.uploadName || fd.name, fd.type);
      dt.items.add(f);
    }
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    // 6. Chờ nút Upload sẵn sàng (enabled)
    const uploadBtn = await waitFor(() => {
      const btn = findUploadButton(dialog);
      if (btn && isButtonEnabled(btn)) return btn;
      return null;
    }, 4000, 200);

    const btnToClick = uploadBtn || findUploadButton(dialog);
    if (!btnToClick) throw new Error('Không tìm thấy nút "Upload" trong dialog.');
    btnToClick.click();

    // 7. Chờ kết quả: Thành công, Lỗi hoặc Dialog tự đóng
    const doneStatus = await waitFor(() => {
      const curDialog = findUploadDialog();
      if (!curDialog) return 'success'; // Dialog tự đóng = upload hoàn tất
      const st = checkUploadStatus(curDialog);
      if (st === 'success') {
        closeDialog(curDialog);
        return 'success';
      }
      if (st === 'error') {
        const errSnippet = (curDialog.innerText || '').slice(0, 120).replace(/\s+/g, ' ');
        closeDialog(curDialog);
        return 'error: ' + errSnippet;
      }
      return null;
    }, 25000, 300);

    if (!doneStatus) throw new Error('Upload quá thời gian chờ (25s).');
    if (typeof doneStatus === 'string' && doneStatus.startsWith('error:')) {
      throw new Error('Hệ thống báo lỗi: ' + doneStatus.replace('error: ', ''));
    }

    await sleep(600);
    return { count: batch.length };
  }

  // ── Upload tất cả (Legacy handler chia nhỏ thành từng batch) ───────────────────
  async function handleUploadAll(fileDataList, settings) {
    const results = { success: [], skipped: [], renamed: [], batches: 0 };
    const todayNames = await getTodayNames();
    const toUpload = [];

    for (const fd of fileDataList) {
      const original = fd.name;
      const ext  = getExt(original);
      const base = getBase(original);

      // Lọc "bs"
      if (settings.filterBs) {
        const cb = settings.caseSensitive ? base : base.toLowerCase();
        if (cb.includes('bs')) {
          if (settings.errorAction === 'rename') {
            const cleaned = (settings.caseSensitive ? base.replace(/bs/g,'') : base.replace(/bs/gi,'')) || 'file';
            fd.uploadName = cleaned + ext;
            fd.reason = 'bs_removed';
          } else {
            results.skipped.push({ name: original, reason: 'Tên chứa "bs"' });
            continue;
          }
        }
      }

      if (!fd.uploadName) fd.uploadName = original;

      // Kiểm tra trùng tên
      if (settings.checkDuplicate) {
        const isDup = todayNames.some(n => {
          const a = settings.caseSensitive ? n : n.toLowerCase();
          const b = settings.caseSensitive ? fd.uploadName : fd.uploadName.toLowerCase();
          return a === b;
        });
        if (isDup) {
          if (settings.errorAction === 'rename') {
            fd.uploadName = settings.renamePrefix + fd.uploadName;
            fd.reason = (fd.reason ? fd.reason + '+' : '') + 'renamed';
          } else {
            results.skipped.push({ name: original, reason: 'Trùng tên hôm nay' });
            continue;
          }
        }
      }
      toUpload.push(fd);
    }

    if (!toUpload.length) return { ...results, message: 'Không có file hợp lệ để upload.' };

    const batches = chunkArray(toUpload, BATCH_SIZE);
    results.batches = batches.length;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      chrome.runtime.sendMessage({ type: 'BATCH_PROGRESS', current: i+1, total: batches.length, count: batch.length });
      try {
        await uploadBatch(batch);
        const successItems = [];
        for (const fd of batch) {
          successItems.push({ name: fd.uploadName, status: 'success' });
          results.success.push(fd.uploadName);
          if (fd.reason && fd.uploadName !== fd.name) {
            results.renamed.push({ from: fd.name, to: fd.uploadName });
          }
          todayNames.push(fd.uploadName);
        }
        await addHistoryBatch(successItems);
      } catch (err) {
        for (const fd of batch) {
          results.skipped.push({ name: fd.uploadName, reason: `Lỗi đợt ${i+1}: ${err.message}` });
        }
      }
      if (i < batches.length - 1) await sleep(1000);
    }

    const note = batches.length > 1 ? ` (${batches.length} đợt × ${BATCH_SIZE})` : '';
    return {
      ...results,
      message: `Đã upload ${results.success.length} file thành công${note}.`
        + (results.skipped.length ? ` Bỏ qua: ${results.skipped.length}.` : '')
        + (results.renamed.length ? ` Đổi tên: ${results.renamed.length}.` : ''),
    };
  }

  // ── Đóng dialog ───────────────────────────────────────────────────────────────
  function closeDialog(dialog) {
    if (!dialog) return;
    const closeSelectors = [
      'button[aria-label="Close"]', 'button[aria-label="close"]',
      '.btn-close', '.close', '[data-dismiss="modal"]', 'button.close', '.modal-close',
      '.ant-modal-close'
    ];
    for (const s of closeSelectors) {
      const btn = dialog.querySelector(s);
      if (btn && isVisible(btn)) { btn.click(); return; }
    }
    for (const el of dialog.querySelectorAll('button, a')) {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (['thoát', 'đóng', 'close', '×', 'x', 'hủy', 'huy'].includes(txt)) {
        el.click();
        return;
      }
    }
  }

  // ── Tìm phần tử ───────────────────────────────────────────────────────────────
  function findUpFilesButton() {
    for (const el of document.querySelectorAll('button, a, [role="button"], span[onclick], div[onclick]')) {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (txt === 'up files' || txt.includes('up files')) return el;
      if ((el.getAttribute('title') || '').toLowerCase().includes('up files')) return el;
      if ((el.getAttribute('aria-label') || '').toLowerCase().includes('up files')) return el;
    }
    return null;
  }

  function findUploadDialog() {
    const fast = [
      '[role="dialog"]', '.modal.show', '.modal.active',
      '[class*="modal"][class*="show"]', '[class*="dialog"][class*="open"]',
      'nz-modal-container', '.ant-modal'
    ];
    for (const s of fast) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return el;
    }
    // Fallback: tìm theo text đặc trưng
    const candidates = document.querySelectorAll('div[class*="modal"], div[class*="dialog"], div[class*="popup"], div[class*="overlay"]');
    for (const d of candidates) {
      if (!isVisible(d)) continue;
      const txt = (d.innerText || d.textContent || '').toLowerCase();
      if (txt.includes('chon file de upload') || txt.includes('chọn file để upload') ||
          txt.includes('so file / lan') || txt.includes('số file / lần') ||
          txt.includes('tải file') || txt.includes('up files')) return d;
    }
    return null;
  }

  function findUploadButton(dialog) {
    const container = dialog || document;
    const candidates = container.querySelectorAll('button, [role="button"], a.btn, a.button');
    for (const el of candidates) {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (txt === 'upload' || txt === 'tải lên' || txt === 'tai len') return el;
    }
    for (const el of candidates) {
      const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
      if ((txt.includes('upload') || txt.includes('tải lên')) && !txt.includes('up files')) return el;
    }
    const footerBtn = container.querySelector('.modal-footer button.btn-primary, .ant-modal-footer button.ant-btn-primary');
    if (footerBtn) return footerBtn;
    return null;
  }

  function isButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled || btn.hasAttribute('disabled')) return false;
    if (btn.classList.contains('disabled') || btn.classList.contains('ant-btn-disabled')) return false;
    return true;
  }

  function checkUploadStatus(dialog) {
    if (!dialog) return 'success';
    const txt = (dialog.innerText || dialog.textContent || '').toLowerCase();
    if (txt.includes('thất bại') || txt.includes('that bai') ||
        txt.includes('vượt quá') || txt.includes('vuot qua') ||
        txt.includes('lỗi máy chủ') || txt.includes('error') ||
        txt.includes('failed')) {
      return 'error';
    }
    if (txt.includes('thành công') || txt.includes('thanh cong') ||
        txt.includes('hoàn thành') || txt.includes('hoan thanh') ||
        txt.includes('success') || txt.includes('complete') ||
        txt.includes('100%')) {
      return 'success';
    }
    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fn, timeout = 5000, interval = 200) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = fn();
      if (r) return r;
      await sleep(interval);
    }
    return null;
  }

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function getExt(n)  { const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i) : ''; }
  function getBase(n) { const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(0, i) : n; }

  // Tối ưu chuyển Base64 thành File bằng native fetch & blob (nhanh hơn atob trên luồng chính)
  async function dataUrlToFile(dataUrl, fileName, mimeType) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], fileName, { type: mimeType || 'image/jpeg' });
    } catch (_) {
      const arr = dataUrl.split(',');
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      return new File([u8], fileName, { type: mimeType || 'image/jpeg' });
    }
  }

  async function getTodayNames() {
    return new Promise(r => chrome.runtime.sendMessage({ type: 'GET_TODAY' }, res => r(res?.names || [])));
  }

  async function addHistoryBatch(items) {
    return new Promise(r => chrome.runtime.sendMessage({ type: 'ADD_HISTORY_BATCH', items }, r));
  }
})();
