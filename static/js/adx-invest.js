class AdxInvest extends TigerInvest {
	constructor(data = [], ma = 0) {
		super(data, ma);
		this.data = this.withAdx(data);
	}
	withAdx(data) {
		const adx = new Adx(data).calculate();
		return data.map((day, idx) => ({
			...day,
			golden: adx[idx] && adx[idx].golden,
			dead: adx[idx] && adx[idx].dead
		}));
	}
	execute(day) {
		const priceStatus = this.priceStatus(day);
		// 核心狀態機邏輯
		if (this.getTotalInvested() == 0 && priceStatus.isGolden) {
			const amount = this.totalCapital;
			this.buy(day.close, amount);
			this.logStatus(day, { act: '建倉', amount });
		}
		const amount = this.getTotalInvested();
		const act = priceStatus.isDead ? '清倉' : '持倉';
		this.logStatus(day, { act, amount });
	}
	summary() {
		const summary = super.summary();
		summary.stopProfitPrice = this.stopProfitPrice;
		return summary;
	}
	// 價格狀態分析
	priceStatus(day) {
		return {
			isGolden: day.golden,
			isDead: day.dead,
			isStopLoss: day.close <= this.stopLossPrice
		};
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