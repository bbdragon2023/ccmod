# chatchat 使用說明書

**等 Claude 工作的時候，玩小遊戲、跟朋友聊天；Claude 一做完或需要你，它會叫你回來。**

chatchat 是 Claude Code 的 mod（外掛），裝在你自己的終端機裡。它會在右側開一個面板，裡面有「遊戲」和「聊天」兩個分頁；另外附一條內建的 statusline，以及三套可切換的外觀主題。

---

## 目錄

1. [它能做什麼](#它能做什麼)
2. [安裝](#安裝)
3. [第一次使用](#第一次使用)
4. [玩遊戲](#玩遊戲)
5. [跟朋友聊天](#跟朋友聊天)
6. [主題](#主題)
7. [statusline](#statusline)
8. [指令總表](#指令總表)
9. [隱私與安全](#隱私與安全)
10. [疑難排解](#疑難排解)
11. [目前的限制](#目前的限制)
12. [開發者](#開發者)

---

## 它能做什麼

| 功能 | 說明 |
|---|---|
| 小遊戲 | 貪食蛇、合併方塊（2048 玩法）、踩地雷。最高分會一直保留 |
| 自動暫停 | Claude 做完、要你授權、或問你問題時，遊戲立刻凍結，並跳出提示和提示音 |
| 聊天 | 用邀請碼跟朋友開聊天室，看得到彼此是不是也在等 Claude |
| 主題 | Studio（預設）、Riso、Pocket 三套外觀，每套各有自己的提示音 |
| statusline | 資料夾、分支、模型、花費、今日累計、5 小時額度，不需要自己寫腳本 |

---

## 安裝

### 需要準備

| 項目 | 用途 | 怎麼確認 |
|---|---|---|
| Claude Code 2.1.287 以上 | 執行 mod | `claude --version` |
| 打開 function hooks 開關 | 讓 Claude Code 載入 mod | 見下方步驟 1 |
| [Bun](https://bun.sh) | 只有**聊天**需要；不裝也能玩遊戲 | `bun --version` |
| 能點滑鼠的終端機 | 點一下遊戲區，鍵盤才會交給遊戲 | macOS Terminal、iTerm2、Ghostty、kitty、WezTerm 都可以 |

### 步驟

**1. 打開 function hooks 開關**

編輯 `~/.claude/settings.json`，在 `env` 裡加上這一行（沒有 `env` 就自己建一個）：

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

**2. 拿到 mod 資料夾**（二選一）

- 有 repo 權限：`git clone git@github.com:bbdragon2023/chatchat.git`，mod 就在裡面的 `mod/` 資料夾。
- 沒有權限：請朋友把 `mod/` 資料夾壓縮後傳給你，解壓縮到任何地方都可以。

**3. 啟動 Claude Code 並載入 mod**

```sh
claude --plugin-dir /你的路徑/chatchat/mod
```

看到提示框，輸入 `/chatchat` 能開出面板，就代表裝好了。

**（選用）聊天要用的 Bun**

```sh
curl -fsSL https://bun.sh/install | bash
```

---

## 第一次使用

1. 輸入 `/chatchat`，右側會出現 chatchat 面板。
2. **用滑鼠點一下面板裡的遊戲區**，鍵盤就交給遊戲了。
3. 用 ↑↓ 選遊戲，按 Enter 開始。
4. 想回去打字給 Claude，按 **Esc**。

> 終端機寬度至少 110 欄時，面板會貼在右側；比較窄時，面板會出現在提示框上方。

---

## 玩遊戲

### 什麼時候會跳出邀請

Claude 開始工作約 5 秒後，提示框上方會出現一條橫條：

```
◆ Claude 工作中 0:12   要玩一下嗎？   [ 玩一下 ]  [ 這次不用 ]
```

用滑鼠點「玩一下」就會打開面板。這裡刻意**不設快捷鍵**，所以你在提示框打字不會誤觸。

### 操作方式

| 遊戲 | 按鍵 |
|---|---|
| 選單 | ↑↓ 選擇 · Enter 開始 |
| 貪食蛇 | 方向鍵或 WASD 移動 · r 重來 |
| 合併方塊 | 方向鍵滑動 · r 重來 |
| 踩地雷 | 方向鍵移動游標 · Enter 或空白鍵翻開 · f 插旗 · r 重來 |
| 任何遊戲 | q 回選單 · Esc 回提示框 |

踩地雷的第一下一定不會踩到雷。踩地雷記錄的是「最快秒數」，另外兩款記錄「最高分」。

### Claude 做完時

遊戲會立刻凍結，同時跳出提示，並播放主題的提示音：

```
◉ Claude 做完了 · 1:48
Enter 回去看結果 · z 再玩 30 秒
```

- **Enter**：關掉面板，回去看 Claude 的結果。
- **z**：再玩 30 秒。每個回合只能延一次，下一個回合照樣會暫停。

### Claude 要你授權或問你問題時

遊戲會凍結，而且**不能延**。按 Esc 回到 Claude 的授權選單處理就好。這樣可以避免「玩到忘記按允許，Claude 卡在那裡好幾分鐘」。

---

## 跟朋友聊天

聊天需要一台電腦當「聊天伺服器」（relay）。通常由一個人開，其他人連進來。**每個人都需要 Claude Code、chatchat mod 和 Bun。**

### 開房的人

```text
/chatchat host                  ← 在你的電腦開聊天伺服器
/chatchat invite 週末 vibe       ← 開房，拿到要傳給朋友的那一行
```

`host` 會列出朋友可以連的位址，例如：

- `ws://192.168.x.x:8787`：同一個 Wi-Fi 或區網的朋友用這個。
- `ws://100.x.x.x:8787`：這是 Tailscale 位址，不在同一個網路的朋友用這個。

`invite` 會給你一行字，原封不動傳給朋友就好：

```text
/chatchat join BU8E-KBVV-GESY ws://192.168.x.x:8787
```

> 第一次有人連進來時，macOS 可能會問「是否允許 bun 接受連入連線」，請選「允許」。
> **你的 Claude Code 要保持開著**，聊天伺服器會跟著你的 session 一起關掉。

### 加入的人

把收到的那一行貼進 Claude Code 的提示框按 Enter，再輸入 `/chatchat chat` 打開聊天分頁。

### 聊天時

- 面板上方有「遊戲／聊天」兩個分頁按鈕，點「聊天」切過去。
- 最上面會顯示朋友現在在做什麼，例如「▲ 小美 · 等 Claude 中」。
- 在最下面的輸入框打字，按 Enter 送出。
- 面板關著的時候，新訊息**只會**讓提示框上方的橫條顯示「● 2 則未讀」，不跳面板、不發出聲音，點「打開聊天」就能看。
- statusline 也會顯示在線人數和未讀數。
- 下次打開 Claude Code，會自動回到上次的聊天室。

### 暱稱

預設用你 git 設定的名字（`git config user.name` 的第一個字）。要改的話：

```text
/chatchat nick 阿哲
```

### 離開聊天室

```text
/chatchat leave
```

邀請碼外流的話，離開後再 `invite` 一組新的就好，舊的碼就沒用了。

---

## 主題

```text
/chatchat theme            ← 查看目前用哪一套
/chatchat theme studio     ← 夜間工作室風（預設）：薰衣草色、便利貼、留言圖釘
/chatchat theme riso       ← 印刷小誌風：米色紙張配螢光粉，做完時出現大字 DONE!
/chatchat theme pocket     ← 掌機風：LCD 綠、像素對話框
```

三套主題只換外觀和提示音，按鍵和暫停規則完全一樣。你的選擇會被記住。

> 終端機的字型是你自己設定的，mod 沒辦法換字型，所以主題的變化在配色、符號和版面上。

---

## statusline

chatchat 會在提示框下方顯示一行狀態：

```text
📁 brand-site | 🌿 main* | 🤖 Opus 5.5 | 💸 $0.84 | 💰 $6.20/day | ⏰ 1h 12m left | ◆ Claude 0:42 · ▲2 在線
```

| 段 | 意思 | 段名稱 |
|---|---|---|
| 📁 | 目前資料夾 | `dir` |
| ⚡ | bun 版本（預設關閉） | `bun` |
| 🌿 | git 分支，有未提交的改動時加 `*` | `branch` |
| 🤖 | 模型 | `model` |
| 💸 | 這次 session 的花費 | `cost` |
| 💰 | 今天所有 session 加起來的花費 | `daily` |
| ⏰ | 5 小時額度還剩多久。用掉 70% 以上加 ⚠，90% 以上加 🔴 | `limit` |
| ◆ | chatchat：Claude 計時、在線人數、未讀數 | `chatchat` |

### 三種模式

```text
/chatchat statusline auto   ← 預設。你已經有自己的 statusLine 的話，只補上 ◆ chatchat 那段
/chatchat statusline full   ← 顯示全部
/chatchat statusline off    ← 關掉
```

### 單獨開關某一段

```text
/chatchat statusline bun on
/chatchat statusline cost off
```

> 這行只能放純文字，沒辦法上顏色，所以額度警告用 ⚠ 和 🔴 符號表示。

---

## 指令總表

| 指令 | 作用 |
|---|---|
| `/chatchat` | 打開面板（遊戲分頁） |
| `/chatchat chat` | 打開面板（聊天分頁） |
| `/chatchat close` | 關掉面板 |
| `/chatchat help` | 列出所有指令 |
| `/chatchat theme [studio\|riso\|pocket]` | 查看或切換主題 |
| `/chatchat statusline [auto\|full\|off]` | statusline 模式 |
| `/chatchat statusline <段> on\|off` | 單獨開關某一段 |
| `/chatchat host [port]` | 在這台電腦開聊天伺服器，預設 port 8787 |
| `/chatchat server <ws://…>` | 改用別人開的聊天伺服器 |
| `/chatchat invite [房名]` | 開聊天室，拿邀請碼 |
| `/chatchat join <邀請碼> [ws://…]` | 加入聊天室；不帶碼就重新連回上次的房間 |
| `/chatchat nick <暱稱>` | 改暱稱 |
| `/chatchat leave` | 離開聊天室 |

所有 `/chatchat` 指令都只在你自己的電腦上執行，**不會送給 Claude，也不會花任何 token**。

---

## 隱私與安全

- **聊天訊息不會進入 Claude 的上下文。** 朋友傳什麼都只顯示給你看，所以沒辦法透過聊天訊息叫你的 Claude 做事。
- 訊息裡的終端機控制字元會被清掉，連結只顯示成文字，不會自動打開。
- 朋友**看不到**你的專案、分支、花費或 Claude 在做什麼，只看得到粗略狀態：在線上，或等 Claude 中。
- statusline 只顯示在你自己的畫面上。
- 聊天伺服器只看得到邀請碼的雜湊值，看不到邀請碼本身。
- **限制：** 同一個網路裡，知道邀請碼又知道伺服器位址的人都能加入。聊天內容沒有端對端加密，只適合跟信任的朋友在私人網路（家裡、公司、Tailscale）上使用。
- 本機的控制通道（Unix socket）權限是 600，只有你自己的帳號能用。

---

## 疑難排解

| 狀況 | 原因與解法 |
|---|---|
| 按鍵沒反應，字都跑到提示框 | 先**用滑鼠點一下遊戲區**。按 Esc 之後要再點一次 |
| `/chatchat` 說「終端機太窄」 | 把視窗拉寬，面板會自己出現 |
| 輸入 `/chatchat` 沒有反應 | 確認 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 有設定，而且有用 `--plugin-dir` 載入 mod |
| 沒有提示音 | 提示音目前只支援 macOS |
| 聊天顯示「需要 Bun」 | 安裝 Bun（`curl -fsSL https://bun.sh/install \| bash`），再輸入 `/chatchat join` |
| 朋友連不上 | ① 確認朋友跟你在同一個網路，或用 Tailscale 位址 ② macOS 防火牆要允許 bun ③ 開房的人的 Claude Code 要開著 ④ 確認位址的 port 沒打錯 |
| 一直顯示「重新連線中」 | 聊天伺服器關掉了，或網路斷了。伺服器回來後會自己連上，也可以輸入 `/chatchat join` 立即重試 |
| 想清掉最高分或設定 | 刪掉 Claude Code 設定資料夾裡 chatchat 的 store 檔，或重新安裝 mod |

---

## 目前的限制

- 遊戲畫面只支援終端機（Claude Code 桌面版和 VS Code 版還不行）。
- 一定要用滑鼠點一下，遊戲才收得到按鍵，因為 mod API 沒有自動取得焦點的方法。
- 聊天的每個人都需要 Claude Code 加這個 mod。不用 Claude Code 的朋友還沒辦法加入，之後會評估做一個獨立的小程式。
- 勿擾（專注）模式、復古主機遊戲（WASM-4、Game Boy 自製遊戲）還在規劃中。

---

## 開發者

```sh
claude plugin validate mod     # 檢查 mod 結構
claude plugin test mod         # mod 的測試（遊戲、狀態機、statusline、聊天、面板）
cd mod/bridge && bun test      # 聊天伺服器與橋接程式的整合測試
```

| 路徑 | 內容 |
|---|---|
| `hooks/register.tsx` | 主程式：Claude 的事件、指令、面板、橫條、statusline、聊天連線 |
| `hooks/arcade/ArcadeClient.tsx` | 遊戲畫面，在終端機繪圖執行緒上跑 |
| `hooks/games/` | 三款遊戲的純邏輯 |
| `hooks/chat/` | 聊天狀態與畫面 |
| `hooks/theme/tokens.ts` | 三套主題 |
| `hooks/statusline/` | statusline 段落與每日花費帳本 |
| `bridge/` | 聊天伺服器（`relay-server.ts`）與橋接程式（`main.ts`），用 Bun 執行，零依賴 |
| `sounds/` | 提示音 |

設計與計畫文件在 repo 的 `docs/plans/`。
