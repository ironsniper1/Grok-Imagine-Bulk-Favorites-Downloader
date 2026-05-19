// ==UserScript==
// @name         Grok Imagine – Bulk Favorites Downloader v22
// @namespace    https://grok.com/
// @version      22.3.0
// @description  Bulk download favorites + bulk upscale videos + quota monitor + improved naming + better progress
// @author       You
// @match        https://grok.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      grok.com
// @connect      rest/media/folder/list
// @connect      assets.grok.com
// @connect      imagine-public.x.ai
// @connect      x.ai
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIG ──────────────────────────────────────────────────────────────
    const PAGE_SIZE = 40;
    const CHUNK_SIZE = 200;
    const CHUNK_PAUSE_MS = 5000;
    const API_DELAY_MS = 1000;
    const DL_DELAY_MS = 800;
    const UPSCALE_DELAY_MS = 200; // 1s between upscale requests

    const ENDPOINT = 'https://grok.com/rest/media/post/list';
    const FOLDER_ENDPOINT = 'https://grok.com/rest/media/folder/list';
    const UPSCALE_ENDPOINT = 'https://grok.com/rest/media/video/upscale';
    const STORAGE_KEY = 'grokdl_downloaded_ids';
    const QUOTA_ENDPOINT = 'https://grok.com/rest/media/imagine/quota_info';
    const QUOTA_REFRESH_MS = 30000;
    // ─────────────────────────────────────────────────────────────────────────

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ── Quota check ──────────────────────────────────────────────────────────
    function fetchQuotaInfo() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: QUOTA_ENDPOINT,
                headers: { 'Content-Type': 'application/json' },
                data: '{}',
                withCredentials: true,
                onload: res => {
                    try { resolve(JSON.parse(res.responseText)); }
                    catch (_) { resolve(null); }
                },
                onerror: () => resolve(null),
            });
        });
    }

    const QUOTA_SERVICES = [
        { key: 'image',     title: 'Speed Image',      icon: '\u26a1' },
        { key: 'imagePro',  title: 'Quality Image',    icon: '\ud83c\udfa8' },
        { key: 'imageEdit', title: 'Edit Image',       icon: '\u270f\ufe0f' },
        { key: 'video',     title: '480p Video',       icon: '\ud83c\udfa5' },
        { key: 'video720p', title: '720p Video',       icon: '\ud83d\udcfd\ufe0f' },
    ];

    function buildQuotaPanel() {
        const panel = document.createElement('div');
        panel.id = 'grokdl-quota';
        Object.assign(panel.style, {
            background: 'rgba(9,11,17,0.94)', color: '#cbd5e1',
            border: '1px solid rgba(255,255,255,0.11)', borderRadius: '10px',
            padding: '12px 14px', fontSize: '11px', lineHeight: '1.6',
            maxWidth: '320px', minWidth: '220px',
            backdropFilter: 'blur(10px)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            display: 'none',
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: '8px',
        });

        const title = document.createElement('span');
        title.textContent = '\ud83d\udcca Imagine Quota';
        Object.assign(title.style, { fontWeight: '700', fontSize: '12px' });

        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '\u21bb';
        refreshBtn.title = 'Refresh quota';
        Object.assign(refreshBtn.style, {
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#cbd5e1', cursor: 'pointer',
            borderRadius: '5px', padding: '2px 8px', fontSize: '12px',
        });

        header.appendChild(title);
        header.appendChild(refreshBtn);
        panel.appendChild(header);

        const grid = document.createElement('div');
        grid.id = 'grokdl-quota-grid';
        Object.assign(grid.style, {
            display: 'flex', flexDirection: 'column', gap: '6px',
        });
        panel.appendChild(grid);

        async function loadQuota() {
            grid.innerHTML = '<div style="color:#64748b;text-align:center;padding:4px;">Loading...</div>';
            const data = await fetchQuotaInfo();
            panel.style.display = 'block';
            if (!data) {
                grid.innerHTML = '<div style="color:#ef4444;text-align:center;">Failed to load quota</div>';
                return;
            }
            grid.innerHTML = '';
            for (const svc of QUOTA_SERVICES) {
                const q = data[svc.key];
                if (!q) continue;
                const isActive = q.available && (q.remainingQueries === null || q.remainingQueries > 0);
                const remaining = q.remainingQueries === null ? '\u221e' : q.remainingQueries;

                const row = document.createElement('div');
                Object.assign(row.style, {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '3px 6px', borderRadius: '6px',
                    background: isActive ? 'rgba(0,255,140,0.06)' : 'rgba(255,60,60,0.06)',
                });

                const dot = document.createElement('span');
                Object.assign(dot.style, {
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: isActive ? '#00ff99' : '#ff4d4d',
                    boxShadow: '0 0 6px ' + (isActive ? '#00ff99' : '#ff4d4d'),
                });

                const name = document.createElement('span');
                name.textContent = svc.icon + ' ' + svc.title;
                Object.assign(name.style, { flex: '1', fontSize: '11px' });

                const count = document.createElement('span');
                count.textContent = String(remaining);
                Object.assign(count.style, {
                    fontWeight: '700', fontSize: '12px',
                    color: isActive ? '#00ff99' : '#ff4d4d',
                    minWidth: '20px', textAlign: 'right',
                });

                row.appendChild(dot);
                row.appendChild(name);
                row.appendChild(count);
                grid.appendChild(row);
            }
        }

        refreshBtn.addEventListener('click', loadQuota);
        loadQuota();
        setInterval(loadQuota, QUOTA_REFRESH_MS);

        return panel;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const clean = (s, n) =>
    String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '-').slice(0, n);

    const fmtDate = ts => { /* keep original */
        const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
        if (isNaN(d)) return 'unknown';
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    };

    // Persistent history (unchanged)
    function loadHistory() { /* ... same as v21 ... */
        try { return new Set(JSON.parse(GM_getValue(STORAGE_KEY, '[]')).map(String)); }
        catch (_) { return new Set(); }
    }
    function saveHistory(set) { GM_setValue(STORAGE_KEY, JSON.stringify([...set])); }
    function markDownloaded(set, ids) {
        for (const id of ids) set.add(String(id));
        saveHistory(set);
    }
    function clearHistory() { GM_setValue(STORAGE_KEY, '[]'); }

    // ── Fetch one page via GM_xmlhttpRequest ──────────────────────────────────
    function fetchPage(cursor, folderId) {
        return new Promise((resolve) => {
            const body = {
                limit:  PAGE_SIZE,
                filter: { source: 'MEDIA_POST_SOURCE_LIKED' },
            };
            if (cursor) body.cursor = String(cursor);
            if (folderId) body.filter.folderId = folderId;

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

    // ── Fetch folder list ────────────────────────────────────────────────────
    function fetchFolders() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method:          'POST',
                url:             FOLDER_ENDPOINT,
                headers:         { 'Content-Type': 'application/json' },
                data:            JSON.stringify({}),
                withCredentials: true,
                onload: res => {
                    if (res.status !== 200) { resolve([]); return; }
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data.folders ?? []);
                    } catch (_) { resolve([]); }
                },
                onerror: () => resolve([]),
            });
        });
    }

    // ── Parse one page of results ─────────────────────────────────────────────
    function parseResponse(data, page = 1, shallowOnly = false) {
        if (!data) return { items: [], nextCursor: null, rawCount: 0 };

        const raw = Array.isArray(data) ? data : data.posts ?? data.mediaPosts ?? data.items ?? data.results ?? data.data ?? data.media ?? data.list ?? data.generations ?? [];

        const items = [];
        let postIdx = 1;

        for (const post of raw) {
            // 忽略原post项，只从 images 和 videos 取
            const allMedia = [...(post.images ?? []), ...(post.videos ?? [])];

            // 取生成时间最早的项作为 postID（主帖ID）
            let postID = post.id;
            let earliestTime = Infinity;
            for (const m of allMedia) {
                const t = new Date(m.createTime || m.createdAt || m.createdTime || 0).getTime();
                if (t > 0 && t < earliestTime) {
                    earliestTime = t;
                    postID = m.id;  // 或保持 post.id，根据实际优先用最早media的id
                }
            }

            let childIdx = 1;
            for (const child of allMedia) {
                harvest(child, items, post, page, postIdx, childIdx);
                // 覆盖id为 postID（主帖最早id）
                if (items.length) {
                    const last = items[items.length - 1];
                    last.postID = String(postID);  // 新增字段用于文件名
                }
                childIdx++;
            }
            postIdx++;
        }

        const nextCursor = data.nextCursor ?? data.next_cursor ?? data.cursor ?? data.nextPage ?? data.next ?? data.pagination?.nextCursor ?? data.meta?.cursor ?? null;

        return { items, nextCursor, rawCount: raw.length };
    }
    // ── Harvest single item ───────────────────────────────────────────────────
    function harvest(item, out, parent, page = 1, postIdx = 1, childIdx = 0) {
        if (!item) return;

        const url = item.hdMediaUrl || item.mediaUrl || item.imageUrl || item.videoUrl || item.url || item.media?.url || item.fileUrl || item.sourceUrl;
        if (!url) return;

        const isVid = /\.(mp4|webm|mov)/i.test(url) || item.mediaType === 'video';
        const lowresvid = isVid && !item.hdMediaUrl && !item.hdUrl && item.resolutionName === "480p";   // 低分辨率视频需要 upscale

        out.push({
            id: String(item.id ?? item.postId ?? item.mediaId ?? item.generationId ?? Math.random()),
            url,
            prompt: clean(item.prompt ?? item.caption ?? parent?.prompt ?? 'no-prompt', 80),
            model: clean(item.modelName ?? item.model ?? item.modelId ?? 'grok', 20),
            date: fmtDate(item.createdAt ?? item.createTime ?? item.createdTime ?? item.timestamp ?? Date.now()),
            ext: isVid ? 'mp4' : (url.match(/\.(png|webp|jpeg|jpg)/i)?.[1]?.toLowerCase() ?? 'jpg'),
            page: page,
            postIdx: postIdx,
            childIdx: childIdx,
            lowresvid: lowresvid,
            // 新增用于文件名和CSV
            childId: String(item.id),
            createTime: item.createTime || item.createdAt || item.createdTime
        });
    }

// ── Collect all pages（无最大分页限制，直接循环到无nextCursor） ─────────────
    async function collectAll(onStatus, history, folderId, shallowOnly = false) {
        const bag = new Map();
        let cursor = null;
        let page = 1;
        let emptyPages = 0;

        while (true) {
            onStatus(`Fetching page ${page}… (${bag.size} items found so far)`);

            let data = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                data = await fetchPage(cursor, folderId);
                if (data) break;
                await sleep(1500);
            }
            if (!data) break;

            const { items, nextCursor } = parseResponse(data, page, shallowOnly);

            for (const item of items) {
                if (!bag.has(item.id)) bag.set(item.id, item);
            }

            onStatus(`Page ${page}: +${items.length} new (${bag.size} total)`);

            if (items.length === 0) {
                emptyPages++;
                if (emptyPages >= 2) break;
            } else {
                emptyPages = 0;
            }

            if (!nextCursor) break;

            cursor = nextCursor;
            page++;
            await sleep(1000);
        }

        return [...bag.values()];
    }

// ── Bulk Upscale Videos ───────────────────────────────────────────────────
async function bulkUpscaleVideos(items, onStatus) {
    // 只处理 lowresvid === true 的视频
    const videosToUpscale = items.filter(item => item.lowresvid === true);

    if (!videosToUpscale.length) {
        onStatus('✅ No low-resolution videos need upscaling.');
        return 0;
    }

    onStatus(`🔼 Starting upscale for ${videosToUpscale.length} low-res videos...`);

    let success = 0;
    const failedVideos = [];

    for (let i = 0; i < videosToUpscale.length; i++) {
        const v = videosToUpscale[i];
        onStatus(`🔼 Upscaling video ${i+1}/${videosToUpscale.length} (ID: ${v.id})...`);

        const result = await new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: UPSCALE_ENDPOINT,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ videoId: v.id }),
                withCredentials: true,
                onload: res => {
                    if (res.status === 200) {
                        success++;
                        resolve({ success: true, status: res.status });
                    } else {
                        resolve({ success: false, status: res.status });
                    }
                },
                onerror: () => {
                    resolve({ success: false, status: 0 }); // Network error
                }
            });
        });

        if (!result.success) {
            failedVideos.push({
                id: v.id,
                status: result.status,
                prompt: v.prompt || 'No prompt available'
            });
        }

        if (i < videosToUpscale.length - 1) {
            await sleep(UPSCALE_DELAY_MS);
        }
    }

    // Generate failure report
    if (failedVideos.length > 0) {
        onStatus(`🎉 Bulk upscale finished — ${success}/${videosToUpscale.length} requests sent. ${failedVideos.length} failed.`);

        // Remove existing failure panel if any
        document.getElementById('grokdl-upscale-failures')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'grokdl-upscale-failures';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '2147483647',
            background: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)', fontFamily: 'system-ui, -apple-system, sans-serif',
        });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            background: '#0f1117', color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px',
            padding: '24px', maxWidth: '520px', width: '90%',
            maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
        });

        const title = document.createElement('div');
        Object.assign(title.style, {
            fontSize: '16px', fontWeight: '700', marginBottom: '16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        });

        const titleText = document.createElement('span');
        titleText.textContent = `⚠️ Upscale Failed (${failedVideos.length})`;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        Object.assign(closeBtn.style, {
            background: 'transparent', border: 'none', color: '#64748b',
            cursor: 'pointer', fontSize: '18px', padding: '0 4px',
        });
        closeBtn.addEventListener('click', () => overlay.remove());

        title.appendChild(titleText);
        title.appendChild(closeBtn);
        panel.appendChild(title);

        failedVideos.forEach((video) => {
            const postUrl = `https://grok.com/imagine/post/${video.id}`;

            const row = document.createElement('div');
            Object.assign(row.style, {
                background: 'rgba(255,255,255,0.04)', borderRadius: '8px',
                padding: '10px 12px', marginBottom: '8px',
                borderLeft: '3px solid #ef4444',
            });

            const idLine = document.createElement('div');
            Object.assign(idLine.style, { fontSize: '11px', color: '#94a3b8', marginBottom: '3px' });
            idLine.textContent = `ID: ${video.id}`;

            const promptLine = document.createElement('div');
            Object.assign(promptLine.style, { fontSize: '12px', color: '#cbd5e1', marginBottom: '4px', wordBreak: 'break-word' });
            promptLine.textContent = `Prompt: ${video.prompt}`;

            const statusLine = document.createElement('div');
            Object.assign(statusLine.style, { fontSize: '11px', color: '#f87171', marginBottom: '4px' });
            statusLine.textContent = `Status: ${video.status === 0 ? 'Network Error' : `HTTP ${video.status}`}`;

            const linkEl = document.createElement('a');
            linkEl.href = postUrl;
            linkEl.target = '_blank';
            linkEl.textContent = '🔗 Open in Grok';
            Object.assign(linkEl.style, {
                color: '#60a5fa', fontSize: '12px', textDecoration: 'none',
                display: 'inline-block', marginTop: '2px',
            });
            linkEl.addEventListener('mouseenter', () => linkEl.style.textDecoration = 'underline');
            linkEl.addEventListener('mouseleave', () => linkEl.style.textDecoration = 'none');

            row.appendChild(idLine);
            row.appendChild(promptLine);
            row.appendChild(statusLine);
            row.appendChild(linkEl);
            panel.appendChild(row);
        });

        overlay.appendChild(panel);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    } else {
        onStatus(`🎉 Bulk upscale finished — ${success}/${videosToUpscale.length} requests sent.`);
    }

    return success;
}

    // ── Download with new filename rule ───────────────────────────────────────
    async function downloadNew(newItems, history, onStatus) {
        if (!newItems.length) return 0;

        const csvRows = [["filename", "childId", "prompt"]];
        let done = 0;

        for (const item of newItems) {
            const postID8 = String(item.postID || item.id).slice(0, 8);
            const dt = new Date(item.createTime || Date.now());
            const date8 = dt.getFullYear().toString().slice(-2) + String(dt.getMonth()+1).padStart(2,'0') + String(dt.getDate()).padStart(2,'0');
            const time6 = String(dt.getHours()).padStart(2,'0') + String(dt.getMinutes()).padStart(2,'0') + String(dt.getSeconds()).padStart(2,'0');
            const childID8 = String(item.childId || item.id).slice(0, 8);

            const name = `${postID8}_${date8}_${time6}_${childID8}.${item.ext}`;

            csvRows.push([name, item.childId || item.id, item.prompt]);

            onStatus(`Downloading ${++done}/${newItems.length} → ${name}`);

            GM_download({ url: item.url, name });

            await sleep(800);
        }

        // 生成CSV
        const csvContent = csvRows.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'grok_download_list.csv';
        link.click();

        if (history) markDownloaded(history, newItems.map(i => i.id));
        return done;
    }
    // ── UI (新增 Upscale 按钮 + 改进进度) ───────────────────────────────────
    function buildUI() {
        if (document.getElementById('grokdl-v22')) return;

        const wrap = document.createElement('div');
        wrap.id = 'grokdl-v16';
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

        // Main download button
        const btn = document.createElement('button');
        btn.textContent = '⬇ Download Favorites';
        Object.assign(btn.style, {
            background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
            borderRadius: '10px', padding: '11px 20px', fontSize: '13px', fontWeight: '600',
            minWidth: '220px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            transition: 'background .15s',
        });

        // Small "reset history" link below the button
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

        // ── Modal dialog asking what to do ────────────────────────────────────
        function showActionModal(onChoice) { // onChoice(action, maxPages)
            // Remove any existing modal
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

            // Optional page limit input
            const limitWrap = document.createElement('div');
            Object.assign(limitWrap.style, { marginBottom: '16px' });

            const limitLabel = document.createElement('label');
            limitLabel.textContent = 'Max pages to fetch (leave blank for all):';
            Object.assign(limitLabel.style, { fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '5px' });

            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.min = '1';
            limitInput.placeholder = 'e.g. 3  =  120 newest items';
            Object.assign(limitInput.style, {
                width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '7px', padding: '7px 10px', color: '#e2e8f0', fontSize: '12px',
                boxSizing: 'border-box', outline: 'none',
            });

            limitWrap.appendChild(limitLabel);
            limitWrap.appendChild(limitInput);

            // Media type filter
            const filterWrap = document.createElement('div');
            Object.assign(filterWrap.style, { marginBottom: '16px' });

            const filterLabel = document.createElement('label');
            filterLabel.textContent = 'Media type to download:';
            Object.assign(filterLabel.style, { fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '5px' });

            const filterSelect = document.createElement('select');
            Object.assign(filterSelect.style, {
                width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '7px', padding: '7px 10px', color: '#e2e8f0', fontSize: '12px',
                boxSizing: 'border-box', outline: 'none', cursor: 'pointer',
            });
            [['all', '🖼 + 🎥  Images & Videos (default)'], ['images', '🖼  Images only'], ['videos', '🎥  Videos only']].forEach(([val, label]) => {
                const opt = document.createElement('option');
                opt.value = val; opt.textContent = label;
                filterSelect.appendChild(opt);
            });

            filterWrap.appendChild(filterLabel);
            filterWrap.appendChild(filterSelect);

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
                row.addEventListener('click', () => { const mp = parseInt(limitInput.value, 10); overlay.remove(); onChoice(action, isNaN(mp) || mp < 1 ? 0 : mp, filterSelect.value, '', ''); });
                return row;
            };

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            Object.assign(cancelBtn.style, {
                background: 'transparent', border: 'none', color: '#64748b',
                cursor: 'pointer', fontSize: '12px', marginTop: '4px',
                display: 'block', width: '100%', textAlign: 'center', padding: '6px',
            });
            cancelBtn.addEventListener('click', () => { overlay.remove(); onChoice(null, 0, 'all', ''); });

            box.appendChild(title);
            box.appendChild(sub);
            box.appendChild(limitWrap);
            box.appendChild(filterWrap);
            box.appendChild(mkBtn(
                '⬇ Download new favorites',
                'Fetch all favorites, skip ones already downloaded, save the rest',
                '#60a5fa', 'download'
            ));
            // Quick sync page input
            const quickWrap = document.createElement('div');
            Object.assign(quickWrap.style, { marginBottom: '10px' });
            const quickLabel = document.createElement('label');
            quickLabel.textContent = 'Quick sync: pages to scan (default 5 = ~200 newest items):';
            Object.assign(quickLabel.style, { fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '5px' });
            const quickInput = document.createElement('input');
            quickInput.type = 'number'; quickInput.min = '1'; quickInput.value = '5';
            quickInput.placeholder = 'e.g. 5 = ~200 items';
            Object.assign(quickInput.style, {
                width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '7px', padding: '7px 10px', color: '#e2e8f0', fontSize: '12px',
                boxSizing: 'border-box', outline: 'none',
            });
            quickWrap.appendChild(quickLabel);
            quickWrap.appendChild(quickInput);
            box.appendChild(quickWrap);

            box.appendChild(mkBtn(
                '🔖 Save IDs only (no download)',
                'Scan ALL favorites and mark as "already have" — use max pages above to limit scope',
                '#a78bfa', 'ids_only'
            ));
            // Override mkBtn click for ids_quick to use quickInput
            const quickBtn = document.createElement('button');
            Object.assign(quickBtn.style, {
                display: 'block', width: '100%', background: 'rgba(255,255,255,0.05)',
                border: '1px solid #34d39933', borderRadius: '10px',
                padding: '12px 14px', marginBottom: '10px', cursor: 'pointer',
                textAlign: 'left', transition: 'background .15s',
            });
            quickBtn.onmouseenter = () => { quickBtn.style.background = '#34d39922'; };
            quickBtn.onmouseleave = () => { quickBtn.style.background = 'rgba(255,255,255,0.05)'; };
            const quickBtnLbl = document.createElement('div');
            quickBtnLbl.textContent = '⚡ Quick sync IDs (newest N pages only)';
            Object.assign(quickBtnLbl.style, { fontSize: '13px', fontWeight: '600', color: '#34d399' });
            const quickBtnDsc = document.createElement('div');
            quickBtnDsc.textContent = 'Fast partial sync for multi-device use — only scans recent items, not your full library';
            Object.assign(quickBtnDsc.style, { fontSize: '11px', color: '#94a3b8', marginTop: '3px' });
            quickBtn.appendChild(quickBtnLbl);
            quickBtn.appendChild(quickBtnDsc);
            quickBtn.addEventListener('click', () => {
                const qp = parseInt(quickInput.value, 10);
                overlay.remove();
                onChoice('ids_quick', isNaN(qp) || qp < 1 ? 5 : qp, filterSelect.value, '', '');
            });
            box.appendChild(quickBtn);
            box.appendChild(mkBtn(
                '⬇ Download everything (ignore history)',
                'Re-download all favorites regardless of history',
                '#f59e0b', 'download_all'
            ));
            box.appendChild(cancelBtn);
            overlay.appendChild(box);

            // Close on overlay click
            overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onChoice(null, 0, 'all', ''); } });
            document.body.appendChild(overlay);
        }

        let busy = false;
        btn.addEventListener('click', () => {
            if (busy) return;
            showActionModal(async (action, maxPages, mediaFilter, folderId, folderName) => {
                if (!action) return; // cancelled

                busy = true; btn.disabled = true;
                log.style.display = 'block';
                setColor('#1e40af');
                btn.textContent = '⏳ Collecting…';

                try {
                    const history = loadHistory();
                    console.log('[GrokDL] Loaded history, IDs tracked:', history.size, '| sample:', [...history].slice(0,3));
                    const mediaLabel = mediaFilter === 'images' ? ' — images only' : mediaFilter === 'videos' ? ' — videos only' : '';
                    setStatus(`Fetching favorites list… (${history.size} previously downloaded)${maxPages ? ` — limited to ${maxPages} page(s) / ~${maxPages * 40} items` : ''}${mediaLabel}`);

                    // ids_quick uses its own page limit (passed as maxPages from the quick sync input)
                    const effectiveMaxPages = maxPages;
                    const allItems = await collectAll(setStatus, action === 'download' ? history : null, effectiveMaxPages, folderId || null);

                    if (action === 'ids_only' || action === 'ids_quick') {
                        const newIds = allItems.filter(i => !history.has(i.id)).map(i => i.id);
                        markDownloaded(history, newIds);
                        const scopeLabel = action === 'ids_quick' ? ` (scanned newest ~${allItems.length} items across ${effectiveMaxPages} page(s))` : '';
                        setStatus(`✅ Saved ${newIds.length} new ID(s) to history${scopeLabel}.
Total tracked: ${history.size}.
No files were downloaded.`);
              btn.textContent = `✅ ${newIds.length} IDs saved`;
              setColor('#a78bfa');

          } else {
              // download or download_all
              // Debug: log a few IDs to confirm format matches history
              console.log('[GrokDL] Sample fetched IDs:', allItems.slice(0,3).map(i => i.id), '| types:', allItems.slice(0,3).map(i => typeof i.id));
              console.log('[GrokDL] History sample:', [...history].slice(0,3), '| types:', [...history].slice(0,3).map(i => typeof i));

              // Apply media type filter
              const applyMediaFilter = items => {
                  if (mediaFilter === 'images') return items.filter(i => i.ext !== 'mp4' && i.ext !== 'webm' && i.ext !== 'mov');
                  if (mediaFilter === 'videos') return items.filter(i => i.ext === 'mp4' || i.ext === 'webm' || i.ext === 'mov');
                  return items;
              };

              const itemsToDownload = applyMediaFilter(
                  action === 'download_all'
                  ? allItems
                  : allItems.filter(i => !history.has(String(i.id)))
              );

              const skipped = allItems.length - itemsToDownload.length;
              const newCount = itemsToDownload.length;

              if (newCount === 0) {
                  setStatus(`✅ Nothing new! All ${allItems.length} favorites already downloaded.
Generate new images, save them, then click again.`);
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
                    btn.textContent = '⬇ Download Favorites';
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

      // ── Folder download button ────────────────────────────────────────────
      const folderBtn = document.createElement('button');
      folderBtn.textContent = '🏷 Download by Tag';
      Object.assign(folderBtn.style, {
          background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer',
          borderRadius: '10px', padding: '11px 20px', fontSize: '13px', fontWeight: '600',
          minWidth: '220px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          transition: 'background .15s',
      });
      folderBtn.onmouseenter = () => { if (!folderBtn.disabled) folderBtn.style.background = '#6d28d9'; };
      folderBtn.onmouseleave = () => { if (!folderBtn.disabled) folderBtn.style.background = '#7c3aed'; };

      function showFolderModal(onChoice) { // onChoice(folderId, folderName, skipDownloaded, mediaFilter)
          document.getElementById('grokdl-folder-modal')?.remove();

          const overlay = document.createElement('div');
          overlay.id = 'grokdl-folder-modal';
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
          title.textContent = '🏷 Download by Tag';
          Object.assign(title.style, { fontSize: '15px', fontWeight: '700', marginBottom: '6px' });

          const sub = document.createElement('div');
          sub.textContent = 'Select a tag to download only items inside it.';
          Object.assign(sub.style, { fontSize: '12px', color: '#64748b', marginBottom: '18px' });

          // Folder select
          const fLabel = document.createElement('label');
          fLabel.textContent = 'Tag:';
          Object.assign(fLabel.style, { fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '5px' });

          const fSelect = document.createElement('select');
          Object.assign(fSelect.style, {
              width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '7px', padding: '7px 10px', color: '#e2e8f0', fontSize: '12px',
              boxSizing: 'border-box', outline: 'none', cursor: 'pointer', marginBottom: '14px',
          });

          const loadOpt = document.createElement('option');
          loadOpt.textContent = 'Loading tags…'; loadOpt.disabled = true;
          fSelect.appendChild(loadOpt);

          fetchFolders().then(folders => {
              fSelect.removeChild(loadOpt);
              if (folders.length === 0) {
                  const noOpt = document.createElement('option');
                  noOpt.textContent = 'No tags found'; noOpt.disabled = true;
                  fSelect.appendChild(noOpt);
              } else {
                  folders.forEach(f => {
                      const opt = document.createElement('option');
                      opt.value = f.id; opt.textContent = '🏷 ' + f.name;
                      fSelect.appendChild(opt);
                  });
              }
          });

          // Skip already downloaded toggle
          const skipWrap = document.createElement('div');
          Object.assign(skipWrap.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' });
          const skipCheck = document.createElement('input');
          skipCheck.type = 'checkbox'; skipCheck.checked = true;
          skipCheck.id = 'grokdl-skip-check';
          Object.assign(skipCheck.style, { cursor: 'pointer', accentColor: '#7c3aed' });
          const skipLabel = document.createElement('label');
          skipLabel.htmlFor = 'grokdl-skip-check';
          skipLabel.textContent = 'Skip already downloaded';
          Object.assign(skipLabel.style, { fontSize: '12px', color: '#94a3b8', cursor: 'pointer' });
          skipWrap.appendChild(skipCheck);
          skipWrap.appendChild(skipLabel);

          // Download button
          const dlBtn = document.createElement('button');
          dlBtn.textContent = '⬇ Download This Tag';
          Object.assign(dlBtn.style, {
              display: 'block', width: '100%', background: '#7c3aed', color: '#fff',
              border: 'none', borderRadius: '10px', padding: '12px', fontSize: '13px',
              fontWeight: '600', cursor: 'pointer', marginBottom: '10px',
          });
          dlBtn.addEventListener('click', () => {
              const fid = fSelect.value;
              const fname = fid ? (fSelect.options[fSelect.selectedIndex]?.text ?? '').replace('🏷 ', '') : '';
              overlay.remove();
              onChoice(fid, fname, skipCheck.checked, tagFilterSelect.value);
          });

          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Cancel';
          Object.assign(cancelBtn.style, {
              background: 'transparent', border: 'none', color: '#64748b',
              cursor: 'pointer', fontSize: '12px', display: 'block',
              width: '100%', textAlign: 'center', padding: '6px',
          });
          cancelBtn.addEventListener('click', () => { overlay.remove(); onChoice(null, '', false, 'all'); });
          overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onChoice(null, '', false, 'all'); } });

          // Media type filter
          const tagFilterWrap = document.createElement('div');
          Object.assign(tagFilterWrap.style, { marginBottom: '16px' });
          const tagFilterLabel = document.createElement('label');
          tagFilterLabel.textContent = 'Media type to download:';
          Object.assign(tagFilterLabel.style, { fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '5px' });
          const tagFilterSelect = document.createElement('select');
          Object.assign(tagFilterSelect.style, {
              width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '7px', padding: '7px 10px', color: '#e2e8f0', fontSize: '12px',
              boxSizing: 'border-box', outline: 'none', cursor: 'pointer',
          });
          [['all', '🖼 + 🎥  Images & Videos (default)'], ['images', '🖼  Images only'], ['videos', '🎥  Videos only']].forEach(([val, label]) => {
              const opt = document.createElement('option');
              opt.value = val; opt.textContent = label;
              tagFilterSelect.appendChild(opt);
          });
          tagFilterWrap.appendChild(tagFilterLabel);
          tagFilterWrap.appendChild(tagFilterSelect);

          box.appendChild(title);
          box.appendChild(sub);
          box.appendChild(fLabel);
          box.appendChild(fSelect);
          box.appendChild(tagFilterWrap);
          box.appendChild(skipWrap);
          box.appendChild(dlBtn);
          box.appendChild(cancelBtn);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
      }

      folderBtn.addEventListener('click', () => {
          if (busy) return;
          showFolderModal(async (folderId, folderName, skipDownloaded, tagMediaFilter = 'all') => {
              if (!folderId) return;

              busy = true; folderBtn.disabled = true; btn.disabled = true;
              log.style.display = 'block';
              folderBtn.style.background = '#5b21b6';
              folderBtn.textContent = '⏳ Collecting…';

              try {
                  const history = loadHistory();
                  setStatus(`Fetching tag "${folderName}"… (${history.size} previously downloaded)`);

                  const allItems = await collectAll(setStatus, skipDownloaded ? history : null, 0, folderId, true);

                  const applyTagMediaFilter = items => {
                      if (tagMediaFilter === 'images') return items.filter(i => i.ext !== 'mp4' && i.ext !== 'webm' && i.ext !== 'mov');
                      if (tagMediaFilter === 'videos') return items.filter(i => i.ext === 'mp4' || i.ext === 'webm' || i.ext === 'mov');
                      return items;
                  };

                  const itemsToDownload = applyTagMediaFilter(
                      skipDownloaded
                      ? allItems.filter(i => !history.has(String(i.id)))
                      : allItems
                  );

                  const skipped = allItems.length - itemsToDownload.length;
                  const mediaLabel = tagMediaFilter === 'images' ? ' (images only)' : tagMediaFilter === 'videos' ? ' (videos only)' : '';

                  if (itemsToDownload.length === 0) {
                      setStatus(`✅ Nothing new in "${folderName}"${mediaLabel}! ${skipped > 0 ? `All ${skipped} items already downloaded.` : 'Tag appears empty.'}`);
                      folderBtn.textContent = '✅ Already up to date';
                      folderBtn.style.background = '#16a34a';
                  } else {
                      setStatus(`${itemsToDownload.length} to download from "${folderName}"${mediaLabel}${skipped > 0 ? `, skipping ${skipped} already downloaded` : ''}…`);
                      const n = await downloadNew(itemsToDownload, history, setStatus);
                      if (n > 0) {
                          setStatus(`✅ Done! ${n} file(s) from "${folderName}"${mediaLabel} → Downloads/grok-favorites/`);
                          folderBtn.textContent = `✅ ${n} files done`;
                          folderBtn.style.background = '#16a34a';
                      }
                  }
              } catch (e) {
                  setStatus('❌ ' + e.message);
                  console.error('[GrokDL]', e);
                  folderBtn.textContent = '🏷 Retry';
                  folderBtn.style.background = '#dc2626';
              }

              folderBtn.disabled = false; btn.disabled = false; busy = false;
          });
      });

      // 新增 Bulk Upscale 按钮
      const upscaleBtn = document.createElement('button');
      upscaleBtn.textContent = '🔼 Bulk Upscale Videos';
      Object.assign(upscaleBtn.style, {
          background: '#ea580c', color: '#fff', border: 'none', cursor: 'pointer',
          borderRadius: '10px', padding: '11px 20px', fontSize: '13px', fontWeight: '600',
          minWidth: '220px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      });
      upscaleBtn.onmouseenter = () => { if (!upscaleBtn.disabled) upscaleBtn.style.background = '#c2410c'; };
      upscaleBtn.onmouseleave = () => { if (!upscaleBtn.disabled) upscaleBtn.style.background = '#ea580c'; };

      // 主下载按钮点击逻辑中加入 upscale 选项（或独立点击）

      upscaleBtn.addEventListener('click', () => {
          if (busy) return;
          busy = true; upscaleBtn.disabled = true;
          log.style.display = 'block';
          setStatus('🔼 Collecting favorites for upscale...');

          collectAll(setStatus, null, 0, null, false).then(allItems => {
              bulkUpscaleVideos(allItems, setStatus).finally(() => {
                  upscaleBtn.disabled = false;
                  busy = false;
                  upscaleBtn.textContent = '🔼 Bulk Upscale Videos';
              });
          });
      });

      const quotaPanel = buildQuotaPanel();

      // 把 upscaleBtn 加入 wrap（放在 Download Favorites 按钮下方）
      wrap.appendChild(quotaPanel);
      wrap.appendChild(log);
      wrap.appendChild(btn);           // 原下载按钮
      wrap.appendChild(upscaleBtn);    // 新 upscale 按钮
      wrap.appendChild(folderBtn);
      wrap.appendChild(resetBtn);
      document.body.appendChild(wrap);
  }

    // ── Per-card download button ──────────────────────────────────────────────

    // Extract postId from React fiber props — works even when img src is a base64 blob
    function getPostIdFromFiber(el) {
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fiberKey) return null;
        const visited = new Set();
        function walk(node, depth) {
            if (!node || depth > 15 || visited.has(node)) return null;
            visited.add(node);
            const props = node.memoizedProps || node.pendingProps;
            if (props && typeof props.postId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(props.postId)) {
                return props.postId;
            }
            return walk(node.child, depth + 1) || walk(node.sibling, depth);
        }
        return walk(el[fiberKey], 0);
    }

    function extractIdFromUrl(url) {
        if (!url) return null;
        return url.match(/images\/([a-f0-9-]{36})/)?.[1] ||
            url.match(/generated\/([a-f0-9-]{36})/)?.[1] ||
            url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ||
            null;
    }

    async function downloadCard(postId, btnEl) {
        btnEl.textContent = '⏳';
        btnEl.disabled = true;

        try {
            const toDownload = [];

            // ── Strategy 1: try the API (works for favorited/saved posts) ──────────
            const data = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method:          'POST',
                    url:             'https://grok.com/rest/media/post/get',
                    headers:         { 'Content-Type': 'application/json' },
                    data:            JSON.stringify({ id: postId }),
                    withCredentials: true,
                    onload: res => {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (_) { resolve(null); }
                    },
                    onerror: () => resolve(null),
                });
            });

            const post = data?.post ?? data;
            if (post?.id && !data?.code) {
                // API worked — collect main + children
                if (post.mediaUrl) {
                    toDownload.push({ url: post.mediaUrl, id: post.id, prompt: post.prompt ?? '', model: post.modelName ?? 'grok', src: 'api' });
                }
                for (const child of post.images ?? []) {
                    const url = child.mediaUrl || child.hdMediaUrl || child.url;
                    if (url && child.id !== post.id) toDownload.push({ url, id: child.id ?? post.id, prompt: post.prompt ?? '', model: child.modelName ?? post.modelName ?? 'grok', src: 'api' });
                }
                for (const child of post.videos ?? []) {
                    const url = child.mediaUrl || child.hdMediaUrl || child.url;
                    if (url) toDownload.push({ url, id: child.id ?? post.id, prompt: post.prompt ?? '', model: child.modelName ?? post.modelName ?? 'grok', src: 'api' });
                }
                for (const child of post.childPosts ?? []) {
                    const url = child.mediaUrl || child.hdMediaUrl || child.url;
                    if (url && child.id !== post.id) toDownload.push({ url, id: child.id, prompt: post.prompt ?? '', model: child.modelName ?? 'grok', src: 'api' });
                }
            }

            // ── Strategy 2: extract base64 blobs directly from the card DOM ────────
            // Used for imagine page images that aren't yet saved/favorited
            if (!toDownload.length) {
                const card = btnEl.closest('[class*="masonry-card"]') ?? btnEl.parentElement;
                if (card) {
                    const imgs = [...card.querySelectorAll('img')];
                    let idx = 0;
                    for (const img of imgs) {
                        if (!img.src) continue;
                        if (img.src.startsWith('data:')) {
                            // base64 blob — convert to downloadable file via blob URL
                            const mimeMatch = img.src.match(/^data:([^;]+);base64,/);
                            const mime = mimeMatch?.[1] ?? 'image/jpeg';
                            const ext  = mime.split('/')[1]?.replace('jpeg','jpg') ?? 'jpg';
                            const base64 = img.src.split(',')[1];
                            const binary = atob(base64);
                            const bytes  = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            const blob    = new Blob([bytes], { type: mime });
                            const blobUrl = URL.createObjectURL(blob);
                            const name    = `grok-favorites/${postId.slice(0,8)}_${idx}.${ext}`;
                            GM_download({ url: blobUrl, name,
                                         onload: () => setTimeout(() => URL.revokeObjectURL(blobUrl), 5000),
                                         onerror: e => { console.warn('[GrokDL] blob dl failed', e); URL.revokeObjectURL(blobUrl); }
                                        });
                            idx++;
                            await sleep(200);
                        } else if (img.src.includes('x.ai') || img.src.includes('imagine-public') || img.src.includes('generated')) {
                            toDownload.push({ url: img.src, id: postId + '_' + idx, prompt: '', model: 'grok', src: 'dom' });
                            idx++;
                        }
                    }
                    // Also grab any video sources
                    for (const v of [...card.querySelectorAll('video, source')]) {
                        const url = v.src || v.currentSrc;
                        if (url && !url.startsWith('data:')) toDownload.push({ url, id: postId + '_v' + idx, prompt: '', model: 'grok', src: 'dom' });
                    }
                    if (idx > 0) {
                        // Already downloaded via blob above
                        btnEl.textContent = `✅${idx > 1 ? ' ' + idx : ''}`;
                        setTimeout(() => { btnEl.textContent = '⬇'; btnEl.disabled = false; }, 3000);
                        return;
                    }
                }
            }

            // ── Strategy 3: GM_download CDN URLs found in DOM ──────────────────────
            if (toDownload.length) {
                const seen = new Set();
                const unique = toDownload.filter(i => { if (!i.url || seen.has(i.url)) return false; seen.add(i.url); return true; });
                console.log('[GrokDL] card downloading', unique.length, 'file(s) via', unique[0]?.src, 'for', postId);
                for (const item of unique) {
                    const isVid = /\.(mp4|webm|mov)/i.test(item.url);
                    const ext   = isVid ? 'mp4' : (item.url.match(/\.(png|webp|jpeg|jpg)/i)?.[1]?.toLowerCase() ?? 'jpg');
                    const prompt = clean(item.prompt, 60);
                    const model  = clean(item.model, 20);
                    const name   = `grok-favorites/${String(item.id).slice(0,8)}_${model}_${prompt}.${ext}`;
                    GM_download({ url: item.url, name, onerror: e => console.warn('[GrokDL] card dl failed', item.url, e) });
                    await sleep(200);
                }
                btnEl.textContent = unique.length > 1 ? `✅ ${unique.length}` : '✅';
                setTimeout(() => { btnEl.textContent = '⬇'; btnEl.disabled = false; }, 3000);
                return;
            }

            console.warn('[GrokDL] nothing to download for', postId, '| api response:', JSON.stringify(data)?.slice(0,150));
            btnEl.textContent = '❌';
            setTimeout(() => { btnEl.textContent = '⬇'; btnEl.disabled = false; }, 2000);

        } catch (e) {
            console.error('[GrokDL] card download error', e);
            btnEl.textContent = '❌';
            setTimeout(() => { btnEl.textContent = '⬇'; btnEl.disabled = false; }, 2000);
        }
    }

    function injectCardButton(card) {
        if (card.querySelector('.grokdl-card-btn')) return; // already injected

        // Try React fiber first (works when img src is a base64 blob with no URL to parse)
        let postId = getPostIdFromFiber(card);

        // Fallback: parse from img/video src URL
        if (!postId) {
            const img   = card.querySelector('img');
            const video = card.querySelector('video');
            const src   = img?.src || video?.src || card.querySelector('source')?.src || '';
            postId = extractIdFromUrl(src);
        }

        if (!postId) return; // can't identify this card

        const btn = document.createElement('button');
        btn.className = 'grokdl-card-btn';
        btn.textContent = '⬇';
        btn.title = 'Download this image/video + children';
        Object.assign(btn.style, {
            position: 'absolute', bottom: '8px', left: '8px', zIndex: '99',
            background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none',
            borderRadius: '8px', width: '32px', height: '32px', fontSize: '14px',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            opacity: '0', transition: 'opacity 0.15s',
            pointerEvents: 'auto',
        });

        // Show on card hover
        card.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
        card.addEventListener('mouseleave', () => { if (!btn.disabled) btn.style.opacity = '0'; });

        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // don't open the image viewer
            e.preventDefault();
            downloadCard(postId, btn);
        });

        card.appendChild(btn);
    }

    function injectAllCardButtons() {
        document.querySelectorAll('.group\\/media-post-masonry-card').forEach(injectCardButton);
    }

    // Watch for new cards being added to the DOM (virtual scroll)
    const cardObserver = new MutationObserver(() => injectAllCardButtons());
    cardObserver.observe(document.body, { childList: true, subtree: true });

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