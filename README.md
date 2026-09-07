# Discord 운동 집계 Worker

Discord 채팅 자체를 저장소로 쓰는 운동 인증/목숨 관리 봇. DB 없음, 24시간 서버 없음 — Cloudflare Worker + Discord REST API로만 동작.

- 운동 인증 채널/쓰레드의 채팅 → 운동 기록
- 별도 비공개 등록 채널의 봇 메시지 → 등록/탈퇴/목숨/목표 조절 기록
- Cloudflare Cron(매주 월요일 10:00 KST) → 자동 집계 + 결과 게시

---

## 주간 집계 규칙

- 한 주: 월요일 10:00 KST ~ 다음 월요일 10:00 KST 직전
- 채팅에 `x/y` 형태로 올리면 인증됨. `y`(목표)는 사람마다 다를 수 있음(1~5, 기본 3) — 채팅에 쓴 분모가 아니라 그 사람이 **등록한 목표**를 기준으로 성공/실패 판정
- 같은 사람이 같은 주에 여러 번 올리면 그중 최댓값 사용
- `지난주 3/3`처럼 "지난주"가 포함되면 직전 주로 귀속
- `이름 x/y > 목n` 형태로 여러 명 기록을 모은 수동 요약글(`>` 포함, 또는 `x/y`가 한 메시지에 2번 이상)은 개인 인증으로 보지 않고 무시 — 복붙해서 올려도 본인 기록이 잘못 잡히지 않음

## 목숨 규칙

목숨은 ❤️ 개수로 표시(❤️❤️❤️ = 3). 목표 미달 시 부족한 횟수만큼 한 칸씩 차감.

```text
❤️❤️❤️ + 2/3 → ❤️❤️
❤️❤️❤️ + 1/3 → ❤️
❤️❤️❤️ + 0/3 → 💀 ❤️❤️❤️ (0이 되는 순간 즉시 초기화, 남은 차감은 계속 적용)
```

현재 진행 중인 주는 미달이어도 목숨을 즉시 깎지 않음. 매주 월요일 10시 마감 시점에 확정.

---

## 명령어

| 명령어 | 설명 | 공개 범위 |
|---|---|---|
| `/집계 [대상]` | 이번 주(기본) 또는 지난주 현황 | 채널 전체 공개 |
| `/등록 [목표]` | 본인 등록 (목3 시작, 목표는 1~5 중 선택) | 나만 보기 |
| `/등록 사용자:@OO 목숨: 목표:` | 관리자용 타인 등록 | 나만 보기 |
| `/일괄등록 목숨: [목표:]` | 관리자용, 다중 선택 UI로 여러 명 한 번에 등록 | 나만 보기 |
| `/목숨조절 목숨: [사용자:]` | 관리자용 목숨 변경 (목표는 유지) | 나만 보기 |
| `/목표조절 목표: [사용자:]` | 관리자용 목표(분모) 변경 (목숨은 유지) | 나만 보기 |
| `/탈퇴 사용자:` | 관리자용, 탈퇴 처리 (그 주부터 집계 제외) | 나만 보기 |
| `/도움말` | 규칙·명령어 안내 | 나만 보기 |

자기 자신 재등록(악용 방지)은 본인이 할 수 없고 관리자만 가능.

---

## Discord 채널 구성

```text
운동 인증 채널/쓰레드   — 참여자 읽기/쓰기, 봇 읽기
결과 채널               — 참여자 읽기, 봇 쓰기 (@here 자동 집계)
등록 채널 (비공개)      — 관리자 + 봇만 볼 수 있게 View Channel 권한 제한
```

등록 채널에는 `[WORKOUT_REGISTRY_V1] {...}` 형태의 내부 기록(REGISTER/UNREGISTER/SET_LIVES)이 쌓임. 이 메시지가 지워지면 등록 정보도 사라짐 — DB 없이 동작하는 구조의 핵심. 운동 인증 채널과 절대 같은 채널로 두지 말 것(마커 메시지가 그대로 노출됨).

---

## 설정 (`wrangler.json` vars / secrets)

```json
"vars": {
  "DISCORD_APPLICATION_ID": "...",
  "WORKOUT_CHANNEL_ID": "...",
  "REGISTRY_CHANNEL_ID": "...",
  "RESULT_CHANNEL_ID": "..."
}
```

Cloudflare secret로 별도 설정: `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY` (`npx wrangler secret put ...`).

로컬 개발용 `.dev.vars`: `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`.

Bot에는 Message Content Intent가 반드시 켜져 있어야 함 — 꺼져 있으면 남의 메시지 내용을 못 읽어서 집계가 전부 0으로 나옴.

---

## 실행

```bash
yarn install
yarn test          # 유닛 테스트
yarn typecheck
yarn deploy        # wrangler deploy
yarn register       # 슬래시 커맨드 등록/갱신
```

---

## CI/CD (`.github/workflows/ci.yml`)

- push/PR 전체: `typecheck` + `test`
- `main` push 시: 테스트 통과하면 이어서 `wrangler deploy` + 슬래시 커맨드 재등록까지 자동 실행

배포 job은 GitHub `DISCORD_BOT` Environment의 시크릿 사용: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`.

---

## 한계

- 등록 채널/운동 인증 채널 메시지를 지우면 그 기록도 사라짐 (DB 대신 채팅을 저장소로 씀)
- `x/y` 숫자는 사용자 입력을 그대로 신뢰함
- `지난주`는 한 주 전만 지원
- 메시지가 수천 건 이상 쌓이면 전체 재스캔 방식이 비효율적일 수 있음
