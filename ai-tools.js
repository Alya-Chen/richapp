// ============================================================
// ai-tools.js — AI 助手自訂工具白名單
//
// 每個工具都是白名單、範圍受限的 richapp 網域操作，刻意不使用 Pi SDK
// 預設的 bash/read/edit/write 工具（見 createAgentSession 呼叫端的
// `noTools: "builtin"`）。所有工具都透過 createTools(userId) 產生，
// userId 必須是伺服器端從 req.session 帶入的值——工具內部一律信任
// 這個閉包捕捉到的 userId，絕不接受呼叫端（LLM 或前端）傳入的 userId，
// 避免跨帳號存取。詳見 README「AI 助手整合」章節。
// ============================================================

import { Object as TObject, String as TString, Array as TArray, Number as TNumber, Optional as TOptional, Union as TUnion, Literal as TLiteral } from 'typebox';
import { STRATEGY_PRESETS } from './trading-strategy.js';
import { stockService } from './stock-service.js';
import { Investor, WeeklyInvestor } from './stock-investor.js';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT_DIR, 'data');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const READ_FILE_MAX_CHARS = 20000; // 避免大檔案（原始股價 CSV/JSON 可達 300K+）塞爆對話 context

function walkDataDir(dir, base) {
	let out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === '.DS_Store') continue;
		const full = path.join(dir, entry.name);
		const rel = base + '/' + entry.name;
		if (entry.isDirectory()) out.push(...walkDataDir(full, rel));
		else out.push({ path: rel, size: fs.statSync(full).size });
	}
	return out;
}

export function createTools(userId) {
	return [
		{
			name: 'listStrategies',
			label: '列出交易策略',
			description: '列出 richapp 所有可用的交易策略 preset（代號、說明、是否為週線）',
			parameters: TObject({}),
			async execute() {
				const summary = Object.entries(STRATEGY_PRESETS).map(([key, p]) => ({
					key, desc: p.desc, weekly: !!p.weekly
				}));
				return { content: [{ type: 'text', text: JSON.stringify(summary) }], details: summary };
			}
		},
		{
			name: 'runBacktest',
			label: '執行回測',
			description: '對指定股票代號用指定策略跑訊號層級回測（近一年、不含資金管理模擬），回傳勝率/盈虧比/總損益',
			parameters: TObject({
				code: TString({ description: '股票代號，例如 2330' }),
				strategy: TString({ description: '策略代號，必須是 listStrategies 回傳的 key 之一，例如 adx' })
			}),
			async execute(toolCallId, params) {
				const preset = STRATEGY_PRESETS[params.strategy];
				if (!preset) {
					return { content: [{ type: 'text', text: `找不到策略 ${params.strategy}，請先用 listStrategies 確認代號` }], details: null };
				}
				const backtestParams = Object.assign({}, preset.params, {
					entryStrategy: preset.entry,
					exitStrategy: [...preset.exit],
					weekly: preset.weekly || false,
					entryDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
					exitDate: new Date()
				});
				const r = await stockService.backtest(params.code, backtestParams, true);
				const trades = (r?.trades || []).filter(t => t.status === 'closed' && t.duration > 0);
				const wins = trades.filter(t => t.profit > 0);
				const result = {
					code: params.code,
					strategy: params.strategy,
					trades: trades.length,
					winRate: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0,
					totalProfit: +trades.reduce((s, t) => s + t.profit, 0).toFixed(1)
				};
				return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
			}
		},
		{
			name: 'getStockDailies',
			label: '查詢日線行情',
			description: '查詢指定股票最近 20 個交易日的日線收盤價',
			parameters: TObject({
				code: TString({ description: '股票代號' })
			}),
			async execute(toolCallId, params) {
				const startDate = new Date();
				startDate.setDate(startDate.getDate() - 60); // 抓 60 天原始資料，確保能湊出 20 個交易日
				const data = await stockService.dailies(params.code, startDate);
				const recent = data.slice(-20).map(d => ({ date: new Date(d.date).toISOString().slice(0, 10), close: d.close }));
				return { content: [{ type: 'text', text: JSON.stringify(recent) }], details: recent };
			}
		},
		{
			name: 'getStockWeeklies',
			label: '查詢週線行情',
			description: '查詢指定股票最近 20 週的週線收盤價',
			parameters: TObject({
				code: TString({ description: '股票代號' })
			}),
			async execute(toolCallId, params) {
				const startDate = new Date();
				startDate.setDate(startDate.getDate() - 20 * 7 * 2); // 抓約40週原始資料，確保能湊出 20 週
				const data = await stockService.weeklies(params.code, startDate);
				const recent = data.slice(-20).map(d => ({ date: new Date(d.date).toISOString().slice(0, 10), close: d.close }));
				return { content: [{ type: 'text', text: JSON.stringify(recent) }], details: recent };
			}
		},
		{
			name: 'runInvestorSimulation',
			label: '執行資金管理模擬回測',
			description: '對多檔股票用指定策略跑真實資金管理模擬（近一年、含手續費與證交稅、最多同時持有4檔各25%倉位），回傳勝率/盈虧比/期望值/稅金/稅後淨利/最大回撤。最多10檔股票，運算較慢請耐心等待',
			parameters: TObject({
				codes: TArray(TString(), { description: '股票代號陣列，最多10檔' }),
				strategy: TString({ description: '策略代號，必須是 listStrategies 回傳的 key 之一' }),
				money: TOptional(TNumber({ description: '本金，預設100萬' }))
			}),
			async execute(toolCallId, params) {
				const preset = STRATEGY_PRESETS[params.strategy];
				if (!preset) {
					return { content: [{ type: 'text', text: `找不到策略 ${params.strategy}，請先用 listStrategies 確認代號` }], details: null };
				}
				const codes = (params.codes || []).slice(0, 10);
				if (!codes.length) {
					return { content: [{ type: 'text', text: 'codes 不能為空' }], details: null };
				}
				const money = params.money || 1000000;
				const investParams = Object.assign({}, preset.params, {
					entryStrategy: preset.entry,
					exitStrategy: [...preset.exit],
					weekly: preset.weekly || false,
					entryDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
					exitDate: new Date()
				});
				const InvestorClass = preset.weekly ? WeeklyInvestor : Investor;
				const inv = new InvestorClass(codes, money, investParams);
				const result = await inv.invest();
				const s = result.data.summary;
				const summary = {
					codes, strategy: params.strategy, money,
					已平倉: s.tradeCount, 未平倉: s.unclosed,
					勝率: +(s.winRate * 100).toFixed(1), 盈虧比: s.pnl, 期望值: s.expectation,
					稅金: Math.round(s.tax), 稅後淨利: Math.round(s.netProfit), 最大回撤: +(s.maxDrawdown * 100).toFixed(1)
				};
				return { content: [{ type: 'text', text: JSON.stringify(summary) }], details: summary };
			}
		},
		{
			name: 'compareStrategies',
			label: '批次比較策略',
			description: '跨多檔股票、多個策略做訊號層級批次比較（近一年、不含資金管理模擬），回傳每個策略聚合後的勝率/盈虧比/期望值/總損益，依期望值排序。最多20檔股票、5個策略',
			parameters: TObject({
				codes: TArray(TString(), { description: '股票代號陣列，最多20檔' }),
				strategies: TArray(TString(), { description: '策略代號陣列，必須是 listStrategies 回傳的 key，最多5個' })
			}),
			async execute(toolCallId, params) {
				const codes = (params.codes || []).slice(0, 20);
				const strategies = (params.strategies || []).slice(0, 5);
				if (!codes.length || !strategies.length) {
					return { content: [{ type: 'text', text: 'codes 和 strategies 都不能為空' }], details: null };
				}
				const results = [];
				for (const key of strategies) {
					const preset = STRATEGY_PRESETS[key];
					if (!preset) { results.push({ strategy: key, error: '找不到此策略' }); continue; }
					const backtestParams = Object.assign({}, preset.params, {
						entryStrategy: preset.entry,
						exitStrategy: [...preset.exit],
						weekly: preset.weekly || false,
						entryDate: new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
						exitDate: new Date()
					});
					let allTrades = [];
					for (const code of codes) {
						const r = await stockService.backtest(code, { ...backtestParams }, true); // 每檔股票都用獨立副本，避免 stockService.backtest 內部把 entryStrategy/exitStrategy 從字串換成 class 後，下一檔股票拿到已經被改寫的參數
						const trades = (r?.trades || []).filter(t => t.status === 'closed' && t.duration > 0);
						allTrades.push(...trades);
					}
					const wins = allTrades.filter(t => t.profit > 0);
					const losses = allTrades.filter(t => t.profit < 0);
					const sumWins = wins.reduce((s, t) => s + t.profit, 0);
					const sumLossAbs = Math.abs(losses.reduce((s, t) => s + t.profit, 0)) || 1;
					const winRate = allTrades.length ? wins.length / allTrades.length : 0;
					const pnl = sumWins / sumLossAbs;
					const expectation = allTrades.length ? (pnl * winRate) - (1 - winRate) : 0;
					results.push({
						strategy: key,
						trades: allTrades.length,
						winRate: +(winRate * 100).toFixed(1),
						pnl: +pnl.toFixed(2),
						expectation: +expectation.toFixed(2),
						totalProfit: +allTrades.reduce((s, t) => s + t.profit, 0).toFixed(1)
					});
				}
				results.sort((a, b) => (b.expectation ?? -999) - (a.expectation ?? -999));
				return { content: [{ type: 'text', text: JSON.stringify(results) }], details: results };
			}
		},
		{
			name: 'getUserSettings',
			label: '讀取使用者設定',
			description: '讀取目前這個使用者自己的策略參數設定',
			parameters: TObject({}),
			async execute() {
				const user = await stockService.getUser(userId);
				return { content: [{ type: 'text', text: JSON.stringify(user.settings || {}) }], details: user.settings || {} };
			}
		},
		{
			name: 'updateUserParams',
			label: '更新使用者策略參數',
			description: '更新目前這個使用者自己的策略參數，只會合併更新有傳入的欄位，不會覆蓋其他既有參數',
			parameters: TObject({}, { additionalProperties: true }),
			async execute(toolCallId, params) {
				const user = await stockService.getUser(userId);
				const settings = { ...(user.settings || {}), params: { ...(user.settings?.params || {}), ...params } };
				await stockService.saveUser({ id: userId, name: user.name, settings });
				return { content: [{ type: 'text', text: `已更新：${JSON.stringify(settings.params)}` }], details: settings.params };
			}
		},
		{
			name: 'listProjectFiles',
			label: '列出可查閱的說明文件與研究資料',
			description: '列出可透過 readProjectFile 讀取的檔案清單：README.md 以及 data/ 目錄下所有策略分析報告（.md）、回測明細（.csv/.meta）、原始股價（.json/.csv），附檔案大小（bytes）',
			parameters: TObject({}),
			async execute() {
				const files = [{ path: 'README.md', size: fs.statSync(README_PATH).size }, ...walkDataDir(DATA_DIR, 'data')];
				return { content: [{ type: 'text', text: JSON.stringify(files) }], details: files };
			}
		},
		{
			name: 'readProjectFile',
			label: '讀取說明文件或研究資料檔案',
			description: '讀取 README.md 或 data/ 目錄下的檔案內容。適合查策略分析報告（.md）全文，或抽查回測/股價原始檔（.csv/.json）的片段；股價或回測數據的正式查詢請優先用 getStockDailies/getStockWeeklies/runBacktest/runInvestorSimulation 等專用工具，這裡讀到的是原始檔案格式且大檔案只會回傳片段。先用 listProjectFiles 查有哪些檔案可讀',
			parameters: TObject({
				path: TString({ description: '檔案相對路徑，例如 README.md 或 data/bullbear.md' })
			}),
			async execute(toolCallId, params) {
				const resolved = path.resolve(ROOT_DIR, params.path || '');
				const isReadme = resolved === README_PATH;
				const isInData = resolved === DATA_DIR || resolved.startsWith(DATA_DIR + path.sep);
				if (!isReadme && !isInData) {
					return { content: [{ type: 'text', text: '只能讀取 README.md 或 data/ 目錄下的檔案' }], details: null };
				}
				if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
					return { content: [{ type: 'text', text: `找不到檔案 ${params.path}` }], details: null };
				}
				const raw = fs.readFileSync(resolved, 'utf8');
				let text = raw;
				const truncated = raw.length > READ_FILE_MAX_CHARS;
				if (truncated) {
					const headLen = Math.floor(READ_FILE_MAX_CHARS * 0.6);
					const tailLen = READ_FILE_MAX_CHARS - headLen;
					text = raw.slice(0, headLen) + `\n\n...(中間已省略，檔案總長度 ${raw.length} 字元，只顯示開頭與結尾)...\n\n` + raw.slice(-tailLen);
				}
				return { content: [{ type: 'text', text }], details: { path: params.path, length: raw.length, truncated } };
			}
		},
		{
			name: 'saveStockTrade',
			label: '新增或修改交易紀錄',
			description: '新增一筆買入/賣出交易紀錄，或（帶 id 時）修改既有的一筆。新增時 code/act/date/price/amount 都必填；修改時只需帶 id 加上要改的欄位，其他欄位維持原值。act 只能是「買入」或「賣出」，date 格式 YYYY-MM-DD，price 是成交價，amount 是成交股數。手續費/證交稅（tax）由系統依 act 自動計算，不用自己填',
			parameters: TObject({
				id: TOptional(TNumber({ description: '交易紀錄 id；有給值代表修改既有紀錄，不給則新增一筆' })),
				code: TOptional(TString({ description: '股票代號（新增時必填）' })),
				act: TOptional(TUnion([TLiteral('買入'), TLiteral('賣出')], { description: '買入或賣出（新增時必填）' })),
				date: TOptional(TString({ description: '交易日期，格式 YYYY-MM-DD（新增時必填）' })),
				price: TOptional(TNumber({ description: '成交價（新增時必填）' })),
				amount: TOptional(TNumber({ description: '成交股數（新增時必填）' })),
				ma: TOptional(TNumber({ description: '此筆交易對應的均線天數，非必填' }))
			}),
			async execute(toolCallId, params) {
				let trade;
				if (params.id != null) {
					const existing = await stockService.getTradeById(params.id);
					if (!existing) {
						return { content: [{ type: 'text', text: `找不到交易紀錄 id=${params.id}` }], details: null };
					}
					if (existing.userId !== userId) {
						return { content: [{ type: 'text', text: '沒有權限修改這筆交易紀錄' }], details: null };
					}
					trade = Object.assign({}, existing, { id: params.id, userId });
					['code', 'act', 'date', 'price', 'amount', 'ma'].forEach(k => {
						if (params[k] !== undefined) trade[k] = params[k];
					});
				} else {
					if (!params.code || !params.act || !params.date || params.price == null || params.amount == null) {
						return { content: [{ type: 'text', text: '新增交易紀錄需要 code、act、date、price、amount 都填寫' }], details: null };
					}
					trade = { userId, code: params.code, act: params.act, date: params.date, price: params.price, amount: params.amount, ma: params.ma };
				}
				const saved = await stockService.saveTrade(trade);
				const result = saved.toJSON();
				return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
			}
		}
	];
}
