// ==UserScript==
// @name         Grok Imagine – Bulk Favorites Downloader v12
// @namespace    https://grok.com/
// @version      12.0.0
// @description  Downloads ALL your Grok Imagine favorites in chunks of 200. Remembers downloads, skips already-downloaded on future runs. Option to save IDs only without downloading.
// @author       You
// @match        https://grok.com/imagine*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      grok.com
// @connect      assets.grok.com
// @connect      imagine-public.x.ai
// @connect      x.ai
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────────────────
  const PAGE_SIZE      = 40;    // API items per request
  const CHUNK_SIZE     = 200;   // files per download batch before pausing
  const CHUNK_PAUSE_MS = 5000;  // ms to wait between chunks
  const API_DELAY_MS   = 700;   // ms between API pages
  const DL_DELAY_MS    = 250;   // ms between individual file downloads
  const ENDPOINT       = 'https://grok.com/rest/media/post/list';
  const STORAGE_KEY    = 'grokdl_downloaded_ids'; // persisted download history
  // ─────────────────────────────────────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const clean = (s, n) =>
    String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '-').slice(0, n);

  const fmtDate = ts => {
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (isNaN(d)) return 'unknown';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  // ── Persistent download history ───────────────────────────────────────────
  function loadHistory() {
    try {
      return new Set(JSON.parse(GM_getValue(STORAGE_KEY, '[]')).map(String));
    } catch (_) {
      return new Set();
    }
  }

  function saveHistory(set) {
    GM_setValue(STORAGE_KEY, JSON.stringify([...set]));
  }

  function markDownloaded(set, ids) {
    for (const id of ids) set.add(String(id));
    saveHistory(set);
  }

  function clearHistory() {
    GM_setValue(STORAGE_KEY, '[]');
  }

  // ── Fetch one page via GM_xmlhttpRequest ──────────────────────────────────
  function fetchPage(cursor) {
    return new Promise((resolve) => {
      const body = {
        limit:  PAGE_SIZE,
        filter: { source: 'MEDIA_POST_SOURCE_LIKED' },
      };
      if (cursor) body.cursor = String(cursor);

      GM_xmlhttpRequest({
        method:          'POST',
        url:             ENDPOINT,
        headers:         { 'Content-Type': 'application/json' },
        data:            JSON.stringify(body),
        withCredentials: true,
        onload: res => {
          if (res.status !== 200) {
            console.error('[GrokDL] API error', res.status, res.responseText.slice(0, 200));
            resolve(null);
            return;
          }
          try { resolve(JSON.parse(res.responseText)); }
          catch (e) { console.error('[GrokDL] JSON parse error', e); resolve(null); }
        },
        onerror: e => { console.error('[GrokDL] request error', e); resolve(null); },
      });
    });
  }

  // ── Parse one page of results ─────────────────────────────────────────────
  function parseResponse(data) {
    if (!data) return { items: [], nextCursor: null, rawCount: 0 };

    console.log('[GrokDL] response keys:', Object.keys(data));

    const raw = Array.isArray(data)
      ? data
      : data.mediaPosts ?? data.items  ?? data.posts   ?? data.results
      ?? data.data      ?? data.media  ?? data.list    ?? data.generations ?? [];

    console.log('[GrokDL] raw:', raw.length, '| keys:', raw[0] ? Object.keys(raw[0]) : 'n/a');

    const items = [];
    for (const post of raw) {
      harvest(post, items);
      for (const child of post?.childPosts ?? post?.children ?? post?.mediaList ?? post?.media ?? []) {
        harvest(child, items, post);
      }
    }

    const nextCursor =
      data.nextCursor   ?? data.next_cursor  ?? data.cursor     ??
      data.nextPage     ?? data.next         ?? data.pagination?.nextCursor ??
      data.meta?.cursor ?? null;

    return { items, nextCursor, rawCount: raw.length };
  }

  function harvest(item, out, parent) {
    if (!item) return;
    const url =
      item.hdMediaUrl || item.mediaUrl  || item.imageUrl ||
      item.videoUrl   || item.url       || item.media?.url ||
      item.fileUrl    || item.sourceUrl;
    if (!url) return;

    const isVid = /\.(mp4|webm|mov)/i.test(url) || item.mediaType === 'video';
    out.push({
      id:     String(item.id ?? item.postId ?? item.mediaId ?? item.generationId ?? Math.random()),
      url,
      prompt: clean(item.prompt ?? item.caption ?? parent?.prompt ?? 'no-prompt', 80),
      model:  clean(item.modelName ?? item.model ?? item.modelId ?? 'grok', 20),
      date:   fmtDate(item.createdAt ?? item.createdTime ?? item.timestamp ?? Date.now()),
      ext:    isVid ? 'mp4' : (url.match(/\.(png|webp|jpeg|jpg)/i)?.[1]?.toLowerCase() ?? 'jpg'),
    });
  }

  // ── Paginate all API pages ────────────────────────────────────────────────
  async function collectAll(onStatus, history) {
    const bag = new Map();
    let cursor     = null;
    let page       = 1;
    let emptyPages = 0;

    while (true) {
      onStatus(`Fetching page ${page}… (${bag.size} new items found so far)`);

      const data = await fetchPage(cursor);

      if (!data) {
        if (page === 1) {
          onStatus('❌ API request failed. Are you logged in? Check console.');
          break;
        }
        onStatus(`Request failed on page ${page}. Stopping.`);
        break;
      }

      const { items, nextCursor, rawCount } = parseResponse(data);

      let added = 0;
      for (const item of items) {
        if (!bag.has(item.id)) { bag.set(item.id, item); added++; }
      }

      onStatus(`Page ${page}: +${added} items (total so far: ${bag.size})`);
      console.log('[GrokDL] page', page, '| added:', added, '| nextCursor:', nextCursor);

      // Early-stop: API returns newest-first, so if every item on this page is
      // already in history, everything on later pages will be too.
      if (history && items.length > 0) {
        const allKnown = items.every(i => history.has(String(i.id)));
        if (allKnown) {
          onStatus(`Page ${page}: all items already downloaded — stopping early.`);
          console.log('[GrokDL] Early stop: full page already in history');
          break;
        }
      }

      if (added === 0) {
        emptyPages++;
        if (emptyPages >= 2) { onStatus('No new items — reached the end.'); break; }
      } else {
        emptyPages = 0;
      }

      if (!nextCursor) { onStatus('No next cursor — all pages fetched.'); break; }

      cursor = nextCursor;
      page++;
      await sleep(API_DELAY_MS);
    }

    return [...bag.values()];
  }

  // ── Download in chunks ────────────────────────────────────────────────────
  async function downloadNew(newItems, history, onStatus) {
    if (!newItems.length) {
      onStatus('No items to download.');
      return 0;
    }

    const total  = newItems.length;
    const chunks = Math.ceil(total / CHUNK_SIZE);
    let done     = 0;
    const justDownloaded = [];

    for (let c = 0; c < chunks; c++) {
      const chunkItems = newItems.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
      const chunkNum   = c + 1;

      onStatus(`Chunk ${chunkNum}/${chunks}: queuing ${chunkItems.length} files…`);

      for (const item of chunkItems) {
        const name = `grok-favorites/${item.date}_${item.id.slice(0, 8)}_${item.model}_${item.prompt}.${item.ext}`;
        GM_download({
          url:     item.url,
          name,
          onerror: e => console.warn('[GrokDL] download failed:', item.url, e),
        });
        justDownloaded.push(item.id);
        done++;

        if (done % 10 === 0 || done === total) {
          onStatus(`Chunk ${chunkNum}/${chunks} — ${done}/${total} files queued…`);
          markDownloaded(history, justDownloaded.splice(0));
        }

        await sleep(DL_DELAY_MS);
      }

      if (c < chunks - 1) {
        const remaining = total - done;
        onStatus(
          `✅ Chunk ${chunkNum}/${chunks} done! (${done}/${total} total)\n` +
          `Pausing ${CHUNK_PAUSE_MS / 1000}s before next ${Math.min(CHUNK_SIZE, remaining)} files…`
        );
        await sleep(CHUNK_PAUSE_MS);
      }
    }

    if (justDownloaded.length) markDownloaded(history, justDownloaded);
    return done;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('grokdl-v12')) return;

    const wrap = document.createElement('div');
    wrap.id = 'grokdl-v12';
    Object.assign(wrap.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    const log = document.createElement('div');
    Object.assign(log.style, {
      background: 'rgba(9,11,17,0.94)', color: '#cbd5e1',
      border: '1px solid rgba(255,255,255,0.11)', borderRadius: '10px',
      padding: '10px 14px', fontSize: '12px', lineHeight: '1.7',
      maxWidth: '320px', display: 'none', wordBreak: 'break-word',
      backdropFilter: 'blur(10px)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    });

    const btn = document.createElement('button');
    btn.textContent = '⬇ Download New Favorites';
    Object.assign(btn.style, {
      background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
      borderRadius: '10px', padding: '11px 20px', fontSize: '13px', fontWeight: '600',
      minWidth: '220px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      transition: 'background .15s',
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '🗑 Reset download history';
    Object.assign(resetBtn.style, {
      background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer',
      fontSize: '11px', padding: '2px 4px', textDecoration: 'underline',
    });
    resetBtn.title = 'Clears the memory of what was downloaded so everything gets re-downloaded next time';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset download history? Next run will re-download everything.')) {
        clearHistory();
        setStatus('History cleared. Next download will grab everything.');
      }
    });

    let _col = '#2563eb';
    const setColor  = c => { _col = c; btn.style.background = c; };
    const setStatus = msg => { log.textContent = msg; console.log('[GrokDL]', msg); };

    btn.onmouseenter = () => { if (!btn.disabled) btn.style.background = '#1d4ed8'; };
    btn.onmouseleave = () => { if (!btn.disabled) btn.style.background = _col; };

    function showActionModal(onChoice) {
      document.getElementById('grokdl-modal')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'grokdl-modal';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483646',
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)', fontFamily: 'system-ui, -apple-system, sans-serif',
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#0f1117', color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
        padding: '28px 28px 24px', maxWidth: '360px', width: '90%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      });

      const title = document.createElement('div');
      title.textContent = 'What would you like to do?';
      Object.assign(title.style, { fontSize: '15px', fontWeight: '700', marginBottom: '8px' });

      const history = loadHistory();
      const sub = document.createElement('div');
      sub.textContent = `${history.size} ID(s) in download history`;
      Object.assign(sub.style, { fontSize: '12px', color: '#64748b', marginBottom: '20px' });

      const mkBtn = (label, desc, color, action) => {
        const row = document.createElement('button');
        Object.assign(row.style, {
          display: 'block', width: '100%', background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${color}33`, borderRadius: '10px',
          padding: '12px 14px', marginBottom: '10px', cursor: 'pointer',
          textAlign: 'left', transition: 'background .15s',
        });
        row.onmouseenter = () => { row.style.background = `${color}22`; };
        row.onmouseleave = () => { row.style.background = 'rgba(255,255,255,0.05)'; };

        const lbl = document.createElement('div');
        lbl.textContent = label;
        Object.assign(lbl.style, { fontSize: '13px', fontWeight: '600', color });

        const dsc = document.createElement('div');
        dsc.textContent = desc;
        Object.assign(dsc.style, { fontSize: '11px', color: '#94a3b8', marginTop: '3px' });

        row.appendChild(lbl);
        row.appendChild(dsc);
        row.addEventListener('click', () => { overlay.remove(); onChoice(action); });
        return row;
      };

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      Object.assign(cancelBtn.style, {
        background: 'transparent', border: 'none', color: '#64748b',
        cursor: 'pointer', fontSize: '12px', marginTop: '4px',
        display: 'block', width: '100%', textAlign: 'center', padding: '6px',
      });
      cancelBtn.addEventListener('click', () => { overlay.remove(); onChoice(null); });

      box.appendChild(title);
      box.appendChild(sub);
      box.appendChild(mkBtn(
        '⬇ Download new favorites',
        'Fetch all favorites, skip ones already downloaded, save the rest',
        '#60a5fa', 'download'
      ));
      box.appendChild(mkBtn(
        '🔖 Save IDs only (no download)',
        'Mark all current favorites as "already have" without downloading files',
        '#a78bfa', 'ids_only'
      ));
      box.appendChild(mkBtn(
        '⬇ Download everything (ignore history)',
        'Re-download all favorites regardless of history',
        '#f59e0b', 'download_all'
      ));
      box.appendChild(cancelBtn);
      overlay.appendChild(box);
      overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onChoice(null); } });
      document.body.appendChild(overlay);
    }

    let busy = false;
    btn.addEventListener('click', () => {
      if (busy) return;
      showActionModal(async (action) => {
        if (!action) return;

        busy = true; btn.disabled = true;
        log.style.display = 'block';
        setColor('#1e40af');
        btn.textContent = '⏳ Collecting…';

        try {
          const history = loadHistory();
          console.log('[GrokDL] Loaded history, IDs tracked:', history.size, '| sample:', [...history].slice(0,3));
          setStatus(`Fetching favorites list… (${history.size} previously downloaded)`);

          const allItems = await collectAll(setStatus, action === 'download' ? history : null);

          if (action === 'ids_only') {
            const newIds = allItems.filter(i => !history.has(i.id)).map(i => i.id);
            markDownloaded(history, newIds);
            setStatus(`✅ Saved ${newIds.length} new ID(s) to history.\nTotal tracked: ${history.size}.\nNo files were downloaded.`);
            btn.textContent = `✅ ${newIds.length} IDs saved`;
            setColor('#a78bfa');

          } else {
            console.log('[GrokDL] Sample fetched IDs:', allItems.slice(0,3).map(i => i.id), '| types:', allItems.slice(0,3).map(i => typeof i.id));
            console.log('[GrokDL] History sample:', [...history].slice(0,3), '| types:', [...history].slice(0,3).map(i => typeof i));

            const itemsToDownload = action === 'download_all'
              ? allItems
              : allItems.filter(i => !history.has(String(i.id)));

            const skipped = allItems.length - itemsToDownload.length;
            const newCount = itemsToDownload.length;

            if (newCount === 0) {
              setStatus(`✅ Nothing new! All ${allItems.length} favorites already downloaded.\nGenerate new images, save them, then click again.`);
              btn.textContent = '✅ Already up to date';
              setColor('#16a34a');
            } else {
              setStatus(`${newCount} to download${skipped > 0 ? `, skipping ${skipped} already downloaded` : ''}…`);
              const n = await downloadNew(itemsToDownload, history, setStatus);
              if (n > 0) {
                setStatus(`✅ Done! ${n} file(s) → Downloads/grok-favorites/`);
                btn.textContent = `✅ ${n} files done`;
                setColor('#16a34a');
              } else {
                btn.textContent = '⬇ Download New Favorites';
                setColor('#2563eb');
              }
            }
          }
        } catch (e) {
          setStatus('❌ ' + e.message);
          console.error('[GrokDL]', e);
          btn.textContent = '⬇ Retry';
          setColor('#dc2626');
        }

        btn.disabled = false; busy = false;
      });
    });

    wrap.appendChild(log);
    wrap.appendChild(btn);
    wrap.appendChild(resetBtn);
    document.body.appendChild(wrap);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.body) buildUI();
  else new MutationObserver((_, o) => {
    if (document.body) { o.disconnect(); buildUI(); }
  }).observe(document.documentElement, { childList: true });

  let _path = location.pathname;
  setInterval(() => {
    if (location.pathname !== _path) { _path = location.pathname; setTimeout(buildUI, 800); }
  }, 500);

})();
