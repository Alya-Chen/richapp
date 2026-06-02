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
