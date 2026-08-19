(function () {
  'use strict';

  const SELF_ID = 'bookoasis_plugins_viewer';
  const root = document.querySelector('[data-uf-root]');
  if (!root) return;

  const $ = (role) => root.querySelector(`[data-role="${role}"]`);
  const tabsEl = $('tabs');
  const panesEl = $('panes');
  const statusEl = $('status');

  let plugins = [];
  let activeId = null;
  const bundleCache = new Map();

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentType() {
    return document.documentElement.getAttribute('data-library-type') || 'general';
  }

  function showStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', !!isError);
    statusEl.classList.remove('uf-hidden');
  }

  function hideStatus() {
    if (statusEl) statusEl.classList.add('uf-hidden');
  }

  async function fetchViewers() {
    const res = await fetch(
      `/api/media/dashboard/widgets/${SELF_ID}/data?type=${encodeURIComponent(currentType())}`,
      { credentials: 'same-origin' }
    );
    if (!res.ok) throw new Error(`통합 뷰어 목록 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '통합 뷰어 목록 조회 실패');
    return Array.isArray(data.viewers) ? data.viewers : [];
  }

  async function getBundle(pluginId) {
    if (bundleCache.has(pluginId)) return bundleCache.get(pluginId);
    const res = await fetch(`/api/media/plugins/${encodeURIComponent(pluginId)}/ui`, {
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`UI 번들 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    if (!data.success || !data.bundle) throw new Error(data.error || 'UI 번들이 없습니다.');
    bundleCache.set(pluginId, data.bundle);
    return data.bundle;
  }

  // 코어 mountCategoryPluginUI 와 동일한 직접 마운트 방식.
  // 개별 뷰어 스크립트는 window.__bookOasisViewerCleanups 레지스트리로
  // 실행 시 이전 뷰어를 스스로 정리하므로 탭 전환 시 innerHTML 교체가 안전함.
  async function mountViewer(plugin) {
    showStatus((plugin.title || plugin.id) + ' 뷰어를 불러오는 중...');
    const bundle = await getBundle(plugin.id);

    // 이전 뷰어 정리 (뷰어 자체 레지스트리 선(先)정리)
    try {
      const reg = window.__bookOasisViewerCleanups;
      if (reg && typeof reg.forEach === 'function') {
        [...reg.values()].forEach((cleanup) => {
          try { cleanup(); } catch (e) { /* noop */ }
        });
        reg.clear();
      }
    } catch (e) { /* noop */ }

    let html = '';
    if (bundle.css) {
      html += `<style data-uf-style="${escapeHtml(plugin.id)}">${bundle.css}</style>`;
    }
    html += bundle.html || '';
    panesEl.innerHTML = html;

    if (bundle.js) {
      try {
        const scriptFn = new Function('pluginId', 'container', bundle.js);
        scriptFn(plugin.id, panesEl);
      } catch (err) {
        console.error(`[UnifiedViewer] ${plugin.id} 스크립트 실행 오류:`, err);
        showStatus((plugin.title || plugin.id) + ' 스크립트 오류: ' + (err.message || '오류'), true);
        return;
      }
    }
    hideStatus();
  }

  async function activate(pluginId) {
    if (activeId === pluginId) return;
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) return;
    activeId = pluginId;
    root.querySelectorAll('.uf-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.pluginId === pluginId);
    });
    try {
      await mountViewer(plugin);
    } catch (err) {
      console.error('[UnifiedViewer] mount error:', err);
      showStatus((plugin.title || pluginId) + ' 뷰어를 불러오지 못했습니다: ' + (err.message || '오류'), true);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    plugins.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'uf-tab' + (p.id === activeId ? ' is-active' : '');
      btn.dataset.pluginId = p.id;
      const icon = p.icon || 'fa-solid fa-puzzle-piece';
      btn.innerHTML = `<i class="uf-tab-icon ${escapeHtml(icon)}"></i><span>${escapeHtml(p.title || p.id)}</span>`;
      btn.addEventListener('click', () => activate(p.id));
      frag.appendChild(btn);
    });
    tabsEl.appendChild(frag);

    if (plugins.length === 0) {
      showStatus('이 보관함의 통합 뷰어에 표시할 플러그인이 없습니다. 설정 > 플러그인 > 통합 뷰어에서 선택하세요.', true);
      panesEl.innerHTML = '';
      activeId = null;
    } else {
      const stillActive = plugins.some((p) => p.id === activeId);
      if (!stillActive) {
        activeId = null;
        activate(plugins[0].id);
      }
    }
  }

  function cleanUpSidebarTabs(viewerList) {
    if (!Array.isArray(viewerList)) return;
    const hiddenIds = new Set(viewerList.map((p) => p && p.id).filter(Boolean));
    hiddenIds.delete(SELF_ID);

    try {
      // 1. 모아보기에 포함된 플러그인의 개별 사이드바 탭 숨김
      viewerList.forEach((p) => {
        if (!p || !p.id || p.id === SELF_ID) return;
        const selectors = [
          `[data-plugin-id="${CSS.escape(p.id)}"]`,
          `[data-tab-id="${CSS.escape(p.id)}"]`,
          `a[href*="/plugins/${CSS.escape(p.id)}"]`,
          `a[href*="/category/${CSS.escape(p.id)}"]`,
        ];
        selectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            if (!el.closest('[data-uf-root]')) {
              el.style.display = 'none';
            }
          });
        });
      });

      // 2. 모아보기에서 체크 해제된 플러그인의 사이드바 탭 복원
      document.querySelectorAll('[data-role="sidebar-category-dynamic"], [data-plugin-id], [data-tab-id]').forEach((el) => {
        if (el.closest('[data-uf-root]')) return;
        const pid = el.dataset.pluginId || el.dataset.tabId || (el.dataset.id && el.dataset.id.startsWith('plugin_') ? el.dataset.id.replace('plugin_', '') : null);
        if (pid && !hiddenIds.has(pid) && el.style.display === 'none') {
          el.style.display = '';
        }
      });
    } catch (_) {}
  }

  async function reloadViewerTabs() {
    try {
      plugins = await fetchViewers();
      renderTabs();
      cleanUpSidebarTabs(plugins);
    } catch (err) {
      console.error('[UnifiedViewer] reload error:', err);
    }
  }

  window.reloadBookOasisPluginsViewerTabs = reloadViewerTabs;
  window.addEventListener('bookoasis_plugins_viewer:config_updated', reloadViewerTabs);
  // 세션 전환/사이드바 재렌더링 후에도 현재 세션 기준으로 개별 탭 숨김/복원 재적용
  window.addEventListener('library:categories-rendered', reloadViewerTabs);
  // 플러그인 매니저에서 설치/삭제/활성/비활성/업데이트 성공 시 탭 목록 재조회
  window.addEventListener('plugin_manager:plugins_changed', reloadViewerTabs);

  async function init() {
    try {
      plugins = await fetchViewers();
      renderTabs();
      cleanUpSidebarTabs(plugins);
    } catch (err) {
      console.error('[UnifiedViewer] init error:', err);
      showStatus('뷰어 목록을 불러오지 못했습니다: ' + (err.message || '오류'), true);
    }
  }

  init();
})();
