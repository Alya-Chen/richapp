class RsiInvest extends TigerInvest {
	constructor(data = [], ma = 0) {
		super(data, ma);
		//this.totalCapital = 1000;
		this.data = this.withRsi(data);
	}
	withRsi(data) {
		const rsi = new Rsi(data).calculate();
		return data.map((day, idx) => ({ 
			...day,
			rsi: rsi[idx] && rsi[idx].rsi,
			dead: rsi[idx] && rsi[idx].dead
		}));
	}
	execute(day) {
		const priceStatus = this.priceStatus(day);
		// 核心狀態機邏輯
		if (this.getTotalInvested() == 0 && priceStatus.isAboveMa) {
			const amount = this.totalCapital;
			this.buy(day.close, amount);
			this.logStatus(day, { act: '建倉', amount });			
		}
		if ((priceStatus.isStopLoss || priceStatus.isRsiDead || priceStatus.isDown) && this.getTotalInvested() > 0) { // 停損，停利優先
			const act = priceStatus.isRsiDead ? 'RSI 過熱出場' : '清倉';
			const amount = this.sell(day.close, 1.0);
			if (amount) this.logStatus(day, { act, amount });
		}
		this.logStatus(day);
	}
	summary() {
		const summary = super.summary();
		summary.stopProfitPrice = this.stopProfitPrice;
		if (this.data.length) {
			summary.rsiHot = this.data[this.data.length - 1].rsi >= 80;
			summary.rsiHot = summary.rsiHot || (this.logs[this.logs.length - 1].act || '').includes('過熱');			
		}
		return summary;
	}	
	// 價格狀態分析
	priceStatus(day) {
		return {
			isAboveMa: day.close > day.ma,
			isRsiDead: day.dead,
			isStopLoss: day.close <= this.stopLossPrice,
			isDown: (day.close < day.ma * 0.995) && (day.prev.close < day.prev.ma), // 透過二日法則來檢驗主力洗盤，連續兩日破均線才出場
		};
		this.yestoday = day;
	}
	// 動態止損規則
	updateStopLoss(day) {
		if (!this.getAvgCost()) return;
		// 停利點設定為 5%
		this.stopProfitPrice = this.getAvgCost() * 1.05;
		// 帳上獲利 3% 時，停損點必須設定在損益兩平位置
		const profitRate = (day.close - this.getAvgCost()) / this.getAvgCost();
		if (profitRate >= 0.03) {
			return (this.stopLossPrice = this.getAvgCost() * 1.01);
		}
		// 建倉成本下 5% 防護網
		this.stopLossPrice = this.getAvgCost() * 0.95;
	}
}