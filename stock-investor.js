import {
	stockService
} from './stock-service.js';

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
		let tests = await stockService.backtest(this.stockCodes, this.params, true);
		tests = Array.from(
			tests.reduce((map, test) => {
				const existing = map.get(test.code);
				if (!existing || new Date(test.endDate) > new Date(existing.endDate)) {
					map.set(test.code, test);
				}
				return map;
			}, new Map()).values()
		);

		const entryDate = this.params.entryDate;
		const exitDate = this.params.exitDate;	
		const trades = [];
		const invested = {
			money: this.money,
			profit: 0
		};
		const csv = [];
		// 結構化的 JSON 回傳內容
		const data = {
			summary: {
				entryDate: new Date(entryDate),
				exitDate: exitDate,
				initialMoney: this.money,
				finalMoney: null,
				totalProfit: null,
				stockCount: tests.length
			},
			//timeline: [], // 每日資金/累積損益快照
			events: [],   // 交易事件：buy/sell
			byCode: {}  // 依代號彙整的交易
		};
		csv.push(`"代號","公司","購入日期","購入價格","購入股數","剩餘本金","賣出日期","賣出價格","單筆收益","累積收益","期末本金","出場原因"`);
		while (true) {
			if (entryDate.isSameDay(exitDate)) break;
			for (let i = 0; i < tests.length; i++) {
				const test = tests[i];
				test.trades = test.trades || test.result.trades;
				let trade = test.trades.find(t => t.status == 'closed' && exitDate.isAfter(t.exitDate) && entryDate.isSameDay(t.entryDate));
				if (trade) {
					trade.amount = parseInt(invested.money / trade.entryPrice);
					trade.amount = trade.amount > 1000 ? 1000 : trade.amount;
					if (trade.amount > 0) {
						const money = trade.amount * trade.entryPrice;
						invested.money -= money;
						trade.tax = trade.amount * trade.entryPrice * 0.001425;
						trade.tax = Math.max(trade.tax, 20).scale(2);
						trades.push({
							code: test.code,
							name: test.name,
							ma: test.ma,
							entryRemain: invested.money,
							...trade
						});
						// 事件與分組
						data.events.push({ type: 'buy', date: trade.entryDate, code: test.code, name: test.name, ma: test.ma, price: trade.entryPrice, amount: trade.amount, tax: trade.tax, cashAfter: invested.money, reason: trade.entryReason });
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
					invested.money += money;
					trade.profit = (trade.amount * trade.profit).scale();
					trade.tax += (trade.amount * trade.exitPrice * 0.004425).scale(2);
					invested.profit += trade.profit;
					trades.find(t => t.code == trade.code).status = 'done';
					const reason = trade.exitReason + (trade.reentry ? '（返場）' : '');
					csv.push(`"${trade.code}","${trade.name}（${trade.ma}）","${trade.entryDate}",${trade.entryPrice.scale()},${trade.amount},${trade.entryRemain.scale()},"${trade.exitDate}",${trade.exitPrice.scale()},${trade.profit.scale()},${invested.profit.scale()},${invested.money.scale()},"${reason}"`);
					// 事件
					data.events.push({ type: 'sell', date: trade.exitDate, code: trade.code, name: trade.name, ma: trade.ma, price: trade.exitPrice, amount: trade.amount, profit: trade.profit, tax: trade.tax, cashAfter: invested.money, reason });
				}
			};
			// 每日資金與損益快照
			//data.timeline.push({ date: new Date(entryDate), cash: invested.money, profit: invested.profit });
			entryDate.addDays(1);
		}
		// 完成摘要
		data.summary.finalMoney = invested.money;
		data.summary.totalProfit = invested.profit;
		data.summary = Object.assign(data.summary, this.calculateMetrics(tests));
		return {
			csv: csv.join('\r\n'),
			data,
			money: invested.money.scale(),
			profit: invested.profit.scale(),
			trades
		};
	}
	// 績效指標計算
	calculateMetrics(tests) {
		const trades = tests.map(t => t.trades).flat().filter(t => t.status === 'closed');
		const wins = trades.filter(t => t.profit > 0); // 有獲利的交易數
		const reentry = trades.filter(t => t.reentry); // 返場的交易數
		const reentryWins = trades.filter(t => (t.reentry && t.profit > 0)); // 返場有獲利的交易數
		const reentryProfit = trades.reduce((sum, t) => sum + (t.reentry ? t.profit : 0), 0); // 返場的獲利金額
		const profit = trades.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0) * t.amount, 0); // 總獲利金額
		const loss = trades.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0) * t.amount, 0); // 總虧損金額
		const tax = trades.reduce((sum, t) => sum + (t.tax || 0), 0); // 總稅金
		const breakouts = trades.reduce((sum, t) => sum + (t.breakout || 0), 0);
		const pnl = profit / Math.abs(loss || 1); // 盈虧比：總獲利金額除以總虧損金額
		const winRate = wins.length / trades.length;
		const expectation = (pnl * winRate) - (1 - winRate); // 期望值 =（盈虧比 x 勝率）–（1 - 勝率）
		return {
			tradeCount: trades.length,
			profit: (profit + loss).scale(),
			loss: loss.scale(),
			tax,
			profitRate: (trades.reduce((sum, t) => sum + t.profitRate, 0)).scale(),
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
}


export {
	Investor
};