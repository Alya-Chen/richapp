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

	/**
	 * 價格模擬 — 向上下逐步遞減/遞增，試算何時觸發買賣訊號
	 *
	 * @param {Array} dailies   原始日線資料
	 * @param {Object} position 持倉資訊（含 avgCost, stopLossPrice）
	 * @param {Object} [opts]
	 * @param {number} [opts.step=0.005]  每次變動比例（預設 0.5%）
	 * @param {number} [opts.maxMove=0.1] 最大變動幅度（預設 10%）
	 * @param {number} [opts.amp=0.02]    假設今日振幅比例（預設 2%）
	 * @returns {Object} { down: Array, up: Array }
	 *   每筆: { pct:number, close:number, golden:boolean, dead:boolean,
	 *           stopLoss:boolean, adx:number, plusDi:number, minusDi:number }
	 */
	static simulate(dailies, position, opts = {}) {
		const step = opts.step || 0.005;
		const maxMove = opts.maxMove || 0.1;
		const amp = opts.amp || 0.02;
		const entryTime = opts.entryDate ? new Date(opts.entryDate).getTime() : 0;
		const prev = dailies[dailies.length - 1];
		const baseClose = prev.close;
		const makeRow = (close) => {
			const halfAmp = close * amp / 2;
			const hypothetical = {
				date: new Date(),
				high: close + halfAmp,
				low:  close - halfAmp,
				close
			};
			const extended = [...dailies, hypothetical];
			const adxResult = new Adx(extended).calculate();
			const today = adxResult[adxResult.length - 1];

			// 只掃描建倉後的 ADX 區間（含今日假設）
			const adxValues = adxResult
				.filter(r => r.date && new Date(r.date).getTime() >= entryTime)
				.map(r => r.adx)
				.filter(v => v != null);
			const adxLow  = Math.min(...adxValues);
			const adxHigh = Math.max(...adxValues);
			const raiseRate     = today.adx ? (today.adx - adxLow) / adxLow : 0;
			const drawdownRate  = today.adx ? (adxHigh - today.adx) / today.adx : 0;

			return {
				close: parseFloat(close.toFixed(2)),
				golden: !!today.golden,
				dead: !!today.dead,
				adx: today.adx?.scale(2),
				adxRate: today.adxRate?.scale(4),
				raiseRate: parseFloat(raiseRate.toFixed(4)),
				drawdownRate: parseFloat(drawdownRate.toFixed(4)),
				plusDi: today.plusDi?.scale(2),
				minusDi: today.minusDi?.scale(2),
				stopLoss: position?.stopLossPrice ? close <= position.stopLossPrice : false,
			};
		};

		const count = Math.round(maxMove / step);
		const down = [];
		for (let i = 1; i <= count; i++) {
			const pct = i * step;
			down.push({ pct: parseFloat((pct * 100).toFixed(1)), ...makeRow(baseClose * (1 - pct)) });
		}
		const up = [];
		for (let i = 1; i <= count; i++) {
			const pct = i * step;
			up.push({ pct: parseFloat((pct * 100).toFixed(1)), ...makeRow(baseClose * (1 + pct)) });
		}
		return { down, up };
	}

	/**
	 * 找出第一個觸發買入或賣出的價格點
	 * @param {'buy'|'sell'} side
	 * @param {Object} [opts]
	 * @param {number} [opts.adxRate=10]     ADX 三日斜率門檻（0=不使用）
	 * @param {number} [opts.drawdownRate=0] ADX 高點回撤率門檻（0=不使用）
	 * @param {number} [opts.raiseRate=0]    ADX 谷底回升率門檻（0=不使用）
	 * @returns {{ pct:number, close:number, reason:string, status:string }|null}
	 */
	static findTriggerPrice(dailies, side, position, opts = {}) {
		const { down, up } = this.simulate(dailies, position, opts);
		const candidates = side === 'sell' ? down : up;
		const adxRt = opts.adxRate || 0.1;
		const drawRt = opts.drawdownRate || 0.2;
		const raiseRt = opts.raiseRate || 0;
		for (const r of candidates) {
			console.log(r);
			if (side === 'sell') {
				if (r.dead) return { ...r, reason: `＄${r.close.toFixed(0)}，跌 ${r.pct}% ADX 死叉（回撤 ${(r.drawdownRate * 100).scale(2)}%）`, status: 'sell' };
				if (adxRt && r.adxRate < -adxRt) return { ...r, reason: `＄${r.close.toFixed(0)}，跌 ${r.pct}% ADX 下降率 ${(r.adxRate * 100).scale(2)}%（回撤 ${(r.drawdownRate * 100).scale(2)}%）`, status: 'sell' };
				if (drawRt && r.drawdownRate >= drawRt) return { ...r, reason: `＄${r.close.toFixed(0)}，跌 ${r.pct}% ADX 高點回撤 ${(r.drawdownRate * 100).scale(2)}%`, status: 'sell' };
			} else {
				if (r.golden && (!adxRt || r.adxRate >= adxRt)) return { ...r, reason: `＄${r.close.toFixed(0)}，漲 ${r.pct}% ADX 金叉${adxRt ? `（斜率 ${(r.adxRate * 100).scale(2)}%）` : ''}${raiseRt ? `，谷底回升 ${(r.raiseRate * 100).scale(2)}%` : ''}`, status: 'buy' };
			}
		}
		// 未觸發：用最後一筆（變動最大）的 ADX 狀態來說明當前趨勢
		const ref = candidates.at(-1);
		const trend = ref.adx >= 25
			? `＄${ref.close.toFixed(0)}，跌 ${ref.pct}% ，ADX ${ref.adx}`
			: `＄${ref.close.toFixed(0)}，跌 ${ref.pct}% ，ADX ${ref.adx}（＜25）`;
		const diffDi = ref.plusDi - ref.minusDi;
		const di = (diffDi > 0) ? `多頭(${diffDi.toFixed(2)})`	: `空頭(${diffDi.toFixed(2)})`;
		const extras = [];
		if (ref.adxRate != null) extras.push(`斜率 ${(ref.adxRate * 100).scale(2)}%`);
		if (raiseRt && side === 'sell' && ref.raiseRate > 0)   extras.push(`谷底回升 ${(ref.raiseRate * 100).scale(2)}%`);
		if (drawRt && side !== 'sell' && ref.drawdownRate > 0) extras.push(`高點回撤 ${(ref.drawdownRate * 100).scale(2)}%`);
		const extra = extras.length ? `，${extras.join('，')}` : '';
		return {
			...ref,
			reason: `${trend}，${di}${extra}`,
			status: side === 'sell' ? 'hold' : 'wait'
		};
	}
}