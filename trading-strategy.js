import * as dateFns from 'date-fns';
import { Macd, Rsi, BullBear } from './static/js/macd-kdj.js';

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