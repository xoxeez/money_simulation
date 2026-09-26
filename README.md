# 소학행 자산 플래너 v2

기존 소학행 자산 플래너를 대체할 수 있는 복사 가능한 PWA 소스입니다. 화면은 vanilla JS로 동작하며, 기존 `coupleV8` 데이터와 월별 `closed` 상태를 읽어옵니다.

## 복사할 파일

다음 파일을 기존 웹페이지 폴더에 복사하세요.

```text
index.html
app.js
domain.mjs
styles.css
manifest.json
sw.js
firebase-config.js
```

기존 아이콘 파일(`icon-192.png`, `icon-512.png`, `favicon-32.png`)은 그대로 사용하면 됩니다.

## Firebase 사용

`firebase-config.js`에는 Firebase 프로젝트 설정과 Firestore 문서 경로가 들어 있습니다. 설정 파일은 이전 앱과의 호환을 위해 기존 `firebaseConfig` 및 `DOC_PATH` 바인딩을 유지하면서, 새 앱이 사용하는 `window.firebaseConfig`와 `window.DOC_PATH`에도 값을 노출합니다. 다른 Firebase 프로젝트를 사용할 경우 이 파일의 설정과 문서 경로를 함께 바꾸세요.

Firebase 설정이 없으면 자동으로 localStorage 모드로 동작합니다. 기존 데이터는 다음 순서로 확인합니다.

1. `sohakPlannerV2`
2. `coupleV8`
3. `coupleV7`

기존 `coupleV8` 또는 `coupleV7` 데이터는 새 구조로 마이그레이션됩니다. Firebase에서 읽은 원본 문서는 최초 로드 시 `sohakPlannerV2:cloudBackup`에도 보관하고, 변환된 데이터는 `sohakPlannerV2`에 저장합니다.

상단의 `백업` 버튼으로 현재 데이터를 JSON 파일로 저장하고, `복원` 버튼으로 백업 파일을 다시 불러올 수 있습니다.

## 용돈 카드 설정

자산 화면에서 카드의 자금 성격을 지정합니다.

- `관리 계좌`: 개인 지출 시 연결 계좌로 정산 항목 생성
- `비공개 용돈`: 용돈 주인의 개인 지출을 용돈으로 처리
- `외부 계좌`: 잔액을 관리하지 않고 결제 수단만 기록

비공개 용돈 계좌의 잔액과 거래 내역은 화면에 표시하지 않습니다.

## 과거 데이터 처리

- 마감되지 않은 과거 월: 개인 카드 사용을 정산 검토 목록에 추가합니다.
- 마감 완료 월: 기존 월의 결과를 `closeSnapshot`으로 보존하고 새 정산 규칙을 적용하지 않습니다.
- 과거 정산 항목의 초기 상태는 `검토 필요`입니다. 실제로 이체했다면 `이체 완료`로 바꾸세요.

마감 월을 수정하려면 정산 화면에서 먼저 마감을 해제해야 합니다.

## 실행

PWA와 ES module은 `file://` 주소에서 정상 동작하지 않을 수 있으므로 정적 서버로 실행하세요.

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000/outputs/sohak-planner-v2/`을 열거나, 이 폴더의 파일을 정적 호스팅 루트에 복사해 사용하면 됩니다.

## 배포 후 갱신

`app.js`, `domain.mjs`, `styles.css`를 변경할 때마다 `sw.js`의 `CACHE` 값을 올리세요.

```js
const CACHE = "sohak-planner-v2-1";
```

이렇게 해야 이미 설치된 PWA가 새 앱 셸을 받아옵니다.
