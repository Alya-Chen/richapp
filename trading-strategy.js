import * as dateFns from 'date-fns';
// ============================================================
// trading-strategy.js — 交易策略類別定義
//
// 結構：
//   1. 基礎工具   → Cache, MACD_CACHE, RSI_CACHE, ADX_CACHE …
//   2. 日線策略   → TwoDaysUpEntry, DynamicStopExit, Tiger, Rsi …
//   3. 複合策略   → AdxMacdEntryExit, ObvMacdEntryExit, BBEntryExit
//   4. 週線策略   → WeeklyTrendEntry, WeeklyTrendExit
//   5. 預設組合   → STRATEGY_PRESETS（供 CLI / UI 匯入）
// ============================================================

import { Macd, Kdj, Rsi, BullBear, BollingerBands, Adx, Utils } from './static/js/macd-kdj.js';
import { ObvMacd } from './static/js/obv-macd.js';

class Cache {
	constructor(claz, params) {
		this.claz = claz;
		this.params = params || {};
		this.cache = {};
		this.date = new Date().toDateString();
	}

	get(code, data) {
		const key = code + '-' + (data?.length || 0);
		if (this.date != new Date().toDateString()) {
			this.date = new Date().toDateString();
			this.cache = {};
		}
		if (!this.cache[key]) {
			this.cache[key] = new this.claz(data, this.params).calculate();
		}
		return this.cache[key];
	}
	set(code, value) {
		const key = code + '-' + (value?.length || 0);
		this.cache[key] = value;
	}
}

const RSI_CACHE = new Cache(Rsi);
const MACD_CACHE = new Cache(Macd);
const KDJ_CACHE = new Cache(Kdj);
const ADX_CACHE = new Cache(Adx);

export class TwoDaysUpEntry {
	static name = '連兩日走高進場策略';
	static enabled = true;
	static maSensitive = true;
	static crossTimeframe = true;
	constructor(data, params) {
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
		if (!marketFilter(this.params, day.date)) return false;

		const prevDay = this.data[index - 1];
		// 今日收盤價 > 今日 MA * 1.xx 而且 昨日收盤價 > 昨日 MA * 1.xx
		const isUp = day.close > day.ma * (1 + threshold) && prevDay.close > prevDay.ma * (1 + threshold);
		return isUp ? { reason: `${TwoDaysUpEntry.name} 高過 MA ${1 + threshold} 倍` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class DynamicStopExit {
	static name = '動態止盈止損出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data;
		this.params = params;
	}

	// 平倉條件檢查
	checkExit(day, _, position) {
		const {
			stopLossPct,   // 固定止損小於入場價格的如：3%
			takeProfitPct, // 固定止盈大於入場價格的如：10%
			dynamicStopPct, // 動態止損小於曾經最高價格的如：5%
			partialProfitPct, // 部分止盈大於入場價格的如：5%
			partialProfitRatio, // 部分止盈的比例如：0.5
			maxHoldPeriod // 最大持倉周期如：30 天
		} = this.params;

		const exitConditions = [];
		// 固定止損出清
		if (stopLossPct) {
			exitConditions.push({
				reason: `止損出清：${day.close.scale()} 小於入場 ${position.entryPrice.scale()} 的 ${(stopLossPct * 100).scale(2)}%`,
				condition: day.close <= position.entryPrice * (1 - stopLossPct)
			});
		}
		// 部分止盈
		if (partialProfitPct && !position.partialExits) {
			const profit = day.close - position.entryPrice;
			const profitPct = profit / position.entryPrice;
			exitConditions.push({
				ratio: partialProfitRatio,
				reason: `部分止盈 ${partialProfitRatio * 100}%：每股獲利 ${profit.scale(2)} 元（${(profitPct * 100).scale(2)}%）`,
				condition: day.close >= position.entryPrice * (1 + partialProfitPct),
				status: `closed-${(partialProfitRatio * 100).scale()}%`
			});
		}
		// 固定止盈出清
		if (takeProfitPct) {
			exitConditions.push({
				reason: `止盈出清：${day.close.scale()} 大於入場 ${position.entryPrice.scale()} 的 ${takeProfitPct * 100}%`,
				condition: day.close >= position.entryPrice * (1 + takeProfitPct),
				status: 'closed'
			});
		}
		// 最高價回撤出清
		if (dynamicStopPct) {
			// 更新交易日最高價格
			position.high = Math.max(position.high || 0, day.close);
			const dynamicStop = position.high * (1 - dynamicStopPct);
			exitConditions.push({
				reason: `最高價回撤出清：${day.close.scale()} 小於最高價 ${position.high.scale()} 的 ${(dynamicStopPct * 100).scale()}%`,
				condition: day.close <= dynamicStop
			});
		}
		// 時間止損最大持倉天數
		if (maxHoldPeriod) {
			exitConditions.push({
				reason: `最大持倉天數大於 ${maxHoldPeriod} 天`,
				condition: day.date - position.entryDate > maxHoldPeriod * 24 * 60 * 60 * 1000
			});
		}
		return exitConditions.find(c => c.condition);
	}
}

///////////////////////////////////////////////////////////////////////////////
export class TigerEntry {
	static name = '金唬男均線突破進場策略';
	static enabled = true;
	static maSensitive = true;
	constructor(data, params) {
		this.data = data;
		this.params = params;
		this.params.volumeRate = params.volumeRate || 1.2; // 交易增量倍數
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
		return (isUp && breakout && volumeCond) ? { reason: `${TigerEntry.name} ${day.close.scale()} > ${day.ma.scale()}` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class TigerExit {
	static name = '金唬男均線出場場策略';
	static enabled = true;
	static maSensitive = true;
	constructor(data, params) {
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
	static name = '牛市金唬男均線突破進場策略';
	static enabled = true;
	static maSensitive = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		if (!this.data.length) return;
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
export class RsiHotExit {
	static name = 'RSI 過熱出場策略';
	static enabled = true;
	constructor(data, params) {
		this.data = data;
		this.params = params;
		this.rsi = RSI_CACHE.get(params.code, data);
	}

	// 平倉條件檢查
	checkExit(day) {
		const time = Date.parse(day.date);
		const rsiExit = this.rsi.find(r => r && r.time == time && r.dead);
		return rsiExit ? { reason: `RSI 過熱出場：${rsiExit.rsi.scale()}` } : null;
	}
}
///////////////////////////////////////////////////////////////////////////////
export class RsiExit {
	static CACHE = {};
	static name = 'RSI 長短週期死叉出場策略';
	static enabled = true;

	constructor(data, params) {
		this.short = params.rsiShort || 5;
		this.long = params.rsiLong || 10;
		this.data = data;
		this.params = params;

		if (!RsiExit.CACHE[this.params.code + this.short]) {
			RsiExit.CACHE[this.params.code + this.short] = new Cache(Rsi, { period: this.short });
		}
		if (!RsiExit.CACHE[this.params.code + this.long]) {
			RsiExit.CACHE[this.params.code + this.long] = new Cache(Rsi, { period: this.long });
		}
		this.rsiShortValues = RsiExit.CACHE[this.params.code + this.short].get(this.params.code, this.data);
		this.rsiLongValues = RsiExit.CACHE[this.params.code + this.long].get(this.params.code, this.data);
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		if (index < 1) return null;

		// 從預先算好的陣列中取得 RSI 值
		const rsiPrevShort = this.rsiShortValues[index - 1]?.rsi;
		const rsiTodayShort = this.rsiShortValues[index]?.rsi;
		const rsiPrevLong = this.rsiLongValues[index - 1]?.rsi;
		const rsiTodayLong = this.rsiLongValues[index]?.rsi;

		// 確保資料存在
		if ([rsiPrevShort, rsiTodayShort, rsiPrevLong, rsiTodayLong].some(v => v == null)) {
			return null;
		}

		// RSI 死叉：RSI 短線由上往下穿越長線
		const cross = rsiPrevShort >= rsiPrevLong && rsiTodayShort < rsiTodayLong;
		if (cross) {
			return { reason: `RSI(${this.short}/${this.long}) 死叉出場：${rsiTodayShort.scale()} < ${rsiTodayLong.scale()}` }
		}
		return null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class MaCrossEntryExit {
	static name = 'MA 交叉進出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		if (this.data.length > 0) {
			params.ma1 = params.ma1 || 5;
			params.ma2 = params.ma2 || 10;
			params.ma3 = params.ma3 || 60;
			this.calculateMA(params.ma1);
			this.calculateMA(params.ma2);
			this.calculateMA(params.ma3);
			this.rsi = RSI_CACHE.get(params.code, data);
		}
	}

	calculateMA(period) {
		const maKey = `ma${period}`;
		for (let i = 0; i < this.data.length; i++) {
			if (i < period - 1) {
				this.data[i][maKey] = null;
			} else {
				let sum = 0;
				for (let j = 0; j < period; j++) {
					sum += this.data[i - j].close;
				}
				this.data[i][maKey] = sum / period;
			}
		}
	}

	// 開倉條件檢查
	checkEntry(_, index, position) {
		if (index < 1 || position.status != 'closed') return false;

		const prev = this.data[index - 1];
		const day = this.data[index];
		const ma1 = `ma${this.params.ma1}`; // 短線
		const ma2 = `ma${this.params.ma2}`; // 中線
		const ma3 = `ma${this.params.ma3}`; // 生命線
		const rsiThreshold = this.params.rsiThreshold;

		// 確保兩天的均線數據都存在
		if (day[ma1] == null || day[ma2] == null || day[ma3] == null || prev[ma1] == null || prev[ma2] == null || prev[ma3] == null) {
			return null;
		}

		const time = Date.parse(day.date);
		const rsi = this.rsi.find(r => r && r.time == time)?.rsi;
		if (rsiThreshold && rsi > rsiThreshold) return null; // RSI 過熱不入場
		// 黃金交叉：ma1 從下方穿越 ma2 且當日股價 >= ma3
		let goldenCross = prev[ma1] <= prev[ma2] && day[ma1] > day[ma2] && day.close >= day[ma3];
		if (!goldenCross) {
			// 昨日收盤價在 ma3 以下，且昨日與今日 ma1 都在 ma2 上，且今日股價 >= ma3
			goldenCross = prev.close < prev[ma3] && prev[ma1] > prev[ma2] && day[ma1] > day[ma2] && day.close >= day[ma3];
		}
		return goldenCross ? { reason: `黃金交叉: ${ma1} > ${ma2} 且 ${day.close.scale()} >= ${day[ma3].scale()} RSI: ${rsi?.scale()}` } : null;
	}

	// 平倉條件檢查
	checkExit(_, index, position) {
		if (index < 1) return false;

		const prev = this.data[index - 1];
		const day = this.data[index];
		const ma1 = `ma${this.params.ma1}`; // 短線
		const ma2 = `ma${this.params.ma2}`; // 中線
		const ma3 = `ma${this.params.ma3}`; // 生命線

		// 確保兩天的均線數據都存在
		if (day[ma1] == null || day[ma2] == null || prev[ma1] == null || prev[ma2] == null) {
			return null;
		}

		// 死亡交叉：ma1 從上方穿越 ma2 且當日股價 <= ma3
		let deathCross = prev[ma1] >= prev[ma2] && day[ma1] < day[ma2];
		//return deathCross ? { reason: `死亡交叉: ${ma1} < ${ma2}` } : null;
		if (deathCross) {
			return { reason: `死亡交叉: ${ma1} < ${ma2}` };
		}
		else {
			deathCross = prev.close < prev[ma3] && day.close < day[ma3];
			return deathCross ? { reason: `連續兩日破生命線: ${prev.close.scale()} < ${prev[ma3].scale()} 且 ${day.close.scale()} < ${day[ma3].scale()}` } : null;
		}
	}
}

///////////////////////////////////////////////////////////////////////////////
export class AdxEntry {
	static name = 'ADX 進場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		this.params.adxRate = params.adxRate || 0;
		this.adx = params.weekly
			? new Adx(data, { period: 14, threshold: 25 }).calculate()
			: ADX_CACHE.get(params.code, data);
	}

	// 開倉條件檢查
	checkEntry(day, index, position) {
		const time = Date.parse(day.date);
		const adx = this.adx.find(i => i && i.time == time);
		// 若設定 adxRate 三日斜率門檻，先作過濾
		if (index < 1 || position.status != 'closed' || adx == null || adx.adx == null || adx.adxRate < this.params.adxRate) {
			return null;
		}
		// ADX 數值範圍濾網：過低（趨勢不明）或過高（過度延伸）都不進場
		if (this.params.adxThreshold != null && adx.adx < this.params.adxThreshold) return null;
		if (this.params.adxMaxThreshold != null && adx.adx > this.params.adxMaxThreshold) return null;
		if (!marketFilter(this.params, day.date)) return null;

		// 追蹤 ADX 低點（用於谷底回升率計算）
		position.adxLow = Math.min(position.adxLow || 100, adx.adx);
		const raiseRate = position.adxLow ? (adx.adx - position.adxLow) / position.adxLow : 0;
		const adxNote = `三日斜率：${(adx.adxRate * 100).scale(2)}%，谷底回升率：${(raiseRate * 100).scale(2)}%，日：${adx.adx.scale(2)}` + (adx.week ? `／週：${adx.week.scale(2)}` : '');

		// 金叉：標準進場訊號，reentry 不論 true/false 都允許
		if (adx.golden) {
			return { reason: `${AdxEntry.name} 金叉（${adx.plusDi.scale(2)} > ${adx.minusDi.scale(2)}）${adxNote}` };
		}

		// raiseRate 谷底回升：僅在 reentry=true 且已出場過才允許（此為「返場」）
		if (this.params.reentry && this.params.raiseRate > 0 && position.exitDate && raiseRate >= this.params.raiseRate) {
			return { reason: `${AdxEntry.name} 谷底回升（${(raiseRate * 100).scale(2)}% ≥ ${(this.params.raiseRate * 100).scale(2)}%）${adxNote}` };
		}

		return null;
	}
}

export class AdxExit {
	static name = 'ADX 出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		this.params.adxRate = params.adxRate || 0;
		this.adx = params.weekly
			? new Adx(data, { period: 14, threshold: 25 }).calculate()
			: ADX_CACHE.get(params.code, data);
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		const time = Date.parse(day.date);
		const adx = this.adx.find(i => i && i.time == time);
		if (index < 1 || adx == null || adx.adx == null) return null;
		const adxNote = `三日斜率：${(adx.adxRate * 100).scale(2)}%，日：${adx.adx?.scale(2)}` + (adx.week ? `／週：${adx.week.scale(2)}` : '');
		if (this.params.adxRate && adx.adxRate < -this.params.adxRate) {
			return { reason: `${AdxExit.name} 下降率強烈 ${adxNote}` };
		}
		position.adxHigh = Math.max(position.adxHigh || 0, adx.adx);
		const drawdownRate = position.adxHigh ? (position.adxHigh - adx.adx) / adx.adx : 0;
		if (this.params.drawdownRate && drawdownRate > this.params.drawdownRate) {
			return { reason: `${AdxExit.name} 高點回撤率：-${(drawdownRate * 100).scale(2)}% 強烈 ${adxNote}` };
		}
		return adx.dead ? { reason: `${AdxExit.name} 死叉（${adx.minusDi.scale(2)} > ${adx.plusDi.scale(2)}）${adxNote}` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
export class MacdEntry {
	static name = 'MACD 進場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		this.macd = MACD_CACHE.get(params.code, data);
	}

	// 開倉條件檢查
	checkEntry(day, index, position) {
		const time = Date.parse(day.date);
		const macd = this.macd.find(i => i && i.time == time);
		if (index < 1 || position.status != 'closed' || macd == null) return null;
		if (!marketFilter(this.params, day.date)) return null;
		return macd.golden ? { reason: `${MacdEntry.name} 金叉，信心：${macd.score}（快 ${(macd.diff||0).scale()} > 慢 ${(macd.dea||0).scale()}）` } : null;
	}
}

export class MacdExit {
	static name = 'MACD 出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		this.macd = MACD_CACHE.get(params.code, data);
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		const time = Date.parse(day.date);
		const macd = this.macd.find(i => i && i.time == time);
		if (index < 1 || macd == null) return null;
		return macd.dead ? { reason: `${MacdExit.name} 死叉，信心：${macd.score}（慢 ${(macd.dea||0).scale()} > 快 ${(macd.diff||0).scale()}）` } : null;
	}
}

///////////////////////////////////////////////////////////////////////////////
// MacdMixEntry/MacdMixExit — 日線資料 + 內部週線 MACD
// 接收日線資料，內部壓成週線計算 MACD，只在完整週結束日檢查訊號。
// 進場條件：週線金叉 && (日線 DIF ≥ 0 || 日線金叉)
// 出場條件：週線死叉
///////////////////////////////////////////////////////////////////////////////
export class MacdMixEntry {
	static name = 'MACD 混合進場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		const weeklyData = Utils.toWeekly(data, { weekEndDay: 5 });
		this.macd = new Macd(data).calculate();
		this.weeklyMacd = new Macd(weeklyData).calculate();
	}

	_isWeekEnd(index) {
		if (index >= this.data.length - 1) return true;
		const d1 = new Date(this.data[index].date);
		const d2 = new Date(this.data[index + 1].date);
		// 若下筆資料與本筆不在同一 ISO 週，則本筆為週末
		const w1 = dateFns.getISOWeek(d1);
		const w2 = dateFns.getISOWeek(d2);
		return w1 !== w2 || d1.getFullYear() !== d2.getFullYear();
	}

	checkEntry(day, index, position) {
		if (index < 1 || position.status != 'closed') return null;
		if (!this._isWeekEnd(index)) return null; // 只在本週末檢查
		const time = Date.parse(day.date);
		const w = this.weeklyMacd.find(i => i && i.time == time);
		if (!w?.golden) return null;
		// 日線濾網：柱狀圖向上（動能增強中）
		const idx = this.macd.findIndex(i => i && i.time == time);
		const d = this.macd[idx];
		const prev = this.macd[idx - 1];
		if (!d || !prev || d.histogram <= prev.histogram) return null;
		if (!marketFilter(this.params, day.date)) return null;
		return { reason: `${MacdMixEntry.name} 週金叉+日柱向上（週DIF ${(w.diff||0).scale()} > 週DEA ${(w.dea||0).scale()}，日柱 ${(d.histogram||0).scale()} > ${(prev.histogram||0).scale()}）` };
	}
}

export class MacdMixExit {
	static name = 'MACD 混合出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		const weeklyData = Utils.toWeekly(data, { weekEndDay: 5 });
		this.macd = new Macd(data).calculate();
		this.weeklyMacd = new Macd(weeklyData).calculate();
	}

	_isWeekEnd(index) {
		if (index >= this.data.length - 1) return true;
		const d1 = new Date(this.data[index].date);
		const d2 = new Date(this.data[index + 1].date);
		const w1 = dateFns.getISOWeek(d1);
		const w2 = dateFns.getISOWeek(d2);
		return w1 !== w2 || d1.getFullYear() !== d2.getFullYear();
	}

	checkExit(day, index, position) {
		if (index < 1) return null;
		const time = Date.parse(day.date);
		const w = this.weeklyMacd.find(i => i && i.time == time);
		if (!w?.dead) return null;
		return { reason: `${MacdMixExit.name} 週死叉（週DIF ${(w.diff||0).scale()} < 週DEA ${(w.dea||0).scale()}）` };
	}
}

///////////////////////////////////////////////////////////////////////////////
export class AdxMacdEntryExit {
	// 若 ADX < 20 → 只用 MACD
	// 若 ADX 20～25 → MACD 為主，少量 ADX 試單
	// 若 ADX > 25 且上升 → 停用 MACD，全面用 ADX
	static name = 'ADX＋MACD 進出場策略';
	static enabled = true;
	static crossTimeframe = true;
	constructor(data, params) {
		this.data = data || [];
		this.params = params;
		this.params.macdBullishExtend = params.macdBullishExtend ?? false;
		this.adx = ADX_CACHE.get(params.code, data);
		this.adxEntry = new AdxEntry(data, params);
		this.adxExit = new AdxExit(data, params);
		this.macdEntry = new MacdEntry(data, params);
		this.macdExit = new MacdExit(data, params);
	}

	// 開倉條件檢查
	checkEntry(day, index, position) {
		const time = Date.parse(day.date);
		const adx = this.adx.find(i => i && i.time == time);
		if (index < 1 || position.status != 'closed' || adx == null || adx.adx == null) return null;
		if (!marketFilter(this.params, day.date)) return null;
		if (adx.adx < 20) return this.macdEntry.checkEntry(day, index, position);
		if (adx.adx >= 20 && adx.adx <= 25) return this.macdEntry.checkEntry(day, index, position) || this.adxEntry.checkEntry(day, index, position);
		if (adx.adx > 25) {
			// 先試 ADX 本身訊號
			const adxSignal = this.adxEntry.checkEntry(day, index, position);
			if (adxSignal) return adxSignal;
			// ADX>25 強勢趨勢但無 ADX 金叉：若 MACD 仍在多頭區間且動能持續加溫，視為延續訊號（可選，macdBullishExtend=true）
			if (this.params.macdBullishExtend && adx.adx < 40) {
				const macdData = this.macdEntry.macd?.find(i => i && i.time == time);
				const prevAdx = this.adx.find(i => i && i.time < time);
				if (macdData && macdData.diff != null && macdData.dea != null && macdData.diff > macdData.dea && adx.adx > (prevAdx?.adx || 0)) {
					return { reason: `ADX強勢＋MACD多頭延續（${macdData.diff.scale(2)} > ${macdData.dea.scale(2)}）` };
				}
			}
			return null;
		}
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		const time = Date.parse(day.date);
		const adx = this.adx.find(i => i && i.time == time);
		if (index < 1 || adx == null || adx.adx == null) return null;
		// macdBullishExtend 出場：ADX 高檔動能竭盡（ADX曾>40＋掉頭）
		if (this.params.macdBullishExtend) {
			const prevAdx = this.adx.reduce((best, i) => (i && i.time < time && (!best || i.time > best.time)) ? i : best, null);
			if (prevAdx && prevAdx.adx > 40 && adx.adx < prevAdx.adx) {
				return { reason: `ADX高檔動能竭盡（${prevAdx.adx.scale(2)}→${adx.adx.scale(2)}），波段停利` };
			}
		}
		if (adx.adx < 20) return this.macdExit.checkExit(day, index, position);
		if (adx.adx >= 20 && adx.adx <= 25) return this.macdExit.checkExit(day, index, position) || this.adxExit.checkExit(day, index, position);
		if (adx.adx > 25) return this.adxExit.checkExit(day, index, position);
	}
}
// ── 共用輔助函式 ──

// 大盤濾網：檢查 dayDate 當日 0050 是否位於 MA20 之上
function marketFilter(params, dayDate) {
	if (!params.marketFilter) return true;
	const time = Date.parse(dayDate);
	// 找最接近當日（且 <= 當日）的 marketData 筆
	const row = (params.marketData || []).slice().reverse().find(d => Date.parse(d.date) <= time);
	if (!row || row.ma20 == null) return true; // MA 未就緒時不擋
	return params.marketAboveMA !== false ? row.close > row.ma20 : row.close < row.ma20;
}

///////////////////////////////////////////////////////////////////////////////
export class ObvMacdEntryExit {
	static name = 'OBV MACD 策略';
	static enabled = true;
	constructor(data, params = {}) {
		this.data = data || [];
		this.params = Object.assign({
			maType: 'DEMA',
			maLength: 9,
			slowLength: 26,
			minConfidence: 0.6
		}, params);

		// 計算 OBV MACD 指標並取得所有信號
		const obvMacd = new ObvMacd(this.data, {
			maType: this.params.maType,
			maLength: this.params.maLength,
			slowLength: this.params.slowLength
		});
		this.signals = obvMacd.getAllSignals();
	}

	// 開倉條件檢查
	checkEntry(day, index, position) {
		if (index < 1 || position.status != 'closed') return null;
		if (!marketFilter(this.params, day.date)) return null;

		const currentSignal = this.signals[index];
		const prevSignal = this.signals[index - 1];

		if (!currentSignal || !prevSignal) return null;

		// 買入條件：
		// 1. signal 為 'buy'
		// 2. confidence 達到最低要求
		// 3. trend 為 'bullish' 或 'neutral'
		const isBuySignal = currentSignal.signal === 'buy';
		const hasConfidence = currentSignal.confidence >= this.params.minConfidence;
		const isValidTrend = currentSignal.trend === 'bullish' || currentSignal.trend === 'neutral';

		if (isBuySignal && hasConfidence && isValidTrend) {
			return {
				reason: `${ObvMacdEntryExit.name} ${currentSignal.signalSource} 信號`,
				confidence: currentSignal.confidence,
				signalSource: currentSignal.signalSource,
				trend: currentSignal.trend
			};
		}

		return null;
	}

	// 平倉條件檢查
	checkExit(day, index, position) {
		if (index < 1) return null;

		const currentSignal = this.signals[index];
		const prevSignal = this.signals[index - 1];

		if (!currentSignal || !prevSignal) return null;

		// 賣出條件：
		// 1. signal 為 'sell'
		// 2. confidence 達到最低要求
		// 3. trend 為 'bearish' 或 'neutral'
		const isSellSignal = currentSignal.signal === 'sell';
		const hasConfidence = currentSignal.confidence >= this.params.minConfidence;
		const isValidTrend = currentSignal.trend === 'bearish' || currentSignal.trend === 'neutral';
		if (isSellSignal && hasConfidence && isValidTrend) {
			return {
				reason: `${ObvMacdEntryExit.name} ${currentSignal.signalSource} 信號`,
				confidence: currentSignal.confidence,
				signalSource: currentSignal.signalSource,
				trend: currentSignal.trend
			};
		}
		return null;
	}
}
///////////////////////////////////////////////////////////////////////////////
export class BBEntryExit {
	static name = '布林帶策略';
	static enabled = true;
	static maSensitive = true;
	static crossTimeframe = true;
	constructor(data, params = {}) {
		this.data = data || [];
		this.params = Object.assign({
			period: params.ma ?? 20,
			k:2, // 標準差倍數
			bwLookback: 100, // 帶寬分位數的回看天數
			bwPercentile: 20, // 低波動門檻：近 bwLookback 日的 20% 分位
			shortHighLookback: 20, // 規則2「創短期新高」的回看天數
			atrMul: 1 // 停損 ATR 倍數（規則1）
		}, params);

		if (this.data.length < this.params.period) return;

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
		if (index < 1 || !day.bb || !this.data[index-1]?.bb) return null;
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
					profit1At: day.bb.middle ?? null,
					scale1Ratio: 0.5,
					profit2At: day.bb.upper ?? null,
					scale2Ratio: 0.5
				}
			};
		}
		return null;
	}

	// ========= 規則 2：突破多 =========
	// 帶寬 < 近 100 日 20% 分位；Day1 收盤 > 上軌；Day2 不回帶(收>上軌) 且 創短期新高 → 買
	checkRule2Long(day, index) {
		if (index < 1 || !day.bb || !this.data[index-1]?.bb) return null;
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
				reason: `布林帶突破多：低帶寬 ${day.bb.bandwidth.scale(2)} + 二日上軌外 ${day.bb.upper.scale(2)} 且創短期新高 ${shortHigh.scale(2)}`
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
		if (index < 1 || !day.bb) return null;
		const prev = this.data[index - 1];
		if ([day.low, day.close, day.bb.middle, prev.close].some(v => v == null)) return null;
		const touchedMiddle = day.low <= day.bb.middle * 1.001; // 允許一點誤差
		const reclaimedMiddle = day.close > day.bb.middle;
		const momentumUp = day.close > prev.close;
		if (touchedMiddle && reclaimedMiddle && momentumUp) {
			return {
				action: 'pyramid',
				reason: `沿上軌行進中回踩不破中軌 ${day.bb.middle.scale(2)} 且轉強，加碼`
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
		if (position.status == 'closed') return null;
		if (index < 1 || !day.bb) return null;
		if (day.close > day.bb.middle) position.seenAboveMiddle = true;
		const prev = this.data[index - 1];
		// 規則2的出場：連續兩日收盤 < 中軌
		if (position.seenAboveMiddle && day.bb.middle != null && prev.bb?.middle != null) {
			const twoDaysBelowMiddle = (prev.close < prev.bb.middle) && (day.close < day.bb.middle);
			if (twoDaysBelowMiddle) {
				return {
					reason: `出清：已上中軌後，連兩日收盤跌破中軌 ${day.bb.middle.scale(2)}`
				};
			}
		}
		// 動態防守（適用規則1）：收盤 < (入場價 - ATR×1) 或 跌破最近關鍵低點
		if (position.reason.startsWith('布林帶反轉多') && day.atr != null && position.entryPrice != null) {
			const atrStop = position.entryPrice - this.params.atrMul * day.atr;
			if (day.close < atrStop) {
				return {
					reason: `出清：跌破 ATR×${this.params.atrMul} ${atrStop.scale(2)} 動態停損`
				};
			}
			if (position.day2Low != null && day.close < position.day2Low) {
				return {
					reason: `出清：跌破 Day2 低點 ${position.day2Low.scale(2)} 停損`
				};
			}
		}
		// 分批止盈的執行通常在撮合層根據目標價位觸發，這裡僅提供判斷參考：
		// 若尚未出 50%，且當日高點 >= 中軌：觸發 profit1
		// 若尚未全出，且當日高點 >= 上軌：觸發 profit2
		if (position.takeProfitPlan) {
			const {
				profit1At,
				profit2At
			} = position.takeProfitPlan;
			if (!position.tookProfit1 && profit1At != null && day.high >= profit1At) {
				position.tookProfit1 = true;
				return {
					ratio: 0.5,
					reason: `先出 50%：到達入場中軌 ${profit1At.scale(2)}`,
					status: 'closed-50%'
				};
			}
			if (!position.tookProfit2 && profit2At != null && day.high >= profit2At) {
				position.tookProfit2 = true;
				return {
					ratio: position.tookProfit1 ? 0.5 : 1,
					reason: `出清：到達入場上軌 ${profit2At.scale(2)}`,
					status: 'closed'
				};
			}
		}
		return null;
	}
}

// ============== 週線趨勢策略 ==============

export class WeeklyTrendEntry {
	static name = '週線趨勢進場';
	static enabled = true;
	constructor(data, params) {
		this.data = data;
		this.params = params;
		this.params.goldenLookback = params.goldenLookback || 3; // 金叉後 N 週內回踩 5MA 都算
		this.params.maxDeviation = params.maxDeviation || 0.1;   // 價格偏離 MA5 上限（正乖離率）
		this.params.maxWeeklyVol = params.maxWeeklyVol || 0.04; // 週波動率上限（過高波動不進）
		this.calcMAs();
		this.macd = new Macd(data).calculate();
	}

	calcMAs() {
		for (const [period, key] of [[5, 'ma5'], [10, 'ma10'], [20, 'ma20']]) {
			for (let i = 0; i < this.data.length; i++) {
				if (i < period - 1) {
					this.data[i][key] = null;
				} else {
					let sum = 0;
					for (let j = 0; j < period; j++) sum += this.data[i - j].close;
					this.data[i][key] = sum / period;
				}
			}
		}
	}

	checkEntry(day, index, position) {
		if (index < 20 || position.status !== 'closed') return null;

		// 多頭排列：MA5 > MA10（放掉 MA20，增加起漲點捕捉）
		if (!(day.ma5 > day.ma10)) return null;

		// MACD 週金叉（近 N 週內曾發生，預設 3 週）
		const lb = Math.max(0, index - this.params.goldenLookback);
		const recentGolden = this.macd.slice(lb, index + 1).some(m => m && m.golden);
		if (!recentGolden) return null;

		// 股價接近 MA5（正乖離率上限 maxDeviation，預設 10%）
		if (day.close < day.ma5 * 0.97 || day.close > day.ma5 * (1 + this.params.maxDeviation)) return null;

		// 成交量不低於前 5 週均量（只過濾極度萎縮）
		const slice = this.data.slice(Math.max(0, index - 5), index);
		const avgVol = slice.reduce((s, d) => s + (d.volume || 0), 0) / Math.min(5, Math.max(1, slice.length));
		if (avgVol > 0 && (day.volume || 0) < avgVol * 1.0) return null;

		// 週波動率過濾（近 10 週平均波動過高不進，避免高波動股假訊號）
		const n = Math.min(10, index);
		let sumVol = 0;
		for (let i = 0; i < n; i++) {
			const curr = this.data[index - i];
			const prev = this.data[index - i - 1];
			sumVol += Math.abs(curr.close - prev.close) / prev.close;
		}
		if (sumVol / n > this.params.maxWeeklyVol) return null;

		return { reason: `${WeeklyTrendEntry.name} MA5:${day.ma5.scale()} MA10:${day.ma10.scale()} MA20:${day.ma20.scale()} Vol:${((day.volume || 0) / avgVol).scale(1)}x` };
	}
}

export class WeeklyTrendExit {
	static name = '週線趨勢出場';
	static enabled = true;
	constructor(data, params) {
		this.data = data;
		this.params = params;
		this.params.trailingStopPct = params.trailingStopPct || 0.1; // 移動停利：從最高點回落 %
		this.calcMAs();
		this.macd = new Macd(data).calculate();
	}

	calcMAs() {
		for (const [period, key] of [[5, 'ma5'], [10, 'ma10'], [20, 'ma20']]) {
			for (let i = 0; i < this.data.length; i++) {
				if (i < period - 1) {
					this.data[i][key] = null;
				} else {
					let sum = 0;
					for (let j = 0; j < period; j++) sum += this.data[i - j].close;
					this.data[i][key] = sum / period;
				}
			}
		}
	}

	checkExit(day, index, position) {
		if (index < 20) return null;

		const prev = this.data[index - 1];
		if (index >= this.macd.length || index - 1 >= this.macd.length) return null;
		const m = this.macd[index];
		const mp = this.macd[index - 1];
		const trailPct = this.params.trailingStopPct;
		const profitRate = (day.close - position.entryPrice) / position.entryPrice;

		// 追蹤持倉期間最高價
		if (!position.highestPrice || day.close > position.highestPrice) {
			position.highestPrice = day.close;
		}

		if (profitRate <= 0) {
			// === 虧損/打平：MA5 死叉單週確認（快速停損） ===
			if (prev.ma5 != null && prev.ma10 != null && day.ma5 != null && day.ma10 != null &&
			    prev.ma5 >= prev.ma10 && day.ma5 < day.ma10) {
				return { reason: `${WeeklyTrendExit.name} 虧損MA5死叉 ${(profitRate * 100).scale(1)}%` };
			}
		} else {
			// === 獲利中：移動停利 ===
			const drawdown = 1 - day.close / position.highestPrice;
			if (drawdown >= trailPct) {
				return { reason: `${WeeklyTrendExit.name} 移動停利回撤${(drawdown * 100).scale(1)}% ${(profitRate * 100).scale(1)}%獲利了結` };
			}
		}

		// 備用出場條件（不分盈虧皆適用）
		// MACD 死叉
		if (m && m.dead) {
			return { reason: `${WeeklyTrendExit.name} MACD死叉 DIF:${(m.diff || 0).scale()}` };
		}
		// MACD DIF 拐頭向下 + 紅柱
		if (m && mp && m.histogram < 0 && m.diff < mp.diff) {
			return { reason: `${WeeklyTrendExit.name} DIF拐頭 Hist:${(m.histogram || 0).scale()}` };
		}
		// 跌破 20MA（緊急停損）
		if (day.ma20 != null && day.close < day.ma20 * 0.97) {
			return { reason: `${WeeklyTrendExit.name} 跌破20MA ${day.close.scale()} < ${(day.ma20 * 0.97).scale()}` };
		}

		return null;
	}
}

// ============================================================
// 策略組合預設值（供 CLI / UI / 外部匯入使用）
//
// 每組包含:
//   entry     — 進場策略類別名稱（對應 export class XxxEntry）
//   exit      — 出場策略類別名稱陣列
//   weekly    — true 表示此策略使用週線資料（選填）
//   params    — 建議參數，可依情境覆寫
// ============================================================
// 策略預設組合（STRATEGY_PRESETS）
// 每個 preset 包含：entry/exit 策略類別、是否週線(weekly)、簡短說明(desc)、參數群(params)
// params 說明格式：參數名=預設值  說明
// ============================================================
export const STRATEGY_PRESETS = {
	// ── 週線趨勢（保守波段） ──
	// 週線 MA5>MA10 + MACD 金叉確認趨勢 + 回踩 5MA 進場 + 移動停利出場
	// 參數: ma=20(TradingSystem day.ma用), goldenLookback=3(金叉確認期), maxDeviation=0.1(離MA偏差上限)
	//       maxWeeklyVol=0.04(週漲幅上限), trailingStopPct=0.1(移動停利%)
	weeklyTrend: {
		entry: 'WeeklyTrendEntry', exit: ['WeeklyTrendExit'], weekly: true,
		desc: '週線 MA5>MA10 + MACD 金叉 + 回踩5MA + 移動停利',
		params: { ma: 20, goldenLookback: 3, maxDeviation: 0.1, maxWeeklyVol: 0.04, trailingStopPct: 0.1 }
	},

	// ── ADX 日線（短線趨勢） ──
	// ADX +DI/-DI 金叉進場/死叉出場，adxRate 過濾斜率不足的假金叉
	// 參數: ma=20(基礎均線), adxRate=0.1(ADX三日斜率門檻<0.1不進場), drawdownRate=0.2(ADX高點回撤率>20%出場)
	//       reentry=true(允許返場), raiseRate=0.1(返場須ADX谷底回升>10%)
	adx: {
		entry: 'AdxEntry', exit: ['AdxExit'],
		desc: 'ADX +DI/-DI 金叉/死叉 + 谷底回升返場',
		params: { ma: 20, adxRate: 0.1, drawdownRate: 0.2, reentry: true, raiseRate: 0.1 }
	},

	// ── ADX 週線（波段版本） ──
	// 參數同 ADX 日線，僅 ma=8、adxRate=0.05、drawdownRate=0.3
	weeklyAdx: {
		entry: 'AdxEntry', exit: ['AdxExit'], weekly: true,
		desc: 'ADX 週線版，門檻調低避免過度敏感',
		params: { ma: 8, adxRate: 0.05, drawdownRate: 0.3, reentry: true, raiseRate: 0.1 }
	},

	// ── MACD 週線 ──
	// 參數: ma=8(TradingSystem day.ma用，策略本身未使用)
	weeklyMacd: {
		entry: 'MacdEntry', exit: ['MacdExit'], weekly: true,
		desc: 'MACD 週線版，過濾日線假金叉/死叉',
		params: { ma: 8 }
	},
	// ── MACD 混合週線（日線資料 + 內部週線 MACD） ──
	// 接收日線資料，內部壓成週線 MACD。只在完整週結束日檢查，可搭配日線多頭濾網。
	// 參數: ma=8, weekEndDay=5(5=週五)
	weeklyMacdMix: {
		entry: 'MacdMixEntry', exit: ['MacdMixExit'],
		desc: 'MACD 混合週線（日線壓週線 + 週金叉日多頭濾網）',
		params: { ma: 8 }
	},

	// ── ADX+MACD 週線 ──
	// ADX<20只用MACD → ADX 20~25 MACD為主、ADX試單 → ADX>25且上升全面用ADX
	// 參數: ma=8, adxRate=0.05(ADX下降率<-0.05出場), drawdownRate=0.3, reentry=true, raiseRate=0.1
	weeklyAdxMacd: {
		entry: 'AdxMacdEntryExit', exit: ['AdxMacdEntryExit'], weekly: true,
		desc: 'ADX+MACD 週線版',
		params: { ma: 8, adxRate: 0.05, drawdownRate: 0.3, reentry: true, raiseRate: 0.1,
			marketFilter: false, marketCode: '0050', marketMAPeriod: 20, marketAboveMA: true }
	},

	// ── MA交叉 週線 ──
	// MA5 金叉 MA10 且收盤 ≥ 年線(MA52) 進場；MA5 死叉 MA10 出場
	// 參數: ma1=5(短週期), ma2=10(中週期), ma3=52(年線,多空分界)
	weeklyMaCross: {
		entry: 'MaCrossEntryExit', exit: ['MaCrossEntryExit'], weekly: true,
		desc: 'MA 交叉週線版，MA3=52週(年線)',
		params: { ma1: 5, ma2: 10, ma3: 52 }
	},

	// ── 布林通道週線 ──
	// 規則1 反轉多：前週跌破下軌 → 本週反彈過前高入場
	// 規則2 突破多：低波動壓縮(帶寬<歷史20%分位) + 連兩週站上上軌 + 創短期新高入場
	// 出場：已上中軌後連兩週跌破中軌。
	// 參數: ma=20(BB中軌期數), bbPeriod=20, bbStdDev=2, atrPeriod=14, atrMult=1.5
	//       bwLookback=52(帶寬歷史回看週數), shortHighLookback=12(短期新高回看週數)
	weeklyBB: {
		entry: 'BBEntryExit', exit: ['BBEntryExit'], weekly: true,
		desc: '布林通道週線版，低波動壓縮後的大波段',
		params: { ma: 20, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, atrMult: 1.5, bwLookback: 52, shortHighLookback: 12 }
	},

	// ── 連兩週走高週線 ──
	// 連兩週收盤站上 8MA 進場，動態回撤(dynamicStopPct) 出場
	// 策略對 MA 參數不敏感（MA=8 vs MA=16 結果相同），固定 MA=8 即可
	// 參數: ma=8, threshold=0.005(收盤需高於MA比例), dynamicStopPct=0.07(動態回撤%)
	weeklyTwoDays: {
		entry: 'TwoDaysUpEntry', exit: ['DynamicStopExit'], weekly: true,
		desc: '連兩週收盤站上均線進場 + 動態停損',
		params: { ma: 8, threshold: 0.005, dynamicStopPct: 0.07 }
	},

	// ── MACD 金叉/死叉 ──
	// MACD DIF/DEA 金叉進場 / 死叉出場，標準 MACD 交易法
	// 參數: ma=20(TradingSystem day.ma用，策略本身未使用)
	macd: {
		entry: 'MacdEntry', exit: ['MacdExit'],
		desc: 'MACD DIF/DEA 金叉進場 / 死叉出場',
		params: { ma: 20 }
	},

	// ── ADX + MACD 複合 ──
	// ADX<20只用MACD → ADX 20~25 MACD為主、ADX試單 → ADX>25且上升全面用ADX
	// 複合濾網未提升表現，ADX+MACD 週線版(weeklyAdxMacd)較佳
	adxMacd: {
		entry: 'AdxMacdEntryExit', exit: ['AdxMacdEntryExit'],
		desc: 'ADX 判斷趨勢強度 + MACD 決定進出',
		params: { ma: 20, adxRate: 0.1, drawdownRate: 0.2, reentry: true, raiseRate: 0.1 }
	},

	// ── OBV + MACD（已移除） ──
	// 交易成本吃掉大部分獲利，不建議使用。ObvMacdEntryExit 類別保留供參考。

	// ── 布林通道 + ATR（僅保留週線版） ──
	// 保留週線版 weeklyBB（低波動壓縮後的大波段）

	// ── MA 交叉（二條/三條） ──
	// MA5 金叉 MA10 且收盤 ≥ 生命線(MA60) 進場；MA5 死叉或 RSI 死叉出場
	// 參數: ma=20(TradingSystem day.ma用), ma1=5, ma2=10, ma3=60, rsiThreshold=70(RSI過熱不進場)
	maCross: {
		entry: 'MaCrossEntryExit', exit: ['MaCrossEntryExit'],
		desc: '短線 MA 黃金交叉 / 死亡交叉 + 生命線',
		params: { ma: 20, ma1: 5, ma2: 10, ma3: 60, rsiThreshold: 70 }
	},

	// ── 二日突破 + 動態停損 ──
	// 連兩日收盤站上 MA 且成交量放大進場；跌破 MA、動態回撤或 ATR 停損出場
	// 日線版總損益 +16,058 為所有策略最高，頻率 395 筆
	// 參數: ma=20, threshold=0.005(收盤需高於MA比例), volumeRate=1.2(量比>1.2), breakout=true, dynamicStopPct=0.07

	// ── Tiger 突破（日線） ──
	tiger: {
		entry: 'TigerEntry', exit: ['TigerExit', 'DynamicStopExit'],
		desc: '收盤突破 MA 進場 / 跌破 MA 或動態停損出場',
		params: { ma: 5, threshold: 0.005, stopLossPct: 0.03, dynamicStopPct: 0.07 }
	},

	// ── Bull Tiger（強勢突破） ──
	bullTiger: {
		entry: 'BullTigerEntry', exit: ['TigerExit', 'RsiHotExit'],
		desc: '強勢突破 MA + RSI 過熱過濾',
		params: { ma: 5, threshold: 0.005, rsiThreshold: 70 }
	},

	// ── MACD 進場 + RSI 出場 ──
	macdRsi: {
		entry: 'MacdEntry', exit: ['RsiExit'],
		desc: 'MACD 金叉進場，短週期 RSI 跌破長週期 RSI 出場',
		params: { ma: 20 }
	},
};