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

  function renderLastUpdated() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = '갱신: ' + fmtTime(new Date().toISOString());
  }

  // 이후 Task 13에서 chat/sessions 추가
  async function loadStats() {
    try {
      const data = await fetchJson('/api/admin/stats');
      renderVisitors(data && data.visitors);
      renderLastUpdated();
      // chat 섹션은 Task 13에서 채움
      window.__adminStats = data;
    } catch (e) {
      console.error('[admin] stats load failed:', e);
    }
  }

  document.getElementById('refresh-btn').addEventListener('click', loadStats);
  loadStats();
})();
