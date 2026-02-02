import * as st from './trading-strategy.js';
import {
	stockService
} from './stock-service.js';

const FEE_RATE = 0.001425 * 0.6; // 證券手續費，六折
const FEE_TAX_RATE = FEE_RATE + 0.003; // 證券手續費＋證券交易稅 0.001425 + 0.003

class Investor {
	constructor(stockCodes, money, params) {
		this.stockCodes = stockCodes;
		this.money = money || (200 * 10000);
		params.transient = true;
		params.entryDate = params.entryDate || new Date(new Date().getFullYear() + '/01/01');
		params.exitDate = params.exitDate || new Date();
		this.params = params;
	}

	async invest() {
		const entryDate = this.params.entryDate;
		const exitDate = this.params.exitDate;
		const entryStrategy = st[this.params.entryStrategy].name;
		const exitStrategy = this.params.exitStrategy.map(s => st[s].name).join('＋');
		const maxEntryMoney = this.money / 4;
		const invested = {
			balance: this.money, // 當前餘額
			unclosed: 0,
			profit: 0,
			maxDrawdown: 0
		};
		const csv = [];
		// 結構化的 JSON 回傳內容
		const data = {
			summary: {
				entryDate: new Date(entryDate),
				exitDate: exitDate,
				initialMoney: this.money,
				maxEntryMoney,
				finalMoney: null,
				totalProfit: null,
				stockCount: this.stockCodes.length
			},
			//timeline: [], // 每日資金/累積損益快照
			events: [],   // 交易事件：buy/sell
			byCode: {}  // 依代號彙整的交易
		};
		const trades = [];
		let tests = null;
		let runningTests = [];
		csv.push(`代號	公司	MA	購入日期	購入價格	購入股數	剩餘本金	賣出日期	賣出價格	單筆收益	單筆稅金	累積收益	期末本金	出場原因`);
		while (entryDate.getTime() < exitDate.getTime()) {
			const codes = this.stockCodes.filter(code => !runningTests.map(t => t.code).includes(code));
			tests = this.params.dynamic ? runningTests.concat(await this.getTests(codes, entryDate)) : (tests || await this.getTests(codes, entryDate));
			for (let i = 0; i < tests.length; i++) {
				const test = tests[i];
				test.trades = test.trades || test.result.trades;
				let trade = test.trades.find(t => entryDate.isSameDay(t.entryDate));
				if (trade && invested.balance > 0) {
					// 單次最高投資金額：總金額的 1/4 或餘額
					const entryMoney = Math.min(invested.balance, maxEntryMoney);
					trade.amount = parseInt(entryMoney / trade.entryPrice);
					//trade.amount = trade.amount > 1000 ? 1000 : trade.amount;
					if (trade.amount > 0) {
						runningTests.push(test);
						const money = trade.amount * trade.entryPrice;
						invested.balance -= money;
						trade.tax = trade.amount * trade.entryPrice * FEE_RATE;
						trade.tax = Math.max(trade.tax, 20).scale(2);
						trades.push({
							code: test.code,
							name: test.name,
							ma: test.ma,
							entryRemain: invested.balance,
							...trade
						});
						// 事件與分組
						data.events.push({ type: 'buy', date: trade.entryDate, code: test.code, name: test.name, ma: test.ma, price: trade.entryPrice, amount: trade.amount, tax: trade.tax, remainMoney: invested.balance, reason: trade.entryReason });
						if (!data.byCode[test.code]) data.byCode[test.code] = { code: test.code, name: test.name, ma: test.ma, trades: [] };
						data.byCode[test.code].trades.push({
							amount: trade.amount,
							status: trade.status,
							entryDate: trade.entryDate,
							entryPrice: trade.entryPrice,
							entryReason: trade.entryReason,
							exitDate: trade.exitDate,
							exitPrice: trade.exitPrice,
							exitReason: trade.exitReason,
							profit: (trade.amount * trade.profit).scale(),
							tax: trade.tax,
							reentry: trade.reentry || false
						});
					}
				}
				trade = trades.find(t => t.code == test.code && t.status == 'closed' && entryDate.isSameDay(t.exitDate));
				if (trade) {
					const money = trade.amount * trade.exitPrice;
					invested.balance += money;
					trade.profit = (trade.amount * trade.profit).scale();
					trade.tax += (trade.amount * trade.exitPrice * FEE_TAX_RATE).scale(2);
					invested.profit += trade.profit;
					trades.find(t => t.code == trade.code).status = 'done';
					const reason = trade.exitReason + (trade.reentry ? '（返場）' : '');
					csv.push(`${trade.code}	${trade.name}	${trade.ma}	${trade.entryDate.toLocaleDateString()}	${trade.entryPrice.scale(2)}	${trade.amount}	${trade.entryRemain.scale()}	${trade.exitDate.toLocaleDateString()}	${trade.exitPrice.scale()}	${trade.profit.scale()}	${trade.tax.scale()}	${invested.profit.scale()}	${trade.profitRate.scale(2)}	${invested.balance.scale()}	${reason}`);
					data.events.push({ type: 'sell', date: trade.exitDate, code: trade.code, name: trade.name, ma: trade.ma, price: trade.exitPrice, amount: trade.amount, profit: trade.profit, profitRate: trade.profitRate, tax: trade.tax, remainMoney: invested.balance, reason });
					runningTests = runningTests.filter(t => t.code != trade.code);
					invested.maxDrawdown = this.calculateMDD(invested, trades);
				}
			};
			entryDate.addDays(1);
		}

		// 完成摘要
		const unclosed = trades.filter(t => t.status != 'closed' && t.status != 'done');
		// 計算未平倉的交易
		for (const trade of unclosed) {
			const day = await stockService.getDaily(trade.code, entryDate);
			trade.profit = (day.close - trade.entryPrice) * trade.amount;
			invested.profit += trade.profit;
			invested.unclosed += day.close * trade.amount;
			csv.push(`${trade.code}	${trade.name}	${trade.ma}	${trade.entryDate.toLocaleDateString()}	${trade.entryPrice.scale(2)}	${trade.amount}	${trade.entryRemain.scale()}`);
		}
		data.summary = Object.assign(data.summary, this.calculateMetrics(trades));
		data.summary.finalMoney = invested.balance;
		data.summary.unclosed = invested.unclosed;
		data.summary.unclosedCount = unclosed.length;
		data.summary.totalProfit = invested.profit;
		data.summary.profitRate = (data.summary.totalProfit / this.money);
		data.summary.netProfitRate = (data.summary.netProfit / this.money);
		data.summary.maxDrawdown = invested.maxDrawdown?.scale(2);
		csv.unshift(`${data.summary.finalMoney.scale()}	${data.summary.unclosed.scale()}	${data.summary.totalProfit.scale()}	${data.summary.profitRate.scale(2)}	${data.summary.tax.scale()}	${data.summary.netProfit.scale()}	${data.summary.netProfitRate.scale(2)}	${data.summary.tradeCount}	${data.summary.winRate.scale(2)}	${data.summary.pnl}	${data.summary.expectation}	${data.summary.maxDrawdown.scale(2)}	${data.summary.reentry}	${data.summary.reentryWinRate.scale(2)}	${data.summary.reentryProfit.scale()}`);
		csv.unshift(`最後本金	未平倉	總獲利	總獲利率	總稅金	稅後淨利	淨利率	總交易次數	總勝率	盈虧比	期望值	最大回撤率	返場次數	返場勝率	返場獲利`);
		csv.unshift(`入場日期	${entryDate.toLocaleDateString()}	出場日期	${exitDate.toLocaleDateString()}	入場策略	${entryStrategy}	出場策略	${exitStrategy}`);
		return {
			csv: csv.join('\r\n'),
			data,
			money: invested.balance.scale(),
			profit: invested.profit.scale(),
			trades
		};
	}
	calculateMDD(invested, trades) {
		const profit = trades.reduce((sum, t) => sum + t.profit, 0); // 交易中的獲利金額
		invested.minProfit = Math.min(profit, invested.minProfit || 0);
		invested.maxProfit = Math.max(profit, invested.maxProfit || 0);
		return (invested.maxProfit - invested.minProfit) / invested.maxProfit;
	}
	// 績效指標計算
	calculateMetrics(trades) {
		const wins = trades.filter(t => t.profit > 0); // 有獲利的交易數
		const reentry = trades.filter(t => t.reentry); // 返場的交易數
		const reentryWins = trades.filter(t => (t.reentry && t.profit > 0)); // 返場有獲利的交易數
		const reentryProfit = trades.reduce((sum, t) => sum + (t.reentry ? t.profit : 0), 0); // 返場的獲利金額
		const profit = trades.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0), 0); // 總獲利金額
		const totalLoss = trades.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0), 0); // 總虧損金額
		const tax = trades.reduce((sum, t) => sum + t.tax, 0); // 總稅金
		const breakouts = trades.reduce((sum, t) => sum + (t.breakout || 0), 0);
		const pnl = profit / Math.abs(totalLoss || 1); // 盈虧比：總獲利金額除以總虧損金額
		const winRate = wins.length / trades.length; // 總勝率
		const expectation = (pnl * winRate) - (1 - winRate); // 期望值 =（盈虧比 x 勝率）–（1 - 勝率）
		return {
			tradeCount: trades.length,
			totalLoss: totalLoss.scale(),
			tax,
			netProfit: (profit + totalLoss - tax).scale(),
			breakoutRate: (breakouts / trades.length).scale(),
			winRate: winRate.scale(),
			reentry: reentry.length,
			reentryWins: reentryWins.length,
			reentryWinRate: (reentryWins.length / reentry.length).scale(),
			reentryProfit: reentryProfit.scale(),
			pnl: pnl.scale(),
			expectation: expectation.scale()
		};
	}
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

export {
	Investor
};