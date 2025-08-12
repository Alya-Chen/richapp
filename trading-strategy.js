import * as dateFns from 'date-fns';
import { Macd, Rsi, BullBear, BollingerBands } from './static/js/macd-kdj.js';

export class TwoDaysUpEntry {
	constructor(data, params) {
		this.name = '連兩日走高進場策略';
		this.data = data;
		this.params = params;
		this.params.threshold = this.params.threshold || 0.005; // 收盤價與 MA 的漲幅需超過 0.05%
	}

	// 開倉條件檢查
	checkEntry(day, index, position) {
		const {
			ma,
			threshold
		} = this.params;
		if (index < ma || position.status != 'closed') return false;

		const prevDay = this.data[index - 1];
		// 今日收盤價 > 今日 MA * 1.xx 而且 昨日收盤價 > 昨日 MA * 1.xx
		const isUp = day.close > day.ma * (1 + threshold) && prevDay.close > prevDay.ma * (1 + threshold);
		return isUp ? { reason: `${this.name} 高過 MA ${1 + threshold} 倍` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class DynamicStopExit {
	constructor(data, params) {
		this.name = '動態止盈止損出場策略';
		this.params = params;
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		const {
			stopLossPct,   // 止損小於入場價格的 3%
			takeProfitPct, // 固定止盈大於入場價格的 10%
			dynamicStopPct, // 動態止損小於曾經最高價格的 5%
			maxHoldPeriod // 最大持倉周期 30 天
		} = this.params;
		
		const exitConditions = [];
		
		// 固定止損
		if (stopLossPct) {
			exitConditions.push({
				reason: `止損觸發：${day.close.scale()} 小於入場價格 ${position.entryPrice.scale()} 的 ${stopLossPct * 100}%`,
				condition: day.close <= position.entryPrice * (1 - stopLossPct)
			});
		}
		// 固定止盈
		if (takeProfitPct) {
			exitConditions.push({
				reason: `止盈觸發：${day.close.scale()} 大於入場價格 ${position.entryPrice.scale()} 的 ${takeProfitPct * 100}%`,
				condition: day.close >= position.entryPrice * (1 + takeProfitPct)
			});
		}
		// 動態止損
		if (dynamicStopPct) {
			const dynamicStop = this.getDynamicStop(day);
			exitConditions.push({
				reason: `止盈觸發：${day.close.scale()} 小於曾經最高價格 ${dynamicStop.scale()} 的 ${dynamicStopPct * 100}%`,
				condition: day.close <= dynamicStop
			});
		}
		// 時間止損（最大持倉周期）
		if (maxHoldPeriod) {
			exitConditions.push({
				reason: `時間止損：交易週期大於 ${maxHoldPeriod} 天`,
				condition: day.date - position.entryDate > maxHoldPeriod * 24 * 60 * 60 * 1000
			});
		}
		
		return exitConditions.find(c => c.condition);
	}
	
	// 更新動態止損，交易日最高價格的 xx%
	getDynamicStop(day) {
	    this.dynamicStop = this.dynamicStop || 0;
		const newStop = day.high * (1 - this.params.dynamicStopPct);
		this.dynamicStop = Math.max(newStop, this.dynamicStop);
		return this.dynamicStop;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class TigerEntry {
	constructor(data, params) {
		this.data = data;
		this.params = params;
		this.params.volumeRate = params.volumeRate || 1.2; // 交易增量倍數
		this.name = `金唬男均線突破${ this.params.breakout ? '二日法則' : '' }進場策略`;
	}
		
	// 開倉條件檢查
	checkEntry(day, index, position) {
		const {
			ma,
			threshold,
			volumeRate
		} = this.params;
		if (index < ma || position.status != 'closed') return false;

		const prev = this.data[index - 1];

		// 均線斜率
		const slopeCond = day.maSlope > 0;
		// 成交量需上升
		const volumeCond = true; //day.volume > (day.volumeMa * volumeRate);
		//if (!slopeCond) {
			// 若在多頭趨勢中，股價下跌測試均線並碰觸後，隔日立刻反彈是最佳買點
			//const isUp = (day.close > prev.close) && (prev.low >= prev.ma);
			//return isUp && volumeCond;
			//return (isUp && volumeCond) ? { reason: `多頭趨勢，股價下跌測試均線並碰觸後，隔日立刻反彈` } : null;
			//}
		// 當股價由下往上【突破】均線時【立刻】買進
		const isUp = day.close > day.ma;
		// 驗證二日法則：隔日股價沒有再創新高為假突破
		const breakout = this.params.breakout ? (prev.close > prev.ma && day.close > prev.close) : true;
		// (day.close > day.ma * (1 + threshold)) && (prev.low > prev.ma);
		// (prev.close > prev.ma * (1 + threshold));
		// slopeCond > 0 均線【上彎】時，均線突破的機率會高很多
		// return isUp && volumeCond && slopeCond;
		return (isUp && breakout && volumeCond) ? { reason: `${this.name} ${day.close.scale()} > ${day.ma.scale()}` } : null;
	}	
}

///////////////////////////////////////////////////////////////////////////////
export class TigerExit {
	constructor(data, params) {
		this.name = '金唬男均線出場場策略';
		this.data = data;
		this.params = params;
	}
	
	// 平倉條件檢查
	checkExit(day, index, position) {
		const threshold = 1 - this.params.threshold;
		const prev = this.data[index - 1];
		// 二日法則驗證失敗，為假突破，入場第三天又破均線，應立刻停損
		if (!position.breakout && dateFns.differenceInDays(new Date(), day) == 2 && day.close < day.ma) {
			return { reason: `金唬男止損，假突破隔日又破均線：${day.close.scale()} < ${day.ma.scale()}` };
		}
		// 透過二日法則來檢驗主力洗盤，連續兩日破均線才出場
		const isDown = (day.close < day.ma * threshold) && (prev.close < prev.ma);
		//(prev.close < prev.ma * (1 - threshold));
		return isDown ? { reason: `金唬男止損，連續兩日破均線：${day.close.scale()} < ${(day.ma * threshold).scale()}` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class BullTigerEntry {
	constructor(data, params) {
		this.name = '牛市金唬男均線突破進場策略';
		this.data = data;
		this.params = params;
		this.tigerEntry = new TigerEntry(data, params);
		this.trendTurns = new BullBear(this.data).calculate();
	}
	
	// 開倉條件檢查
	checkEntry(day, index, position) {
		const pass = this.tigerEntry.checkEntry(day, index, position);
		const isNowBullish = day.ma20 > day.ma60 || day.ma20 > day.ma120;
		if (!pass || !isNowBullish) return false;
		pass.reason = 'MA20>MA60 或 MA20>MA120 ' + pass.reason;
		return pass;		
	}	
}

///////////////////////////////////////////////////////////////////////////////
export class RsiTigerExit {
	static CACHE = { date: new Date().toLocaleDateString() };
	
	constructor(data, params) {
		if (RsiTigerExit.CACHE.date < new Date().toLocaleDateString()) {
			RsiTigerExit.CACHE = { date: new Date().toLocaleDateString() };
			console.log(`＃＃＃＃＃＃＃ ${RsiTigerExit.CACHE.date} 初始化 RsiTigerExit.CACHE ＃＃＃＃＃＃＃`);
		}
		this.name = 'RSI＋金唬男均線出場場策略';
		this.data = data;
		this.params = params;
		this.tigerExit = new TigerExit(data, params);
		this.rsi = (params.code && RsiTigerExit.CACHE.hasOwnProperty(params.code)) ? RsiTigerExit.CACHE[params.code] : new Rsi(this.data).calculate();
		RsiTigerExit.CACHE[params.code] = this.rsi.filter(r => r && r.dead);
	}
	
	// 平倉條件檢查
	checkExit(day, index, position) {
		//const diffRate = (day.close - position.entryPrice) / position.entryPrice;
		//if (diffRate <= -0.05) return { reason: `${toFixed(diffRate * 100)}％ 止損出場` } 
		const time = Date.parse(day.date);
		const rsiExit = this.rsi.find(r => r && r.time == time && r.dead);
		if (rsiExit) {
			return { reason: `RSI 過熱出場：${rsiExit.rsi.scale()}` }
		}
		return this.tigerExit.checkExit(day, index, position);
	}
}

///////////////////////////////////////////////////////////////////////////////
export class MacdMaEntry {
	constructor(data, params) {
		this.name = 'MACD MA 進場策略';
		this.data = data;
		this.params = params;
		this.macd = new Macd(this.data).calculate();
	}
	
	// 開倉條件檢查
	checkEntry(day, index, position) {
		const curr = this.macd[index];
		if (index < 1 || curr == null || position.status != 'closed') return null;
		return (curr.golden) ? { reason: `${this.name} ${curr.signal.scale()} 金叉` } : null;		
	}	
}

export class MacdMaExit {
	constructor(data, params) {
		this.name = 'MACD MA 出場策略';
		this.data = data;
		this.params = params;
		this.macd = new Macd(this.data).calculate();
	}
	
	// 平倉條件檢查
	checkExit(day, index, position) {
		const curr = this.macd[index];
		if (index < 1 || curr == null) return null;
		return (curr.dead) ? { reason: `${this.name} ${curr.signal.scale()} 死叉` } : null;		
	}	
}
///////////////////////////////////////////////////////////////////////////////
export class BBEntryExit {
	constructor(data, params = {}) {
		this.name = '布林帶策略';
		this.data = data || [];
		this.params = Object.assign({
			period: params.ma ?? 20,
			k:2, // 標準差倍數
			bwLookback: 100, // 帶寬分位數的回看天數
			bwPercentile: 20, // 低波動門檻：近 bwLookback 日的 20% 分位
			shortHighLookback: 20, // 規則2「創短期新高」的回看天數
			atrMul: 1 // 停損 ATR 倍數（規則1）
		}, params);
		
		const bb = new BollingerBands(this.data, this.params.period, this.params.k).calculate();
		this.data.forEach((d, i) => d.bb = bb[i]);
		
		const atrs = this.calcATR(this.data, this.params.period);
		this.data.forEach((d, i) => d.atr = atrs[i]);
	}

	calcATR(data, period) {
		let atrValues = [];
		let prevATR = null;
		for (let i = 0; i < data.length; i++) {
			if (i === 0) {
				atrValues.push(null);
				continue;
			}
			const prev = data[i - 1];
			const day = data[i];
			const tr = Math.max(
				day.high - day.low,
				Math.abs(day.high - prev.close),
				Math.abs(day.low - prev.close)
			);
			if (i < period) {
				atrValues.push(null);
			} else if (i === period) {
				// 初始化 ATR：用前 period 根的 TR 平均
				const trs = [];
				for (let j = 1; j <= period; j++) {
					const p = data[j - 1];
					const c = data[j];
					trs.push(Math.max(
						c.high - c.low,
						Math.abs(c.high - p.close),
						Math.abs(c.low - p.close)
					));
				}
				prevATR = trs.reduce((a, b) => a + b, 0) / period;
				atrValues.push(prevATR);
			} else {
				prevATR = ((prevATR * (period - 1)) + tr) / period;
				atrValues.push(prevATR);
			}
		}
		return atrValues;
	}
	
	// 取得近N日中第q(%)分位的帶寬門檻
	getBandwidthPercentile(index) {
		const n = this.params.bwLookback;
		if (index + 1 < n) return null;
		const slice = this.data.slice(index - n + 1, index + 1)
			.map(d => d.bb.bandwidth)
			.filter(v => v != null);
		if (slice.length < n * 0.8) return null; // 資料不足保守跳過
		slice.sort((a, b) => a - b);
		const pos = Math.floor((this.params.bwPercentile / 100) * (slice.length - 1));
		return slice[pos];
	}

	// 近N日最高價（含當日）
	rollingHigh(index, lookback) {
		const s = Math.max(0, index - lookback + 1);
		let h = -Infinity;
		for (let i = s; i <= index; i++) h = Math.max(h, this.data[i].high);
		return h;
	}

	// ========= 規則 1：反轉多 =========
	// Day1 收盤 < 下軌；Day2 收盤 > 下軌 且 > Day1 高點 → 開盤買
	checkRule1Long(day, index) {
		if (index < 1) return null;
		const d1 = this.data[index - 1];
		if ([d1.close, d1.bb.lower, day.close, day.bb.lower, d1.high].some(v => v == null)) return null;
		const condDay1 = d1.close < d1.bb.lower;
		const condDay2 = (day.close > day.bb.lower) && (day.close > d1.high);
		if (condDay1 && condDay2) {
			// 進場價：次日開盤（交給外部撮合）；這裡回傳停損/分批出場邏輯bb.lower
			const stopByDay2Low = (day.low != null) ? day.low : null;
			const atrStop = (day.atr != null) ? day.close - this.params.atrMul * day.atr : null;
			return {
				rule: '布林帶反轉多',
				reason: `布林帶反轉多：前日收破下軌，隔日反彈且過前日高點`,
				day2Low: day.low,
				// 停損兩種策略擇一或外部擇優
				stopLossCandidates: {
					byDay2Low: stopByDay2Low,
					byATR: atrStop
				},
				// 止盈：中軌出50%、上軌全出（給外部引擎執行）
				takeProfitPlan: {
					scale1At: day.bb.middle ?? null,
					scale1Ratio: 0.5,
					scale2At: day.bb.upper ?? null,
					scale2Ratio: 0.5
				}
			};
		}
		return null;
	}

	// ========= 規則 2：突破多 =========
	// 帶寬 < 近100日20%分位；Day1 收盤 > 上軌；Day2 不回帶(收>上軌) 且 創短期新高 → 買
	checkRule2Long(day, index) {
		if (index < 1) return null;
		const d1 = this.data[index - 1];
		if ([d1.close, d1.bb.upper, day.close, day.bb.upper, day.high].some(v => v == null)) return null;
		const bwThresh = this.getBandwidthPercentile(index);
		if (bwThresh == null || day.bb.bandwidth == null) return null;
		const lowVol = day.bb.bandwidth <= bwThresh;
		const d1Break = d1.close > d1.bb.upper;
		const d2Hold = day.close > day.bb.upper; // 不回帶：收盤仍在上軌之上
		const shortHigh = this.rollingHigh(index, this.params.shortHighLookback);
		const d2NewHigh = day.high >= shortHigh;
		if (lowVol && d1Break && d2Hold && d2NewHigh) {
			return {
				rule: '布林帶突破多',
				reason: `布林帶突破多：低帶寬 + 二日上軌外且創短期新高`
			};
		}
		return null;
	}

	/**
	 * 開倉條件檢查（回傳第一個符合的訊號）
	 * @param {*} day   當日K
	 * @param {*} index 當日索引
	 * @param {*} position 當前部位 { status: 'closed' | 'long' | 'short', ... }
	 */
	checkEntry(day, index, position) {
		if (!position || position.status !== 'closed') return null;
		// 先檢查規則1（反轉），再檢查規則2（突破）
		const r1 = this.checkRule1Long(day, index);
		if (r1) return r1;
		const r2 = this.checkRule2Long(day, index);
		if (r2) return r2;
		return null;
	}

	/**
	 * 加碼（僅針對規則2：沿上軌行進期間，回踩不破中軌再轉強可加碼）
	 * 判斷條件（簡化版）：
	 *  - 昨日或更早已在多頭持倉
	 *  - 今日最低觸到/接近中軌，但收盤重新站回中軌之上且高於昨日收盤
	 */
	checkPyramid(day, index, position) {
		if (!position || position.status !== 'long') return null;
		if (index < 1) return null;
		const prev = this.data[index - 1];
		if ([day.low, day.close, day.bb.middle, prev.close].some(v => v == null)) return null;
		const touchedMiddle = day.low <= day.bb.middle * 1.001; // 允許一點誤差
		const reclaimedMiddle = day.close > day.bb.middle;
		const momentumUp = day.close > prev.close;
		if (touchedMiddle && reclaimedMiddle && momentumUp) {
			return {
				action: 'pyramid',
				reason: '沿上軌行進中回踩不破中軌且轉強，加碼'
			};
		}
		return null;
	}

	/**
	 * 出場 / 停損
	 * - 規則1：可採用 Day2 低點 或 ATR×1 作為止損（在入場時已提供候選，這裡做動態防守）
	 * - 規則2：跌破中軌連續兩日 → 出清
	 * - 同時提供：到達中軌/上軌的分批止盈（由撮合層執行）
	 */
	checkExit(day, index, position) {
		if (position.status !== 'open') return null;
		if (index < 1) return null;
		if (day.close > day.bb.middle) position.seenAboveMiddle = true;
		const prev = this.data[index - 1];
		// 規則2的出場：連續兩日收盤 < 中軌
		if (position.seenAboveMiddle && day.bb.middle != null && prev.bb.middle != null) {
			const twoDaysBelowMiddle = (prev.close < prev.bb.middle) && (day.close < day.bb.middle);
			if (twoDaysBelowMiddle) {
				return {
					action: 'exit',
					reason: '規則2：已上中軌後，連兩日收盤跌破中軌，出清'
				};
			}
		}
		// 動態防守（適用規則1）：收盤 < (入場價 - ATR×1) 或 跌破最近關鍵低點
		if (position.reason.startsWith('布林帶反轉多') && day.atr != null && position.entryPrice != null) {
			const atrStop = position.entryPrice - this.params.atrMul * day.atr;
			if (day.close < atrStop) {
				return {
					action: 'stop',
					reason: `規則1：跌破 ATR×${this.params.atrMul} 動態停損`
				};
			}
			if (position.day2Low != null && day.close < position.day2Low) {
				return {
					action: 'stop',
					reason: '規則1：跌破Day2低點停損'
				};
			}
		}
		// 分批止盈的執行通常在撮合層根據目標價位觸發，這裡僅提供判斷參考：
		//   若尚未出 50%，且當日高點 >= 中軌：觸發 scale1
		//   若尚未全出，且當日高點 >= 上軌：觸發 scale2
		if (position.takeProfitPlan) {
			const {
				scale1At,
				scale2At
			} = position.takeProfitPlan;
			if (!position.tookScale1 && scale1At != null && day.high >= scale1At) {
				return {
					action: 'scale1',
					reason: '到達中軌，先出50%'
				};
			}
			if (!position.tookScale2 && scale2At != null && day.high >= scale2At) {
				return {
					action: 'scale2',
					reason: '到達上軌，全數出清'
				};
			}
		}
		return null;
	}
}

///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// 比例法則（適合慢牛市場）分批進場：資金分為 25%, 40%, 35%
// 第一次投入 25% 每上漲超過 3% 再投入下一筆資金
// 動態調整停損：
// 第一筆入場後，停損點為入場價格 * (1 - 5%)
// 第二筆入場後，因為總投入為 65%，停損點為兩筆資金平均價格 * (1 - 2%) 以確保總損失能在 1% 左右
// 第三筆入場後，停損點為三筆資金平均價格，以符合不接受帳面盈餘虧損原則
// 關鍵點買進出場法：單次 all-in 還是分批入場？
// 動態調整停損：
// 跌破均線出場 25%，若後續再破新低再出場 40%，最後的 35% 一樣要符合四大心法原則設定停損點出場
// 跌破均線後若重新突破均線，再回頭加碼 40% -> 35%
export class TigerPartialEntryExit {
	constructor(data, params) {
		this.name = '金唬男均線分批進出場策略';
		this.data = data;
		this.cost = []; // 已經投入的資金
		this.params = params;
		this.params.entryRates = [ 0.25, 0.4, 0.35 ]; // 資金分批進場比例
	}
	
	// 開倉條件檢查
	checkEntry(day, index, position) {
		const {
			entryRates
		} = this.params;
		if (index < ma) return false;
		
		if (position.status == 'closed') {
			this.tigerEntry = new TigerEntry(this.data, this.params);
			if (this.tigerEntry.checkEntry(day, index, position)) {
				const idx = this.cost.length;
				this.cost.push({ price: day.close, rate: entryRates[idx] });
			}
		}
		
		position.avgCost = this.getAvgCost();
	}
	
	getAvgCost() {
		const cost = this.cost.reduce((sum, cost) => sum + (cost.price * cost.rate), 0);
		const rate = this.cost.reduce((sum, cost) => sum + cost.rate, 0);
		return cost / rate;
	}
	
	// 平倉條件檢查
	checkExit(day, index, position) {
	
	}
}