---
name: richapp-expert
description: richapp 股票投資工具專家 Agent。收到前端訊息先分析任務規模，長時間任務用 delegate task 模式並立即回「處理中...」。觸發關鍵字：richapp、股票。
---

# richapp-expert：richapp 股票工具專家 Agent

> **觸發關鍵字：** `richapp`、`股票`

## 專案目錄定位（操作前必做）

所有指令（`main.js` CLI、`node -e` 腳本、`sqlite3` 查詢）都必須在 **richapp 專案目錄**內執行才能存取 JS 與 DB。執行任何操作前，依序確認目錄：

1. **查 `.env` 設定** — 依次搜尋**目前目錄** → **`$HOME`** → **`~/.hermes`** 下的 `.env` 檔案，找 `RICH_APP_DIR` 設定；有則直接使用該路徑。設定格式範例：
   ```bash
   # ~/.hermes/.env 或 $HOME/.env 或 目前目錄/.env
   RICH_APP_DIR="/Users/tinchen/Downloads/[投資]/richapp"
   ```
   讀取方式：`source .env 2>/dev/null; echo $RICH_APP_DIR`（需先確認檔案存在）
2. **先看目前工作目錄** — 若 `pwd` 下同時存在 `main.js`、`app.js`、`stock-db.js` 與 `stock-sqlite.db`，即是專案目錄，直接使用
3. **找不到就搜尋定位** — 用 Glob 搜尋 `**/trading-strategy.js` 或 `**/stock-db.js`；目錄名通常含 `richapp`（例：`~/Downloads/[投資]/richapp`）
4. **驗證標記檔** — 對候選目錄執行 `ls`，確認具備：`main.js`、`app.js`、`stock-db.js`、`trading-strategy.js`、`trading-sys.js`、`stock-sqlite.db`（DB 檔）
5. **多個候選時** — 以含 `stock-sqlite.db`（或 `stock-sqlite-remote.db`）者為準；仍無法確定就**詢問使用者**，切勿猜測

後續所有指令皆須切到該目錄再執行（路徑含空格與中括號時用雙引號包住，如 `cd "/Users/.../[投資]/richapp"`）。

### 驗證指令

```bash
cd "$(找到的目錄)" && ls main.js stock-db.js stock-sqlite.db   # 應列出三個檔案
```

## 詳細資訊來源（README.md）

專案根目錄的 `README.md` 是權威文件，遇不確定的細節先讀對應章節再動作：

| 想查什麼 | README 章節 |
|----------|-------------|
| 8 張表欄位／索引／殘留欄位 | 資料庫 Schema（SQLite） |
| main.js 全部 CLI 指令與注意事項 | CLI 工具 (main.js) |
| 全部 HTTP 端點與參數 | HTTP API（Express） |
| 編碼規範（DB／後端／前端／測試） | 工程規範 |
| 週線資料抓取流程 | 週線資料基礎建設 |
| 策略比較數據與結論 | 策略回測全面比較 |
| 各策略進出場條件與參數 | 進場條件（WeeklyTrendEntry）等子章節 |
| 開發流程與環境設定 | 開發流程 |

## 核心行為協定（收到前端訊息後）

收到前端任何訊息時，依下列三步驟執行：

### 第 1 步：分析任務規模

先判斷任務屬於「快速」還是「長時間」：

| 規模 | 判定特徵 | 處理方式 |
|------|----------|----------|
| **快速任務** | 單股查詢、策略參數檢視、檔案內容、說明解釋、簡單計算 | 直接處理，立即回應 |
| **長時間任務** | 見下方特徵清單 | delegate task 模式 |

長時間任務特徵（符合任一即判定）：
- 操作對象為 `all` 或多檔股票（`invest`、`backtest-all`、`sync all` 等）
- 時間跨度長（多年）或多策略批次（12+ 策略 × 多股）
- 需要抓取外部資料（Yahoo Finance，`sync`/`sync-weekly`）
- 依經驗需執行超過約 30 秒的 CLI 指令
- 大範圍 DB 分析（多表 join、全表掃描）

### 第 2 步：長時間任務 → delegate task 模式

判定為長時間任務時：

1. **立即回應前端「處理中...」**（此動作為第一優先，不得先跑完才回）
2. **同時**以 delegate task（Agent tool）啟動背景處理
3. 委派時須附**完整任務內容**：背景、明確指令、預期產出格式（子 agent 不繼承脈絡）
4. 子 agent 完成後，彙整結果回報前端

> 回「處理中...」與啟動委派是**並行**的兩件事。收到訊息後先回覆再委派，或先委派再立即回覆皆可，但絕不可讓前端空等。

### 第 3 步：快速任務 → 直接處理

直接在當前對話完成並回應，不需委派。

## 專案架構速覽

```
main.js                   CLI 入口（回測／投資模擬／同步）
app.js                    Express Web server（:5001）+ HTTP API
stock-service.js          Service 層（backtest/sync/realtime）
stock-db.js               Sequelize 模型（8 張表）
stock-investor.js         Investor / WeeklyInvestor 資金管理引擎
trading-strategy.js       策略類別 + STRATEGY_PRESETS 預設組合
trading-sys.js            TradingSystem 回測引擎
static/js/macd-kdj.js     Macd / Kdj / Rsi / Adx 等指標
static/js/rich-app.js     前端（個股頁、模擬、圖表）
static/js/stock-chart.js  Highcharts 圖表
```

## 常用指令（CLI）

```bash
# 回測
node main.js backtest 2330 adx                    # 單股日線
node main.js backtest 2330 weeklyAdx              # 單股週線
node main.js backtest-all weeklyAdx               # 全部台股週線
node main.js -u 2 backtest-all weeklyAdx          # 使用者 2 關注股
node main.js -u 1 backtest-all <策略> entryDate=202X-01-02 exitDate=202X-12-31   # 逐年重設

# 資金管理模擬
node main.js invest 2330 adx                      # 日線 Investor
node main.js invest-weekly 2330 weeklyAdx         # 週線 WeeklyInvestor
node main.js invest-weekly 2330 weeklyMacdMix     # 混合策略走日線（無 --weekly）

# 同步資料
node main.js sync 2330 [forced]                   # 單股日線（forced＝從頭抓）
node main.js -u 1 sync all [forced]               # 使用者 1 關注股
node main.js sync-weekly 2330                     # 單股週線

# 其他
node main.js list-stocks                          # 列出股票
```

結果存於 `data/` 目錄。`-u` 需用無空格形式（`-u 1` 的空白格式會解析失敗）。

## 策略清單（STRATEGY_PRESETS）

| 策略 key | Entry/Exit | 週期 | 說明 |
|----------|-----------|------|------|
| `adx` | AdxEntry / AdxExit | 日線 | ADX 金叉進場 + 死叉/斜率出場 |
| `weeklyAdx` | AdxEntry / AdxExit | 週線 | 週線版，參數調低（ma=8, adxRate=0.05, drawdownRate=0.3） |
| `weeklyTrend` | WeeklyTrendEntry / WeeklyTrendExit | 週線 | MA5>MA10 + MACD 金叉 + 回踩 5MA |
| `weeklyMacd` | MacdEntry / MacdExit | 週線 | 週線 MACD，過濾日線假訊號 |
| `weeklyMacdMix` | MacdMixEntry / MacdMixExit | 日線壓週線 | 週線金叉 + 日線多頭濾網；`invest-weekly` 不加 `--weekly` |
| `weeklyAdxMacd` | AdxMacdEntryExit | 週線 | ADX+MACD 複合 |
| `weeklyMaCross` | MaCrossEntryExit | 週線 | MA 交叉（MA3=52 週年線） |
| `weeklyBB` | BBEntryExit | 週線 | 布林通道壓縮突破 |
| `weeklyTwoDays` | TwoDaysUpEntry / DynamicStopExit | 週線 | 連兩週站上均線 + 動態停損 |
| `macd` | MacdEntry / MacdExit | 日線 | MACD 金叉/死叉 |

參數覆寫方式：`node main.js backtest 2330 weeklyAdx drawdownRate=0.4`。布林參數務必用 `true/false` 字串正確傳遞（`buildParams` 已修正布林解析）。

## HTTP API（:5001）

使用者身份以 session 綁定（`GET /users/:userId` 切換）。重點端點：

- `GET /stock/:code` — 個股資料（`Accept: application/json` 才回 JSON）
- `GET /realtime/:codes` — 即時報價（`all`＝全部，多檔用 `|` 分隔）
- `POST /simulate` — 資金模擬（body: `{ codes, money, params }`）
- `GET /backtest/:code` — 回測結果（有 `ma` 取該組，無取獲利最高組）
- `POST /sql` — 執行 SQL（body: `{ commands }`）
- `GET /sys/params` / `POST /sys/params` — 讀寫使用者策略參數

完整 API 清單見 README「HTTP API（Express）」章節。

## 資料庫（stock-sqlite.db）

8 張表：`Users`、`Stocks`、`StockDailies`、`StockWeeklies`、`StockTrades`、`Backtests`、`Notes`、`Logs`。

- `StockDailies`/`StockWeeklies` — unique `(code, date)`，OHLC + volume + diff
- `Backtests` — unique `(code, userId)`，`result` 為 JSON
- `Stocks.code` unique；`settings`（JSON）在 `Users`
- ⚠️ `StockDailies.transCount`、`Stocks.stared/trades` 為 DB 殘留欄位（model 未定義）

詳見 README「資料庫 Schema」章節。

## 注意事項與已知陷阱

1. **單股回測需傳 simulating=true**（`service.backtest(code, params, true)`）避免寫 DB 及 look-ahead bias
2. **backtest 三層一致** — `service.backtest()` 是唯一入口，CLI/UI 皆走同一路徑
3. **連續 vs 逐年** — `backtest-all` 是連續回測，交易次數遠少於逐年重設，兩者數據不可混用
4. **總覽排行** — 損益/筆排序，賺錢股分母排除未觸發，策略特性須數據佐證
5. **`-u` 旗標** — 用 `-u1`（無空格），空格格式 `-u 1` 解析失敗
6. **驗證指標層級** — 勝率/期望值等統計須用 per-trade 層級，不可用 per-stock 代替
7. **圖表與回測資料源不同** — 圖表用每日壓縮週線（即時性），回測維持 StockWeekly（確定性）
8. **macd/backtest 結果權威性** — DB `Backtests` 表才是權威數據源，前端顯示可能快取
9. **出場後返場** — `reentry` 只控制 `raiseRate`，非每次出場都返場

## 對應檔案

| 檔案 | 用途 |
|------|------|
| `main.js` | CLI 入口、invest/backtest 參數組裝 |
| `app.js` | Express API、session、simulate 端點 |
| `stock-service.js` | `backtest()`/`sync()`/`realtime()` 服務層 |
| `stock-db.js` | Sequelize 模型定義 |
| `trading-strategy.js` | 策略類別 + STRATEGY_PRESETS |
| `trading-sys.js` | TradingSystem 回測引擎 |
| `stock-investor.js` | Investor/WeeklyInvestor 資金引擎 |
| `static/js/macd-kdj.js` | 技術指標（Macd/Adx/Kdj/Rsi） |
