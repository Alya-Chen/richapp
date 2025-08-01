function scale(num, digits) {
        return num.scale(digits);
}

export class TradingSystem {
	constructor(data, params) {
		this.trades = [];
		this.params = Object.assign({}, params);
		this.params.threshold = this.params.threshold || 0.005; // 收盤價與 MA 的漲幅需超過 0.05%
		this.params.volumeMa = this.params.volumeMa || 5; // 成交量 volumeMa 日均值
		this.params.slope = this.params.slope || 3; // slope 日均線斜率
		this.data = this.calcIndicators(data);
	}

	// ================== 指標計算 ==================
	calcIndicators(data) {
		// 計算 MA 日均線（滯後一日）
		const withMA = data.map((item, index) => {
			const ma = this.params.ma;
			const count = ma - 1;
			if (index < count) return {
				...item,
				ma: null
			}; // 前 MA - 1 天無法計算

			const prevs = data.slice(Math.max(0, index - count), index + 1);
			const sum = prevs.reduce((acc, curr) => acc + curr.close, 0);
			return {
				...item,
				ma: sum / ma
			};
		});

		// 計算成交量 volumeMa 日均值
		const withVolumeMA = withMA.map((item, index) => {
			const volumeMa = this.params.volumeMa;
			const count = volumeMa - 1;
			if (index < count) return {
				...item,
				volumeMa: null
			};
			const prevs = withMA.slice(Math.max(0, index - count), index + 1);
			const sum = prevs.reduce((acc, curr) => acc + curr.volume, 0);
			return {
				...item,
				volumeMa: sum / volumeMa
			};
		});

		// 計算均線斜率 slope 日變化
		const withSlope = withVolumeMA.map((item, index) => {
			const slope = this.params.slope;
			if (index < slope || !item.ma) return {
				...item,
				maSlope: null
			};
			const prev = withVolumeMA[index - slope].ma;
			return {
				...item,
				maSlope: (item.ma - prev) / slope
			};
		});

		return withSlope;
	}

	// 核心回測方法
	backtest() {
		//const now = new Date().getTime();
		const entryStrategy = new this.params.entryStrategy(this.data, this.params);
		const exitStrategy = this.params.exitStrategy.map(strategy => new strategy(this.data, this.params));
		const entryTime = Date.parse(this.params.entryDate);
		const exitTime = Date.parse(this.params.exitDate || new Date()) + (8 * 3600 * 1000); // EIGHT_HOURS		
		let position = { status: 'closed' };
		this.data.forEach((day, index) => {
			const time = Date.parse(day.date);
			if (time < entryTime || time > exitTime) return;			
			// 開倉檢查
			if (position.status == 'closed') {
				const entryCondition = entryStrategy.checkEntry(day, index, position);
				if (entryCondition) {
					position = this.openPosition(day, entryCondition.reason, index);
					// MA 上出場後是否要重複入場
					//position = (!this.params.reentry && position.reentry) ?  { status: 'closed' } : position;
				}
			}
			// 平倉檢查
			if (position.status != 'closed') {
				//let exitCondition;
				//for (let i=0; i<exitStrategy.length; i++) {
				for (const strategy of exitStrategy) {
					const exitCondition = strategy.checkExit(day, index, position);
					if (exitCondition) {				
						this.closePosition(position, day, exitCondition.reason);
						position = { status: 'closed' };
						break;
					}
				}
			}
		});
		//console.log(`${exitStrategy.name} ${new Date().getTime() - now}`);
		return {
			params: this.params,
			ma: this.params.ma,
			startDate: this.params.entryDate,
			endDate: this.params.exitDate,
			trades: this.trades,
			...this.calculateMetrics()
		};
	}

	// 績效指標計算
	calculateMetrics() {
		const closedTrades = this.trades.filter(t => t.status === 'closed');
		const wins = closedTrades.filter(t => t.profit > 0); // 有獲利的交易數
		const reentry = closedTrades.filter(t => t.reentry); // 返場的交易數
		const reentryWins = closedTrades.filter(t => (t.reentry && t.profit > 0)); // 返場有獲利的交易數
		const reentryProfit = closedTrades.reduce((sum, t) => sum + (t.reentry ? t.profit : 0), 0); // 返場的獲利金額
		const profit = closedTrades.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0), 0); // 總獲利金額
		const loss = closedTrades.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0), 0); // 總虧損金額
		const breakouts = closedTrades.reduce((sum, t) => sum + (t.breakout || 0), 0);
		const pnl = profit / Math.abs(loss || 1); // 盈虧比：總獲利金額除以總虧損金額
		const winRate = wins.length / closedTrades.length;
		const expectation = (pnl * winRate) - (1 - winRate); // 期望值 =（盈虧比 x 勝率）–（1 - 勝率）
                return {
                        profit: scale(profit + loss),
                        loss: scale(loss),
                        profitRate: scale(closedTrades.reduce((sum, t) => sum + t.profitRate, 0)),
                        breakoutRate: scale(breakouts / closedTrades.length),
                        winRate: scale(winRate),
			reentry: reentry.length,
			reentryWins: reentryWins.length,
                        reentryWinRate: scale(reentryWins.length / reentry.length),
                        reentryProfit: scale(reentryProfit),
                        pnl: scale(pnl),
                        expectation: scale(expectation),
			maxDrawdown: this.calculateMaxDrawdown(closedTrades)
		};
	}

	// 最大回撤計算
	calculateMaxDrawdown(trades) {
		let peak = -Infinity;
		let maxDrawdown = 0;
		let equity = 0;
		trades.forEach(t => {
			equity += t.profitRate;
			if (equity > peak) peak = equity;
			maxDrawdown = Math.min(maxDrawdown, equity - peak);
		});
                return scale(maxDrawdown);
	}

	// 記錄開倉
	openPosition(day, reason, index) {
		const prev2 = this.data[index - 2]; // 前兩日的收盤價在 MA 下，才能作向上破線的金二日
		const prev1 = this.data[index - 1];
		const position = {
			breakout: (prev2.close < prev2.ma) && (prev1.close > prev1.ma && day.close > prev1.close),
			entryDate: day.date,
			entryPrice: day.close,
			entryReason: reason,
			status: 'open'
		};		
		if (this.trades.length > 0) {
			// 前次交易過熱出場，且前兩日的收盤價在 MA 上表示「返場」
			position.reentry = this.trades[this.trades.length - 1].exitReason.includes('過熱') && (prev2.close > prev2.ma);
		}
		// 參數設定不返場就退出交易
		if (!this.params.reentry && position.reentry) return { status: 'closed' };
		this.trades.push(position);
		return position;
	}

	// 記錄平倉
	closePosition(position, day, reason) {
		position.exitPrice = day.close;
                position.pnl = scale((day.close / position.entryPrice - 1) * 100);
                position.duration = scale((day.date - position.entryDate) / (1000 * 60 * 60 * 24));
		position.exitReason = reason;
                position.profit = scale(position.exitPrice - position.entryPrice);
                position.profitRate = scale(position.profit / position.entryPrice);
		position.entryDate = position.entryDate.toLocaleDateString();
		position.exitDate = day.date.toLocaleDateString();
		position.status = 'closed';
	}
}

// 參數優化模塊
export class ParameterOptimizer {
	constructor(data) {
		this.data = data;
	}

	// 網格搜索優化
	gridSearch(paramGrid) {
		const paramCombinations = this.generateCombinations(paramGrid);
		return paramCombinations.map(params => {
			const system = new TradingSystem(this.data, params);
			return system.backtest();
		});
	}

	// 生成參數組合
	generateCombinations(paramGrid) {
		const keys = Object.keys(paramGrid);
		const combinations = [];

		function generate(index, current) {
			if (index === keys.length) {
				combinations.push(current);
				return;
			}
			const key = keys[index];
			paramGrid[key].forEach(value => {
				generate(index + 1, {
					...current,
					[key]: value
				});
			});
		}

		generate(0, {});
		return combinations;
	}
}