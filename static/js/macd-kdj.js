export class Macd {
    constructor(data, {
        fast = 12,
        slow = 26,
        dea = 9
    } = {}) {
        this.data = data;
        this.fast = fast;
        this.slow = slow;
        this.dea = dea;
    }

    calculate() {
        const data = this.data.map(d => d.close);
        // 計算兩條平滑移動平均數 EMAn1 與 EMAn2
        const fastEMA = this.calculateEMA(data, this.fast);
        const slowEMA = this.calculateEMA(data, this.slow);

        // DIF Line：快線（EMAn1 - EMAn2）
        const diffArray = data.map((_, i) => {
            if (fastEMA[i] === null || slowEMA[i] === null) return null;
            return fastEMA[i] - slowEMA[i];
        });

        const validDiffArray = diffArray.filter(x => x !== null);
        // DEA Line 計算 DIF 差離平均值：慢線 DIF 的 EMAn3 天移動平均
        const deaArray = this.calculateEMA(validDiffArray, this.dea);
        const fullDeaArray = diffArray.map((m, idx) => {
            if (m === null) return null;
            const deaIdx = idx - (this.slow - 1) - (this.dea - 1);
            return deaIdx >= 0 ? deaArray[deaIdx] : null;
        });

        const slopeArray = diffArray.map((m, idx) => {
            if (m === null || idx <= 10) return null;
            const prev10 = diffArray[idx - 10]; // 计算近 10 日均线斜率
            return prev10 && ((m - prev10) / 10) > 0;
        });

        // MACD (紅綠柱) Histogram：DIF - DEA
        const histogramArray = diffArray.map((m, idx) => {
            if (m === null || fullDeaArray[idx] === null) return null;
            return parseFloat((m - fullDeaArray[idx]).scale(3));
        });

        const result = this.data.map((day, idx) => ({
            time: day.date ? Date.parse(day.date) : null,
            diff: diffArray[idx],
            slope: slopeArray[idx],
            dea: fullDeaArray[idx],
            histogram: histogramArray[idx]
        }));
        return this.detectCrossovers(result);
    }

    calculateEMA(values, period) {
        const k = 2 / (period + 1);
        const emaArray = [];
        let ema;

        for (let i = 0; i < values.length; i++) {
            if (i < period - 1) {
                emaArray.push(null);
                continue;
            }
            if (i === period - 1) {
                const sum = values.slice(0, period).reduce((acc, v) => acc + v, 0);
                ema = sum / period;
            } else {
                ema = values[i] * k + ema * (1 - k);
            }
            emaArray.push(ema);
        }
        return emaArray;
    }

    detectCrossovers(diffArray) {
        for (let i = 1; i < diffArray.length; i++) {
            const prev = diffArray[i - 1];
            const curr = diffArray[i];
            if (prev.diff == null || prev.dea == null || curr.diff == null || curr.dea == null) {
                continue;
            }
            if (prev.diff < prev.dea && curr.diff >= curr.dea && curr.dea >= 0) {
                curr.golden = true; // 金叉
            }
            if (prev.diff > prev.dea && curr.diff <= curr.dea && curr.dea >= 0) {
                curr.dead = true; // 死亡交叉
            }
            /*if (!prev.diffSignal && curr.diffSignal) {
            	curr.golden = true; // 金叉
            }
            if (prev.diffSignal && !curr.diffSignal) {
            	curr.dead = true; // 死亡交叉
            }*/
        }
        return diffArray;
    }

    // Bullish Engulfing（看漲吞噬形態） 是一種常見的 K 線反轉形態，通常出現在 下跌趨勢末端，暗示潛在的反轉上漲
    detectBearishEngulfing(diffArray) {
        const result = [false]; // 第一根沒辦法判斷
        for (let i = 1; i < this.data.length; i++) {
            if (!rsiArray[i]) continue;
            const prev = this.data[i - 1];
            const curr = this.data[i];
            const isBullishPrev = prev.close > prev.open;
            const isBearishCurr = curr.close < curr.open;
            const isEngulfingBody = curr.close < prev.open && curr.open > prev.close;
            diffArray[i].bearish = (isBullishPrev && isBearishCurr && isEngulfingBody);
        }
        return diffArray;
    }
}

export class Kdj {
    //9,3,3 / 89,3,3 / 9,3,c
    constructor(data, {
        period = 9,
        k = 3,
        d = 3
    } = {}) {
        this.data = data;
        this.period = period; // 典型 KDJ 週期是9
        this.k = k;
        this.d = d;
    }

    calculate() {
        const result = [];
        let prevK = 50;
        let prevD = 50;
        for (let i = 0; i < this.data.length; i++) {
            const day = this.data[i];
            const time = day.date ? Date.parse(day.date) : null;
            if (i < this.period - 1) {
                result.push({
                    time,
                    k: null,
                    d: null,
                    j: null
                });
                continue;
            }
            const slice = this.data.slice(i - this.period + 1, i + 1);
            const highN = Math.max(...slice.map(d => d.high));
            const lowN = Math.min(...slice.map(d => d.low));
            const currentClose = day.close;
            const rsv = (highN === lowN) ? 50 : ((currentClose - lowN) / (highN - lowN)) * 100;
            // 平滑計算 K 和 D
            const k = (prevK * (this.k - 1) + rsv) / this.k;
            const d = (prevD * (this.d - 1) + k) / this.d;
            const j = 3 * k - 2 * d;
            result.push({
                time,
                k,
                d,
                j
            });
            prevK = k;
            prevD = d;
        }
        return this.detectCrossovers(result);
    }

    detectCrossovers(kdjArray) {
        /*let lastTop = 0;
        for (let i = 1; i < kdjArray.length; i++) {
            const prev = kdjArray[i - 1];
            const curr = kdjArray[i];
            if (!prev || !curr) continue;
            const onBottom = curr.j < 20 || (curr.k <= 20 && curr.d <= 20);
            const onTop = curr.j > 80 || (curr.k >= 80 && curr.d >= 80);
            // K 突破 20 或 K 連續兩次突破 50
            if (curr.k > prev.k && curr.k > 20 && prev.k <= 20) {
                curr.golden = true;
                lastTop = 0; // reset
            }
            if (lastTop > 50 && curr.k > 50 && curr.k > prev.k && prev.k <= 50) {
                curr.golden = true;
                lastTop = 0; // reset
            } else {
                lastTop = (curr.k > lastTop) ? curr.k : lastTop;
            }
            //if (onBottom && prev.k < prev.d && curr.k >= curr.d) {
            //	curr.golden = true;
            //}
            //if (onTop && prev.k > prev.d && curr.k <= curr.d) {
            //	curr.dead = true;
            //}
        }*/
		for (let i = 1; i < kdjArray.length; i++) {
            const prev = kdjArray[i - 1];
            const curr = kdjArray[i];
            if (!prev || !curr) continue;
            curr.dead = prev.k >= 90 && curr.k < 90;
		}		
        return kdjArray;
    }
}

export class Cci {
    constructor(data, {
        period = 14,
        limit = 100
    } = {}) {
        this.data = data; // 每個元素應該包含 { high, low, close }
        this.period = period;
        this.limit = limit;
    }

    calculate() {
        const typicalPrices = this.data.map(d => (d.high + d.low + d.close) / 3);
        const result = [];
        for (let i = 0; i < this.data.length; i++) {
            if (i < this.period - 1) {
                result.push(null); // 前面不足期數
                continue;
            }
            const time = this.data[i].date ? Date.parse(this.data[i].date) : null;
            const slice = typicalPrices.slice(i - this.period + 1, i + 1);
            const ma = slice.reduce((sum, v) => sum + v, 0) / this.period;
            const meanDeviation = slice.reduce((sum, v) => sum + Math.abs(v - ma), 0) / this.period;
            const cci = (typicalPrices[i] - ma) / (0.015 * meanDeviation);
            result.push({
                time,
                cci
            });
        }
        return this.detectCrossovers(result);
    }

    detectCrossovers(cciArray) {
        for (let i = 1; i < cciArray.length; i++) {
            const prev = cciArray[i - 1];
            const curr = cciArray[i];
            if (!prev || !curr) continue;
            //if (prev.cci < -this.limit && curr.cci >= -this.limit) {
            //	curr.golden = true;
            //}
            if (prev.cci > this.limit && curr.cci <= this.limit) {
                curr.dead = true;
            }
        }
        return cciArray;
    }
}

export class Rsi {
    constructor(data, {
        period = 9,
        limit = 80
    } = {}) {
        this.data = data;
        this.period = period;
        this.limit = limit;
    }

    calculate() {
        const rsiArray = [];
        let gains = 0,
            losses = 0;
        // 前 N 日先計算平均漲跌幅
        const prices = this.data.map(d => d.close);
        for (let i = 1; i <= this.period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        let avgGain = gains / this.period;
        let avgLoss = losses / this.period;
        // RSI 初始值
        rsiArray[this.period] = this.calculateRSI(avgGain, avgLoss);
        // 往後依據平滑計算 RSI
        for (let i = this.period + 1; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (this.period - 1) + gain) / this.period;
            avgLoss = (avgLoss * (this.period - 1) + loss) / this.period;
            const time = this.data[i].date ? Date.parse(this.data[i].date) : null;
            const rsi = this.calculateRSI(avgGain, avgLoss);
            rsiArray[i] = {
				date: this.data[i].date,
				close: this.data[i].close,
				volume: this.data[i].volume,
                time,
                rsi
            };
        }
        // 前期無法計算 RSI 的位置補 null
        for (let i = 0; i <= this.period; i++) {
            rsiArray[i] = null;
        }
        return this.detectDivergence(this.detectCrossovers(rsiArray));
    }

    calculateRSI(avgGain, avgLoss) {
        if (avgLoss === 0) return 100; // 強勢區
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    detectCrossovers(rsiArray) {
        for (let i = 1; i < rsiArray.length; i++) {
            const prev = rsiArray[i - 1];
            const curr = rsiArray[i];
            if (!prev || !curr) continue;
            curr.dead = prev.rsi >= this.limit && curr.rsi < this.limit;
            //curr.dead = curr.rsi >= this.limit;
            //curr.golden = curr.rsi <= (100 - this.limit);
        }
        return rsiArray;
    }

    detectDivergence(rsiArray) {
	    for (let i = 0; i < rsiArray.length; i++) {
			const prev2 = rsiArray[i - 2];
			const prev1 = rsiArray[i - 1];
			const curr = rsiArray[i];
			if (!prev2) continue;
			const priceHigher = curr.close > prev1.close && prev1.close > prev2.close;
			const rsiLower = curr.rsi < prev1.rsi && prev1.rsi < prev2.rsi;
			const volumeLower = curr.volume < prev1.volume && prev1.volume < prev2.volume;
			const priceLower = curr.close < prev1.close && prev1.close < prev2.close;
			const rsiHigher = curr.rsi > prev1.rsi && curr.rsi > prev2.rsi;
			if (priceHigher && rsiLower && volumeLower) curr.bear = true;
			if (priceLower && rsiHigher && volumeLower) curr.bull = true;
	    }
	    return rsiArray;		
	}	
}

export class BullBear {
    constructor(data) {
        this.data = data;
    }

    calculate() {
        return this.withMa(20).withMa(60).withMa(120).findTrendTurns();
    }

    withMa(period) {
        this.data.forEach((day, index) => {
            if (index < period - 1) return null;
            const sum = this.data.slice(index - period + 1, index + 1).reduce((sum, curr) => sum + curr.close, 0);
            day['ma' + period] = (sum / period).scale(2);
        });
        return this;
    }

    findTrendTurns() {
        const result = {
            bullish: [],
            bearish: []
        };
        this.data.forEach((curr, index) => {
            const prev = this.data[index - 1];
            if (curr.ma120 != null && prev.ma120 != null) {
                // 多頭轉折
                const isNowBullish = curr.ma20 > curr.ma60 || curr.ma20 > curr.ma120;
                const wasBullish = prev.ma20 > prev.ma60 || prev.ma20 > prev.ma120;
                if (isNowBullish && (!result.bullish.length || !wasBullish)) {
                    result.bullish.push(curr.date.toLocaleDateString());
                }
                // 空頭轉折
                const isNowBearish = !(curr.ma20 > curr.ma60 || curr.ma20 > curr.ma120);
                const wasBearish = !(prev.ma20 > prev.ma60 || prev.ma20 > prev.ma120);
                if (isNowBearish && !wasBearish) {
                    result.bearish.push(curr.date.toLocaleDateString());
                }
            }
        });
        const curr = this.data[this.data.length - 1];
        result.bullscore = [(curr.ma20 > curr.ma60 ? 1 : -1), (curr.ma20 > curr.ma120 ? 1 : -1), (curr.ma60 > curr.ma120 ? 1 : -1)];
        return result;
    }
}

export class ExitAlert {
    constructor(data) {
        this.data = data;
    }

    calcATR(data, period) {
        let trs = [];
        for (let i = 1; i < data.length; i++) {
            const prevClose = data[i - 1].close;
            const {
                high,
                low,
                close
            } = data[i];
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trs.push(tr);
        }
        return trs.slice(-period).reduce((sum, v) => sum + v, 0) / period;
    }

    calculate() {
        const MA_PERIOD = 20;
        const ATR_PERIOD = 20;
        const calcMA = (data, period) => data.slice(-period).reduce((sum, d) => sum + d.close, 0) / period;
        const calcBias = (price, ma) => ((price - ma) / ma) * 100;
        const alerts = this.data.map((p, idx) => {
            if (idx < MA_PERIOD) return {
                date: p.date,
                score: 0
            }; // 資料不足

            const recent = this.data.slice(Math.max(0, idx - 19), idx + 1);
            const closeToday = p.close;
            const ma = calcMA(this.data.slice(idx - MA_PERIOD + 1, idx + 1), MA_PERIOD);
            const bias10 = this.data.slice(idx - 9, idx + 1).map(d => calcBias(d.close, ma));
            const avgBias10 = bias10.reduce((sum, b) => sum + b, 0) / bias10.length;

            const breakouts = recent.filter((_, i, arr) =>
                i >= 1 && arr[i - 1].close > ma && arr[i].close > ma
            ).length;

            const atrNow = this.calcATR(this.data.slice(idx - ATR_PERIOD + 1, idx + 1));
            const atrPrev = this.calcATR(this.data.slice(idx - ATR_PERIOD - 20 + 1, idx - 20 + 1));
            const atrChange = atrPrev ? ((atrNow - atrPrev) / atrPrev) * 100 : 0;

            let score = 0;
            if (breakouts === 0) score++;
            if (avgBias10 < -3) score++;
            if (Math.abs(atrChange) > 20) score++;

            return {
                date: p.date,
                score
            };
        });

        return alerts.filter(a => a.score >= 2);
    }
}