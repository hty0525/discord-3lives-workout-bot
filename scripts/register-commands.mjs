import fs from "node:fs";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: ".dev.vars" });

const wrangler = JSON.parse(fs.readFileSync("wrangler.json", "utf8"));

const applicationId = wrangler?.vars?.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

const missing = [];

if (!applicationId || applicationId.startsWith("CHANGE_ME_")) {
  missing.push("wrangler.json > vars.DISCORD_APPLICATION_ID");
}
if (!guildId || guildId.startsWith("CHANGE_ME_")) {
  missing.push(".dev.vars > DISCORD_GUILD_ID");
}
if (!botToken || botToken.startsWith("CHANGE_ME_")) {
  missing.push(".dev.vars > DISCORD_BOT_TOKEN");
}

if (missing.length > 0) {
  console.error(`다음 설정이 필요합니다:\n- ${missing.join("\n- ")}`);
  process.exit(1);
}

const lifeChoices = [
  { name: "목1", value: 1 },
  { name: "목2", value: 2 },
  { name: "목3", value: 3 }
];

const targetChoices = [
  { name: "1회", value: 1 },
  { name: "2회", value: 2 },
  { name: "3회", value: 3 },
  { name: "4회", value: 4 },
  { name: "5회", value: 5 }
];

const commands = [
  {
    name: "집계",
    description: "운동 인증 현황을 Discord 채팅에서 집계합니다.",
    type: 1,
    options: [
      {
        type: 3,
        name: "대상",
        description: "이번주 또는 지난주",
        required: false,
        choices: [
          { name: "이번주", value: "current" },
          { name: "지난주", value: "previous" }
        ]
      }
    ]
  },
  {
    name: "등록",
    description: "본인을 등록합니다. 목표(분모)는 직접 고를 수 있고, 관리자는 다른 사용자와 시작 목숨도 지정할 수 있습니다.",
    type: 1,
    options: [
      {
        type: 6,
        name: "사용자",
        description: "관리자용: 등록할 사용자",
        required: false
      },
      {
        type: 4,
        name: "목숨",
        description: "관리자용: 시작 목숨",
        required: false,
        choices: lifeChoices
      },
      {
        type: 4,
        name: "목표",
        description: "본인의 주간 목표 횟수 (기본 3회)",
        required: false,
        choices: targetChoices
      }
    ]
  },
  {
    name: "일괄등록",
    description: "관리자용: 여러 사용자를 한 번에 등록합니다.",
    type: 1,
    options: [
      {
        type: 4,
        name: "목숨",
        description: "선택한 사용자들의 시작 목숨",
        required: true,
        choices: lifeChoices
      },
      {
        type: 4,
        name: "목표",
        description: "선택한 사용자들의 주간 목표 횟수 (기본 3회)",
        required: false,
        choices: targetChoices
      }
    ]
  },
  {
    name: "목숨조절",
    description: "관리자용: 등록된 사용자의 현재 목숨을 변경합니다.",
    type: 1,
    options: [
      {
        type: 4,
        name: "목숨",
        description: "변경할 목숨",
        required: true,
        choices: lifeChoices
      },
      {
        type: 6,
        name: "사용자",
        description: "한 명만 바로 변경할 때 선택. 비우면 여러 명 선택 가능",
        required: false
      }
    ]
  },
  {
    name: "목표조절",
    description: "관리자용: 등록된 사용자의 주간 목표(분모)를 변경합니다.",
    type: 1,
    options: [
      {
        type: 4,
        name: "목표",
        description: "변경할 목표 횟수",
        required: true,
        choices: targetChoices
      },
      {
        type: 6,
        name: "사용자",
        description: "한 명만 바로 변경할 때 선택. 비우면 여러 명 선택 가능",
        required: false
      }
    ]
  },
  {
    name: "탈퇴",
    description: "관리자용: 운동 참여자를 탈퇴 처리합니다.",
    type: 1,
    options: [
      {
        type: 6,
        name: "사용자",
        description: "탈퇴 처리할 사용자",
        required: true
      }
    ]
  },
  {
    name: "도움말",
    description: "봇 사용법과 규칙을 안내합니다.",
    type: 1,
    options: []
  }
];

const url =
  `https://discord.com/api/v10/applications/${applicationId}` +
  `/guilds/${guildId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(commands)
});

const text = await response.text();

if (!response.ok) {
  console.error(`명령 등록 실패: HTTP ${response.status}\n${text}`);
  process.exit(1);
}

console.log("등록 완료:");
console.log("- /집계 [대상: 이번주|지난주]");
console.log("- /등록 [목표: 1~5회]");
console.log("- /일괄등록 목숨:목1|목2|목3 [목표: 1~5회]");
console.log("- /목숨조절 목숨:목1|목2|목3 [사용자:@OO]");
console.log("- /목표조절 목표:1~5회 [사용자:@OO]");
console.log("- /탈퇴 사용자:@OO");
console.log("- /도움말");
