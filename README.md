# RichApp — 金唬男股市波段投資工具

- 共同開發者：tinehen（廷嘉）, pinname（小宇）

## 目錄

- [專案簡介](#專案簡介)
- [快速開始](#快速開始)
- [技術架構](#技術架構)
- [資料庫 Schema](#資料庫-schema-sqlite)
- [週線資料基礎建設](#週線資料基礎建設)
- [牛熊訊號（bullscore）](#牛熊訊號bullscore)
- [CLI 工具（main.js）](#cli-工具-mainjs)
- [HTTP API（Express）](#http-api-express)
- [策略](#策略)
- [策略回測全面比較（2025/01/02 ~ 2026/06/22）](#策略回測全面比較-20250102--20260622)
- [AI 助手整合](#ai-助手整合)
- [工程規範](#工程規範)
- [開發流程](#開發流程)

## 專案簡介

基於 Node.js + SQLite 的股票波段投資輔助工具，支援台股與美股，提供技術指標分析、策略回測、即時報價等功能。

## 快速開始

```bash
# 安裝依賴
npm install

# 啟動 Web server（run.sh 會自動停止舊程序並重新啟動）
bash run.sh

# 瀏覽器開啟 http://localhost:5001
# 前端樣式變更後重新建置 Tailwind
npm run build          # 一次性建置
npm run dev            # 監聽模式

# CLI 工具（完整命令見「CLI 工具」章節）
node main.js backtest 2330 adx
```

## 技術架構

- **後端**：Node.js（ES Modules）、Express
- **資料庫**：SQLite + Sequelize ORM
- **前端**：HTML/JS、Tailwind CSS、DaisyUI、Highcharts
- **測試**：Node.js 內建測試執行器（`node --test`）
- **資料來源**：Yahoo Finance API（主要），TWSE/TPEX（台股備援），Finnhub/Stooq（美股備援）

## 資料庫 Schema（SQLite）

模型定義於 `stock-db.js`（Sequelize ORM），DB 檔案為 `./stock-sqlite.db`。啟動時以 `sequelize.sync({ force: false })` 自動建立表（不重置）。時間一律用 `DATE`/`DATEONLY`（`TZ=Asia/Taipei`），不使用 Sequelize 自動時間戳。

### Users — 使用者

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `name` | VARCHAR, UNIQUE | 用戶名稱 |
| `settings` | JSON | 偏好設定（含策略參數 `settings.params`、關注股 `stared`） |

### Stocks — 股票

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `code` | VARCHAR(10), UNIQUE | 股票代號 |
| `country` | STRING(10) | 國別（`tw`/`us`） |
| `name` | VARCHAR | 股票名稱 |
| `defaultMa` | INTEGER | 金唬男 MA 值（預設 16） |
| `tigerMa` | STRING(10) | 預設 MA 值 |
| `otc` | BOOLEAN | 是否上櫃 |
| `financial` | JSON | 財報資料（含 `bullscore` 牛熊訊號，見 [牛熊訊號](#牛熊訊號bullscore)） |
| `stared` / `trades` | TINYINT / JSON | ⚠️ 舊欄位（model 未定義，僅 DB 殘留） |

### StockDailies — 日線

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `code` | VARCHAR(10) | 股票代號 |
| `date` | DATE | 交易日期 |
| `open` / `high` / `low` / `close` | FLOAT | OHLC |
| `volume` | INTEGER | 成交量 |
| `diff` | FLOAT | 漲跌價差 |
| `transCount` | INTEGER | ⚠️ 舊欄位（model 未定義，僅 DB 殘留） |

- Unique index：`(code, date)`；另有 `code`、`date` 一般索引
- `saveAll()` 以 `bulkCreate({ updateOnDuplicate })` 更新 `open/high/low/close/volume/diff`

### StockWeeklies — 週線

結構同 StockDailies（無 `transCount`），Unique index `(code, date)`。`date` 為該週最後交易日，因股票而異（非固定週五）。詳細抓取流程見下方「[週線資料基礎建設](#週線資料基礎建設)」。

### StockTrades — 交易記錄

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `code` | VARCHAR(10) | 股票代號 |
| `userId` | INTEGER | 使用者流水號 |
| `shadow` | BOOLEAN | 是否影子使用者 |
| `act` | VARCHAR(5) | `買入` / `賣出` |
| `ma` | INTEGER | MA 值 |
| `date` | DATE | 交易日期 |
| `price` | FLOAT | 交易價 |
| `tax` | FLOAT | 手續費＋稅 |
| `amount` | INTEGER | 買賣股數 |
| `remain` | INTEGER | 剩餘股數 |

- 索引：`userId`、`code`、`date`
- `save()` 自動計算 `tax`：買入＝金額×0.1425%×0.6（最低 $20）；賣出＝金額×0.4425%

### Backtests — 回測結果

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `code` | VARCHAR(10) | 股票代號 |
| `userId` | INTEGER | 使用者流水號 |
| `name` | VARCHAR | 股票名稱 |
| `ma` | INTEGER | 測試的 MA 值（預設 16） |
| `params` | JSON | 測試參數 |
| `startDate` / `endDate` | DATE | 回測區間 |
| `profit` / `profitRate` | FLOAT | 利潤 / 利潤率 |
| `result` | JSON | 完整回測結果 |
| `opened` | BOOLEAN | 是否有執行中交易 |
| `lastModified` | DATE | 修改時間 |

- Unique index：`(code, userId)` — 同股同使用者只留一份

### Notes — 筆記

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `owner` | VARCHAR | 擁有者 |
| `title` | VARCHAR | 標題 |
| `content` | VARCHAR | 內容 |
| `date` | DATETIME | 建立時間 |

### Logs — 日誌

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | INTEGER PK | 自動流水號 |
| `level` | VARCHAR | `info` / `error` |
| `msg` | VARCHAR | 訊息 |
| `date` | DATETIME | 建立時間 |

## 週線資料基礎建設

支援 Yahoo Finance 週線資料的獨立抓取與儲存，與日線完全隔離。

### 資料表

- **`StockWeekly`**（`stock-db.js`）— 獨立 table，結構同 StockDaily，unique key `(code, date)`
  - `saveAll()` / `save()` / `query()` / `last()` 方法齊全

### 爬蟲

- **`YahooCrawler.fetchAll(p1, p2, interval)`**（`stock-crawler.js`）
  - 第三參數 `interval` 預設 `'1d'`，傳 `'1wk'` 抓週線
  - 非日線時不備援到 UsCrawler / TwCrawler（後者不支援週線）

### Service 層

- **`stockService.syncWeekly(code)`** — 掃描股票，以 `'1wk'` 抓取並存入 StockWeekly
- **`stockService.weeklies(code, startDate)`** — 讀取週線，無資料時自動回源抓取
- **`stockService.saveWeekly(weekly)`** — 委託 StockWeekly.save()

## 牛熊訊號（bullscore）

首頁「🐮 牛氣沖天」區塊的資料來源。由 `BullBear`（`static/js/macd-kdj.js:424`）計算，寫入 `Stocks.financial.bullscore`。

### 演算法（`BullBear.calculate()`）

以 MA20 / MA60 / MA120 均線輔助，輸出 `{ bullish, bearish, bullscore }`：

| 輸出 | 說明 |
|------|------|
| `bullish` / `bearish` | MA20 對 MA60/MA120 的多頭／空頭轉折日期清單 |
| `bullscore` | `[S1, S2, S3]`，每訊號 ±1（通過 = 1，未過 = -1） |

三個訊號（全部 AND）：

| 訊號 | 條件 | 意義 |
|------|------|------|
| S1 趨勢 | `MA20 > MA60` 且 `MA60 ≥ 5 日前 MA60` | 中期均線多頭排列、MA60 走平轉升 |
| S2 動能 | 當日收漲且收盤突破近 20 日高點（不含當日） | 動能突破 |
| S3 趨勢強度 | ADX(14) 末筆 `adx > 25` | 趨勢強度達標 |

評級：`[1,1,1]` 全牛、`[-1,-1,-1]` 全熊、其餘混合。

### 前端門檻

- `rich-app.js:678` — 牛氣沖天 tab 收錄「至少 2 牛」的股票（bullscore 含 ≥2 個 🐮），並排除已在關注／持有／今日／已實現清單者
- `rich-app.js:205-207` — 將 bullscore 數值陣列 map 成 emoji 字串（🐮=1、🐼=-1）供徽章顯示

## CLI 工具（`main.js`）

```bash
# 回測
node main.js backtest 2330 adx                    # 單股日線 ADX
node main.js backtest 2330 weeklyAdx             # 單股週線 ADX
node main.js backtest-all weeklyAdx              # 全部台股週線 ADX
node main.js -u 2 backtest-all weeklyAdx         # 使用者 2 的關注股票

# 資金管理模擬
node main.js invest 2330 adx                      # 日線 Investor
node main.js invest-weekly 2330 weeklyAdx         # 週線 WeeklyInvestor
node main.js invest-weekly 2330 weeklyMacdMix      # 混合策略走日線（無 --weekly）
node main.js -u 2 invest 2330                     # 使用使用者 2 的策略參數

# 同步資料
node main.js sync 2330                            # 單股日線
node main.js sync 2330 forced                     # 單股日線強制完整同步（從頭抓）
node main.js -u 1 sync all                        # 使用者 1 關注股全部同步
node main.js -u 1 sync all forced                 # 使用者 1 關注股強制完整同步
node main.js sync all                             # 全部台股同步（無 -u 時）
node main.js sync-weekly 2330                     # 單股週線
node main.js -u 1 sync-weekly all                 # 使用者 1 關注股週線同步
node main.js sync-weekly all                      # 全部台股週線同步

# 參數覆寫
node main.js backtest 2330 weeklyAdx drawdownRate=0.4

# 結果存於 data/ 目錄
ls data/
```

注意事項：

- `invest-weekly` 對混合策略 `weeklyMacdMix` **不會加 `--weekly`**：該策略為「日線資料 + 內部自壓週線 MACD」，直接以日線 Investor 執行，由 `MacdMixEntry`/`MacdMixExit` 在策略內部自壓週線。
- `backtest-all` 是**連續回測**（同方向交易合併），交易次數遠少於逐年重設的分析方式。例：MACD 週線 USER1，連續 16 筆 vs 逐年 242 筆（約 15 倍差）。比較數據時不可混用：總覽的總筆數若源自逐年分析，賺錢股數也須來自逐年。需逐年數據請執行：`node main.js -u 1 backtest-all <策略> entryDate=202X-01-02 exitDate=202X-12-31`

## HTTP API（Express）

Web server 監聽 `http://localhost:5001`，靜態檔由 `static/` 提供，API 回傳 JSON。使用者身份以 session 綁定（`GET /users/:userId` 切換）。

### 使用者與設定

| Method | Path | 說明 |
|--------|------|------|
| GET | `/users{/:userId}` | 使用者列表、目前使用者、總資金；同時切換 session 使用者 |
| GET | `/sys/params` | 目前使用者的策略參數 |
| POST | `/sys/params` | 儲存策略參數（忽略 `entryDate`/`exitDate`/`codes`） |
| GET | `/star/:code` | 切換關注股星號 |

### 股票與行情

| Method | Path | 說明 |
|--------|------|------|
| GET | `/stocks` | 全部股票 |
| GET | `/stock/:code{/:ma}` | 個股資料（含 `defaultMa`）；`Accept: application/json` 才回 JSON，否則回 index.html |
| GET | `/stock/add/:code/:name` | 新增股票 |
| POST | `/stock/:code/financial` | 合併更新財務資料 |
| GET | `/realtime{/:codes}` | 即時報價；`all` 回全部股票最後一筆，多檔以 `\|` 分隔 |
| GET | `/dailies/:code` | 個股日線 |
| GET | `/dailies/check` | 檢查日線資料完整性 |

### 交易與配息

| Method | Path | 說明 |
|--------|------|------|
| GET | `/trades` | 交易列表（依 userId + query 過濾，`shadow=true` 轉布林） |
| GET | `/dividends` | 有 `payDate` 的交易（配息） |
| POST | `/stock/:code/trade` | 新增/更新交易（`trade.userId` 固定 1）；`destroy: true` 時依 `id` 刪除 |
| POST | `/stock/:code/dividend` | 新增/更新/刪除配息（`amount` 為空即刪除） |

### 回測與模擬

| Method | Path | 說明 |
|--------|------|------|
| GET | `/backtest/opened` | 未平倉的回測任務 |
| GET | `/backtest/:code{/:ma}` | 回測結果；`all` 依每位使用者 params 全跑；有 `ma` 回該組、無 `ma` 回獲利最高組（查無則現跑） |
| GET | `/simulate{/:codes}` | `strategies` 回傳可用進/出場策略清單；其餘回 index.html |
| POST | `/simulate` | 執行資金模擬（`params.weekly` 或 Entry 名稱以 Weekly 開頭 → `WeeklyInvestor`，否則 `Investor`） |

### 同步與維護

| Method | Path | 說明 |
|--------|------|------|
| POST | `/sql` | 執行 SQL 指令（body: `{ commands }`） |
| GET | `/sync/:code{/:forced}` | 同步個股日線並回測；`all` 同步全部並全面回測 |
| GET | `/logs` | 日誌（固定回 20 筆；`req.params.limit` 未接線） |

### 筆記

| Method | Path | 說明 |
|--------|------|------|
| GET | `/notes/:owner` | 指定所有人的筆記 |
| POST | `/note` | 新增/更新筆記 |
| DELETE | `/note/:id` | 刪除筆記 |

## 策略

策略由進場（`*Entry`）／出場（`*Exit`）類別組成（定義於 `trading-strategy.js`），資金管理由 `Investor`／`WeeklyInvestor` 執行（`stock-investor.js`）。基底類別 `TigerInvest` 提供共用核心方法，新策略應繼承之。

### 週線趨勢（`WeeklyTrendEntry` / `WeeklyTrendExit`）

#### 進場條件（`WeeklyTrendEntry`）

全部 AND：

| 條件 | 說明 |
|------|------|
| MA 多頭排列 | MA5 > MA10 |
| MACD 週金叉 | 近 N 週內曾發生金叉（`params.goldenLookback`，預設 3 週） |
| 股價接近 MA5 | 正乖離率低於上限（`params.maxDeviation`，預設 10%） |
| 成交量 | 不低於前 5 週均量（只過濾極度萎縮） |
| 週波動率 | 近 10 週平均波動低於上限（`params.maxWeeklyVol`，預設 4%） |

#### 出場條件（`WeeklyTrendExit`）

依盈虧狀態分流：

| 狀態 | 出場方式 | 說明 |
|------|---------|------|
| **虧損/打平** | MA5 死叉 MA10（單週確認） | 快速停損，控制虧損 |
| **獲利中** | 移動停利 | 從持倉最高價回落 `trailingStopPct`（預設 10%） |
| **備用（不分盈虧）** | MACD 死叉 / DIF 拐頭 / 跌破 20MA | 緊急出場 |

#### 參數一覽

| 參數 | 所屬策略 | 預設值 | 說明 |
|------|---------|:------:|------|
| `goldenLookback` | Entry | 3 | MACD 金叉後 N 週內回踩 5MA 都算進場 |
| `maxDeviation` | Entry | 0.1 | 價格偏離 MA5 的正乖離率上限 |
| `maxWeeklyVol` | Entry | 0.04 | 近 10 週平均波動率上限（高波動股不進） |
| `trailingStopPct` | Exit | 0.1 | 獲利中從最高點回落多少比例出場 |

### WeeklyInvestor

`WeeklyInvestor` 繼承 `Investor`，專為週線策略設計。一次跑完回測後執行資金管理（每筆投入 25%），不需逐日 Loop。

```js
import { WeeklyInvestor } from './stock-investor.js';

const inv = new WeeklyInvestor(['2330'], 1000000, {
    entryStrategy: 'AdxEntry',
    exitStrategy: ['AdxExit'],
    adxRate: 0.05, drawdownRate: 0.3
});
const result = await inv.invest();
```

### MACD 混合週線（`weeklyMacdMix`）

日線資料 + 內部自壓週線 MACD（`MacdMixEntry`/`MacdMixExit`），只在完整週結束日檢查訊號，可搭配日線多頭濾網。

| 條件 | 說明 |
|------|------|
| 進場 | 週線 DIF/DEA 金叉，且日線 MACD 柱狀圖較前一日向上（動能增強中） |
| 出場 | 週線 DIF/DEA 死叉 |

- 執行 `invest-weekly 2330 weeklyMacdMix` 時**不會加 `--weekly`**，直接以日線資料執行（參閱 [CLI 注意事項](#cli-工具-mainjs)）

### 使用範例

```js
import { stockService } from './stock-service.js';

// 統一透過 stockService.backtest() 入口（不走 new TradingSystem()）
const result = await stockService.backtest('2330', {
    entryStrategy: 'WeeklyTrendEntry',
    exitStrategy: ['WeeklyTrendExit'],
    ma: 20, transient: true,
    entryDate: new Date('2020-01-01')
});
```

## 策略回測全面比較 (2025/01/02 ~ 2026/06/22)

32 檔 USER 1 關注股（台股 + 美股），使用 `main.js -u 1 backtest-all` 跑所有策略，同區間、同資料源。下表為 **2026-06-26 修復版**數據（MACD_CACHE 快取鍵、backtest-all 週線 flag、pnl 聚合計算三項修復後重跑）。

### 總覽排行（依期望值排序）

| 排名 | 策略 | 筆數 | 勝率 | 期望值 | 盈虧比 | 總損益 | 最大盈 | 最大虧 |
|:---:|:----|:---:|:----:|:------:|:-----:|:-----:|:-----:|:-----:|
| 1 | **MACD週線** | 47 | 63.4% | **5.4** | **9.15** | +6,928 | +1,835 | -148 |
| 2 | **布林通道週線** | 13 | **81.8%** | 4.8 | 6.03 | +610 | +263 | -83 |
| 3 | **MA交叉週線** | 80 | 57.9% | 3.5 | 6.85 | +7,777 | +1,593 | -31 |
| 4 | **週線趨勢** | 21 | 60.0% | 3.2 | 6.05 | +2,009 | +725 | -70 |
| 5 | **ADX+MACD週線** | 45 | 71.7% | 2.3 | 3.63 | +3,604 | +965 | -650 |
| 6 | **ADX日線** | 239 | 60.5% | 1.9 | 3.82 | +13,065 | +1,945 | -121 |
| 7 | **二日突破週線** | 172 | 49.1% | 1.3 | 3.74 | **+15,290** | **+3,106** | -73 |
| 8 | **ADX週線** | 35 | 72.9% | 1.3 | 2.19 | +1,959 | +965 | -650 |
| 9 | **ADX+MACD日線** | 287 | 52.1% | 1.0 | 2.78 | +11,853 | +1,785 | -73 |
| 10 | **MACD日線** | 289 | 49.1% | 0.9 | 2.90 | +14,079 | +2,275 | -25 |
| 11 | **MA交叉日線** | 366 | 41.7% | 0.7 | 2.99 | +12,654 | +2,580 | -362 |

註：`二日突破日線` 未列入 2026-06-26 修復版（未重跑）；日線組以 ADX / MACD 為代表。

### 日線→週線轉換效益

| 策略 | 筆數變化 | 勝率變化 | 期望值變化 | 總損益變化 |
|:----|:--------:|:--------:|:----------:|:----------:|
| ADX週線 | 239→35 (-85%) | 60%→73% (+12.4%) | 1.9→1.3 (-32%) | 13,065→1,959 (-85%) |
| MACD週線 | 289→47 (-84%) | 49%→63% (+14.3%) | 0.9→5.4 (+500%) | 14,079→6,928 (-51%) |
| MA交叉週線 | 366→80 (-78%) | 42%→58% (+16.2%) | 0.7→3.5 (+400%) | 12,654→7,777 (-39%) |
| ADX+MACD週線 | 287→45 (-84%) | 52%→72% (+19.6%) | 1.0→2.3 (+130%) | 11,853→3,604 (-70%) |

### 結論

**週線版的共同優勢**：交易次數減少 78~85%、勝率提升 12~20%。期望值則因策略而異——MACD / MA交叉 / ADX+MACD 大幅提升（130~500%），ADX 因訊號大幅收斂反而下降 32%。**總損益多數下降**（因筆數減少）；盈虧比才是真實的風險報酬指標。

**推薦策略（依使用場景）**：
- **最大總報酬**：二日突破週線（+15,290, 172筆）
- **最高勝率**：布林通道週線（81.8%勝率, 13筆）
- **高品質訊號**：MACD週線（期望值 5.4, 盈虧比 9.15, 47筆）
- **保守大波段**：週線趨勢（60%勝率, 盈虧比 6.05, 僅21筆）
- **日線組均衡**：ADX日線（60.5%勝率, 盈虧比 3.82, 239筆）

**不建議使用**：
- OBV+MACD（864筆、交易成本過高）- 已自策略組合移除
- 布林通道日線（勝率 39%）- 已自策略組合移除，保留週線版

**完整各策略說明、MA 參數穩健性測試與個股分析請見 [`data/完整策略比較-2026-06-22.md`](data/完整策略比較-2026-06-22.md)**；上表數據來源為修復版 [`data/完整策略比較-2026-06-26.md`](data/完整策略比較-2026-06-26.md)（含修復前後差異分析與各策略詳細數據）。

## AI 助手整合

左側「AI 對話」卡片（`static/index.html`＋`static/js/rich-app.js` 的 `$$.chat`）讓使用者用自然語言查詢策略、執行回測/資金管理模擬、查閱過往策略分析報告、調整自己的策略參數、新增或修改交易紀錄。停在 `/stock/:code` 頁面時，送出的訊息會自動帶入目前股票代號，不用自己在訊息裡打代號。

### 技術棧與版本注意事項

- **`@earendil-works/pi-coding-agent`**（純 ESM），需 Node `>=22.19.0`。`package.json` 尚未加 `engines` 欄位約束此需求。
- registry 的 dist-tags 同時有 `legacy-node20`（0.74.2）與 `latest`（0.85.1，目前鎖定版本）——兩者核心 `AgentSession` API 一致，但套件內建文件（`docs/sdk.md`）是隨 0.74.2 發的舊版寫法，跟實際安裝的 0.85.1 **有落差**：文件裡的 `AuthStorage`／`ModelRegistry.create(authStorage)` 在 0.85.1 已經不存在（沒有從套件 export），正確 API 是 `ModelRuntime` + `runtime.setRuntimeApiKey()`（見下方範例）。**之後升級這個套件版本時，務必以 `dist/*.d.ts` 型別定義為準，不要照抄套件內建文件。**
- 定位是「編碼代理」SDK，預設工具組含 bash／檔案操作／程式碼編輯，**不能直接沿用**，必須用 `noTools: "builtin"` 關掉並改用自訂工具（見「工具白名單」）。

### 已確認的範圍決策

| 項目 | 決策 |
|:----|:----|
| Investor 資金管理模擬 | 開放給 agent 自主呼叫（`runInvestorSimulation`），用參數上限（最多 10 檔股票）避免長時間運算卡住對話，不是完全禁止 |
| 寫入權限 | 開放——agent 可代使用者調整策略參數、新增/修改交易紀錄，但所有寫入工具內部一律用伺服器端 session 帶入的 `userId` 覆蓋，絕不信任 agent 或前端傳來的 userId |
| 回應風格 | 不強制 agent 主動附加樣本外驗證等警語／免責聲明，回答以使用者問題為主 |
| Pi SDK 內建 bash／檔案系統／程式碼執行工具（`read`/`bash`/`edit`/`write`，以及另一組 `grep`/`find`/`ls`） | **不開放**。這些工具是對整個專案目錄做無限制讀寫/搜尋（能讀到 `app.js` 的 session secret、`stock-sqlite.db` 原始檔案繞過所有 `userId` 隔離邏輯），風險遠大於 richapp 自己寫的白名單工具。日後如需要（例如轉為單人本機工具、或加上沙箱隔離）可重新評估，屆時應在本節記錄開放範圍與安全措施。與下面的 `readProjectFile` 不是同一件事——`readProjectFile` 是唯讀、白名單限定在 `README.md`／`data/` 的自訂工具 |

### 後端整合（`POST /ai/chat`）

```typescript
import { createAgentSession, ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// 每個使用者的請求都各自建一個 runtime，用 setRuntimeApiKey 動態帶入該使用者存在 DB 裡的金鑰（不落地到檔案）
const runtime = await ModelRuntime.create();
await runtime.setRuntimeApiKey(provider, apiKey);   // provider/apiKey 來自 user.settings.aiProviders
const modelRegistry = new ModelRegistry(runtime);
const model = modelRegistry.find(provider, modelId);

const { session } = await createAgentSession({
  model,
  modelRuntime: runtime,
  sessionManager: SessionManager.inMemory(),  // 對話持久化改走自己的 AssistantMessage 表，見下方
  noTools: "builtin",         // 只關閉內建 bash/read/edit/write，保留自訂工具；用 "all" 會連自訂工具也關掉，是常見誤區
  customTools: createTools(userId),
});

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // event.assistantMessageEvent.delta 是逐字增量文字，串流回前端見「前端整合」
  }
});

await session.prompt(userMessage);
```

- **事件序列**：`agent_start → turn_start → message_start → message_update(...) → message_end → turn_end → agent_end → agent_settled`。要顯示給使用者的是 `text_delta`；`thinking_delta` 是模型推理過程，要不要顯示是另一個 UI 決策。有呼叫工具時 `turn_end` 前會多出 `tool_execution_start`/`tool_execution_end`，正確欄位是 `toolName`／`args`（start）與 `result`／`isError`（end），直接在 event 物件上，不是巢狀在 `event.toolCall` 底下。
- **多輪對話**：模組層級的 `aiSessions = new Map()`（`sessionId → {session, userId, lastMessageId}`）讓同一個 `sessionId` 重複使用同一個 in-memory `AgentSession`；`sessionId` 不存在或不屬於當下 `userId` 時會建立新的，防止用猜測/偷來的 sessionId 接到別人的對話。
- **對話持久化**：不使用 SDK 內建的檔案式 session（`SessionManager.inMemory()` 不落地），改用自己的 `AssistantMessage` 表在 `session.subscribe()` 回呼裡寫入 SQLite——理由是跟著 richapp 現有的一切狀態走同一套資料庫，比另外維護一套獨立儲存系統更好管理、也更容易確保跨使用者隔離。每則訊息無論如何都會寫進 `AssistantMessage`（`parentId` 正確串接），即使記憶體內的 session 消失了歷史紀錄還在。
- **Provider／API Key**：存在 `User.settings.aiProviders`，不需要新開表：

```json
{
  "active": "deepseek",
  "providers": {
    "deepseek":  { "apiKey": "sk-...",     "models": ["deepseek-v4-flash", "deepseek-v4-pro"],                   "defaultModel": "deepseek-v4-flash" },
    "anthropic": { "apiKey": "sk-ant-...", "models": ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"], "defaultModel": "claude-sonnet-5" },
    "openai":    { "apiKey": "sk-...",     "models": ["gpt-5", "gpt-5-mini"],                                   "defaultModel": "gpt-5" },
    "gemini":    { "apiKey": "...",        "models": ["gemini-2.5-pro", "gemini-2.5-flash"],                    "defaultModel": "gemini-2.5-flash" }
  }
}
```

  **已知取捨**：API 金鑰以明文存在 `User.settings`（SQLite 檔案本身也未加密）。richapp 現有認證機制本來就是 session cookie 等級，非企業級安全模型，此規模另外做加密（還要解決「加密金鑰放哪」的新問題）不划算，先如此記錄為已知風險，之後有需要再加密。目前尚未做設定 UI，`aiProviders` 只能直接寫 DB 設定。

- **`./client`／`./rpc-entry`（Pi SDK 的其他匯出子路徑）用不到**：`./rpc-entry` 是把 agent 跑成獨立子行程、用 stdin/stdout 溝通，設計給非 Node 環境；Express 本身就是 Node 行程，直接 in-process 呼叫 `AgentSession` 即可。`./client` 只有 `"source"` 條件、沒有 `"import"`，是給有 TypeScript 建置流程的前端 bundler 用的，richapp 前端是純 `<script src>`、沒有建置流程，用不到。

### 前端整合

- **UI 位置**：沿用 `index.html` 左側欄（`w-1/5`）既有的「AI 對話」卡片，塞進 `indexCtrl`（`rich-app.js` 的 `$$.chat`），不是獨立 controller——這個卡片本身就在首頁，沒有跨頁保留對話狀態的需求。`chat.sessionId`／`chat.messages` 只存在瀏覽器記憶體，重新整理頁面即歸零（見「已知限制」）。對話捲動區高度 `min-h-[420px] max-h-[70vh]`，維持原本的欄寬不變。
- **內容渲染**：`ng-bind-html="chat.render(m.text)"`，`chat.render` 用 `marked` 轉 Markdown 再用 `DOMPurify.sanitize` 淨化——`$sceProvider.enabled(false)` 已關閉 AngularJS 的 SCE，`ng-bind-html` 不會自動過濾，這裡的淨化是必要的。
- **Streaming**：AngularJS 1.8.3 沒有原生 streaming 支援，採 `fetch()` + `response.body.getReader()`：使用者傳訊息一次 POST 完成，Express 端把 `session.subscribe()` 收到的 `text_delta` 逐段 `res.write()`；前端邊讀邊解碼累加到 `$scope`，因為讀取迴圈跑在 Angular digest 週期外，每次更新要包在 `$timeout(fn)` 才會重新渲染。比 SSE（只能 GET、不能帶 body）與 WebSocket（對單輪對話是過度設計）省事。
- **HELP 圖示**：卡片標題列的問號 icon（`chat.help()`），點下去自動送出「你目前可以回答哪些類型的問題？可以幫我做哪些事？」，不用自己想怎麼問。
- **CLEAR 圖示**：HELP 左邊的垃圾桶 icon（`chat.clear()`），清空 `chat.messages` 同時把 `chat.sessionId` 重設為 `null`——只清畫面不清 sessionId 的話，AI 仍會記得被清空前的內容，跟使用者預期不符。兩個按鈕都在串流中停用（`ng-disabled="chat.busy"`），避免中途清空後 `done` 事件把舊 sessionId 寫回來讓清空被復原。清空只影響前端顯示，`AssistantMessage` 歷史紀錄不受影響。
- **股票頁自動帶入代號**：`chat.send()` 送出前用 `$location.path()` 判斷是否在 `/stock/2330` 這類頁面，是的話自動把 `[目前正在查看股票 2330] ` 加在訊息前面才送給後端；聊天泡泡顯示的仍是使用者輸入的原始文字，只有實際送給後端的內容有加這段前綴。卡片內有一行小字提示目前會帶入的股票代號。

### 工具白名單（`ai-tools.js`，`createTools(userId)`）

自訂工具用 `typebox`（無 scope 的套件，不是 `@sinclair/typebox`，兩者版本與 API 不同）建構 `parameters` schema，回傳值包成 `{ content: [{type:"text", text:...}], details:... }`。所有工具的 `userId` 都來自 `createTools(userId)` 的閉包（伺服器端從 session 帶入），工具內部絕不信任 agent 或前端傳來的 userId，避免跨帳號存取。

| 工具 | 說明 |
|:----|:----|
| `listStrategies()` | 列出 `STRATEGY_PRESETS`（代號、說明、是否週線） |
| `runBacktest({code, strategy})` | 訊號層級回測（不含資金管理模擬），固定近一年期間 |
| `getStockDailies({code})` | 最近 20 個交易日收盤價（唯讀） |
| `getStockWeeklies({code})` | 最近 20 週收盤價（唯讀） |
| `runInvestorSimulation({codes, strategy, money?})` | 資金管理模擬回測，含手續費/證交稅；`codes` 最多 10 檔、`money` 預設 100 萬 |
| `compareStrategies({codes, strategies})` | 跨股票、跨策略批次比較，依期望值排序；`codes` 最多 20 檔、`strategies` 最多 5 個 |
| `getUserSettings()` | 讀取呼叫者自己的 `user.settings` |
| `updateUserParams(params)` | 合併更新呼叫者自己的 `user.settings.params`（不是整包覆蓋） |
| `listProjectFiles()` | 列出可讀檔案清單：`README.md` + `data/` 目錄下全部檔案（含 `data/stock/`），附相對路徑與 bytes 大小 |
| `readProjectFile({path})` | 讀取 `README.md` 或 `data/` 目錄下任一檔案內容 |
| `saveStockTrade({id?, code, act, date, price, amount, ma?})` | 新增或修改 `StockTrade`；帶 `id` 就是修改（只需帶要改的欄位），不帶就是新增（`code`/`act`/`date`/`price`/`amount` 必填）。目前只支援新增/修改，沒有刪除（未被要求） |

**跨股票/策略批次計算的既知陷阱**：`compareStrategies` 在迴圈裡對每檔股票呼叫 `stockService.backtest()` 時，一律用 `{...backtestParams}` 建立獨立副本——因為 `stockService.backtest()` 會把傳入的 `params.entryStrategy`/`exitStrategy` 從字串原地改寫成解析後的 class，共用同一個物件會讓後面的股票拿到已被前一檔股票改寫過的參數。

**檔案讀取工具的範圍與防護**（`listProjectFiles`／`readProjectFile`）：範圍限定 `README.md`＋`data/`（含原始股價 CSV/JSON），排除 `static/`（前端原始碼/第三方函式庫，不是對話內容，開放只會讓 agent 讀入大量無關檔案）。路徑檢查在**輸出端**做：用 `path.resolve(ROOT_DIR, params.path)` 算出最終絕對路徑後，檢查它是否等於 `README.md` 或落在 `data/` 底下（用 `path.sep` 邊界檢查，避免 `data-secret/` 這種同字首但非子目錄的路徑誤判為合法）——不管輸入字串長什麼樣，只看最終落點，包含輸入絕對路徑（`path.resolve` 對絕對路徑會忽略 base directory，是常見的路徑跳脫誤區）也一樣會被擋下。大檔案（超過 20,000 字元）取開頭 60%＋結尾 40%、中間標記省略（時間序列資料的最新內容通常在尾端）；工具說明也提醒 agent 股價/回測數據應優先用專用工具查，這裡只適合讀報告全文或抽查片段。

**交易紀錄寫入工具的設計細節**（`saveStockTrade`）：修改前一定先用 `stockService.getTradeById(id)` 撈出原始紀錄確認 `userId` 相符才放行；工具內部在呼叫 `saveTrade` 之前，會把 `existing` 全部欄位跟這次傳入的欄位合併成一個完整物件再送出——因為 `StockTrade.save()` 內部依 `act`/`amount`/`price` 是否同時有值才會正確重算 `tax`，若只帶 `{id, price}` 直接送出（部分合併更新），`act` 會是 `undefined`，稅金不會跟著新價格重算。**沿用既有行為**：`StockTrade.save()` 對「買入」紀錄一律把 `remain` 重設為 `amount`，若這筆買入之前已被部分賣出配對掉庫存，用 `saveStockTrade` 改動它會把 `remain` 重置回總股數——這是 `StockTrade.save()` 本身的既有行為（既有的 `/stock/:code/trade` 路由也一樣），不是這個工具引入的問題。

### 資料模型：`AssistantMessage`

延續 `stock-db.js` 既有的 `sequelize.define` + `timestamps:false` + 手動 `date` 欄位風格。用自我參照的 `parentId` 對應 Pi SDK 的分支/樹狀對話導覽，`sessionId` 對應 Pi SDK 的 session 識別碼：

```js
const AssistantMessage = sequelize.define('AssistantMessage', {
	id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
	userId: { type: DataTypes.INTEGER, allowNull: false, comment: '所屬使用者，伺服器端從 session 帶入，不可信任前端傳的值' },
	sessionId: { type: DataTypes.STRING, allowNull: false, comment: 'Pi SDK 對話 session 識別碼' },
	parentId: { type: DataTypes.INTEGER, allowNull: true, comment: '上一則訊息 id；null 為該 session 根訊息' },
	role: { type: DataTypes.STRING, allowNull: false, comment: 'user / assistant / tool' },
	content: { type: DataTypes.TEXT, allowNull: true },
	toolCalls: { type: DataTypes.JSON, allowNull: true },
	toolResult: { type: DataTypes.JSON, allowNull: true },
	date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { indexes: [{ fields: ['userId', 'sessionId'] }, { fields: ['parentId'] }], timestamps: false });
```

靜態方法：`AssistantMessage.save()`／`findBySession(userId, sessionId)`／`listSessions(userId)`；`stock-service.js` 有對應的薄封裝 `saveAssistantMessage`／`assistantThread`／`assistantSessions`（`assistantSessions`/`assistantThread` 目前前端還沒接上，見「已知限制」）。

### 已知限制（記錄但暫不處理）

- **前端沒有訊息數量上限，也不會載入歷史紀錄**：`chat.messages` 是純前端記憶體陣列，重新整理頁面就歸零（`chat.sessionId` 同樣消失），不會在頁面載入時去讀 `AssistantMessage` 補回歷史。之後若要做「回上次對話」才需要實作讀取歷史 + 訊息數量上限。
- **`aiSessions` 沒有回收機制**：長時間掛著服務、很多輪對話會一直累積在記憶體裡，之後有需要再加 LRU 或 TTL。
- **同一個 `userId` 換裝置不會自動共用對話**：`aiSessions` 用 `sessionId` 當 key、不是 `userId`，換裝置預設會拿到全新空白對話；除非前端刻意做「續舊對話」功能讓兩台裝置送出同一個 `sessionId`，但那也只保證**先後**使用安全，**同時**用兩台裝置對同一個 session 送訊息沒有防護（`lastMessageId` 是普通變數，可能有 race condition；`session.prompt()` 是否耐受並發呼叫也沒把握）。
- **`aiSessions` 只活在單一 Node process 記憶體裡**：現在一台機器一個 process 沒問題；之後若要水平擴展，A 機器建立的 session 換到 B 機器完全看不到，得整套換掉（例如 Redis，或放棄保留活的 `AgentSession`、每次從 `AssistantMessage` 表重建 context）。

### 尚待確認

- `npm audit` 回報 `node-tar` 有 critical 等級漏洞（隨 Pi 相依套件帶入，屬路徑穿越/符號連結類型）——richapp 自身不解壓縮任何檔案不會觸發，但如果之後用到 Pi 的「載入外部 skill/extension」功能要特別注意來源是否可信，並定期關注官方是否釋出修補版本

## 工程規範

### 資料庫（Sequelize / SQLite）

- **Upsert**：使用 Sequelize 內建的 `upsert` 或 `bulkCreate({ updateOnDuplicate })`，避免手動 `findOne` + `save` 造成競態條件
- **Sequelize v6 更新陷阱**（2026-08-24 修復）：
  - `Base.save()`（`stock-db.js`）必須以純物件 `entity.dataValues` 呼叫 `loaded.set()`，不可直接 `loaded.set(instance)`——instance 屬性**不可列舉**，`for...in` 拷不到任何值，`save()` 靜默 no-op 且不報錯
  - 避免原地突變 JSON 欄位（如 `Object.assign(instance.field, {...})`）——`setDataValue` 以 `_.isEqual` 偵測變化，同一物件參考會被判定「未變」而不持久化；應以 spread 建立新物件
- **交易**：多筆寫入或跨表操作需包在 transaction 中
- **資料型別**：
  - 長字串（備註、日誌）使用 `DataTypes.TEXT`
  - MA 值、計數使用 `DataTypes.INTEGER`
- **效能**：
  - 啟用 SQLite WAL 模式與 foreign key 支援
  - 使用 window function（如 `ROW_NUMBER() OVER(...)`）實作「取每組最新一筆」查詢
- **驗證**：在 Model 層加入欄位驗證與約束，避免髒資料入庫
- **時間處理**：避免使用 `toLocaleString()`，統一用 ISO 字串或標準 Date 物件

### 後端

- 使用 ES Modules（`import` / `export`）
- 爬蟲採分層設計：`YahooCrawler`（主要）→ `UsCrawler` / `TwCrawler`（備援自動降級）

### 前端

- 樣式使用 Tailwind CSS + DaisyUI，透過 `npm run build` 建置
- 圖表使用 Highcharts（`stock-chart.js`）
- 策略基底類別 `TigerInvest`，新策略應繼承此類別（如 `RsiInvest`、`AdxInvest`）
- 策略核心方法：`constructor(data, ma)` / `start(trade)` / `execute(day)` / `summary()` / `priceStatus(day)`
- 費用常數定義於 `tiger-invest.js`（`FEE_RATE`、`FEE_TAX_RATE`）
- 類別命名使用大寫駝峰（PascalCase），方法使用小寫駝峰（camelCase）
- 前端透過 `fetch` 與後端 `app.js`（Express）通訊

### 測試

- 使用 Node.js 內建測試執行器（`node:test`），執行 `npm test` 或 `node --test`
- 斷言使用 `node:assert/strict`，基本型別用 `assert.strictEqual`，物件/陣列用 `assert.deepStrictEqual`
- 測試檔案命名為 `*.test.js`，使用 ES Modules
- 測試原則：
  - **隔離性**：測試應獨立，不依賴全域狀態
  - **涵蓋率**：同時測試成功與失敗路徑
  - **實證驗證**：修 bug 前先寫測試重現問題
  - **效能**：避免緩慢測試（如即時抓取真實資料），改用快取或 mock

## 開發流程

### 環境設定

- 使用 `.env` 檔案管理設定（DB 路徑、日誌等級等）
- 預設 DB 路徑：`./stock-sqlite.db`

### 程式碼風格

- 遵循 ES Modules 規範
- 保持適度抽象與模組化；若 `stock-db.js` 過大，考慮拆分 model 至獨立檔案

### 提交前檢查

- 確保測試通過（`npm test`）
- 修改核心邏輯時須更新對應測試
