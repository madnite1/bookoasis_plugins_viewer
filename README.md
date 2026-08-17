# 📚 플러그인 모아보기 (bookoasis_plugins_viewer)

BookOasis에 설치된 카테고리 레벨 플러그인의 카테고리 뷰를 **하나의 화면에서 각 플러그인 이름의 탭으로 구분해 통합 표시**하는 플러그인입니다.

## 주요 기능

- 사이드바 [플러그인 모아보기] 진입 시, 표시하도록 선택한 플러그인들을 탭으로 통합 표시
- 모든 세션(일반/성인/오디오/비디오)에 노출되며, 각 보관함에서는 그 세션에 맞게 선택된 플러그인만 표시
- 설정 페이지에서 **카드형 UI**로 플러그인별 표시 세션 선택:
  - 카드마다 플러그인 이름 + 버전(VERSION 파일 파싱) + id 표시
  - 플러그인이 노출 가능한 세션(일반/성인/오디오/비디오)별 체크박스
  - 하나라도 켜면 해당 플러그인의 **개별 사이드바 탭은 자동 숨김** (전부 끄면 원복)

## 동작 원리

- **직접 마운트 방식**: 코어 `mountCategoryPluginUI`와 동일하게
  `innerHTML(css+html)` + `new Function('pluginId','container', js)` 로 각 뷰어를 탭 전환 마운트합니다.
  (iframe 격리 방식은 개별 뷰어가 코어 window 상태에 의존해 폐기)
- 탭 목록은 자체 `get_dashboard_data` 계약(`/api/media/dashboard/widgets/<id>/data`)으로 조회하고,
  각 뷰어의 UI 번들은 `/api/media/plugins/<id>/ui` 로 로드해 캐시합니다.
- 개별 뷰어는 `window.__bookOasisViewerCleanups` 레지스트리로 자체 정리되므로
  탭 전환 시 이전 뷰어의 리스너/옵저버 클린업이 보장됩니다. **기존 뷰어 코드는 0% 수정.**
- **사이드바 숨김**: 통합 표시로 선택된 플러그인은 런타임에 클래스 속성 `category_tab`을
  None으로 오버라이드해 코어 사이드바에서 제외합니다 (파일 무수정, 메모리상 오버라이드,
  선택 해제·재시작 시 원복). 데이터 API는 계속 동작합니다.

## 설정 저장 구조

- 설정 키: `SHOW_<plugin_id>__<session>` (예: `SHOW_bookoasis_11t__adult`) — 불리언
- 저장 위치: general DB `PLUGIN_CONFIG_bookoasis_plugins_viewer` (코어 설정 저장 계약 그대로 사용)
- 기본값: 전부 꺼짐 = 기존처럼 개별 탭 표시

## 파일 구조

```
bookoasis_plugins_viewer/
  __init__.py                  # 제공자 노출
  bookoasis_plugins_viewer.py  # 제공자 + 동적 config/카탈로그 + category_tab 오버라이드
  index.html                   # 탭 바 + 패널 컨테이너
  style.css                    # 테마 CSS 변수 연동 탭 스타일
  script.js                    # 탭 목록 조회 + 뷰어 직접 마운트/클린업
  settings.html                # 설정 페이지 카드형 UI 골격
  settings.css                 # 카드 그리드 스타일
  settings.js                  # 카탈로그 fetch + 카드 렌더 (저장은 코어 폼 submit 이용)
  VERSION                      # 버전 파일
```

## 주의 / 설계 메모

- 탭·카드 목록은 팩토리 디스커버리 기반 동적 생성 — 뷰어 설치/삭제 시 자동 반영 (자기 자신 제외).
- settings.js의 체크박스 `name`이 설정 키와 동일하므로 코어의 "설정 저장" 버튼이
  그대로 값을 수집·저장합니다 (별도 저장 API 불필요).
- gunicorn 1워커 전제: category_tab 런타임 오버라이드는 프로세스 메모리 기준입니다.
- `.py` 변경은 컨테이너 재시작 필요, html/css/js는 bind mount로 즉시 반영.
