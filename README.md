# RichApp — 金唬男股市波段投資工具

- 共同開發者：tinehen（廷嘉）, pinname（小宇）

## 專案簡介

基於 Node.js + SQLite 的股票波段投資輔助工具，支援台股與美股，提供技術指標分析、策略回測、即時報價等功能。

## 技術架構

- **後端**：Node.js（ES Modules）、Express
- **資料庫**：SQLite + Sequelize ORM
- **前端**：HTML/JS、Tailwind CSS、DaisyUI、Highcharts
- **測試**：Node.js 內建測試執行器（`node --test`）
- **資料來源**：Yahoo Finance API（主要），TWSE/TPEX（台股備援），Finnhub/Stooq（美股備援）

## 工程規範

### 資料庫（Sequelize / SQLite）

- **Upsert**：使用 Sequelize 內建的 `upsert` 或 `bulkCreate({ updateOnDuplicate })`，避免手動 `findOne` + `save` 造成競態條件
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

## 策略回測全面比較 (2025/01/02 ~ 2026/06/22)

32 檔 USER 1 關注股（台股 + 美股），使用 `main.js backtest-all` 跑所有策略，同區間、同資料源。

### 總覽排行（依期望值排序）

| 排名 | 策略 | 筆數 | 勝率 | 期望值 | 盈虧比 | 總損益 | 最大盈 | 最大虧 |
|:---:|:----|:---:|:----:|:------:|:-----:|:-----:|:-----:|:-----:|
| 1 | **MA交叉週線** | 80 | 53.8% | **97.2** | **5.94** | +7,777 | +1,275 | -340 |
| 2 | **週線趨勢** | 21 | 57.1% | 95.6 | 4.85 | +2,009 | +825 | -205 |
| 3 | **二日突破週線** | 165 | 50.3% | 85.0 | 3.51 | **+14,027** | **+3,185** | -860 |
| 4 | **ADX週線** | 74 | **73.0%** | 81.1 | 3.22 | +6,005 | +2,545 | -315 |
| 5 | **MACD週線** | 35 | 65.7% | 80.1 | 2.96 | +2,803 | +923 | -195 |
| 6 | **布林通道週線** | 16 | **75.0%** | 72.2 | **16.71** | +1,156 | +263 | -15 |
| 7 | **ADX+MACD週線** | 92 | 70.7% | 70.9 | 1.94 | +6,522 | +2,175 | -315 |
| 8 | **ADX日線** | 239 | 58.2% | 54.7 | 2.75 | +13,065 | +2,040 | -945 |
| 9 | **MACD日線** | 289 | 46.7% | 48.7 | 3.30 | +14,079 | +2,070 | -715 |
| 10 | **ADX+MACD日線** | 287 | 50.2% | 41.3 | 2.76 | +11,853 | +1,760 | -715 |
| 11 | **二日突破日線** | 395 | 49.1% | 40.7 | 2.57 | +16,058 | +1,775 | -485 |
| 12 | **MA交叉日線** | 366 | 41.0% | 34.6 | 4.31 | +12,654 | +1,680 | -535 |

### 結論

**週線版的共同優勢**：交易次數減少 60~90%、勝率提升 10~20%、期望值普遍高於日線版 50~200%。

**推薦策略（依使用場景）**：
- **最大總報酬**：二日突破週線（+14,027, 165筆）
- **最高勝率/低風險**：ADX週線（73%勝率, 3.22盈虧比）
- **保守大波段**：週線趨勢（57%勝率, 4.85盈虧比, 僅21筆）
- **高品質訊號**：MA交叉週線（期望值 97.2, 盈虧比 5.94, 80筆）
- **極低虧損**：布林通道週線（平均虧僅 6 點, 盈虧比 16.71）

**不建議使用**：
- OBV+MACD（864筆、期望值僅 13.3、每筆 +13 點，交易成本過高）- 已自策略組合移除
- 布林通道日線（期望值 8.2、勝率 39%）- 已自策略組合移除，保留週線版

**完整各策略說明、Preset 參數與個股分析請見 [`data/完整策略比.md`](data/完整策略比.md)。**

### 進場條件（`WeeklyTrendEntry`）

全部 AND：

| 條件 | 說明 |
|------|------|
| MA 多頭排列 | MA5 > MA10 |
| MACD 週金叉 | 近 N 週內曾發生金叉（`params.goldenLookback`，預設 3 週） |
| 股價接近 MA5 | 正乖離率低於上限（`params.maxDeviation`，預設 10%） |
| 成交量 | 不低於前 5 週均量（只過濾極度萎縮） |
| 週波動率 | 近 10 週平均波動低於上限（`params.maxWeeklyVol`，預設 4%） |

### 出場條件（`WeeklyTrendExit`）

依盈虧狀態分流：

| 狀態 | 出場方式 | 說明 |
|------|---------|------|
| **虧損/打平** | MA5 死叉 MA10（單週確認） | 快速停損，控制虧損 |
| **獲利中** | 移動停利 | 從持倉最高價回落 `trailingStopPct`（預設 10%） |
| **備用（不分盈虧）** | MACD 死叉 / DIF 拐頭 / 跌破 20MA | 緊急出場 |

### 參數一覽

| 參數 | 所屬策略 | 預設值 | 說明 |
|------|---------|:------:|------|
| `goldenLookback` | Entry | 3 | MACD 金叉後 N 週內回踩 5MA 都算進場 |
| `maxDeviation` | Entry | 0.1 | 價格偏離 MA5 的正乖離率上限 |
| `maxWeeklyVol` | Entry | 0.04 | 近 10 週平均波動率上限（高波動股不進） |
| `trailingStopPct` | Exit | 0.1 | 獲利中從最高點回落多少比例出場 |

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

## CLI 工具 (`main.js`)

```bash
# 回測
node main.js backtest 2330 adx                    # 單股日線 ADX
node main.js backtest 2330 weeklyAdx             # 單股週線 ADX
node main.js backtest-all weeklyAdx              # 全部台股週線 ADX
node main.js -u 2 backtest-all weeklyAdx         # 使用者 2 的關注股票

# 資金管理模擬
node main.js invest 2330 adx                      # 日線 Investor
node main.js invest-weekly 2330 weeklyAdx         # 週線 WeeklyInvestor
node main.js -u 2 invest 2330                     # 使用使用者 2 的策略參數

# 同步資料
node main.js sync 2330                            # 單股日線
node main.js sync-all weekly                      # 全部台股週線

# 參數覆寫
node main.js backtest 2330 weeklyAdx drawdownRate=0.4

# 結果存於 data/ 目錄
ls data/
```
