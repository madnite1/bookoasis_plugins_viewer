/* 플러그인 모아보기 — 설정 페이지: 세션 레인(칩 드래그 순서/세션 이동) + 카드형 세션 선택 UI
   코어 계약: new Function('window','pluginId','root','config', js)(...)
   저장은 코어 폼 submit이 root 내부 input[name]을 수집하므로:
   - 체크박스 name: SHOW_<plugin_id>__<session>
   - 세션별 순서 hidden input name: TAB_ORDER_<session> (콤마 구분 id 목록)
   카드 체크 ON → 레인에 칩 추가, OFF/칩 x 클릭 → 칩 제거(체크 해제 연동).
   칩 드래그: 같은 레인 = 순서 변경, 다른 레인 = 세션 이동(체크박스 연동).
   플러그인이 지원하지 않는 세션 레인으로는 이동 불가. */
(function () {
  'use strict';

  const SESSION_LABELS = { general: '일반', adult: '성인', audiobook: '오디오', video: '비디오' };
  const SESSIONS = Object.keys(SESSION_LABELS);
  const grid = root.querySelector('[data-pv-role="grid"]');
  const lanesEl = root.querySelector('[data-pv-role="lanes"]');
  if (!grid || !lanesEl) return;

  let catalogById = {};
  const orderInputs = {};

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function ensureOrderInputs() {
    SESSIONS.forEach((s) => {
      const name = `TAB_ORDER_${s}`;
      let input = root.querySelector(`input[name="${name}"]`);
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        lanesEl.appendChild(input);
      }
      orderInputs[s] = input;
    });
  }

  function laneBody(session) {
    return lanesEl.querySelector(`[data-pv-lane="${session}"]`);
  }

  function chipSession(chip) {
    const body = chip.closest('[data-pv-lane]');
    return body ? body.getAttribute('data-pv-lane') : null;
  }

  function supports(pluginId, session) {
    const p = catalogById[pluginId];
    return !!(p && Array.isArray(p.sessions) && p.sessions.includes(session));
  }

  function syncOrder(session) {
    const body = laneBody(session);
    if (!body) return;
    const ids = Array.from(body.querySelectorAll('.pv-chip')).map((el) => el.getAttribute('data-pv-id'));
    orderInputs[session].value = ids.join(',');
    body.classList.toggle('pv-lane-empty', !ids.length);
  }

  function syncAllOrders() {
    SESSIONS.forEach(syncOrder);
  }

  function findCheckbox(pluginId, session) {
    return grid.querySelector(`input[name="SHOW_${CSS.escape(pluginId)}__${CSS.escape(session)}"]`);
  }

  function setChecked(pluginId, session, on) {
    const cb = findCheckbox(pluginId, session);
    if (cb) cb.checked = !!on;
  }

  /* ---------- 칩 ---------- */

  let dragChip = null;
  let dragFromSession = null;

  function clearDropHints() {
    lanesEl.querySelectorAll('.pv-lane-body').forEach((el) =>
      el.classList.remove('pv-drop-ok', 'pv-drop-deny'));
  }

  // 세션 이동 확정: 출발/도착 체크박스 연동 + 순서 재계산
  function finishMove(pluginId, fromSession, toSession) {
    if (fromSession !== toSession) {
      setChecked(pluginId, fromSession, false);
      setChecked(pluginId, toSession, true);
    }
    syncAllOrders();
  }

  function makeChip(pluginId) {
    const p = catalogById[pluginId] || { name: pluginId };
    const chip = document.createElement('span');
    chip.className = 'pv-chip';
    chip.setAttribute('data-pv-id', pluginId);
    chip.setAttribute('draggable', 'true');
    chip.innerHTML = `<span class="pv-chip-name">${esc(p.name)}</span><button type="button" class="pv-chip-x" title="표시 해제">&times;</button>`;

    chip.querySelector('.pv-chip-x').addEventListener('click', (e) => {
      e.preventDefault();
      const s = chipSession(chip);
      if (s) setChecked(pluginId, s, false);
      chip.remove();
      if (s) syncOrder(s);
    });

    chip.addEventListener('dragstart', (e) => {
      dragChip = chip;
      dragFromSession = chipSession(chip);
      chip.classList.add('pv-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', pluginId); } catch (_) {}
    });
    chip.addEventListener('dragend', () => {
      chip.classList.remove('pv-dragging');
      clearDropHints();
      if (dragChip) {
        // 드롭 이벤트가 안 온 경우에도 DOM 상 현재 위치 기준으로 확정
        const toSession = chipSession(chip);
        if (toSession && dragFromSession) finishMove(pluginId, dragFromSession, toSession);
      }
      dragChip = null;
      dragFromSession = null;
    });
    // 다른 칩 위로 드래그: 지원 세션이면 그 위치로 삽입(레인 이동 포함)
    chip.addEventListener('dragover', (e) => {
      if (!dragChip || dragChip === chip) return;
      const targetSession = chipSession(chip);
      const dragId = dragChip.getAttribute('data-pv-id');
      if (!targetSession || !supports(dragId, targetSession)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const chips = Array.from(chip.parentElement.querySelectorAll('.pv-chip'));
      if (chips.includes(dragChip) && chips.indexOf(dragChip) < chips.indexOf(chip)) chip.after(dragChip);
      else chip.before(dragChip);
    });
    return chip;
  }

  function addChip(pluginId, session) {
    const body = laneBody(session);
    if (!body || body.querySelector(`.pv-chip[data-pv-id="${CSS.escape(pluginId)}"]`)) return;
    body.appendChild(makeChip(pluginId));
    syncOrder(session);
  }

  function removeChip(pluginId, session) {
    const body = laneBody(session);
    if (!body) return;
    const chip = body.querySelector(`.pv-chip[data-pv-id="${CSS.escape(pluginId)}"]`);
    if (chip) chip.remove();
    syncOrder(session);
  }

  /* ---------- 렌더 ---------- */

  function renderLanes(catalog, orders) {
    lanesEl.querySelectorAll('.pv-lane').forEach((el) => el.remove());
    SESSIONS.forEach((s) => {
      const lane = document.createElement('div');
      lane.className = 'pv-lane';
      lane.innerHTML = `<div class="pv-lane-title">${esc(SESSION_LABELS[s])}</div><div class="pv-lane-body pv-lane-empty" data-pv-lane="${esc(s)}"></div>`;
      const body = lane.querySelector('.pv-lane-body');
      // 레인 빈 공간으로 드래그: 지원 세션이면 맨 뒤에 추가(레인 이동 포함)
      body.addEventListener('dragover', (e) => {
        if (!dragChip) return;
        const dragId = dragChip.getAttribute('data-pv-id');
        clearDropHints();
        if (!supports(dragId, s)) {
          body.classList.add('pv-drop-deny');
          return;
        }
        body.classList.add('pv-drop-ok');
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragChip.parentElement !== body && !e.target.closest('.pv-chip')) {
          body.appendChild(dragChip);
        }
      });
      body.addEventListener('dragleave', () => body.classList.remove('pv-drop-ok', 'pv-drop-deny'));
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        clearDropHints();
      });
      lanesEl.appendChild(lane);
    });

    // 체크된 플러그인을 저장된 순서 → 나머지 이름순으로 레인에 채움
    SESSIONS.forEach((s) => {
      const checkedIds = catalog.filter((p) => p.checked && p.checked[s]).map((p) => p.id);
      const order = Array.isArray(orders && orders[s]) ? orders[s] : [];
      const sorted = order.filter((id) => checkedIds.includes(id))
        .concat(checkedIds.filter((id) => !order.includes(id)));
      sorted.forEach((id) => addChip(id, s));
      syncOrder(s);
    });
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
            <input type="checkbox" name="${esc(key)}" data-pv-plugin="${esc(p.id)}" data-pv-session="${esc(s)}" ${checked}>
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

    grid.querySelectorAll('input[data-pv-plugin]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const pid = cb.getAttribute('data-pv-plugin');
        const s = cb.getAttribute('data-pv-session');
        if (cb.checked) addChip(pid, s);
        else removeChip(pid, s);
      });
    });
  }

  function currentType() {
    return document.documentElement.getAttribute('data-library-type') || 'general';
  }

  // 설정 페이지(모아보기 화면 밖)에서도 사이드바 탭 숨김/복원을 즉시 적용.
  // script.js는 모아보기 화면 진입 시에만 로드되므로, 여기(설정 페이지 상시 로드)에서
  // 같은 로직을 직접 수행해 저장 직후 바깥 화면에서도 개별 탭이 바로 정리되게 한다.
  function applySidebarCleanup() {
    try {
      // 저장된 hidden input/체크박스에서 현재 세션의 체크 목록 수집
      const type = SESSIONS.includes(currentType()) ? currentType() : 'general';
      const checkedIds = new Set();
      root.querySelectorAll(`input[name^="SHOW_"][name$="__${type}"]`).forEach((cb) => {
        if (cb.checked) checkedIds.add(cb.name.slice(5, cb.name.indexOf('__')));
      });
      checkedIds.delete('bookoasis_plugins_viewer');

      // 1. 체크된 플러그인의 개별 사이드바 탭 숨김
      checkedIds.forEach((pid) => {
        if (!pid) return;
        const selectors = [
          `[data-plugin-id="${CSS.escape(pid)}"]`,
          `[data-tab-id="${CSS.escape(pid)}"]`,
          `a[href*="/plugins/${CSS.escape(pid)}"]`,
          `a[href*="/category/${CSS.escape(pid)}"]`,
        ];
        selectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            if (!el.closest('[data-uf-root]') && !el.closest('[data-pv-role]')) {
              el.style.display = 'none';
            }
          });
        });
      });

      // 2. 체크 해제된 플러그인의 사이드바 탭 복원
      document.querySelectorAll('[data-role="sidebar-category-dynamic"], [data-plugin-id], [data-tab-id]').forEach((el) => {
        if (el.closest('[data-uf-root]') || el.closest('[data-pv-role]')) return;
        const pid = el.dataset.pluginId || el.dataset.tabId || (el.dataset.id && el.dataset.id.startsWith('plugin_') ? el.dataset.id.replace('plugin_', '') : null);
        if (pid && !checkedIds.has(pid) && el.style.display === 'none') {
          el.style.display = '';
        }
      });
    } catch (_) {}
  }

  function refreshOnlyViewerTabs() {
    applySidebarCleanup();
    try {
      window.dispatchEvent(new CustomEvent('bookoasis_plugins_viewer:config_updated'));
      if (typeof window.reloadBookOasisPluginsViewerTabs === 'function') {
        window.reloadBookOasisPluginsViewerTabs();
      }
    } catch (_) {}
  }

  // 저장/토글 후 사이드바 및 탭 갱신
  function wrapSaveConfigApi() {
    try {
      if (!window.__origFetchForPluginsViewer) {
        window.__origFetchForPluginsViewer = window.fetch;
        window.fetch = async function (resource, options) {
          const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

          // 모아보기 설정 저장 요청 시 자체 SQLite save-config API로 가로채기
          if (url && url.includes('/api/media/metadata/plugins/save-config') && options && options.method === 'POST') {
            let reqBody = null;
            try { reqBody = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || null); } catch (_) { reqBody = null; }
            if (reqBody && reqBody.plugin_id === 'bookoasis_plugins_viewer') {
              try {
                const res = await window.__origFetchForPluginsViewer('/api/media/dashboard/widgets/bookoasis_plugins_viewer/save-config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(reqBody),
                  credentials: 'same-origin',
                });
                refreshOnlyViewerTabs();
                return res;
              } catch (_) {}
            }
          }

          const response = await window.__origFetchForPluginsViewer.apply(this, arguments);
          try {
            if (url && (url.includes('/api/media/metadata/plugins/save-config') || url.includes('/api/media/metadata/plugins/toggle')) && options && options.method === 'POST') {
              const cloned = response.clone();
              cloned.json().then((data) => {
                if (data && data.success) {
                  refreshOnlyViewerTabs();
                }
              }).catch(() => {});
            }
          } catch (_) {}
          return response;
        };
      }
    } catch (_) {}
  }

  function collectSettingsData() {
    const data = {};
    // 체크박스 수집
    grid.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.name) data[cb.name] = cb.checked ? 'True' : 'False';
    });
    // TAB_ORDER hidden inputs 수집
    lanesEl.querySelectorAll('input[type="hidden"]').forEach((inp) => {
      if (inp.name) data[inp.name] = String(inp.value || '');
    });
    return data;
  }

  async function saveViewerSettings(form, submitBtn) {
    const origHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...';
    }

    try {
      const payload = collectSettingsData();
      const res = await fetch('/api/media/dashboard/widgets/bookoasis_plugins_viewer/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plugin_id: 'bookoasis_plugins_viewer',
          settings: payload,
          config: payload
        })
      });
      const data = await res.json();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }
      if (data.success) {
        refreshOnlyViewerTabs();
        if (typeof window.showToast === 'function') {
          window.showToast(data.message || '모아보기 설정이 저장되었습니다.', 'success');
        } else {
          alert(data.message || '모아보기 설정이 저장되었습니다.');
        }
      } else {
        if (typeof window.showToast === 'function') {
          window.showToast(data.error || '설정 저장 실패', 'error');
        } else {
          alert(data.error || '설정 저장 실패');
        }
      }
    } catch (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origHtml;
      }
      if (typeof window.showToast === 'function') {
        window.showToast('통신 오류: ' + err.message, 'error');
      } else {
        alert('통신 오류: ' + err.message);
      }
    }
  }

  async function load() {
    wrapSaveConfigApi();
    
    // 코어 폼 submit 가로채기 (capture 단계)
    const form = root.closest('form.plugin-config-form') || root.closest('form');
    if (form) {
      form.addEventListener('submit', function (e) {
        const submitBtn = form.querySelector('button[type="submit"]');
        e.preventDefault();
        e.stopImmediatePropagation();
        saveViewerSettings(form, submitBtn);
      }, true); // capture mode
    }

    try {
      // B4: 설정 로드도 현재 열린 라이브러리 세션 기준 (general 하드코딩 제거)
      const currentSession = (window.currentLibraryType && SESSIONS.includes(window.currentLibraryType))
        ? window.currentLibraryType : 'general';
      const res = await fetch(`/api/media/dashboard/widgets/${encodeURIComponent(pluginId)}/data?type=${encodeURIComponent(currentSession)}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '조회 실패');
      const catalog = Array.isArray(data.catalog) ? data.catalog : [];
      catalogById = {};
      catalog.forEach((p) => { catalogById[p.id] = p; });
      ensureOrderInputs();
      renderCards(catalog);
      renderLanes(catalog, data.orders || {});
    } catch (err) {
      console.error('[PluginsViewer-Settings] load error:', err);
      grid.innerHTML = `<div class="pv-settings-error">플러그인 목록을 불러오지 못했습니다: ${esc(err.message || '오류')}</div>`;
    }
  }

  load();
})();
