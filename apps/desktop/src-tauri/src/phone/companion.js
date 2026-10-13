/* Native companion enhancement. IndexedDB is an outbox, never library authority. */
(() => {
  "use strict";
  const form = document.querySelector('form[action="/capture"]');
  const list = document.querySelector('[data-testid="outbox"]');
  const connection = document.querySelector('[data-testid="connection-state"]');
  const status = document.querySelector('#local-status');
  if (!form || !list || !connection || !status) return;
  let db;
  let library;
  let flushing;
  let saving = false;
  let urls = [];
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const s = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
  };
  function storage(store, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error("Device storage unavailable"));
    });
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await fetch(path, { ...options, signal: controller.signal, cache: "no-store", credentials: "same-origin" }); }
    finally { clearTimeout(timeout); }
  }
  async function connect() {
    try {
      const response = await request('/companion/library');
      if (!response.ok) throw Error("Desktop unavailable");
      const identity = await response.json();
      if (identity.format !== "recall-companion-v1" || !/^[0-9a-f-]{36}$/.test(identity.library_id)) throw Error("Unrecognized library");
      await storage('meta', 'readwrite', s => s.put(identity.library_id, 'library'));
      library = identity.library_id;
      connection.textContent = `Connected to library ${library.slice(0,8)}. Retrieval uses the desktop.`;
      return library;
    } catch {
      connection.textContent = "Desktop unavailable. Captures stay on this device; desktop retrieval is unavailable.";
      return null;
    }
  }
  async function render() {
    const rows = await storage('captures', 'readonly', s => s.getAll());
    urls.forEach(URL.revokeObjectURL); urls = [];
    list.replaceChildren();
    for (const row of rows.sort((a,b) => a.created - b.created)) {
      const article = document.createElement('article');
      const state = document.createElement('strong');
      state.textContent = row.receipt ? 'Received by library' : 'Saved on this device';
      const body = document.createElement('p');
      body.textContent = row.note || row.filename || 'Photo capture';
      const detail = document.createElement('p');
      detail.className = 'fine';
      detail.textContent = row.receipt
        ? `Library ${row.library.slice(0,8)} acknowledged receipt. Organization is separate; inspect its current status on desktop.`
        : (row.error || 'Waiting to send to library.') + ` Library ${row.library.slice(0,8)}.`;
      article.append(state, body, detail);
      const blob = row.photo || new Blob([row.note], { type: 'text/plain' });
      const url = URL.createObjectURL(blob); urls.push(url);
      const copy = document.createElement('a');
      copy.href = url; copy.download = row.filename || 'recall-capture.txt'; copy.textContent = 'Save original copy';
      article.append(copy);
      if (row.receipt && row.library === library) {
        const inspect = document.createElement('a');
        inspect.href = `/saved/${row.id}`; inspect.textContent = ' · Inspect in library'; article.append(inspect);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove device copy';
      remove.onclick = async () => {
        if (!confirm(row.receipt ? 'Remove only this device copy? The library is unchanged.' : 'This capture may exist only on this device. Save an original copy before removing it. Remove it?')) return;
        try { await storage('captures', 'readwrite', s => s.delete(row.id)); await render(); }
        catch { status.textContent = 'Could not remove the device copy.'; }
      };
      article.append(remove); list.append(article);
    }
  }
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const current = await connect();
      // Received copies retain their original scope even when there is no work
      // left to send. Remove stale inspection links after a library switch.
      await render();
      if (!current) return;
      const rows = await storage('captures', 'readonly', s => s.getAll());
      for (const row of rows.filter(r => !r.receipt)) {
        if (row.library !== current) {
          row.error = 'Different library. Reconnect the original library to send this capture.';
        } else {
          const data = new FormData();
          data.set('operation_id', row.id); data.set('note', row.note);
          if (row.photo) data.set('photo', row.photo, row.filename);
          if (row.consent) data.set('process_consent', 'true');
          try {
            const response = await request('/capture', { method: 'POST', body: data,
              headers: { accept: 'application/json', 'x-recall-library-id': row.library } });
            if (!response.ok) throw Error(response.status === 409 ? 'Library changed or busy. Review and retry.' : `Desktop did not acknowledge receipt (${response.status}).`);
            const receipt = await response.json();
            if (receipt.format !== 'recall-capture-receipt-v1' || receipt.state !== 'received' ||
                receipt.library_id !== row.library || receipt.memory_id !== row.id ||
                !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 ||
                !/^[0-9a-f]{64}$/.test(receipt.source_sha256)) throw Error('Receipt did not match this capture.');
            row.receipt = receipt; row.error = '';
          } catch (error) {
            row.error = `${error.message || 'Desktop unavailable'}. Original retained; retry uses the same capture ID.`;
          }
        }
        // Do not resurrect a copy removed in another tab while the request ran.
        await new Promise((resolve, reject) => {
          const tx = db.transaction('captures', 'readwrite'); const store = tx.objectStore('captures');
          const get = store.get(row.id);
          get.onsuccess = () => {
            if (get.result) store.put(get.result.receipt && !row.receipt ? get.result : row);
          };
          tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
        });
        await render();
      }
    })().catch(() => { status.textContent = 'Receipt could not be saved on this device. Original retained; retry to confirm.'; })
      .finally(() => { flushing = null; });
    return flushing;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      if (!db) throw Error('Device storage unavailable. Keep your original; nothing was sent.');
      if (!library) throw Error('Connect to your library once before saving offline captures. Your draft is still here.');
      const data = new FormData(form);
      const note = String(data.get('note') || '');
      const file = data.get('photo'); const photo = file && file.size ? file : null;
      if (!note.trim() && !photo) throw Error('Write a note or choose a photo.');
      if (new TextEncoder().encode(note).length > 262144 || (photo && photo.size > 20 * 1024 * 1024)) throw Error('Use a note under 256 KiB and a photo under 20 MiB. Original remains selected.');
      if (photo && !['image/png','image/jpeg','image/webp'].includes(photo.type)) throw Error('Choose a PNG, JPEG or WebP photo.');
      const row = { id: uuid(), library, note, photo, filename: photo?.name || '',
        consent: data.get('process_consent') === 'true', created: Date.now(), receipt: null, error: '' };
      await storage('captures', 'readwrite', s => s.add(row));
      form.reset(); status.textContent = 'Saved on this device. Waiting for a library receipt.';
      await render(); void flush();
    } catch (error) { status.textContent = error.message || 'Save failed. Keep the original; nothing was sent.'; }
    finally { saving = false; button.disabled = false; }
  });
  document.querySelector('#retry-queue').addEventListener('click', () => { if (db) void flush(); });
  const ask = document.querySelector('form[action="/ask"]');
  ask.addEventListener('submit', async event => {
    event.preventDefault();
    if (await connect()) ask.submit();
    else status.textContent = 'Desktop retrieval unavailable. Your question is still here; retry when connected.';
  });
  window.addEventListener('online', () => { if (db) void flush(); });
  window.addEventListener('offline', () => { connection.textContent = 'Offline. Captures stay on this device; desktop retrieval is unavailable.'; });
  const open = indexedDB.open('recall-companion-v1', 1);
  open.onupgradeneeded = () => { open.result.createObjectStore('captures', { keyPath: 'id' }); open.result.createObjectStore('meta'); };
  open.onerror = () => { status.textContent = 'Device storage unavailable. Keep this page and your original open.'; };
  open.onsuccess = async () => {
    db = open.result;
    try {
      library = await storage('meta', 'readonly', s => s.get('library'));
      await render(); await flush();
      if ('serviceWorker' in navigator && window.isSecureContext) {
        await navigator.serviceWorker.register('/companion-sw.js');
        await navigator.serviceWorker.ready;
        if (!status.textContent) status.textContent = 'Offline capture is ready on this device. Library retrieval still requires the desktop.';
      } else if (!status.textContent) { status.textContent = 'Keep this page open for offline capture. HTTPS is required to reopen it offline.'; }
    } catch { if (!status.textContent) status.textContent = 'Offline setup could not complete. Keep this page and your originals open.'; }
  };
})();
