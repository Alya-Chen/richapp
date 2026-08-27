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
