/* 플러그인 모아보기 — 설정 페이지 카드형 세션 선택 UI
   코어 계약: new Function('window','pluginId','root','config', js)(...)
   저장은 코어 폼 submit이 root 내부 input[name]을 수집하므로,
   체크박스 name 을 SHOW_<plugin_id>__<session> 으로 두면 그대로 저장된다. */
(function () {
  'use strict';

  const SESSION_LABELS = { general: '일반', adult: '성인', audiobook: '오디오', video: '비디오' };
  const grid = root.querySelector('[data-pv-role="grid"]');
  if (!grid) return;

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderCards(catalog) {
    if (!catalog.length) {
      grid.innerHTML = '<div class="pv-settings-empty">표시할 카테고리 뷰 플러그인이 설치되어 있지 않습니다.</div>';
      return;
    }
    grid.innerHTML = catalog.map((p) => {
      const version = p.version ? `v${esc(p.version)}` : '';
      const checks = (p.sessions || []).map((s) => {
        const key = `SHOW_${p.id}__${s}`;
        const checked = p.checked && p.checked[s] ? 'checked' : '';
        return `
          <label class="pv-session-check">
            <input type="checkbox" name="${esc(key)}" ${checked}>
            <span>${esc(SESSION_LABELS[s] || s)}</span>
          </label>`;
      }).join('');
      return `
        <div class="pv-card">
          <div class="pv-card-head">
            <h5 class="pv-card-title">${esc(p.name)}</h5>
            ${version ? `<span class="pv-card-version">${version}</span>` : ''}
          </div>
          <div class="pv-card-id">${esc(p.id)}</div>
          <div class="pv-card-sessions">${checks}</div>
        </div>`;
    }).join('');
  }

  async function load() {
    try {
      const res = await fetch(`/api/media/dashboard/widgets/${encodeURIComponent(pluginId)}/data?type=general`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '조회 실패');
      renderCards(Array.isArray(data.catalog) ? data.catalog : []);
    } catch (err) {
      console.error('[PluginsViewer-Settings] load error:', err);
      grid.innerHTML = `<div class="pv-settings-error">플러그인 목록을 불러오지 못했습니다: ${esc(err.message || '오류')}</div>`;
    }
  }

  load();
})();
