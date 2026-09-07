# Discord 운동 집계 Worker — `/등록` 방식

이번 버전은 **사람 ID를 코드에 직접 넣지 않습니다.**

Discord 자체를 저장소처럼 사용합니다.

- `#운동인증` → 운동 기록
- `#운동-설정` → 등록/탈퇴 기록
- Cloudflare Worker → 집계 계산
- SQL / D1 / KV 없음
- 24시간 켜둘 서버 없음

---

## 최종 규칙

### 주간
- 월요일 10:00 KST ~ 다음 월요일 10:00 KST 직전
- 채팅의 `1/3`, `2/3`, `3/3`, `4/3` ... 값을 읽음
- 같은 사람의 같은 주차에서 가장 큰 값을 사용
- 3회 이상 성공
- 3회 미만이면 **못 채운 횟수만큼 목숨 차감**
  - `2/3` → 1회 부족 → 목숨 `-1`
  - `1/3` → 2회 부족 → 목숨 `-2`
  - `0/3` → 3회 부족 → 목숨 `-3`

### 목숨
목숨은 한 칸씩 차감합니다. 차감 도중 `목0`이 되면 `💀`를 표시하고 즉시 `목3`으로 초기화합니다.
초기화 뒤에도 아직 차감할 횟수가 남아 있으면 계속 차감합니다.

```text
목3 + 2/3 → 목2
목3 + 1/3 → 목1
목3 + 0/3 → 💀 목3

목2 + 1/3 → 💀 목3
목1 + 2/3 → 💀 목3
목1 + 0/3 → 💀 목1
```

### 늦은 인증
```text
지난주 운동 3/3
```

처럼 `지난주`가 포함되면 바로 전 주에 귀속합니다.

---

# 명령어

## 자기 자신 최초 등록

```text
/등록
```

결과:

```text
✅ 태영 등록 완료 · 시작 목숨: 목3
```

Discord User ID를 직접 입력할 필요가 없습니다.

자기 자신 최초 등록은 무조건 목3에서 시작합니다.

재등록은 목숨 초기화 악용을 막기 위해 본인이 할 수 없습니다.

---

## 관리자 기존 인원 등록

기존 인원처럼 이미 목숨이 다른 경우:

```text
/등록 사용자:@도은 목숨:목1
/등록 사용자:@하늘 목숨:목2
/등록 사용자:@희재 목숨:목3
```

`Administrator` 또는 `Manage Server` 권한이 있어야 합니다.

따라서 최초 시스템 도입 시 기존 멤버만 관리자가 현재 목숨대로 한 번 등록하면 됩니다.

---

## 탈퇴

관리자만:

```text
/탈퇴 사용자:@태영
```

탈퇴한 주부터 집계에서 제외합니다.

다시 참여할 경우 관리자가 `/등록 사용자:@태영 목숨:...`으로 재등록합니다.

---

## 집계

현재 주:

```text
/집계
```

지난주:

```text
/집계 대상:지난주
```

예:

```text
🏃 이번 주 운동 현황 · 2026.09.07 10:00 ~ 2026.09.14 10:00

도은  1/3 > 목1
하늘  2/3 > 목2
희재  3/3 > 목3 ✅
태영  4/3 > 목3 ✅
```

현재 주가 아직 안 끝났다면 `0/3`, `1/3`, `2/3`이어도 목숨은 즉시 깎지 않습니다.
월요일 10시 마감 시 **못 채운 횟수만큼** 목숨 차감이 확정됩니다.

---

# Discord 채널 구성 추천

```text
#운동인증
  일반 참여자 읽기/쓰기 가능
  봇 읽기 가능

#운동-집계
  일반 참여자 읽기 가능
  봇 쓰기 가능

#운동-설정
  관리자 + 봇만 읽기/쓰기 가능
```

`#운동-설정`에는 이런 내부 기록이 쌓입니다.

```text
[WORKOUT_REGISTRY_V1] {"action":"REGISTER", ...}
[WORKOUT_REGISTRY_V1] {"action":"UNREGISTER", ...}
```

이 채널을 삭제하거나 기록을 지우면 등록 정보도 사라집니다.
이것이 DB를 사용하지 않는 구조의 핵심입니다.

---

# 설치

## 1. Discord Developer Portal

Application/Bot을 만든 뒤 준비:

- Application ID
- Public Key
- Bot Token

Bot 설정:

- Message Content Intent ON

서버 설치 Scope:

- `bot`
- `applications.commands`

권한:

- View Channel
- Read Message History
- Send Messages

특히 `#운동-설정` 채널은 봇이 읽고 쓸 수 있어야 합니다.

---

## 2. Discord ID 복사

Discord Developer Mode ON 후:

- Server ID
- 운동인증 Channel ID
- 운동설정 Channel ID
- 결과 Channel ID

**참여자 User ID는 필요 없습니다.**

---

## 3. `wrangler.json`

```json
"vars": {
  "DISCORD_APPLICATION_ID": "앱ID",
  "WORKOUT_CHANNEL_ID": "운동인증채널ID",
  "REGISTRY_CHANNEL_ID": "운동설정채널ID",
  "RESULT_CHANNEL_ID": "결과채널ID"
}
```

결과도 운동인증 채널에 올릴 거면:

```text
WORKOUT_CHANNEL_ID
RESULT_CHANNEL_ID
```

를 같은 ID로 쓰면 됩니다.

---

## 4. 로컬 설정

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars`:

```dotenv
DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_GUILD_ID=...
```

---

## 5. 설치/테스트

```bash
npm install
npm test
npm run typecheck
```

---

## 6. Cloudflare 배포

```bash
npx wrangler login
npm run deploy
```

배포 후 Secret 설정:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
```

---

## 7. Discord Interaction Endpoint

Discord Developer Portal → General Information →
Interactions Endpoint URL에 Worker URL 입력:

```text
https://discord-workout-counter.<계정>.workers.dev/
```

---

## 8. Slash Command 등록

```bash
npm run register
```

등록되는 명령:

```text
/집계
/등록
/탈퇴
```

---

# 첫 도입 순서

예를 들어 현재 목숨이:

```text
도은 목1
하늘 목2
희재 목3
태영 목3
```

이면 관리자가 한 번만:

```text
/등록 사용자:@도은 목숨:목1
/등록 사용자:@하늘 목숨:목2
/등록 사용자:@희재 목숨:목3
/등록 사용자:@태영 목숨:목3
```

실행합니다.

그 뒤 새로 들어오는 사람은 직접:

```text
/등록
```

하면 끝입니다.

---

# 자동 월요일 집계

`wrangler.json`:

```json
"triggers": {
  "crons": ["0 1 * * 1"]
}
```

Cloudflare Cron은 UTC 기준:

```text
월요일 01:00 UTC
=
월요일 10:00 KST
```

직전 주 결과를 `RESULT_CHANNEL_ID`에 자동 게시합니다.

---

# 중요한 한계

DB를 일부러 사용하지 않기 때문에:

1. `#운동-설정` 메시지를 삭제하면 등록/탈퇴 기록도 사라집니다.
2. 운동 인증 메시지를 삭제/수정하면 집계도 달라집니다.
3. `x/3` 숫자는 사용자가 입력한 값을 신뢰합니다.
4. 같은 주차의 값은 최댓값을 사용합니다.
5. `지난주`는 한 주 전만 지원합니다.
6. 장기간 메시지가 수천 건 이상 쌓이면 Discord 채팅 전체 재스캔 방식이 비효율적이 될 수 있습니다.

현재 규모에서 서버/DB 없이 시작하는 MVP로는 적합합니다.
