# -*- coding: utf-8 -*-
"""
BookOasis 플러그인 뷰어 (Plugins Viewer) 플러그인.

설치된 카테고리 레벨 플러그인들(예: 11t / HYB / KH / MangaDex / TK / Wolf Viewer)의
카테고리 뷰를 하나의 화면에서 각 플러그인 이름의 탭으로 구분해 통합 표시한다.

동작 원리:
  - 통합 뷰어 자체는 모든 세션(sessions: all)에 노출된다.
  - 설정에서 뷰어별·세션별 체크박스(SHOW_<plugin_id>__<session>)로
    "이 보관함의 통합 뷰어에 표시"를 선택한다 (기본: 꺼짐 = 기존 개별 탭 유지).
  - 하나라도 통합 표시로 선택된 플러그인은 category_tab 을 런타임 디스크립터로
    오버라이드하여 사이드바 개별 탭에서 실시간으로 숨긴다.
  - 프론트엔드는 get_dashboard_data 로 현재 세션의 탭 목록을 받고,
    각 뷰어의 UI 번들은 /api/media/plugins/<id>/ui 로 조회해 직접 마운트한다.
"""
import json

from plugins.metadata.base import BaseMetadataProvider

SELF_ID = "bookoasis_plugins_viewer"
_SESSION_LABELS = {
    "general": "일반",
    "adult": "성인",
    "audiobook": "오디오",
    "video": "비디오",
}

# 런타임 category_tab 오버라이드 원본 보관: {plugin_id: 원본 category_tab dict}
_ORIG_TABS = {}
_CONFIG_CACHE = None
_CONFIG_CACHE_TIME = 0.0
_CACHE_TTL = 0.5  # 0.5초 짧은 메모리 캐시 (단일 요청 내 DB 중복 조회 방지 + 설정 변경 시 즉시 반영)


def _self_installed():
    """플러그인 모아보기 자신이 아직 설치되어 있는지 확인 (삭제 시 자가 복구용)."""
    import os
    return os.path.isdir(os.path.dirname(os.path.abspath(__file__)))


def _load_general_config(force_refresh=False):
    """모든 세션 DB(general, adult, audiobook, video)에 저장된 플러그인 설정을 읽어 병합한다."""
    global _CONFIG_CACHE, _CONFIG_CACHE_TIME
    import time
    now = time.time()
    if not force_refresh and _CONFIG_CACHE is not None and (now - _CONFIG_CACHE_TIME < _CACHE_TTL):
        return _CONFIG_CACHE
    merged = {}
    try:
        from repositories.metadata_repository import MetadataRepository
        for session in ("general", "adult", "audiobook", "video"):
            try:
                raw = MetadataRepository.get_setting_value(session, f"PLUGIN_CONFIG_{SELF_ID}")
                if raw:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        merged.update(data)
            except Exception:
                pass
    except Exception:
        pass
    _CONFIG_CACHE = merged
    _CONFIG_CACHE_TIME = now
    return _CONFIG_CACHE


def _tab_sessions(tab):
    if not isinstance(tab, dict):
        return ["general"]
    raw = tab.get("sessions")
    if raw is None:
        return ["general"]
    if isinstance(raw, str):
        if raw.strip().lower() == "all":
            return list(_SESSION_LABELS.keys())
        raw = [raw]
    if isinstance(raw, (list, tuple, set)):
        out = [s for s in (str(x).strip().lower() for x in raw) if s in _SESSION_LABELS]
        return out or ["general"]
    return ["general"]


def _session_order(config, session):
    """설정에 저장된 세션별 탭 순서(TAB_ORDER_<session>: 콤마 구분 id 목록)를 파싱."""
    raw = config.get(f"TAB_ORDER_{session}", "")
    if not isinstance(raw, str):
        return []
    return [s for s in (x.strip() for x in raw.split(",")) if s]


def _sort_by_order(items, order, name_key):
    """order 목록에 있는 항목은 그 순서대로, 없는 항목은 뒤에 이름순으로."""
    pos = {p_id: i for i, p_id in enumerate(order)}
    known = [it for it in items if it["id"] in pos]
    rest = [it for it in items if it["id"] not in pos]
    known.sort(key=lambda it: pos[it["id"]])
    rest.sort(key=lambda it: str(it.get(name_key) or "").lower())
    return known + rest


def _is_on(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in ("0", "false", "off", "no", "")


def _unified_sessions_for(config, p_id, sessions):
    """설정에서 이 플러그인이 통합 표시되도록 선택된 세션 목록."""
    picked = []
    for s in sessions:
        if _is_on(config.get(f"SHOW_{p_id}__{s}", False)):
            picked.append(s)
    return picked


def _current_request_session():
    """Flask request context에서 현재 요청 세션(db_type)을 추출한다."""
    try:
        from flask import request
        if request:
            s = request.args.get('type') or request.form.get('type')
            if not s and request.is_json:
                data = request.get_json(silent=True) or {}
                s = data.get('type')
            if s and str(s).strip().lower() in _SESSION_LABELS:
                return str(s).strip().lower()
    except Exception:
        pass
    return None


class _DynamicPluginCategoryTab:
    """개별 플러그인의 category_tab 동적 디스크립터.
    현재 요청된 세션(db_type)에 대해 해당 플러그인이 모아보기에 통합 표시되도록 선택된 경우에만
    해당 세션 사이드바에서 개별 탭을 숨긴다 (None 반환).
    """

    def __init__(self, plugin_id, orig_tab):
        self.plugin_id = plugin_id
        self._orig = orig_tab

    def __get__(self, obj, objtype=None):
        if not _self_installed():
            return self._orig
        try:
            config = _load_general_config()
            sessions = _tab_sessions(self._orig)
            req_session = _current_request_session()

            if req_session:
                if req_session in sessions and _is_on(config.get(f"SHOW_{self.plugin_id}__{req_session}", False)):
                    return None
            else:
                picked = _unified_sessions_for(config, self.plugin_id, sessions)
                if picked and len(picked) == len(sessions):
                    return None
        except Exception:
            pass
        return self._orig


def _discover_viewer_classes():
    """category_tab 을 가진 (자신 제외) 설치 플러그인 탐색 및 동적 디스크립터 바인딩."""
    viewers = []
    try:
        from services.metadata_factory import MetadataFactory
        seen = set()
        for provider_name, target_class in MetadataFactory._discover_provider_classes():
            if not target_class:
                continue
            p_id = getattr(target_class, "id", provider_name)
            if p_id == SELF_ID or p_id in seen:
                continue
            seen.add(p_id)

            orig_tab = None
            desc = None
            for klass in type.mro(target_class):
                if "category_tab" in klass.__dict__:
                    desc = klass.__dict__["category_tab"]
                    break

            if desc is not None and hasattr(desc, "_orig"):
                orig_tab = desc._orig

            if not isinstance(orig_tab, dict):
                raw_tab = getattr(target_class, "category_tab", None)
                if isinstance(raw_tab, dict):
                    orig_tab = raw_tab

            if not isinstance(orig_tab, dict):
                continue

            _ORIG_TABS[p_id] = orig_tab

            # 모든 카테고리 뷰어 플러그인의 category_tab을 _DynamicPluginCategoryTab으로 감싸기
            if not isinstance(desc, _DynamicPluginCategoryTab):
                target_class.category_tab = _DynamicPluginCategoryTab(p_id, orig_tab)

            p_name = orig_tab.get("title") or getattr(target_class, "name", p_id)
            viewers.append((p_id, p_name, _tab_sessions(orig_tab), target_class))
    except Exception:
        pass
    return viewers


def _apply_session_overrides(force_refresh_config=False):
    """모든 타겟 뷰어 클래스 탐색 및 오버라이드 바인딩 적용."""
    _load_general_config(force_refresh=force_refresh_config)
    _discover_viewer_classes()


def _read_plugin_version(p_id):
    """플러그인 폴더의 VERSION 파일에서 버전 문자열 파싱."""
    import os
    try:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        vpath = os.path.join(base_dir, p_id, "VERSION")
        if not os.path.isfile(vpath):
            return ""
        with open(vpath, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return ""
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                for k in ("plugin version", "version", "VERSION"):
                    if k in data:
                        return str(data[k]).strip()
                for v in data.values():
                    return str(v).strip()
            return str(data).strip()
        except (ValueError, TypeError):
            pass
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            if ":" in line:
                return line.split(":", 1)[1].strip().strip('"')
            return line.strip('"')
    except Exception:
        pass
    return ""


class _DynamicCategoryTab:
    """코어가 통합 뷰어의 category_tab 을 읽는 시점(사이드바 렌더 등)에
    다른 뷰어들의 표시 오버라이드를 재적용한다."""

    _TAB = {
        "title": "플러그인 모아보기",
        "icon": "fa-solid fa-layer-group",
        "order": 88,
        "sessions": "all",
    }

    def __get__(self, obj, objtype=None):
        _apply_session_overrides()
        return dict(self._TAB)


class _DynamicConfigSchema:
    """설정 페이지 접근 시점에 설치된 뷰어 x 세션 체크박스 스키마 생성."""

    def __get__(self, obj, objtype=None):
        _apply_session_overrides()
        schema = []
        for p_id, p_name, sessions, _cls in _discover_viewer_classes():
            for s in sessions:
                label_session = _SESSION_LABELS.get(s, s)
                schema.append({
                    "key": f"SHOW_{p_id}__{s}",
                    "label": f"{p_name} — {label_session} 통합 표시",
                    "type": "checkbox",
                    "required": False,
                    "default": False,
                    "description": (
                        f"{label_session} 보관함의 통합 뷰어에 {p_name}({p_id})를 표시합니다. "
                        "하나라도 켜면 이 플러그인의 개별 사이드바 탭은 숨겨집니다."
                    ),
                })
        if not schema:
            schema.append({
                "key": "_NO_VIEWERS",
                "label": "표시할 카테고리 뷰 플러그인 없음",
                "type": "text",
                "required": False,
                "default": "",
                "description": "카테고리 뷰 플러그인이 설치되면 여기에 표시 여부 옵션이 나타납니다.",
            })
        return schema


class BookOasisPluginsViewerMetadataProvider(BaseMetadataProvider):
    id = "bookoasis_plugins_viewer"
    name = "플러그인 모아보기"
    is_searchable = False
    config_schema = []
    category_tab = {
        "title": "플러그인 모아보기",
        "icon": "fa-solid fa-layer-group",
        "order": 88,
        "sessions": "all",
    }
    update_manifest = {
        "enabled": True,
        "provider": "github-raw",
        "raw_base_url": "https://raw.githubusercontent.com/madnite1/bookoasis_plugins_viewer/main",
        "files": [
            "bookoasis_plugins_viewer.py",
            "__init__.py",
            "VERSION",
            "index.html",
            "style.css",
            "script.js",
            "settings.html",
            "settings.css",
            "settings.js",
            "README.md",
        ],
        "version_file": "VERSION",
        "version_key": "plugin version",
        "show_sample_update_button": False,
    }

    def search(self, db_type, query):
        return []

    def apply(self, db_type, book_id, item_data):
        return False, "통합 뷰어는 메타데이터 적용 기능을 제공하지 않습니다."

    def get_dashboard_data(self, db_type, limit=10):
        """현재 세션(db_type)의 통합 뷰어 탭 목록 반환."""
        _apply_session_overrides(force_refresh_config=True)
        config = _load_general_config()
        session = str(db_type or "general").strip().lower()

        tabs = []
        for p_id, p_name, sessions, _cls in _discover_viewer_classes():
            picked = _unified_sessions_for(config, p_id, sessions)
            if session not in picked:
                continue
            tab = _ORIG_TABS.get(p_id) or {}
            tabs.append({
                "id": p_id,
                "title": p_name,
                "icon": (tab.get("icon") if isinstance(tab, dict) else None) or "fa-solid fa-puzzle-piece",
                "order": int((tab.get("order") if isinstance(tab, dict) else 50) or 50),
            })
        tabs = _sort_by_order(tabs, _session_order(config, session), "title")

        catalog = []
        for p_id, p_name, sessions, _cls in _discover_viewer_classes():
            catalog.append({
                "id": p_id,
                "name": p_name,
                "version": _read_plugin_version(p_id),
                "sessions": sessions,
                "checked": {s: _is_on(config.get(f"SHOW_{p_id}__{s}", False)) for s in sessions},
            })
        catalog.sort(key=lambda x: x["name"].lower())

        orders = {s: _session_order(config, s) for s in _SESSION_LABELS}

        return {"success": True, "viewers": tabs, "catalog": catalog, "orders": orders}


# 검증기 통과용 리터럴 선언을 런타임 동적 디스크립터로 교체
BookOasisPluginsViewerMetadataProvider.config_schema = _DynamicConfigSchema()
BookOasisPluginsViewerMetadataProvider.category_tab = _DynamicCategoryTab()

# 모듈 로드 즉시 오버라이드 적용 (모든 대상 플러그인 category_tab을 실시간 디스크립터로 즉시 감쌈)
try:
    _apply_session_overrides(force_refresh_config=True)
except Exception:
    pass
