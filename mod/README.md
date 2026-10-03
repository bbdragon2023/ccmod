# chatchat（Claude Code mod）

Claude 在工作時，可以玩小遊戲；Claude 做完或需要你授權時，遊戲會自動暫停並叫你回來。另外內建 statusline 和三套可切換的主題。

這個資料夾是 Phase 1（單人版）。跟朋友聊天和復古主機遊戲屬於之後的階段，見 `docs/plans/`。

## 需要什麼

- Claude Code 2.1.287 以上，在終端機裡使用（遊戲面板只支援終端機）
- 環境變數 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`：寫在 `~/.claude/settings.json` 的 `env` 裡，或在 `claude` 指令前面加上
- 終端機要能回報滑鼠點擊：**先點一下遊戲區**，鍵盤才會交給遊戲；按 `Esc` 把鍵盤交回提示框

## 試玩

```sh
claude --plugin-dir ./mod
```

## 指令

| 指令 | 作用 |
|---|---|
| `/chatchat` | 開遊戲面板（貪食蛇、合併方塊、踩地雷） |
| `/chatchat close` | 關掉面板 |
| `/chatchat theme [studio\|riso\|pocket]` | 查看或切換主題，預設是 Studio |
| `/chatchat statusline [auto\|full\|off]` | statusline 模式。`auto`：如果你已經有自己的 `statusLine`，只補上 chatchat 段 |
| `/chatchat statusline <段> on\|off` | 單獨開關一段：`dir bun branch model cost daily limit chatchat` |

## 運作方式

- Claude 開始一個回合約 5 秒後，提示框上方的橫條會問你要不要玩。這裡用按鈕、不用熱鍵，所以你在提示框打字不會誤觸。
- 回合結束時：遊戲凍結，跳出提示並播放該主題的提示音。按 `Enter` 關掉面板；按 `z` 再玩 30 秒，每個回合只能延一次。
- Claude 要你授權或問你問題時：遊戲凍結，而且不能再延。
- 最高分會保留到下次。

## statusline

段落和 `statusline-cost.sh` 一樣：
📁 資料夾、⚡ bun 版本、🌿 分支（有未提交改動時加 `*`）、🤖 模型、💸 本次花費、💰 今日累計、⏰ 5 小時額度剩餘時間。

mod 的狀態行只能放純文字，所以額度警告改用符號表示：用掉 70% 以上顯示 `⚠`，90% 以上顯示 `🔴`。花費只顯示在你自己的畫面上。

## 開發

```sh
claude plugin validate mod
claude plugin test mod
```
