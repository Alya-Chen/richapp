# richapp

- 共同開發者: tinehen（廷嘉）, pinname（小宇）

## Getting started

To make it easy for you to get started with GitLab, here's a list of recommended next steps.

Already a pro? Just edit this README.md and make it your own. Want to make it easy? [Use the template at the bottom](#editing-this-readme)!

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/topics/git/add_files/#add-files-to-a-git-repository) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin https://gitlab.com/jii.tw/richapp.git
git branch -M main
git push -uf origin main
```

## Integrate with your tools

- [ ] [Set up project integrations](https://gitlab.com/jii.tw/richapp/-/settings/integrations)

## Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Set auto-merge](https://docs.gitlab.com/user/project/merge_requests/auto_merge/)

## Test and Deploy

Use the built-in continuous integration in GitLab.

- [ ] [Get started with GitLab CI/CD](https://docs.gitlab.com/ee/ci/quick_start/)
- [ ] [Analyze your code for known vulnerabilities with Static Application Security Testing (SAST)](https://docs.gitlab.com/ee/user/application_security/sast/)
- [ ] [Deploy to Kubernetes, Amazon EC2, or Amazon ECS using Auto Deploy](https://docs.gitlab.com/ee/topics/autodevops/requirements.html)
- [ ] [Use pull-based deployments for improved Kubernetes management](https://docs.gitlab.com/ee/user/clusters/agent/)
- [ ] [Set up protected environments](https://docs.gitlab.com/ee/ci/environments/protected_environments.html)

***

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thanks to [makeareadme.com](https://www.makeareadme.com/) for this template.

## Suggestions for a good README

Every project is different, so consider which of these sections apply to yours. The sections used in the template are suggestions for most open source projects. Also keep in mind that while a README can be too long and detailed, too long is better than too short. If you think your README is too long, consider utilizing another form of documentation rather than cutting out information.

## Name
Choose a self-explaining name for your project.

## Description
Let people know what your project can do specifically. Provide context and add a link to any reference visitors might be unfamiliar with. A list of Features or a Background subsection can also be added here. If there are alternatives to your project, this is a good place to list differentiating factors.

## Badges
On some READMEs, you may see small images that convey metadata, such as whether or not all the tests are passing for the project. You can use Shields to add some to your README. Many services also have instructions for adding a badge.

## Visuals
Depending on what you are making, it can be a good idea to include screenshots or even a video (you'll frequently see GIFs rather than actual videos). Tools like ttygif can help, but check out Asciinema for a more sophisticated method.

## Installation
Within a particular ecosystem, there may be a common way of installing things, such as using Yarn, NuGet, or Homebrew. However, consider the possibility that whoever is reading your README is a novice and would like more guidance. Listing specific steps helps remove ambiguity and gets people to using your project as quickly as possible. If it only runs in a specific context like a particular programming language version or operating system or has dependencies that have to be installed manually, also add a Requirements subsection.

## Usage
Use examples liberally, and show the expected output if you can. It's helpful to have inline the smallest example of usage that you can demonstrate, while providing links to more sophisticated examples if they are too long to reasonably include in the README.

## Support
Tell people where they can go to for help. It can be any combination of an issue tracker, a chat room, an email address, etc.

## Roadmap
If you have ideas for releases in the future, it is a good idea to list them in the README.

## Contributing
State if you are open to contributions and what your requirements are for accepting them.

For people who want to make changes to your project, it's helpful to have some documentation on how to get started. Perhaps there is a script that they should run or some environment variables that they need to set. Make these steps explicit. These instructions could also be useful to your future self.

You can also document commands to lint the code or run tests. These steps help to ensure high code quality and reduce the likelihood that the changes inadvertently break something. Having instructions for running tests is especially helpful if it requires external setup, such as starting a Selenium server for testing in a browser.

## Authors and acknowledgment
Show your appreciation to those who have contributed to the project.

## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.

## stock-db.js
以下是我對 [stock-db.js](cci:7://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:0:0-0:0) 的重點代碼審查與改進建議。內容包含可立即採取的修正方向、可能的 bug、效能與資料建模建議，以及如何在 Sequelize/SQLite 環境中更穩健地處理 upsert、索引與查詢。

# Findings

- [Base.save()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:341:0-355:2) 用 findOne + set + save 模擬 upsert，存在競態條件與多餘 I/O。
- 多處欄位型別/預設值/註解不一致，例如 `Stock.tigerMa`。
- [StockDaily.saveAll()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:318:0-339:2) 的 `conflictFields` 參數對 Sequelize 並非標準，且 SQLite 的 upsert 依賴唯一索引；目前用法恐怕未生效或未如預期。
- [Stock.findTrades()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:174:0-189:2) 回傳的是「陣列的陣列」且會原地 mutate `stock.trades`。
- `Log` 同時在 `msg` 與 `date` 欄位記錄時間，資訊重複且 `toLocaleString()` 受系統環境影響。
- `Note.content` 用 `STRING` 可能不夠（應考慮 `TEXT`）。
- [StockDaily.last()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:511:0-518:2) 取每檔股票最新一筆的實作可用 window function/子查詢更有效率。
- 沒有使用交易（transaction）包覆多筆寫入或跨表操作。
- 設定（DB 路徑、logging）寫死在程式，不利環境化。
- 沒有驗證（validation）與欄位層級 constraint，易出現髒資料。
- 沒有 Model 關聯（association），`StockDaily.code` 與 `Stock.code` 之間沒有外鍵或一致性機制。

# Recommended Changes

- 將通用 upsert 聚合到 Sequelize 內建的 `upsert` 或 `bulkCreate({ updateOnDuplicate })`，避免自製的 race condition 模式。
- 移除 [StockDaily.saveAll()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:318:0-339:2) 的 `conflictFields`，並確認唯一索引 `['code','date']` 存在。
- 修正欄位型別與預設值不一致問題，尤其是 `Stock.tigerMa`。
- 讓 [Stock.findTrades()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:174:0-189:2) 回傳扁平化結果且不修改來源資料，並在 SQL 層就過濾 null/空陣列。
- 統一時間處理方式，避免 `toLocaleString()`；`Log` 中用 ISO 時間，避免重複資訊。
- 使用 `TEXT` 儲存長字串內容（如 `Note.content`、`Log.msg`）。
- 優化 [StockDaily.last()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:511:0-518:2) 為單次 SQL 查詢（window function 或子查詢）。
- 將 DB 設定環境化（dotenv），並啟用 SQLite WAL 模式、pool 與 foreign_keys pragma。
- 在關鍵寫入流程加上 transaction，並針對 bulk 與跨表操作包覆。
- 增加欄位驗證與 enum/約束，避免不合理數值入庫。
- 若未來需要一致性，建立 `Stock` 與 `StockDaily` 關聯（或改用 `stockId` 作外鍵）。

# Potential Bugs

- `Stock.tigerMa` 型別定義為 `DataTypes.STRING(10)`，但 `defaultValue: 16` 並且註解寫成「預設 MA 值」。這應該是 `INTEGER`，或至少 `STRING` 預設應為 `'16'`。此外與 `defaultMa` 的註解看起來互相混淆。
- [StockDaily.saveAll()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:318:0-339:2) 的 `conflictFields` 不是 Sequelize v6 的正式參數；在 SQLite 中要靠表層級唯一索引 + `updateOnDuplicate` 才能 upsert。現在這段可能沒有如預期 upsert。
- [Stock.findTrades()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:174:0-189:2)：
  - 回傳值為 `stocks.map(stock => stock.trades)`，是「陣列的陣列」，多半不符合「取所有交易」的常態需求。
  - 直接對 `stock.trades` 的每個 trade 做 `forEach` mutate，可能污染原資料。應該透過 map 產生新陣列並加上 `code/name`。
- [StockDaily.save()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:341:0-355:2) 捕捉錯誤只印出 `error.message`，然後不 `throw`，呼叫端可能誤判已成功。

# Concrete Fix Suggestions

- 將 upsert 統一化：
```js
// 範例：用 upsert 取代 Base.save 找一筆再存
await Model.upsert(entity, { conflictFields: ['id'] }); // 注意：SQLite 只需確保 unique key 存在
```

- 修正 `Stock.tigerMa` 與 `defaultMa`：
```js
// 建議：統一為整數欄位
tigerMa: {
  type: DataTypes.INTEGER,
  allowNull: true,
  defaultValue: 16,
  comment: '預設 MA 值'
},
defaultMa: {
  type: DataTypes.INTEGER,
  allowNull: true,
  comment: '金唬男 MA 值'
}
```
若「國別 + 代碼」才唯一，則把 `Stock` 的唯一索引改為 `['country','code']`，避免不同國別相同代碼衝突。

- `Note.content` 與 `Log.msg` 改成 `TEXT`：
```js
content: { type: DataTypes.TEXT, allowNull: true, comment: '內容' }
msg: { type: DataTypes.TEXT, allowNull: false, comment: '訊息' }
```

- [StockDaily.saveAll()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:318:0-339:2) 正確 upsert：
```js
// 移除 conflictFields，確保上有 unique: ['code','date'] 的索引
await StockDaily.bulkCreate(records, {
  updateOnDuplicate: ['open', 'high', 'low', 'close', 'volume', 'diff']
});
```
確保 `indexes` 中有 `unique: true, fields: ['code','date']`（你已經有）。

- [StockDaily.save()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:341:0-355:2) 用 `upsert` 並回拋錯誤：
```js
try {
  await StockDaily.upsert(daily);
} catch (err) {
  console.error('保存 StockDaily 失敗:', err);
  throw err;
}
```

- [Stock.findTrades()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:174:0-189:2) 扁平化、不修改來源：
```js
const stocks = await Stock.findAll({
  where: { trades: { [Op.not]: null } },
  attributes: ['code','name','trades']
});
return stocks.flatMap(s => (s.trades || []).map(t => ({ ...t, code: s.code, name: s.name })));
```

- [StockDaily.last()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:511:0-518:2) 用單次 SQL（SQLite 3.25+ 有 window function）：
```js
// 取單一 code 最新
return await StockDaily.findOne({
  where: { code },
  order: [['date','DESC']]
});

// 取每檔股票各自最新一筆（raw + window function）
const rows = await sequelize.query(`
  SELECT code, date, open, high, low, close, volume, diff
  FROM (
    SELECT sd.*, ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
    FROM StockDailies sd
  ) t
  WHERE rn = 1
`, { type: Sequelize.QueryTypes.SELECT });
```
注意 SQLite 預設表名複數化（`StockDailies`）或你可 `freezeTableName: true` 為一致性。

- `Log` 時間標準化與內容去重：
```js
Log.info = async function(msg) {
  console.log(msg);
  return Base.save(Log, { level: 'info', msg }); // 由 date 欄位記錄時間即可
};
// 或使用 ISO：new Date().toISOString()
```

- 加上 DB 設定環境化與 SQLite 調優：
```js
// 使用 dotenv 載入
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: process.env.DB_PATH || './stock-sqlite.db',
  logging: process.env.DB_LOGGING === 'true',
  pool: { max: 5, min: 0, idle: 10000 }
});
// 啟用 WAL 與 FK
await sequelize.query('PRAGMA journal_mode = WAL;');
await sequelize.query('PRAGMA foreign_keys = ON;');
```

- 加上 transaction（舉例：批次寫入）：
```js
await sequelize.transaction(async (t) => {
  await StockDaily.bulkCreate(records, {
    updateOnDuplicate: ['open','high','low','close','volume','diff'],
    transaction: t
  });
  // 其他相關寫入...
});
```

- 欄位驗證與約束（避免髒資料）：
```js
price: {
  type: DataTypes.FLOAT,
  allowNull: false,
  validate: { min: 0 }
},
volume: {
  type: DataTypes.INTEGER,
  allowNull: false,
  validate: { min: 0 }
}
```
若對精度要求高，SQLite 難以用 DECIMAL，建議「價格*100 以整數存」或在應用層統一以整數計。

- 若未來需要一致性，可補關聯設計：
  - 在 `StockDaily` 加 `stockId` 外鍵指向 `Stock.id`（並保留 `code` 作冗餘索引亦可），或
  - 保持無關聯但在應用層強化一致性檢查。

# Structure & Maintainability

- 將 model 拆檔：`models/user.js`、`models/stock.js`、`models/stockDaily.js`、`models/log.js` 等，在 `db/index.js` 匯總與初始化，提升可讀性。
- 補 `README` 關於 DB 初始化、[initDb()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:520:0-533:1) 的用途與開發/生產模式差異（`sync({ alter: true })` 僅限本機）。
- 若規模擴大，導入 migration（例如 `sequelize-cli`）以版本化 schema 變更。

# Testing

- 增加針對 [StockDaily.saveAll()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:318:0-339:2)、[Stock.findTrades()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:174:0-189:2)、[StockDaily.last()](cci:1://file:///Users/tinchen/Downloads/%5B%E6%8A%95%E8%B3%87%5D/richapp/stock-db.js:511:0-518:2) 的單元測試，特別是：
  - 上下限日期、空資料、重複資料（upsert）與例外流程（拋錯）。
  - 批次寫入的 transaction 回滾行為。

# 總結

整體結構清楚、Model 命名與索引設計方向正確。主要需修正 upsert 的正確實作、修補幾個欄位型別/預設值不一致點、優化查詢（特別是最新一筆資料的查詢）、以及提升寫入的可靠性（transaction + validation）。如果你希望，我可以針對上述建議逐項提出具體的 patch 提案，或先從你最在意的一兩點開始調整。