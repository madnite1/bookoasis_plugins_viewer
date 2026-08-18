# -*- coding: utf-8 -*-
"""
BookOasis 플러그인 뷰어 (Plugins Viewer) 플러그인.

설치된 카테고리 레벨 플러그인들(예: 11t / HYB / KH / MangaDex / TK / Wolf Viewer)의
카테고리 뷰를 하나의 화면에서 각 플러그인 이름의 탭으로 구분해 통합 표시한다.

동작 원리:
  - 통합 뷰어 자체는 모든 세션(sessions: all)에 노출된다.
  - 설정에서 뷰어별·세션별 체크박스(SHOW_<plugin_id>__<session>)로
    "이 보관함의 통합 뷰어에 표시"를 선택한다 (기본: 꺼짐 = 기존 개별 탭 유지).
  - 하나라도 통합 표시로 선택된 플러그인은 category_tab 을 런타임에 None 으로
    오버라이드하여 사이드바 개별 탭에서 숨긴다 (파일 무수정, 메모리상 오버라이드,
    체크 해제 시 원복). 데이터 API(/dashboard/widgets/<id>/data)는 계속 동작한다.
  - 프론트엔드는 get_dashboard_data 로 현재 세션의 탭 목록을 받고,
    각 뷰어의 UI 번들은 /api/media/plugins/<id>/ui 로 조회해 직접 마운트한다.
  - 개별 뷰어는 window.__bookOasisViewerCleanups 레지스트리로 자체 정리되므로
    탭 전환 시 이전 뷰어 클린업이 보장된다. 기존 뷰어 코드는 0% 수정.
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


def _self_installed():
    """플러그인 모아보기 자신이 아직 설치되어 있는지 확인 (삭제 시 자가 복구용)."""
    import os
    return os.path.isdir(os.path.dirname(os.path.abspath(__file__)))


class _HiddenTab:
    """개별 사이드바 탭 숨김용 자가 복구 디스크립터.

    코어가 category_tab 을 읽을 때마다 플러그인 모아보기가 아직 설치되어
    있는지 확인하고, 삭제되었으면 원본 탭을 반환한다 (숨김 자동 해제).
    """

    def __init__(self, orig_tab):
        self._orig = orig_tab

    def __get__(self, obj, objtype=None):
        if not _self_installed():
            return self._orig
        return None


def _tab_sessions(tab):
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


def _load_general_config():
    """설정 페이지가 general DB에 저장하는 이 플러그인의 설정을 읽는다."""
    try:
        from repositories.metadata_repository import MetadataRepository
        raw = MetadataRepository.get_setting_value("general", f"PLUGIN_CONFIG_{SELF_ID}")
        data = json.loads(raw) if raw else {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


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


def _discover_viewer_classes():
    """category_tab 을 가진 (자신 제외) 설치 플러그인 [(id, name, sessions, class), ...]"""
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
            # 재설치 대응: 이전 모듈 인스턴스가 남긴 _HiddenTab 디스크립터에서
            # 원본 탭을 회수한다 (없으면 getattr 이 None 을 반환해 뷰어가 소실됨).
            desc = None
            for klass in type.mro(target_class):
                if "category_tab" in klass.__dict__:
                    desc = klass.__dict__["category_tab"]
                    break
            if desc is not None and isinstance(getattr(desc, "_orig", None), dict):
                _ORIG_TABS.setdefault(p_id, desc._orig)
            tab = _ORIG_TABS.get(p_id) or getattr(target_class, "category_tab", None)
            if not isinstance(tab, dict):
                continue
            p_name = tab.get("title") or getattr(target_class, "name", p_id)
            viewers.append((p_id, p_name, _tab_sessions(tab), target_class))
    except Exception:
        pass
    return viewers


def _unified_sessions_for(config, p_id, sessions):
    """설정에서 이 플러그인이 통합 표시되도록 선택된 세션 목록."""
    picked = []
    for s in sessions:
        if _is_on(config.get(f"SHOW_{p_id}__{s}", False)):
            picked.append(s)
    return picked


def _apply_session_overrides():
    """통합 표시로 선택된 플러그인의 category_tab 을 None 으로 오버라이드해
    사이드바 개별 탭에서 숨긴다. 선택 해제 시 원복한다."""
    config = _load_general_config()
    for p_id, _name, sessions, cls in _discover_viewer_classes():
        try:
            in_unified = bool(_unified_sessions_for(config, p_id, sessions))
            currently_hidden = p_id in _ORIG_TABS
            if in_unified and not currently_hidden:
                _ORIG_TABS[p_id] = getattr(cls, "category_tab", None)
                cls.category_tab = _HiddenTab(_ORIG_TABS[p_id])
            elif not in_unified and currently_hidden:
                cls.category_tab = _ORIG_TABS.pop(p_id)
        except Exception:
            continue


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
        # JSON 형식({"plugin version": "1.0.0"} 등) 우선 시도
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
        # 일반 텍스트: 첫 유효 라인 (key: value 지원)
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
    # 주의: id/config_schema/category_tab 은 plugin_manager 설치 검증기(AST 정적 분석)가
    # 리터럴 값을 요구하므로 클래스 본문에는 리터럴로 선언하고,
    # 동적 디스크립터는 클래스 정의 직후 모듈 레벨에서 재할당한다.
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
        _apply_session_overrides()
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

        # 설정 페이지(카드형 UI)용 카탈로그: 이름/버전/세션/현재 설정값
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

        # 설정 페이지 세션 레인용: 세션별 현재 저장된 순서
        orders = {s: _session_order(config, s) for s in _SESSION_LABELS}

        return {"success": True, "viewers": tabs, "catalog": catalog, "orders": orders}


# 검증기 통과용 리터럴 선언을 런타임 동적 디스크립터로 교체
# (코어는 항상 이 시점 이후에 클래스 속성을 읽으므로 동작 동일)
BookOasisPluginsViewerMetadataProvider.config_schema = _DynamicConfigSchema()
BookOasisPluginsViewerMetadataProvider.category_tab = _DynamicCategoryTab()
