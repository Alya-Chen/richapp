import * as st from './trading-strategy.js';
import {
	stockService
} from './stock-service.js';

const FEE_RATE = 0.001425 * 0.6; // 證券手續費，六折
const FEE_TAX_RATE = FEE_RATE + 0.003; // 證券手續費＋證券交易稅 0.001425 + 0.003

/**
 * Investor — 多股資金管理模擬器（日線專用）
 *
 * 逐日 Loop（`entryDate.addDays(1)`），每天跑一次回測檢查訊號，
 * 管理多筆各 25% 的部位，計算 MDD、稅務、收益率。
 *
 * 週線策略請使用 WeeklyInvestor（一次回測 + 逐筆分配）。
 */
class Investor {
	constructor(stockCodes, money, params) {
		this.stockCodes = stockCodes;
		this.money = money || (200 * 10000);
		params.transient = true;
		params.entryDate = params.entryDate || new Date(new Date().getFullYear() + '/01/01');
		params.exitDate = params.exitDate || new Date();
		this.params = params;
	}

	// 初始化投資狀態（共用作業基底）
	_state() {
		const entryDate = this.params.entryDate;
		const exitDate = this.params.exitDate;
		const maxEntryMoney = this.money / 4;
		return {
			entryDate, exitDate, maxEntryMoney,
			entryStrategy: st[this.params.entryStrategy]?.name || this.params.entryStrategy,
			exitStrategy: this.params.exitStrategy.map(s => st[s]?.name).filter(Boolean).join('＋'),
			invested: { balance: this.money, unclosed: 0, profit: 0, maxDrawdown: 0, maxEquity: this.money },
			trades: [],
			holdings: {}, // { [code]: { shares, entryPrice } } 獨立追蹤持倉，不受 backtest status 影響
			csv: [`代號	公司	MA	購入日期	購入價格	購入股數	剩餘本金	入場總權益	賣出日期	賣出價格	單筆收益	單筆稅金	累積收益	單筆收益率	單筆回撤率	期末本金	出場總權益	出場原因`],
			runningTests: [],
			data: {
				summary: { entryDate: new Date(entryDate), exitDate, initialMoney: this.money, maxEntryMoney, finalMoney: null, totalProfit: null, stockCount: this.stockCodes.length },
				events: [],
				byCode: {}
			}
		};
	}

	// 買入執行
	_executeEntry(test, trade, state) {
		if (!trade || state.invested.balance <= 0) return;
		const entryMoney = Math.min(state.invested.balance, state.maxEntryMoney);
		trade.amount = parseInt(entryMoney / trade.entryPrice);
		if (trade.amount <= 0) return;
		state.runningTests.push(test);
		state.invested.balance -= trade.amount * trade.entryPrice;
		trade.tax = Math.max(trade.amount * trade.entryPrice * FEE_RATE, 20).scale(2);
		// 入場總權益 = 現金 + 新部位市價 + 既有持倉市值
		const entryTotalEquity = this._calcTotalEquity(state) + trade.amount * trade.entryPrice;
		state.trades.push({ code: test.code, name: test.name, ma: test.ma, entryRemain: state.invested.balance, entryTotalEquity, ...trade });
		state.data.events.push({ type: 'buy', date: trade.entryDate, code: test.code, name: test.name, ma: test.ma, price: trade.entryPrice, amount: trade.amount, tax: trade.tax, remainMoney: state.invested.balance, reason: trade.entryReason });
		if (!state.data.byCode[test.code]) state.data.byCode[test.code] = { code: test.code, name: test.name, ma: test.ma, trades: [] };
		state.data.byCode[test.code].trades.push({ amount: trade.amount, status: trade.status, entryDate: trade.entryDate, entryPrice: trade.entryPrice, entryReason: trade.entryReason, exitDate: trade.exitDate, exitPrice: trade.exitPrice, exitReason: trade.exitReason, profit: (trade.amount * trade.profit).scale(), tax: trade.tax, reentry: trade.reentry || false });
		// holdings 獨立追蹤目前持有的股數（不受 trade.status 影響）
		state.holdings[test.code] = { shares: trade.amount, entryPrice: trade.entryPrice };
	}

	// 賣出執行
	_executeExit(trade, state) {
		if (!trade) return;
		state.invested.balance += trade.amount * trade.exitPrice;
		trade.profit = (trade.amount * trade.profit).scale();
		trade.tax += (trade.amount * trade.exitPrice * FEE_TAX_RATE).scale(2);
		state.invested.profit += trade.profit;
		const found = state.trades.find(t => t.code == trade.code && t.amount == trade.amount);
		if (found) found.status = 'done';
		const reason = trade.exitReason + (trade.reentry ? '（返場）' : '');
		// holdings 先移除已出場部位，避免 equity 重複計算（現金已入帳）
		delete state.holdings[trade.code];
		const exitTotalEquity = this._calcTotalEquity(state).scale();
		state.csv.push(`${trade.code}	${trade.name}	${trade.ma}	${trade.entryDate.toLocaleDateString()}	${trade.entryPrice.scale(2)}	${trade.amount}	${trade.entryRemain.scale()}	${trade.entryTotalEquity.scale()}	${trade.exitDate.toLocaleDateString()}	${trade.exitPrice.scale()}	${trade.profit.scale()}	${trade.tax.scale()}	${state.invested.profit.scale()}	${trade.profitRate.scale(2)}	${trade.drawdownRate?.scale(4) || 0}	${state.invested.balance.scale()}	${exitTotalEquity}	${reason}`);
		state.data.events.push({ type: 'sell', date: trade.exitDate, code: trade.code, name: trade.name, ma: trade.ma, price: trade.exitPrice, amount: trade.amount, profit: trade.profit, profitRate: trade.profitRate, tax: trade.tax, remainMoney: state.invested.balance, reason });
		state.runningTests = state.runningTests.filter(t => t.code != trade.code);
		// 基於總權益（現金 + 持倉市值）的 MDD
		const totalEquity = this._calcTotalEquity(state);
		state.invested.maxEquity = Math.max(totalEquity, state.invested.maxEquity);
		state.invested.maxDrawdown = Math.max(
			state.invested.maxDrawdown || 0,
			(state.invested.maxEquity - totalEquity) / state.invested.maxEquity
		);
	}

	// 計算當下總權益：現金 + 所有持倉市值（使用 _closeMap + holdings 獨立追蹤）
	_calcTotalEquity(state) {
		let equity = state.invested.balance;
		for (const [code, h] of Object.entries(state.holdings)) {
			if (h.shares > 0) {
				const close = state._closeMap?.[code] || h.entryPrice;
				equity += h.shares * close;
			}
		}
		return equity;
	}

	// 最終摘要與回傳
	_finalize(state) {
		state.data.summary = Object.assign(state.data.summary, this.calculateMetrics(state.trades));
		// 含未實現損益的總權益（backward compatible：無持倉時與原邏輯一致）
		const unrealizedProfit = state.invested.unrealizedProfit || 0;
		const openEquity = state.invested.openEquity || 0;
		const unclosed = state.invested.unclosed || 0;
		const totalEquity = state.invested.balance + openEquity;
		const totalProfit = state.invested.profit + unrealizedProfit;
		state.data.summary.finalMoney = totalEquity;
		state.data.summary.totalProfit = totalProfit;
		state.data.summary.unclosed = unclosed;
		state.data.summary.profitRate = (totalProfit / this.money).scale(2);
		state.data.summary.netProfitRate = (state.data.summary.netProfit / this.money).scale(2);
		state.data.summary.maxDrawdown = state.invested.maxDrawdown?.scale(2);
		state.csv.unshift(`${totalEquity.scale()}	${unclosed}	${totalProfit.scale()}	${state.data.summary.profitRate.scale(2)}	${state.data.summary.tax.scale()}	${state.data.summary.netProfit.scale()}	${state.data.summary.netProfitRate.scale(2)}	${state.data.summary.tradeCount}	${state.data.summary.winRate.scale(2)}	${state.data.summary.pnl}	${state.data.summary.expectation}	${state.data.summary.maxDrawdown.scale(2)}	${state.data.summary.reentry}	${state.data.summary.reentryWinRate.scale(2)}	${state.data.summary.reentryProfit.scale()}`);
		state.csv.unshift(`最後本金	未平倉	總獲利	總獲利率	總稅金	稅後淨利	淨利率	總交易次數	總勝率	盈虧比	期望值	最大回撤率	返場次數	返場勝率	返場獲利`);
		state.csv.unshift(`入場日期	${state.entryDate.toLocaleDateString()}	出場日期	${state.exitDate.toLocaleDateString()}	入場策略	${state.entryStrategy}	出場策略	${state.exitStrategy}`);
		return {
			csv: state.csv.join('\r\n'),
			data: state.data,
			money: totalEquity.scale(),
			profit: totalProfit.scale(),
			trades: state.trades
		};
	}

	/**
	 * 日線逐日模擬
	 *
	 * 從 entryDate 到 exitDate 每天 tick 一次：
	 *   1. 跑 getTests() 取得所有股票的訊號
	 *   2. 若 entryDate 符合某筆交易的 entryDate → 執行買入
	 *   3. 若 entryDate 符合某筆交易的 exitDate → 執行賣出
	 *
	 * dynamic=true 時每 tick 重新跑回測（慢但準確）；
	 * 否則僅第一次跑回測後快取。
	 */
	async invest() {
		const state = this._state();
		const entryDate = new Date(state.entryDate);
		const exitDate = state.exitDate;
		let tests = null;

		while (entryDate.getTime() < exitDate.getTime()) {
			const codes = this.stockCodes.filter(code => !state.runningTests.map(t => t.code).includes(code));
			tests = this.params.dynamic ? state.runningTests.concat(await this.getTests(codes, entryDate)) : (tests || await this.getTests(codes, entryDate));
			// 建立當日收盤價對照表，供 _calcTotalEquity 計算持倉市值
			state._closeMap = {};
			for (const t of tests) {
				const price = t.prices?.find(p => +p.date === +entryDate);
				if (price) state._closeMap[t.code] = price.close;
			}
			for (let i = 0; i < tests.length; i++) {
				const test = tests[i];
				test.trades = test.trades || test.result.trades;
				const entryTrade = test.trades.find(t => entryDate.isSameDay(t.entryDate));
				this._executeEntry(test, entryTrade, state);
				const exitTrade = state.trades.find(t => t.code == test.code && t.status == 'closed' && entryDate.isSameDay(t.exitDate));
				this._executeExit(exitTrade, state);
			}
			entryDate.addDays(1);
		}
		// 處理持倉中交易：CSV 明細 + 未實現損益
		const openTrades = state.trades.filter(t => t.status === 'open' && t.amount > 0);
		if (openTrades.length > 0 && tests) {
			const testByCode = Object.fromEntries((tests || []).map(t => [t.code, t]));
			let unrealizedTotal = 0, openEquity = 0;
			for (const openTrade of openTrades) {
				const test = testByCode[openTrade.code];
				const close = test?.close;
				if (!close) continue;
				const unrealized = ((close - openTrade.entryPrice) * openTrade.amount).scale();
				unrealizedTotal += ((close - openTrade.entryPrice) * openTrade.amount);
				openEquity += openTrade.amount * close;
				const entryTotalEquity = openTrade.entryTotalEquity || (openTrade.entryRemain + openTrade.amount * openTrade.entryPrice);
				state.csv.push(`${openTrade.code}	${openTrade.name}	${openTrade.ma}	${openTrade.entryDate.toLocaleDateString()}	${openTrade.entryPrice.scale(2)}	${openTrade.amount}	${openTrade.entryRemain.scale()}	${entryTotalEquity.scale()}	持倉中	-	${unrealized}	0	-	-	-	-	-	${openTrade.entryReason}（持倉中）`);
				state.data.events.push({ type: 'hold', date: exitDate, code: openTrade.code, name: openTrade.name, ma: openTrade.ma, price: openTrade.entryPrice, amount: openTrade.amount, unrealizedProfit: unrealized, lastClose: close, reason: openTrade.entryReason });
			}
			state.invested.unclosed = (state.invested.unclosed || 0) + openTrades.length;
			state.invested.unrealizedProfit = (state.invested.unrealizedProfit || 0) + unrealizedTotal;
			state.invested.openEquity = (state.invested.openEquity || 0) + openEquity;
		}
		return this._finalize(state);
	}

	/**
	 * 計算交易統計指標：勝率、盈虧比、期望值、返場統計
	 */
	calculateMetrics(trades) {
		const closed = trades.filter(t => t.status !== 'open');
		const wins = closed.filter(t => t.profit > 0);
		const reentry = closed.filter(t => t.reentry);
		const reentryWins = closed.filter(t => (t.reentry && t.profit > 0));
		const reentryProfit = closed.reduce((sum, t) => sum + (t.reentry ? t.profit : 0), 0);
		const profit = closed.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0), 0);
		const totalLoss = closed.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0), 0);
		const tax = closed.reduce((sum, t) => sum + t.tax, 0);
		const pnl = profit / Math.abs(totalLoss || 1);
		const winRate = wins.length / (closed.length || 1);
		const expectation = (pnl * winRate) - (1 - winRate);
		return {
			tradeCount: closed.length,
			totalLoss: totalLoss.scale(),
			tax,
			netProfit: (profit + totalLoss - tax).scale(),
			winRate: winRate.scale(),
			reentry: reentry.length,
			reentryWins: reentryWins.length,
			reentryWinRate: (reentryWins.length / (reentry.length || 1)).scale(),
			reentryProfit: reentryProfit.scale(),
			pnl: pnl.scale(),
			expectation: expectation.scale()
		};
	}

	/**
	 * 執行一次完整回測，回傳各股票最新的 test 結果。
	 *
	 * 日線模式：每次呼叫都會觸發 TradingSystem 回測，
	 * ADX/MACD 透過 Cache 類別避免重複計算。
	 */
	async getTests(codes, entryDate) {
		if (!codes.length) return [];
		const params = Object.assign({}, this.params, { entryDate });
		const tests = await stockService.backtest(codes, params, true);
		return Array.from(
			tests.reduce((map, test) => {
				const existing = map.get(test.code);
				if (!existing || new Date(test.endDate) > new Date(existing.endDate)) {
					map.set(test.code, test);
				}
				return map;
			}, new Map()).values()
		);
	}
}

/**
 * WeeklyInvestor — 週線資金管理模擬器
 *
 * 與 Investor 不同，週線策略不需要逐日 Loop。
 * 一次跑完整回測取得所有交易，再逐筆執行資金管理。
 *
 * 策略參數傳遞方式與 Investor 相同，僅需加 `weekly: true` 告知
 * backtest() 改讀 StockWeekly 資料源。
 */
class WeeklyInvestor extends Investor {
	/**
	 * 一次回測 → 逐筆資金分配
	 *
	 * 1. 呼叫 stockService.backtest() 取得所有交易
	 *    （傳遞 `params.weekly` 使 backtest 改用 weeklies()）
	 * 2. 過濾 duration > 0 的已結清交易
	 * 3. 對每筆交易依序：買入執行 → 賣出執行
	 *    （共用 Investor 的 _executeEntry / _executeExit）
	 * 4. 回傳結果
	 */
	async invest() {
		const state = this._state();
		const params = Object.assign({}, this.params, { weekly: true, entryDate: state.entryDate });
		const backtestResult = await stockService.backtest(
			this.stockCodes.length === 1 ? this.stockCodes[0] : this.stockCodes,
			params, true
		);

		// 多股回測回傳陣列
		const allResults = Array.isArray(backtestResult) ? backtestResult : [backtestResult];

		// 收集所有進出場事件，依時間序處理
		const events = [];
		for (const result of allResults) {
			if (!result || !result.trades) continue;
			const resultCode = result.code || this.stockCodes[0];
			const name = result.name || '';
			const ma = result.ma || this.params.ma1 || '';
			const trades = result.trades.filter(t => t.duration > 0 || t.status === 'open');
			for (const trade of trades) {
				events.push({ date: new Date(trade.entryDate), type: 'entry', code: resultCode, name, ma, trade, result });
				if (trade.exitDate) {
					events.push({ date: new Date(trade.exitDate), type: 'exit', code: resultCode, trade });
				}
			}
		}
		// 同日期先出場再入場（出場資金可用於同日入場）
		events.sort((a, b) => a.date - b.date || (a.type === b.type ? 0 : a.type === 'exit' ? -1 : 1));

		// 為 _calcTotalEquity 建立收盤價對照表（供持倉市值計算）
		state._closeMap = {};
		const closeIndex = {}; // { code: { timestamp: close } } 依日期索引
		for (const result of allResults) {
			if (result && result.code && result.close != null) {
				state._closeMap[result.code] = result.close;
			}
			if (result && result.code && result.prices) {
				closeIndex[result.code] = {};
				for (const p of result.prices) {
					closeIndex[result.code][+p.date] = p.close;
				}
			}
		}

		for (const event of events) {
			// 更新 _closeMap：找 <= event.date 的最後一筆收盤價
			// （不同股票週線收盤日可能不同，如 Mon vs Wed，不能用精確 timestamp 比對）
			for (const code of Object.keys(state.holdings)) {
				if (closeIndex[code]) {
					const ts = +event.date;
					const prices = Object.entries(closeIndex[code]).map(([k, v]) => [+k, v]);
					const valid = prices.filter(([t]) => t <= ts).sort(([a], [b]) => b - a);
					if (valid.length > 0) state._closeMap[code] = valid[0][1];
				}
			}
			if (event.type === 'entry') {
				const test = { code: event.code, name: event.name, ma: event.ma };
				const trade = event.trade;
				trade.status = 'open';
				this._executeEntry(test, trade, state);
			} else if (event.type === 'exit') {
				const trade = event.trade;
				// 找出當時進場真正買到的 stored 紀錄（用 status='open'，不依賴 backtest 傳入的 amount）
				const stored = state.trades.find(t => t.code == event.code && t.status == 'open');
				if (stored) {
					stored.exitDate = trade.exitDate;
					stored.exitPrice = trade.exitPrice;
					stored.exitReason = trade.exitReason;
					// 設定 per-share profit（_executeExit 會再乘 amount）
					const priceDiff = stored.exitPrice - stored.entryPrice;
					stored.profit = priceDiff;
					stored.profitRate = priceDiff / stored.entryPrice;
					stored.status = 'closed';
					this._executeExit(stored, state);
				}
			}
		}

		// 處理各股持倉中交易：CSV 明細 + 未實現損益
		for (const result of allResults) {
			if (!result || !result.trades) continue;
			const resultCode = result.code || this.stockCodes[0];
			const openTrades = state.trades.filter(t => t.code == resultCode && t.status === 'open' && t.amount > 0);
			if (openTrades.length > 0 && result.close) {
				for (const openTrade of openTrades) {
					const unrealized = ((result.close - openTrade.entryPrice) * openTrade.amount).scale();
					const entryTotalEquity = openTrade.entryTotalEquity || (openTrade.entryRemain + openTrade.amount * openTrade.entryPrice);
					const drawdown = openTrade.drawdownRate ?? ((openTrade.lowPrice ? (openTrade.entryPrice - openTrade.lowPrice) / openTrade.entryPrice : 0).scale(4));
					state.csv.push(`${openTrade.code}	${openTrade.name}	${openTrade.ma}	${openTrade.entryDate.toLocaleDateString()}	${openTrade.entryPrice.scale(2)}	${openTrade.amount}	${openTrade.entryRemain.scale()}	${entryTotalEquity.scale()}	持倉中	-	${unrealized}	0	-	-	${drawdown}	-	-	${openTrade.entryReason}（持倉中）`);
					state.data.events.push({ type: 'hold', date: params.exitDate, code: openTrade.code, name: openTrade.name, ma: openTrade.ma, price: openTrade.entryPrice, amount: openTrade.amount, unrealizedProfit: unrealized, lastClose: result.close, reason: openTrade.entryReason });
				}
				const unrealizedTotal = openTrades.reduce((s, t) => s + ((result.close - t.entryPrice) * t.amount), 0);
				const openEquity = openTrades.reduce((s, t) => s + t.amount * result.close, 0);
				state.invested.unclosed = (state.invested.unclosed || 0) + openTrades.length;
				state.invested.unrealizedProfit = (state.invested.unrealizedProfit || 0) + unrealizedTotal;
				state.invested.openEquity = (state.invested.openEquity || 0) + openEquity;
			}
		}
		return this._finalize(state);
	}
}

export {
	Investor,
	WeeklyInvestor
};