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
			invested: { balance: this.money, unclosed: 0, profit: 0, maxDrawdown: 0 },
			trades: [],
			csv: [`代號	公司	MA	購入日期	購入價格	購入股數	剩餘本金	賣出日期	賣出價格	單筆收益	單筆稅金	累積收益	單筆收益率	期末本金	出場原因`],
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
		state.trades.push({ code: test.code, name: test.name, ma: test.ma, entryRemain: state.invested.balance, ...trade });
		state.data.events.push({ type: 'buy', date: trade.entryDate, code: test.code, name: test.name, ma: test.ma, price: trade.entryPrice, amount: trade.amount, tax: trade.tax, remainMoney: state.invested.balance, reason: trade.entryReason });
		if (!state.data.byCode[test.code]) state.data.byCode[test.code] = { code: test.code, name: test.name, ma: test.ma, trades: [] };
		state.data.byCode[test.code].trades.push({ amount: trade.amount, status: trade.status, entryDate: trade.entryDate, entryPrice: trade.entryPrice, entryReason: trade.entryReason, exitDate: trade.exitDate, exitPrice: trade.exitPrice, exitReason: trade.exitReason, profit: (trade.amount * trade.profit).scale(), tax: trade.tax, reentry: trade.reentry || false });
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
		state.csv.push(`${trade.code}	${trade.name}	${trade.ma}	${trade.entryDate.toLocaleDateString()}	${trade.entryPrice.scale(2)}	${trade.amount}	${trade.entryRemain.scale()}	${trade.exitDate.toLocaleDateString()}	${trade.exitPrice.scale()}	${trade.profit.scale()}	${trade.tax.scale()}	${state.invested.profit.scale()}	${trade.profitRate.scale(2)}	${state.invested.balance.scale()}	${reason}`);
		state.data.events.push({ type: 'sell', date: trade.exitDate, code: trade.code, name: trade.name, ma: trade.ma, price: trade.exitPrice, amount: trade.amount, profit: trade.profit, profitRate: trade.profitRate, tax: trade.tax, remainMoney: state.invested.balance, reason });
		state.runningTests = state.runningTests.filter(t => t.code != trade.code);
		state.invested.maxDrawdown = this.calculateMDD(state.invested, state.trades);
	}

	// 最終摘要與回傳
	_finalize(state) {
		state.data.summary = Object.assign(state.data.summary, this.calculateMetrics(state.trades));
		state.data.summary.finalMoney = state.invested.balance;
		state.data.summary.totalProfit = state.invested.profit;
		state.data.summary.profitRate = (state.data.summary.totalProfit / this.money);
		state.data.summary.netProfitRate = (state.data.summary.netProfit / this.money);
		state.data.summary.maxDrawdown = state.invested.maxDrawdown?.scale(2);
		state.csv.unshift(`${state.data.summary.finalMoney.scale()}	0	${state.data.summary.totalProfit.scale()}	${state.data.summary.profitRate.scale(2)}	${state.data.summary.tax.scale()}	${state.data.summary.netProfit.scale()}	${state.data.summary.netProfitRate.scale(2)}	${state.data.summary.tradeCount}	${state.data.summary.winRate.scale(2)}	${state.data.summary.pnl}	${state.data.summary.expectation}	${state.data.summary.maxDrawdown.scale(2)}	${state.data.summary.reentry}	${state.data.summary.reentryWinRate.scale(2)}	${state.data.summary.reentryProfit.scale()}`);
		state.csv.unshift(`最後本金	未平倉	總獲利	總獲利率	總稅金	稅後淨利	淨利率	總交易次數	總勝率	盈虧比	期望值	最大回撤率	返場次數	返場勝率	返場獲利`);
		state.csv.unshift(`入場日期	${state.entryDate.toLocaleDateString()}	出場日期	${state.exitDate.toLocaleDateString()}	入場策略	${state.entryStrategy}	出場策略	${state.exitStrategy}`);
		return {
			csv: state.csv.join('\r\n'),
			data: state.data,
			money: state.invested.balance.scale(),
			profit: state.invested.profit.scale(),
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
		const entryDate = state.entryDate;
		const exitDate = state.exitDate;
		let tests = null;

		while (entryDate.getTime() < exitDate.getTime()) {
			const codes = this.stockCodes.filter(code => !state.runningTests.map(t => t.code).includes(code));
			tests = this.params.dynamic ? state.runningTests.concat(await this.getTests(codes, entryDate)) : (tests || await this.getTests(codes, entryDate));
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
		return this._finalize(state);
	}

	/**
	 * 計算最大回撤率（簡單版本：盈虧峰值到谷底）
	 */
	calculateMDD(invested, trades) {
		const profit = trades.reduce((sum, t) => sum + t.profit, 0);
		invested.minProfit = Math.min(profit, invested.minProfit || 0);
		invested.maxProfit = Math.max(profit, invested.maxProfit || 0);
		return (invested.maxProfit - invested.minProfit) / invested.maxProfit;
	}

	/**
	 * 計算交易統計指標：勝率、盈虧比、期望值、返場統計
	 */
	calculateMetrics(trades) {
		const wins = trades.filter(t => t.profit > 0);
		const reentry = trades.filter(t => t.reentry);
		const reentryWins = trades.filter(t => (t.reentry && t.profit > 0));
		const reentryProfit = trades.reduce((sum, t) => sum + (t.reentry ? t.profit : 0), 0);
		const profit = trades.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0), 0);
		const totalLoss = trades.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0), 0);
		const tax = trades.reduce((sum, t) => sum + t.tax, 0);
		const pnl = profit / Math.abs(totalLoss || 1);
		const winRate = wins.length / trades.length;
		const expectation = (pnl * winRate) - (1 - winRate);
		return {
			tradeCount: trades.length,
			totalLoss: totalLoss.scale(),
			tax,
			netProfit: (profit + totalLoss - tax).scale(),
			winRate: winRate.scale(),
			reentry: reentry.length,
			reentryWins: reentryWins.length,
			reentryWinRate: (reentryWins.length / reentry.length).scale(),
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

		// 多股回測回傳陣列，需攤平所有交易
		const allResults = Array.isArray(backtestResult) ? backtestResult : [backtestResult];
		for (const result of allResults) {
			if (!result || !result.trades) continue;
			const trades = result.trades.filter(t => t.duration > 0);
			for (const trade of trades) {
				const test = { code: result.code || this.stockCodes[0], name: '', ma: this.params.ma };
				trade.status = trade.status || 'closed';
				this._executeEntry(test, trade, state);
				if (trade.exitDate && trade.amount > 0) {
					const stored = state.trades.find(t => t.code == test.code && t.status == 'closed' && t.amount == trade.amount);
					if (stored) {
						stored.exitDate = trade.exitDate;
						stored.exitPrice = trade.exitPrice;
						stored.exitReason = trade.exitReason;
						stored.profit = trade.profit;
						stored.profitRate = trade.profitRate;
						this._executeExit(stored, state);
					}
				}
			}
		}
		return this._finalize(state);
	}
}

export {
	Investor,
	WeeklyInvestor
};