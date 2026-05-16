(function () {
  'use strict';

  const fmtInt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '—');
  const fmtPct = (r) => (typeof r === 'number' ? (r * 100).toFixed(1) + '%' : '—');
  const fmtMs = (ms) => (typeof ms === 'number' && ms > 0 ? (ms / 1000).toFixed(2) + 's' : '—');
  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`${r.status} ${url}: ${t.slice(0, 200)}`);
    }
    return r.json();
  }

  function renderVisitors(v) {
    const cards = document.querySelectorAll('#visitor-cards .adm-card');
    const keys = ['today', 'yesterday', 'this_week', 'this_month'];
    cards.forEach((card) => {
      const key = card.dataset.key;
      if (!keys.includes(key)) return;
      const value = v && typeof v[key] === 'number' ? v[key] : 0;
      card.querySelector('.adm-card-value').textContent = fmtInt(value);
    });
    drawDailyChart(v && Array.isArray(v.daily_30d) ? v.daily_30d : []);
  }

  function drawDailyChart(series) {
    const svg = document.getElementById('daily-chart');
    if (!svg) return;
    svg.innerHTML = '';
    if (!series.length) return;

    const W = 800, H = 200, pad = { l: 30, r: 10, t: 10, b: 24 };
    const maxU = Math.max(1, ...series.map((d) => d.unique || 0));
    const stepX = (W - pad.l - pad.r) / Math.max(1, series.length - 1);
    const yFor = (u) => H - pad.b - ((u / maxU) * (H - pad.t - pad.b));

    // 축선
    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', pad.l); axis.setAttribute('y1', H - pad.b);
    axis.setAttribute('x2', W - pad.r); axis.setAttribute('y2', H - pad.b);
    axis.setAttribute('stroke', '#e5e7eb'); axis.setAttribute('stroke-width', '1');
    svg.appendChild(axis);

    // y축 max 라벨
    const ymax = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ymax.setAttribute('x', 4); ymax.setAttribute('y', pad.t + 10);
    ymax.setAttribute('font-size', '10'); ymax.setAttribute('fill', '#6b7280');
    ymax.textContent = String(maxU);
    svg.appendChild(ymax);

    // 라인
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const points = series.map((d, i) => `${pad.l + i * stepX},${yFor(d.unique || 0)}`).join(' ');
    path.setAttribute('points', points);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#2563eb');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);

    // 점 + 툴팁용 title
    series.forEach((d, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', pad.l + i * stepX);
      c.setAttribute('cy', yFor(d.unique || 0));
      c.setAttribute('r', '2.5');
      c.setAttribute('fill', '#2563eb');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `${d.date} · 유니크 ${d.unique || 0} · 뷰 ${d.views || 0}`;
      c.appendChild(t);
      svg.appendChild(c);
    });

    // x축 라벨 — 첫/중간/마지막 3개만
    [0, Math.floor(series.length / 2), series.length - 1].forEach((i) => {
      if (i < 0 || i >= series.length) return;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', pad.l + i * stepX);
      lbl.setAttribute('y', H - 6);
      lbl.setAttribute('font-size', '10');
      lbl.setAttribute('fill', '#6b7280');
      lbl.setAttribute('text-anchor', i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle');
      lbl.textContent = (series[i].date || '').slice(5);
      svg.appendChild(lbl);
    });
  }

  function renderChat(c) {
    if (!c) c = {};
    document.querySelectorAll('#chat-cards .adm-card-value').forEach((el) => {
      const key = el.dataset.key;
      if (key === 'avg_response_ms') {
        el.textContent = fmtMs(c.avg_response_ms);
      } else if (key === 'fallback_rate') {
        el.textContent = fmtPct(c.fallback_rate);
      } else {
        el.textContent = fmtInt(c[key]);
      }
    });

    const bars = document.getElementById('category-bars');
    bars.innerHTML = '';
    const cats = Array.isArray(c.category_distribution) ? c.category_distribution : [];
    const maxC = Math.max(1, ...cats.map((x) => x.count || 0));
    if (cats.length === 0) {
      bars.innerHTML = '<div class="adm-muted">데이터 없음</div>';
      return;
    }
    cats.forEach((x) => {
      const row = document.createElement('div');
      row.className = 'adm-bar-row';
      row.innerHTML = `
        <div>${x.category}</div>
        <div class="adm-bar-track"><div class="adm-bar-fill" style="width: ${((x.count || 0) / maxC * 100).toFixed(1)}%"></div></div>
        <div class="adm-bar-count">${fmtInt(x.count || 0)}</div>
      `;
      bars.appendChild(row);
    });
  }

  function renderLastUpdated() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = '갱신: ' + fmtTime(new Date().toISOString());
  }

  async function loadStats() {
    try {
      const data = await fetchJson('/api/admin/stats');
      renderVisitors(data && data.visitors);
      renderChat(data && data.chat);
      renderLastUpdated();
      window.__adminStats = data;
    } catch (e) {
      console.error('[admin] stats load failed:', e);
    }
  }

  let sessionsCursor = null;

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function appendSessionRows(items) {
    const tbody = document.getElementById('sessions-tbody');
    items.forEach((s) => {
      const tr = document.createElement('tr');
      tr.dataset.id = s.id;
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(s.created_at))}</td>
        <td>${fmtInt(s.message_count)}</td>
        <td>${escapeHtml(s.ip_hash_short || '—')}</td>
        <td class="adm-q">${escapeHtml(s.first_user_query || '—')}</td>
      `;
      tr.addEventListener('click', () => openSessionModal(s.id));
      tbody.appendChild(tr);
    });
  }

  async function loadSessions(initial) {
    try {
      const url = '/api/admin/sessions?limit=50' + (sessionsCursor && !initial ? '&before=' + encodeURIComponent(sessionsCursor) : '');
      const data = await fetchJson(url);
      if (initial) document.getElementById('sessions-tbody').innerHTML = '';
      appendSessionRows(data.sessions || []);
      sessionsCursor = data.next_before;
      const btn = document.getElementById('load-more-btn');
      btn.hidden = !sessionsCursor;
    } catch (e) {
      console.error('[admin] sessions load failed:', e);
    }
  }

  async function openSessionModal(id) {
    try {
      const data = await fetchJson('/api/admin/sessions/' + encodeURIComponent(id));
      document.getElementById('modal-title').textContent = '세션 ' + id.slice(0, 8);
      const meta = document.getElementById('modal-meta');
      meta.innerHTML = `
        <div>시작: ${escapeHtml(fmtTime(data.session.created_at))}</div>
        <div>마지막: ${escapeHtml(fmtTime(data.session.last_seen_at))}</div>
        <div>IP: ${escapeHtml(data.session.ip_hash_short || '—')}</div>
        <div>UA: ${escapeHtml((data.session.user_agent || '').slice(0, 80))}</div>
      `;
      const wrap = document.getElementById('modal-messages');
      wrap.innerHTML = '';
      (data.messages || []).forEach((m) => {
        const div = document.createElement('div');
        div.className = 'adm-msg ' + (m.role === 'user' ? 'user' : 'assistant');
        div.innerHTML = `
          ${escapeHtml(m.content || '')}
          <div class="adm-msg-meta">${escapeHtml(fmtTime(m.created_at))}${m.category ? ' · ' + escapeHtml(m.category) : ''}</div>
        `;
        wrap.appendChild(div);
      });
      document.getElementById('session-modal').hidden = false;
    } catch (e) {
      console.error('[admin] session detail failed:', e);
    }
  }

  document.querySelectorAll('#session-modal [data-close]').forEach((el) => {
    el.addEventListener('click', () => { document.getElementById('session-modal').hidden = true; });
  });

  document.getElementById('load-more-btn').addEventListener('click', () => loadSessions(false));

  // refresh-btn 핸들러 — stats + sessions 둘 다 리로드
  document.getElementById('refresh-btn').addEventListener('click', loadStats);
  document.getElementById('refresh-btn').addEventListener('click', () => {
    sessionsCursor = null;
    loadSessions(true);
  });

  // 초기 로드
  loadStats();
  loadSessions(true);
})();
