const FEE_RATE = 0.0008534;
const TAX_RATE = 0.003;

class TigerInvest {
	constructor(data, ma) {
		this.ma = ma;
		this.data = this.withMacd(data);
		this.totalCapital = 100; // 總資金
		this.profit = 0; // 0:未投資, 1-3:三階段
		this.profitRate = 0; // 0:未投資, 1-3:三階段
		this.stage = 0; // 0:未投資, 1-3:三階段
		this.tax = 0; // 手續費與稅金
		this.investments = [];
		this.lowestPrice = Infinity;
		this.takeProfitedTimes = 0;
		this.soldTimes = 0;
		this.stopLossPrice = 0;
		this.logs = [];
		this.stages = [{
				buyable: () => true,
				ratio: 0.25
			}, // 階段1
			{
				buyable: (price) => price > this.getTopPrice(0) * 1.03,
				ratio: 0.5
			}, // 階段2
			{
				buyable: (price) => price > this.getTopPrice(1) * 1.03,
				ratio: 0.25
			} // 階段3
		];
	}
	start(trade) {
		if (trade && trade.logs) return this.load(trade);
		trade = trade || { entryDate: new Date('2000/01/01'), exitDate: new Date() };
		const entryTime = Date.parse(trade.entryDate);
		const exitTime = Date.parse(trade.exitDate || new Date()) + (8 * 3600 * 1000); // EIGHT_HOURS		
		this.data.forEach((day, idx) => {
			const date = Date.parse(day.date);
			if (date < entryTime || date > exitTime) return;
			day.prev = this.data[idx - 1];
			this.execute(day);
		});
		return this.summary();
	}
	load(trade) {
		this.totalCapital = 0;
		trade.logs.forEach(log => {
			log.date = new Date(log.date);
			const day = this.data.find(d => d.date.isSameDay(log.date));
			this.entryDate = trade.entryDate;
			this.exitDate = trade.exitDate;			
			if (log.act == '買入') {
				this.entryPrice = this.entryPrice || log.price;
				this.totalCapital += log.amount;
				this.buy(log.price, log.amount);
			}
			if (log.act == '賣出') {
				this.sell(log.price, (log.amount / this.totalCapital));
				if (this.getTotalInvested() == 0) {
					this.exitPrice = log.price;
				}
			}
			if (day) this.logStatus(day, log);
		});
		if (this.data.length && !trade.exitDate) {
			const day = this.data[this.data.length - 1];
			day.prev = this.data[this.data.length - 2];
			this.execute(day);			
		}
		return this.summary();
	}
	summary() {
		if (!this.exitDate) { // 交易中
			const lastDay = this.data[this.data.length - 1];
			this.tax += lastDay.close * this.getTotalInvested() * FEE_RATE;
			const avgCost = this.getAvgCost();
			this.profit = lastDay.close - this.getAvgCost();
			this.profitRate = this.profit / this.getAvgCost();
		}
		this.totalProfit = this.totalCapital * this.profit;
		this.netProfit = this.totalProfit - this.tax;
		this.netProfitRate = this.profitRate - (FEE_RATE + TAX_RATE);
		return {
			stage: this.stage,
			logs: this.logs,
			entryDate: this.entryDate,
			entryPrice: this.entryPrice,
			exitDate: this.exitDate,
			exitPrice: this.exitPrice,
			avgCost: this.getAvgCost().scale(2) || 0,
			stopLossPrice: this.stopLossPrice.scale(2),			
			profit: this.profit.scale(2),
			profitRate: this.profitRate.scale(3),
			totalProfit: this.totalProfit.scale(2),
			netProfit: this.netProfit.scale(2),
			netProfitRate: this.netProfitRate.scale(3),
			totalInvested: this.getTotalInvested(),
			tax: this.tax
		};		
	}
	withMacd(data) {
		const macd = new Macd(data).calculate();
		return data.map((day, idx) => ({ 
			...day,
			...macd[idx]
		}));
	}	
	execute(day) {
		const priceStatus = this.priceStatus(day);
		// 核心狀態機邏輯
		if (priceStatus.isAboveMa) {
			// 停利優先
			if (priceStatus.isTakeProfit) {
				const amount = this.handleSellStage(day);
				this.takeProfitedTimes++;
				if (amount) this.logStatus(day, { act: '停利', amount });
			} else if (priceStatus.isStopLoss) {
				const amount = this.handleSellStage(day);
				if (amount) this.logStatus(day, { act: '平倉', amount });
			} else {
				const amount = this.handleBuyStage(day);
				if (amount) this.logStatus(day, { act: '建倉', amount });
			}
		} 
		else if (priceStatus.isDown && this.getTotalInvested() > 0) {
			const amount = this.handleSellStage(day, 1.0);
			if (amount) this.logStatus(day, { act: '清倉', amount });
		}
		this.logStatus(day);
	}
	// 價格狀態分析
	priceStatus(day) {
		let isTakeProfit = false;
		if (this.isFullyInvested() && day.close >= this.getAvgCost() * 1.05) { // 已滿倉，獲利超過 5％
			isTakeProfit = true;
		}
		if (this.takeProfitedTimes == 1 && day.close >= this.getAvgCost() * 1.04) { // 未滿倉，曾經停利過，獲利又超過 4％
			isTakeProfit = true;
		}
		return {
			isTakeProfit: isTakeProfit,
			isAboveMa: day.close > day.ma,
			isStopLoss: this.stopLossPrice > day.close,
			isDown: (day.close < day.ma * 0.995) && (day.prev.close < day.prev.ma), // 透過二日法則來檢驗主力洗盤，連續兩日破均線才出場
		};
	}
	// 推進投資階段
	handleBuyStage(day) {
		// 若曾經停利或平倉，需觸底回升才能再加碼
		if (this.soldTimes > 0 || this.takeProfitedTimes > 0 && !this.isRerising(day)) return;
		const stage = this.stages[this.stage];
		let amount = 0;
		if (stage && stage.buyable(day.close)) {
			amount = this.totalCapital * stage.ratio;
			amount = Math.min(amount, this.totalCapital - this.getTotalInvested()); // 避免超過投資上限
			this.buy(day.close, amount);
		}
		return amount;
	}
	isRerising(day) {
		return day.prev.low <= (day.prev.ma * 1.01) && day.close > day.prev.close && day.close > (day.ma * 1.02);
	}	
	// 不同階段的累計可投入資金額度
	getStageCapital() {
		return this.stages.filter((_, idx) => idx <= this.stage).reduce((sum, s) => sum + (this.totalCapital * s.ratio), 0);
	}
	// 執行投資
	buy(price, amount) {
		this.investments.push({
			price,
			amount,
			timestamp: Date.now()
		});
		this.tax += (price * amount * FEE_RATE).scale(2);
	}
	// 階段撤退邏輯
	handleSellStage(day, sellRatio) {
		if (this.stage === 0) return;
		// 執行部分平倉
		this.soldTimes++;
		const sellType = (day.close < this.lowestPrice) ? 'newLow' : 'normal';
		return this.sell(day.close, this.getSellRatio(sellType));
	}
	// 平倉
	sell(price, sellRatio) {
		const amountToSell = this.totalCapital * sellRatio;
		// 先進先出平倉
		let remaining = Math.min(amountToSell, this.getTotalInvested());
		const profit = (price - this.getAvgCost()) * (remaining / this.totalCapital);
		this.profit += profit;
		this.profitRate += profit / this.getAvgCost();
		while (remaining > 0 && this.investments.length > 0) {
			const oldest = this.investments[0];
			const sellAmount = Math.min(oldest.amount, remaining);
			const sellUnits = sellAmount / oldest.price;
			if (oldest.amount === sellAmount) {
				this.investments.shift();
			} else {
				oldest.amount -= sellAmount;
				if (oldest.amount == 0) this.investments.shift();
			}
			remaining -= sellAmount;
		}
		this.tax += (price * amountToSell * 0.00385).scale(2);
		return amountToSell;
	}
	// 獲取階段最高價
	getTopPrice(stage) {
		const stageMap = [
			this.investments.slice(0, 1), // 階段1
			this.investments.slice(1, 2) // 階段2
		];
		return Math.max(...stageMap[stage].map(i => i.price));
	}
	// 獲取清算比例
	getSellRatio(type) {
		const ratioMatrix = {
			normal: [0, 0.25, 0.5, 0.25], // 普通撤退
			newLow: [0, 0.25, 0.25, 0.5] // 創新低撤退
		};
		return ratioMatrix[type][this.stage];
	}
	// 動態止損規則
	updateStopLoss(day) {
		const stopLossRules = [
			() => 0, // 階段0
			() => this.getAvgCost() * 0.95,
			() => this.getAvgCost() * 0.97,
			() => this.getAvgCost() * 0.98
		];
		this.stopLossPrice = stopLossRules[this.stage]();
	}
	updateLowestPrice(day) {
		if (day.close < this.lowestPrice) {
			this.lowestPrice = day.close;
		}
	}
	getAvgCost() {
		return this.investments.reduce((sum, i) => sum + (i.amount * i.price), 0) / this.getTotalInvested();
	}
	// 目前已經投入的資金（動態）
	getTotalInvested() {
		return this.investments.reduce((sum, i) => sum + i.amount, 0);
	}
	isFullyInvested() {
		return this.getTotalInvested() == this.totalCapital || this.getTotalInvested() == this.getStageCapital();
	}
	logStatus(day, act = {}) {
		this.stage = this.investments.length;
		this.updateLowestPrice(day);
		this.updateStopLoss(day);
		const lastDay = this.data[this.data.length - 1];
		const log = this.logs.find(log => log.day.id == day.id) || { ...act };
		const price = log.price || day.close;
		log.day = day;
		log.stage = this.stage;
		log.totalInvested = this.getTotalInvested();
		log.invested = (this.getTotalInvested() / this.totalCapital) * 100;
		log.avgCost = this.getAvgCost().scale(2) || 0;
		log.profit = ((this.profit.scale(2) || (lastDay.close - price)) * (log.amount || 0)).scale(2);
		log.profitRate = (this.profitRate * 100).scale(2) || ((log.profit / (log.avgCost * log.totalInvested)) * 100).scale(2);
		log.stopLossPrice = this.stopLossPrice.scale(2);
		log.tax = this.tax + (price * log.totalInvested * 0.00385);
		let msgs = [day.date.toLocaleDateString()];
		if (log.act) msgs = msgs.concat([`${log.act} ${log.amount}股`]);
		msgs = msgs.concat([
			`價格: ＄${day.close.scale(2)}`,
			`MA: ＄${day.ma ? day.ma.scale(2) : 'NA'}`,
			`階段: ${log.stage}`,
			`持倉: ${log.invested}％`,
			`損益：${log.profit} ${log.profitRate}%`,
			`成本: ＄${log.avgCost || 0}`,
			`止損價: ＄${log.stopLossPrice || 0}`
		]);
		if (!this.logs.find(log => log.day.id == day.id)) this.logs.push(log);
		console.log(msgs.join(' | '));
	}
}

/*
const MA = 18;

// 測試數據：波動上升趨勢
const rowData = [
	95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
	105, 106, 107, 108, 109, 110, 111, 112, // MA18開始計算 
	113, 112, 111, 110, 109, // 112 突破MA18 價格回撤但維持 MA18上方
	108, 107, 116, 115, 120, // 107 跌破MA18，116 突破MA18，120破高
	122, 125, 126, 124, 125 // 創新高止盈
];
const data = rowData.map((close, index) => {
	const count = MA - 1;
	if (index < count) return {
		index,
		close,
		ma: null
	}; // 前 MA - 1 天無法計算
	const prevs = rowData.slice(Math.max(0, index - count), index + 1);
	const sum = prevs.reduce((acc, curr) => acc + curr, 0);
	return {
		index,
		close,
		ma: sum / MA
	};
});
console.log(data);
// 模擬測試
const strategy = new TigerInvestStrategy(data).start();
*/