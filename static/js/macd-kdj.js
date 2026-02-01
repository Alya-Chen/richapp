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

        // MACD (紅綠柱) Histogram：DIF - DEA
        const histogramArray = diffArray.map((m, idx) => {
            if (m === null || fullDeaArray[idx] === null) return null;
            return parseFloat((m - fullDeaArray[idx]).scale(3));
        });

        const result = this.data.map((day, idx) => ({
            time: day.date ? Date.parse(day.date) : null,
            date: day.date, // 日期方便偵錯
            diff: diffArray[idx],
            dea: fullDeaArray[idx],
            histogram: histogramArray[idx]
        }));

        // 依序執行背離偵測與交叉偵測
        const withDivergence = this.detectDivergence(result);
        return this.detectCrossovers(withDivergence);
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

    // 柱狀圖背離偵測
    detectDivergence(data) {
        // 尋找局部峰值（Peaks）與谷底（Troughs）的輔助函式
        const findExtremes = (arr) => {
            const extremes = [];
            for (let i = 2; i < arr.length - 2; i++) {
                const prev = arr[i - 1].histogram;
                const curr = arr[i].histogram;
                const next = arr[i + 1].histogram;
                if (curr === null || prev === null || next === null) continue;
                // 頂部峰值 (Positive Peak)
                if (curr > 0 && curr > prev && curr > next) {
                    extremes.push({ type: 'peak', index: i, value: curr, price: this.data[i].high });
                }
                // 底部谷底 (Negative Trough)
                if (curr < 0 && curr < prev && curr < next) {
                    extremes.push({ type: 'trough', index: i, value: curr, price: this.data[i].low });
                }
            }
            return extremes;
        };

        const extremes = findExtremes(data);
        for (let i = 1; i < extremes.length; i++) {
            const currEx = extremes[i];
            const prevEx = extremes[i - 1];
            // 判斷兩點是否為同一性質（都是正柱或都是負柱）
            if (currEx.type === prevEx.type) {
                // 頂背離 (Bearish Divergence): 股價更高，但柱狀圖峰值更低
                if (currEx.type === 'peak' && currEx.price > prevEx.price && currEx.value < prevEx.value) {
                    data[currEx.index].bearDivergence = true;
                }
                // 底背離 (Bullish Divergence): 股價更低，但柱狀圖谷底抬高
                if (currEx.type === 'trough' && currEx.price < prevEx.price && currEx.value > prevEx.value) {
                    data[currEx.index].bullDivergence = true;
                }
            }
        }
        return data;
    }

    // MACD 交叉偵測
    detectCrossovers(resArray) {
        const DIVERGENCE_WINDOW_SIZE = 5; // 背離訊號有效窗口為 5 天
        let lastBullDivIdx = -100; // 記錄最近底背離發生的索引
        let lastBearDivIdx = -100; // 記錄最近頂背離發生的索引
        for (let i = 2; i < resArray.length; i++) {
        const prev = resArray[i - 1];
            const curr = resArray[i];

            if (prev.diff === null || curr.diff === null) continue;

            // 1. 基礎金叉/死叉判定
            if (prev.diff < prev.dea && curr.diff >= curr.dea) curr.golden = true;
            if (prev.diff > prev.dea && curr.diff <= curr.dea) curr.dead = true;

            // 2. 柱狀圖抽腳/縮頭判定
            if (curr.histogram < 0 && curr.histogram > prev.histogram) curr.histoCover = true;
            if (curr.histogram > 0 && curr.histogram < prev.histogram) curr.histoPeak = true;

            // 3. 更新背離發生位置
            if (curr.bullDivergence) lastBullDivIdx = i;
            if (curr.bearDivergence) lastBearDivIdx = i;

            // 4. 綜合打分邏輯
            let score = 0;

            // --- A. 金叉/死叉得分 (依據零軸位置) ---
            if (curr.golden) {
                score += (curr.diff > 0 ? 50 : 30);
            }
            if (curr.dead) {
                score -= (curr.diff < 0 ? 50 : 30);
            }

            // --- B. 背離記憶加分 (如果底背離剛發生，或者在 5 天內發生過) ---
            const bullDivDiff = i - lastBullDivIdx;
            if (bullDivDiff < DIVERGENCE_WINDOW_SIZE) {
                score += 40;
            }
            const bearDivDiff = i - lastBearDivIdx;
            if (bearDivDiff < DIVERGENCE_WINDOW_SIZE) {
                score -= 40;
            }

            // --- C. 動能微調 ---
            if (curr.histoCover) score += 10;
            if (curr.histoPeak) score -= 10;

            // 限制總分範圍
            curr.score = Math.max(-100, Math.min(100, score));
        }
        return resArray;
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
        let lastTop = 0;
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
            if (onBottom && prev.k < prev.d && curr.k >= curr.d) {
            	curr.golden = true;
            }
            if (onTop && prev.k > prev.d && curr.k <= curr.d) {
            	curr.dead = true;
            }
        }
		/*for (let i = 1; i < kdjArray.length; i++) {
            const prev = kdjArray[i - 1];
            const curr = kdjArray[i];
            if (!prev || !curr) continue;
            curr.dead = prev.k >= 90 && curr.k < 90;
		}*/
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
            if (prev.cci < -this.limit && curr.cci >= -this.limit) {
            	curr.golden = true;
            }
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
            // 金叉：從超賣區下方，向上穿越超賣線
            const oversoldLimit = 100 - this.limit; // e.g., 20
            if (prev.rsi < oversoldLimit && curr.rsi >= oversoldLimit) {
                curr.golden = true;
            }
            // 死叉：從超買區上方，向下穿越超買線
            const overboughtLimit = this.limit; // e.g., 80
            if (prev.rsi > overboughtLimit && curr.rsi <= overboughtLimit) {
                curr.dead = true;
            }
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

export class BollingerBands {
	constructor(data, period = 20, k = 2) {
        this.data = data;
		this.period = period; // N 日
		this.k = k; // 標準差倍數
	}

	// 計算移動平均
	sma(prices) {
		const sum = prices.reduce((acc, val) => acc + val, 0);
		return sum / prices.length;
	}

	// 計算標準差
	stdDev(prices, mean) {
		const variance = prices.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / prices.length;
		return Math.sqrt(variance);
	}

	// 計算布林帶
	calculate() {
		if (this.data.length < this.period) {
			throw new Error(`資料長度必須至少 ${this.period} 筆`);
		}
		let result = [];
		for (let i = 0; i < this.data.length; i++) {
			if (i <= this.period - 1) {
		        result.push({ middle: null, upper: null, lower: null, bandwidth: null });
		        continue;
			}
			const windowData = this.data.slice(i - this.period + 1, i + 1).map(d => d.close);
			const middle = this.sma(windowData);
			const sd = this.stdDev(windowData, middle);
			const upper = middle + this.k * sd;
			const lower = middle - this.k * sd;
			const bandwidth = (upper - lower) / middle;
			result.push({
				time: Date.parse(this.data[i].date),
				middle,
				upper,
				lower,
				bandwidth
			});
		}
		return result;
	}
}

export class Sar {
	/**
	 * @param {Array<Object>} data - 價格資料陣列
	 *   每筆格式例如：
	 *   { date: '2025-01-01', high: 123.4, low: 120.1, close: 121.5 }
	 *
	 * @param {Object} options
	 * @param {number} [options.step=0.02]       - AF 初始加速因子 (Wilder 建議 0.02)
	 * @param {number} [options.maxStep=0.2]     - AF 最大值 (Wilder 建議 0.2)
	 * @param {'auto'|'long'|'short'} [options.start='auto']
	 *        - 初始方向：'auto' 由前兩日收盤決定，或強制 'long' / 'short'
	 */
	constructor(data, {
		step = 0.02,
		maxStep = 0.2,
		start = 'auto'
	} = {}) {
		this.data = data;
		this.step = step;
		this.maxStep = maxStep;
		this.start = start;
	}

	/**
	 * 計算整段資料的 SAR
	 * @returns {Array<Object>} 每日結果：
	 *   {
	 *     date,
	 *     sar,            // 當日 SAR 值，前幾筆可能為 null
	 *     direction,      // 'long' 或 'short'
	 *     reversed        // 是否在這一天發生方向反轉
	 *   }
	 */
	calculate() {
		const {
			data,
			step,
			maxStep,
			start
		} = this;
		const len = data.length;
		const results = [];

		if (len < 2) {
			// 資料太少，無法計算
			return data.map(d => ({
				date: d.date,
				sar: null,
				direction: null,
				reversed: false
			}));
		}

		// --- 初始化方向 direction / EP / SAR / AF ---

		// 1. 初始方向
		let direction;
		if (start === 'long' || start === 'short') {
			direction = start;
		} else {
			// auto：用前兩天收盤價決定
			direction = data[1].close >= data[0].close ? 'long' : 'short';
		}

		// 2. 初始極值 EP (Extreme Point)
		let ep; // 對多頭是最高價, 對空頭是最低價
		if (direction === 'long') {
			ep = Math.max(data[0].high, data[1].high);
		} else {
			ep = Math.min(data[0].low, data[1].low);
		}

		// 3. 初始 SAR (通常取前兩日的相對極端值)
		let sar;
		if (direction === 'long') {
			sar = Math.min(data[0].low, data[1].low);
		} else {
			sar = Math.max(data[0].high, data[1].high);
		}

		// 4. 初始加速因子 AF
		let af = step;

		// 第一筆先塞一個空結果，因為幾乎無法計算 SAR
		results.push({
			date: data[0].date,
			sar: null,
			direction: direction,
			reversed: false
		});

		// 第二筆開始有第一個 SAR 值
		results.push({
			date: data[1].date,
			sar,
			direction,
			reversed: false
		});

		// --- 主迴圈：從第 3 筆資料開始計算 (index = 2) ---
		for (let i = 2; i < len; i++) {
			const today = data[i];
			const prev = data[i - 1];

			let prevSar = sar;
			let prevEp = ep;
			let prevAf = af;
			let prevDirection = direction;

			// 1. 按公式預估當日 SAR
			let currentSar = prevSar + prevAf * (prevEp - prevSar);

			// 2. SAR 不可「侵犯」前兩日的價位
			//    多頭：SAR 不可高於前兩日最低價
			//    空頭：SAR 不可低於前兩日最高價
			const low1 = data[i - 1].low;
			const low2 = data[i - 2].low;
			const high1 = data[i - 1].high;
			const high2 = data[i - 2].high;

			if (prevDirection === 'long') {
				const minLow = Math.min(low1, low2);
				currentSar = Math.min(currentSar, minLow);
			} else {
				const maxHigh = Math.max(high1, high2);
				currentSar = Math.max(currentSar, maxHigh);
			}

			let reversed = false;

			// 3. 檢查是否反轉
			if (prevDirection === 'long') {
				// 多頭被跌破：今天最低價 < SAR，轉為空頭
				if (today.low < currentSar) {
					reversed = true;
					direction = 'short';

					// 反轉後的 SAR 設為上一個極值 (EP)
					sar = prevEp;
					// 新 EP 為今天的最低價
					ep = today.low;
					// AF 重置為 step
					af = step;
				} else {
					// 未反轉，維持多頭
					direction = 'long';
					sar = currentSar;

					// 更新 EP / AF
					if (today.high > prevEp) {
						ep = today.high;
						af = Math.min(prevAf + step, maxStep);
					} else {
						ep = prevEp;
						af = prevAf;
					}
				}
			} else {
				// prevDirection === 'short'
				// 空頭被突破：今天最高價 > SAR，轉為多頭
				if (today.high > currentSar) {
					reversed = true;
					direction = 'long';

					// 反轉後的 SAR 設為上一個極值 (EP)
					sar = prevEp;
					// 新 EP 為今天的最高價
					ep = today.high;
					// AF 重置為 step
					af = step;
				} else {
					// 未反轉，維持空頭
					direction = 'short';
					sar = currentSar;

					// 更新 EP / AF
					if (today.low < prevEp) {
						ep = today.low;
						af = Math.min(prevAf + step, maxStep);
					} else {
						ep = prevEp;
						af = prevAf;
					}
				}
			}

			// 4. 寫入結果
			results.push({
                time: Date.parse(today.date),
				sar,
				direction,
				reversed
			});
		}

		return results;
	}
}

// ATR 指標 (平均真實區間)
export class Atr {
    constructor(data, { period = 14 } = {}) {
        this.data = data;
        this.period = period;
    }

    /**
     * 計算 True Range (TR)
     * @param {object[]} data 包含 high, low, close 的 K 線數據
     * @returns {number[]} True Range 數值陣列
     */
    calculateTR() {
        const trArray = [];
        for (let i = 0; i < this.data.length; i++) {
            const h = this.data[i].high;
            const l = this.data[i].low;
            const cPrev = i > 0 ? this.data[i - 1].close : null;

            // TR = Max([H - L], [|H - C_prev|], [|L - C_prev|])
            const tr1 = h - l;
            const tr2 = cPrev !== null ? Math.abs(h - cPrev) : 0;
            const tr3 = cPrev !== null ? Math.abs(l - cPrev) : 0;

            trArray.push(Math.max(tr1, tr2, tr3));
        }
        return trArray;
    }

    /**
     * 計算 ATR (True Range 的 Wilders Smoothing 平均)
     * @returns {object[]} 包含 date, atr, natr 的結果陣列
     */
    calculate() {
        const trArray = this.calculateTR();
        const period = this.period;

        // 使用 Wilder Smoothing 總和
        const wildersSumTR = Calculator.wildersSmoothing(trArray, period);

        const results = [];
        for (let i = 0; i < this.data.length; i++) {
            const sumTR = wildersSumTR[i];
            let atr = null;
            let natr = null; // Normalized ATR

            // ATR = Smoothed Sum / Period
            if (sumTR !== null) {
                atr = sumTR / period;
                const closePrice = this.data[i].close;
                // NATR = (ATR / Close) * 100%
                natr = (atr / closePrice) * 100;
            }

            results.push({
                date: this.data[i].date,
                close: this.data[i].close,
                tr: trArray[i],
                atr: atr,
                natr: natr
            });
        }
        return results;
    }
}

// Average Directional Index
export class Adx {
    constructor(data, {
        period = 14,
        threshold = 20,
        useWeekly = false,
        strongTrend = 18, // 週線 ADX 強趨勢門檻（可調）
        softTrend = 14 // 週線 ADX 較寬鬆門檻（可調）
    } = {}) {
        this.data = data; // 每個元素應該包含 { high, low, close }
        this.period = period;
        this.threshold = threshold;
        this.useWeekly = useWeekly;
        this.strongTrend = strongTrend;
        this.softTrend = softTrend;
    }

    /**
     * time 建議是週 K 的結束日期 (Date.parse)
     */
    calculate() {
        let adxArray = [];
        let plusDms = [];
        let minusDms = [];
        let trs = [];
        let dxs = [];

        let smoothPlusDm = 0;
        let smoothMinusDm = 0;
        let smoothTr = 0;
        let adx = 0;

        if (this.data.length < this.period * 2) {
            console.warn("ADX calculation needs at least 2 * period data points.");
            return this.data.map(d => ({
                time: d.date ? Date.parse(d.date) : null,
                adx: null,
                plusDi: null,
                minusDi: null
            }));
        }

        for (let i = 0; i < this.data.length; i++) {
            if (i === 0) {
                const day = this.data[i];
                const time = day.date ? Date.parse(day.date) : null;
                adxArray.push({ time, adx: null, plusDi: null, minusDi: null });
                continue;
            }

            const current = this.data[i];
            const prev = this.data[i - 1];
            const upMove = current.high - prev.high;
            const downMove = prev.low - current.low;

            let plusDm = 0;
            let minusDm = 0;
            if (upMove > downMove && upMove > 0) plusDm = upMove;
            if (downMove > upMove && downMove > 0) minusDm = downMove;

            const tr = Math.max(
                current.high - current.low,
                Math.abs(current.high - prev.close),
                Math.abs(current.low - prev.close)
            );

            plusDms.push(plusDm);
            minusDms.push(minusDm);
            trs.push(tr);

            let currentPlusDi = null;
            let currentMinusDi = null;
            let currentAdx = null;

            if (i < this.period) {
                smoothPlusDm += plusDm;
                smoothMinusDm += minusDm;
                smoothTr += tr;
            } else if (i === this.period) {
                smoothPlusDm += plusDm;
                smoothMinusDm += minusDm;
                smoothTr += tr;
            } else {
                smoothPlusDm = (smoothPlusDm * (this.period - 1) + plusDm) / this.period;
                smoothMinusDm = (smoothMinusDm * (this.period - 1) + minusDm) / this.period;
                smoothTr = (smoothTr * (this.period - 1) + tr) / this.period;
            }

            if (i < this.period) {
                const time = current.date ? Date.parse(current.date) : null;
                adxArray.push({ time, adx: null, plusDi: null, minusDi: null });
                continue;
            }

            if (smoothTr === 0) {
                currentPlusDi = 0;
                currentMinusDi = 0;
            } else {
                currentPlusDi = 100 * (smoothPlusDm / smoothTr);
                currentMinusDi = 100 * (smoothMinusDm / smoothTr);
            }

            const diSum = currentPlusDi + currentMinusDi;
            let dx = 0;
            if (diSum !== 0) {
                dx = 100 * (Math.abs(currentPlusDi - currentMinusDi) / diSum);
            }
            dxs.push(dx);

            const dxIndex = dxs.length - 1;
            if (dxIndex >= this.period - 1) {
                // 取最近period個DX值計算SMA
                const startIdx = Math.max(0, dxIndex - this.period + 1);
                const dxSlice = dxs.slice(startIdx, dxIndex + 1);
                const sum = dxSlice.reduce((a, b) => a + b, 0);
                currentAdx = sum / this.period;
            } else {
                currentAdx = null;
            }

            adxArray.push({
                date: current.date,
                time: current.date ? Date.parse(current.date) : null,
                adx: currentAdx,
                plusDi: currentPlusDi,
                minusDi: currentMinusDi,
                diff: (currentPlusDi - currentMinusDi).scale(2)
            });
        }
        const weeklyAdxArray = this.useWeekly ? Calculator.toWeeklyAdx(Calculator.convertToWeekly(this.data), this.period) : null;
        return this.detectCrossovers(adxArray, weeklyAdxArray);
    }

    /**
     * @param {Array<{time:number, adx:number, plusDi:number, minusDi:number}>} adxArray 日線 ADX 結果
     * @param {Array<{time:number, adx:number}>} [weeklyAdxArray] 週線 ADX 結果（可選）
     */
    detectCrossovers(adxArray, weeklyAdxArray = null) {
        // weeklyAdxArray: [{ time, adx }, ...] 依時間排序
        const hasWeekly = Array.isArray(weeklyAdxArray)
            && weeklyAdxArray.some(w => w && w.adx != null);

        let weekIdx = 0;
        for (let i = 1; i < adxArray.length; i++) {
            const current = adxArray[i];
            const prev = adxArray[i - 1];

            if (!current || !prev ||
                current.plusDi == null || current.minusDi == null || current.adx == null ||
                prev.plusDi == null || prev.minusDi == null || prev.adx == null) {
                continue;
            }

            // 1) 日線 ADX 是否上升
            current.rising = false;
            if (i >= 3) {
                const prevAdx1 = adxArray[i - 1]?.adx;
                const prevAdx2 = adxArray[i - 2]?.adx;
                if (prevAdx1 != null && prevAdx2 != null) {
                    current.rising = current.adx > prevAdx1 && prevAdx1 > prevAdx2;
                }
            }

            // 2) 週線 ADX 濾網
            let weekOk = true;     // 預設 = 通過
            current.week = null;

            if (hasWeekly && current.time != null) {
                // 對齊最新一根 time <= current.time 的週線
                while (
                    weekIdx + 1 < weeklyAdxArray.length &&
                    weeklyAdxArray[weekIdx + 1].time <= current.time
                ) {
                    weekIdx++;
                }

                const w = weeklyAdxArray[weekIdx];
                if (w && w.adx != null) {
                    current.week = w.adx;

                    // 判斷週線 ADX 是否「足夠」
                    let strongTrend = w.adx >= this.strongTrend;
                    let softTrend   = false;

                    // 有上一週的話，再看有沒有上升
                    if (weekIdx > 0) {
                        const prevW = weeklyAdxArray[weekIdx - 1];
                        if (prevW && prevW.adx != null) {
                            const risingWeekAdx = w.adx > prevW.adx;
                            softTrend = w.adx >= this.softTrend && risingWeekAdx;
                        }
                    }

                    // 只要符合 strong 或 soft 任一種就通過
                    weekOk = strongTrend || softTrend;
                } else {
                    // ⚠ 沒有週線 ADX 的情況：放行，不當作失敗
                    weekOk = true;
                }
            }

            // 先清理舊旗標
            current.golden    = false;
            current.dead      = false;
            current.adxDead   = false;
            // 若週線濾網不通過 → 完全不打訊號（但保留 rising / week）
            if (!weekOk) {
                continue;
            }
            // === 日線 ADX 的交叉邏輯 ===
            if (current.adx >= this.threshold) {
                if (prev.adx < this.threshold) {
                    // ADX 剛穿越 threshold
                    if (current.plusDi > current.minusDi) {
                        current.golden = true;
                    } else if (current.minusDi > current.plusDi) {
                        current.dead = true;
                    }
                } else {
                    // +DI 向上穿越 -DI（黃金交叉）
                    if (prev.plusDi <= prev.minusDi && current.plusDi > current.minusDi) {
                        current.golden = true;
                    }
                    // -DI 向上穿越 +DI（死亡交叉）
                    else if (prev.minusDi <= prev.plusDi && current.minusDi > current.plusDi) {
                        current.dead = true;
                    }
                }
            }
            if (!current.rising && prev.plusDi <= prev.adx && current.plusDi > current.adx) {
                current.adxDead = true;
            }
        }
        return adxArray;
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

            const atrNow = this.calcATR(this.data.slice(idx - ATR_PERIOD + 1, idx + 1), ATR_PERIOD);
            const atrPrev = this.calcATR(this.data.slice(idx - ATR_PERIOD - 20 + 1, idx - 20 + 1), ATR_PERIOD);
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

/**
 * 波動性屬性分析器
 * @param {Object} options 配置選項
 * @param {number} [options.adxThreshold=20] ADX 趨勢強度閾值
 * @param {number} [options.natrThreshold=2.5] NATR 波動率閾值（%）
 * @param {number} [options.lookbackPeriod=20] 回看天數
 */
export class VolatilityAnalyzer {
    constructor(adxData, atrData, options = {}) {
        // 參數驗證
        if (!Array.isArray(adxData) || !Array.isArray(atrData) || adxData.length !== atrData.length) {
            throw new Error('ADX 和 ATR 數據必須是長度相同的陣列');
        }

        this.adxData = adxData;
        this.atrData = atrData;

        // 合併預設選項和使用者選項
        this.options = {
            adxThreshold: 20,      // 預設 ADX 閾值
            natrThreshold: 2.5,    // 預設 NATR 閾值 (%)
            lookbackPeriod: 20,    // 預設回看 20 天
            ...options
        };

        // 快取分析結果
        this._analysisCache = null;
    }

    /**
     * 分析指定日期的波動性屬性
     * @param {Date|string} [targetDate] 目標日期，可以是 Date 物件或日期字串（YYYY-MM-DD）
     * @returns {Object} 包含波動性屬性和建議的物件
     */
    run(targetDate) {
        const dataLength = this.adxData.length;

        // 檢查數據是否足夠
        if (dataLength === 0) {
            return this._createInsufficientDataResult('無可用數據');
        }

        // 如果沒有指定日期，使用最近一天
        if (!targetDate) {
            return this._analyzeByIndex(0);
        }

        // 將目標日期轉換為標準日期字串（YYYY/MM/DD）
        const targetDateStr = typeof targetDate === 'string'
            ? new Date(targetDate).toLocaleDateString('zh-TW')
            : targetDate.toLocaleDateString('zh-TW');

        // 找到匹配的日期
        for (let i = 0; i < this.adxData.length; i++) {
            const currentDate = new Date(this.adxData[i].date);
            if (currentDate.toLocaleDateString('zh-TW') === targetDateStr) {
                const lookbackIndex = dataLength - 1 - i;
                return this._analyzeByIndex(lookbackIndex);
            }
        }
        return this._createInsufficientDataResult(`找不到 ${targetDateStr} 的數據`);
    }

    /**
     * 分析指定日期的波動性屬性
     * @param {number} [lookbackIndex=0] 回看天數索引，0 表示最近一天，1 表示前一個交易日，依此類推
     * @returns {Object} 包含波動性屬性和建議的物件
     */
    _analyzeByIndex(lookbackIndex = 0) {
        // 使用快取結果（如果可用且查詢的是最近一天）
        if (lookbackIndex === 0 && this._analysisCache) {
            return this._analysisCache;
        }

        const { adxThreshold, natrThreshold, lookbackPeriod } = this.options;
        const dataLength = this.adxData.length;

        // 檢查數據是否足夠
        if (dataLength === 0) {
            return this._createInsufficientDataResult('無可用數據');
        }

        // 計算目標索引
        const targetIndex = dataLength - 1 - lookbackIndex;
        if (targetIndex < 0) {
            return this._createInsufficientDataResult(`沒有第 ${lookbackIndex} 天前的數據`);
        }

        // 確保有足夠的數據進行分析
        const startIdx = Math.max(0, targetIndex - lookbackPeriod + 1);
        const analysisPeriod = targetIndex - startIdx + 1;

        if (analysisPeriod < 5) {
            const availableDays = dataLength - lookbackIndex - 1;
            return this._createInsufficientDataResult(
                `需要至少 5 天數據進行分析，目前只有 ${analysisPeriod} 天` +
                (availableDays > analysisPeriod ? `（總共有 ${availableDays} 天數據，但範圍不足）` : '')
            );
        }

        // 獲取目標日數據
        const targetAdx = this.adxData[targetIndex];
        const targetAtr = this.atrData[targetIndex];

        if (!targetAdx || !targetAtr) {
            return this._createInsufficientDataResult('目標日數據不完整');
        }

        // 計算平均 ADX 和 NATR
        let avgAdx = 0;
        let avgNatr = 0;
        let validCount = 0;

        for (let i = startIdx; i <= targetIndex; i++) {
            const adxVal = this.adxData[i]?.adx;
            const natrVal = this.atrData[i]?.natr;

            if (adxVal !== undefined && natrVal !== undefined) {
                avgAdx += adxVal;
                avgNatr += natrVal;
                validCount++;
            }
        }

        if (validCount === 0) {
            return this._createInsufficientDataResult('無有效數據點');
        }

        // 計算平均值
        avgAdx /= validCount;
        avgNatr /= validCount;

        // 使用目標日的當前值
        const currentAdx = targetAdx.adx;
        const currentNatr = targetAtr.natr;

        // 判斷趨勢和波動性
        const isStrongTrend = currentAdx >= adxThreshold;
        const isHighVolatility = currentNatr >= natrThreshold;

        // 決定市場狀態
        let market, note, risk, sizing;

        if (isStrongTrend && isHighVolatility) {
            market = '趨勢明顯，波動大';
            note = '順勢交易，使用追蹤停損';
            risk = '中高';
            sizing = '標準倉位';
        } else if (isStrongTrend && !isHighVolatility) {
            market = '趨勢明顯，波動小';
            note = '順勢交易，可適度加碼';
            risk = '中低';
            sizing = '標準至加碼倉位';
        } else if (!isStrongTrend && isHighVolatility) {
            market = '趨勢不明，波動大';
            note = '區間操作，嚴守停損';
            risk = '高';
            sizing = '減碼操作';
        } else {
            market = '趨勢不明，波動小';
            note = '觀望或使用突破策略';
            risk = '低';
            sizing = '小倉位或觀望';
        }

        // ✅ 新增：判斷趨勢動向（增強/減弱）
        let trendDirection = '穩定';
        if (currentAdx > avgAdx * 1.1) {
            trendDirection = '增強中';
        } else if (currentAdx < avgAdx * 0.9) {
            trendDirection = '減弱中';
        }

        // ✅ 新增：判斷波動性變化
        let volatilityDirection = '穩定';
        if (currentNatr > avgNatr * 1.1) {
            volatilityDirection = '增加中';
        } else if (currentNatr < avgNatr * 0.9) {
            volatilityDirection = '減少中';
        }

        // 準備結果
        const result = {
            date: targetAdx.date.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
            lookbackIndex,
            market,

            // ✅ 修正：明確標示分類使用的數值
            adx: {
                current: currentAdx.scale(2),       // 用於分類
                average: avgAdx.scale(2),           // 僅供參考
                threshold: adxThreshold,
                trendStrength: isStrongTrend ? '強' : '弱',
                trendDirection,                     // 新增：趨勢動向
                note: '分類依據：current ≥ threshold'
            },

            natr: {
                current: currentNatr.scale(2) + '%',  // 用於分類
                average: avgNatr.scale(2) + '%',      // 僅供參考
                threshold: natrThreshold + '%',
                volatility: isHighVolatility ? '高' : '低',
                volatilityDirection,                 // 新增：波動變化
                note: '分類依據：current ≥ threshold'
            },

            note: {
                strategy: note,
                risk,
                sizing,
                // ✅ 新增：分類說明
                classification: this._getClassification(currentAdx, currentNatr, adxThreshold, natrThreshold)
            },

            diSignal: this._getDiSignal(targetAdx),

            // ✅ 新增：趨勢狀態評估
            trendAssessment: this._assessTrendState(currentAdx, avgAdx, currentNatr, avgNatr),

            rawData: {
                adx: targetAdx,
                atr: targetAtr
            }
        };
        // 如果是最近一天，則快取結果
        if (lookbackIndex === 0) {
            this._analysisCache = result;
        }
        return result;
    }

    // ✅ 新增輔助方法：取得分類標籤
    _getClassification(currentAdx, currentNatr, adxThreshold, natrThreshold) {
        if (currentAdx >= adxThreshold && currentNatr >= natrThreshold) {
            return 'A類：強趨勢高波動';
        } else if (currentAdx < adxThreshold && currentNatr >= natrThreshold) {
            return 'B類：弱趨勢高波動';
        } else if (currentAdx >= adxThreshold && currentNatr < natrThreshold) {
            return 'C類：強趨勢低波動';
        } else {
            return 'D類：弱趨勢低波動';
        }
    }

    // ✅ 新增輔助方法：評估趨勢狀態
    _assessTrendState(currentAdx, avgAdx, currentNatr, avgNatr) {
        const assessments = [];

        // ADX 狀態評估
        if (currentAdx > avgAdx * 1.15) {
            assessments.push('ADX明顯高於平均，趨勢可能加速');
        } else if (currentAdx < avgAdx * 0.85) {
            assessments.push('ADX明顯低於平均，趨勢可能轉弱');
        }

        // NATR 狀態評估
        if (currentNatr > avgNatr * 1.15) {
            assessments.push('波動性明顯高於平均，需注意風險');
        } else if (currentNatr < avgNatr * 0.85) {
            assessments.push('波動性明顯低於平均，走勢可能趨於平穩');
        }

        // 交叉評估
        if (currentAdx > avgAdx && currentNatr > avgNatr) {
            assessments.push('趨勢與波動同步上升，可能進入劇烈趨勢階段');
        } else if (currentAdx < avgAdx && currentNatr < avgNatr) {
            assessments.push('趨勢與波動同步下降，可能進入盤整階段');
        }

        return assessments.length > 0 ? assessments : ['趨勢狀態穩定'];
    }

    // ✅ 新增：建立數據不足的結果
    _createInsufficientDataResult(message) {
        return {
            date: new Date().toISOString().split('T')[0],
            error: true,
            message: message,
            market: '數據不足，無法分析',
            adx: {
                current: 'N/A',
                average: 'N/A',
                threshold: this.options?.adxThreshold || 25,
                trendStrength: '未知'
            },
            natr: {
                current: 'N/A',
                average: 'N/A',
                threshold: (this.options?.natrThreshold || 2.5) + '%',
                volatility: '未知'
            },
            note: {
                strategy: '等待更多數據',
                risk: '未知',
                sizing: '觀望'
            },
            diSignal: '數據不足',
            trendAssessment: ['需要更多數據進行分析']
        };
    }

    // ✅ 新增：獲取DI信號（優化版）
    _getDiSignal(adxData) {
        if (!adxData || adxData.plusDi === undefined || adxData.minusDi === undefined) {
            return 'DI數據不足';
        }

        const plusDi = adxData.plusDi;
        const minusDi = adxData.minusDi;
        const diff = Math.abs(plusDi - minusDi);
        const avg = (plusDi + minusDi) / 2;

        let strength = '弱';
        if (diff > avg * 0.3) {
            strength = '強';
        } else if (diff > avg * 0.15) {
            strength = '中';
        }

        if (plusDi > minusDi) {
            return `${strength}多頭信號 ${plusDi.scale(2)} > ${minusDi.scale(2)}`;
        } else if (minusDi > plusDi) {
            return `${strength}空頭信號 ${minusDi.scale(2)} > ${plusDi.scale(2)}`;
        } else {
            return '多空平衡';
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
class Calculator {
    static convertToWeekly(dailyData) {
        const weekly = [];
        let bucket = null;

        for (const d of dailyData) {
            const date = new Date(d.date);
            const week = date.getFullYear() + "-W" + String(Calculator.getWeekNumber(date));

            if (!bucket || bucket.week !== week) {
                // 開新週
                if (bucket) weekly.push(bucket);
                bucket = {
                    week,
                    open: d.open,
                    high: d.high,
                    low: d.low,
                    close: d.close,
                    volume: d.volume,
                    startDate: d.date, // ★ 新增：該週第一天
                    endDate: d.date, // ★ 先暫存
                    time: Date.parse(d.date), // ★ 用「週的最後一天時間」當 time（先暫存）
                    raw: [d] // 可選：保留原始日資料
                };
            } else {
                // 同一週內，更新高低收 & 結束日期
                bucket.high = Math.max(bucket.high, d.high);
                bucket.low = Math.min(bucket.low, d.low);
                bucket.close = d.close;
                bucket.volume += d.volume;
                bucket.endDate = d.date; // ★ 每天更新到當前這天
                bucket.time = Date.parse(d.date); // ★ 同步更新 time = 這週最後一天
                bucket.raw.push(d);
            }
        }

        if (bucket) weekly.push(bucket);

        return weekly;
    }

    static getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    static toWeeklyAdx(weekly, period = 14) {
        const n = weekly.length;
        const result = weekly.map(w => ({
            ...w,
            tr: null,
            pdm: null,
            ndm: null,
            tr14: null,
            pdm14: null,
            ndm14: null,
            diPlus: null,
            diMinus: null,
            dx: null,
            adx: null
        }));

        for (let i = 1; i < n; i++) {
            const prev = result[i - 1];
            const curr = result[i];

            // TR
            const tr1 = curr.high - curr.low;
            const tr2 = Math.abs(curr.high - prev.close);
            const tr3 = Math.abs(curr.low - prev.close);
            curr.tr = Math.max(tr1, tr2, tr3);

            // +DM and -DM
            const upMove = curr.high - prev.high;
            const downMove = prev.low - curr.low;

            curr.pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
            curr.ndm = (downMove > upMove && downMove > 0) ? downMove : 0;
        }

        // 初始14週平滑
        let tr14 = 0,
            pdm14 = 0,
            ndm14 = 0;

        for (let i = 1; i <= period; i++) {
            tr14 += result[i].tr;
            pdm14 += result[i].pdm;
            ndm14 += result[i].ndm;
        }

        result[period].tr14 = tr14;
        result[period].pdm14 = pdm14;
        result[period].ndm14 = ndm14;

        // 計算 DI、DX
        for (let i = period; i < n; i++) {
            const r = result[i];

            if (i !== period) {
                // Wilder smoothing
                tr14 = tr14 - tr14 / period + r.tr;
                pdm14 = pdm14 - pdm14 / period + r.pdm;
                ndm14 = ndm14 - ndm14 / period + r.ndm;

                r.tr14 = tr14;
                r.pdm14 = pdm14;
                r.ndm14 = ndm14;
            }

            // DI
            r.diPlus = 100 * (r.pdm14 / r.tr14);
            r.diMinus = 100 * (r.ndm14 / r.tr14);

            // DX
            r.dx = 100 * Math.abs(r.diPlus - r.diMinus) /
                (r.diPlus + r.diMinus);
        }

        // ADX: 對DX進行簡單移動平均
        for (let i = period * 2 - 1; i < n; i++) {
            // 取最近period個DX值計算SMA
            let sum = 0;
            for (let j = i - (period - 1); j <= i; j++) {
                if (result[j] && result[j].dx !== null) {
                    sum += result[j].dx;
                }
            }
            result[i].adx = sum / period;
        }

        return result;
    }
    /**
     * 輔助函式：計算 Wilders 平滑 (Wilders Smoothing)
     * ADX/DMI 指標的標準平滑方法，與 EMA 類似。
     * @param {number[]} data 原始數據陣列
     * @param {number} period 週期
     * @returns {number[]} 平滑後的總和 (Sum)，從第 period 天開始有值
     */
    static wildersSmoothing(data, period) {
        if (data.length < period) return data.map(() => null);

        const result = new Array(data.length).fill(null);
        let sum = 0;
        for (let i = 0; i < period; i++) {
            sum += data[i];
        }
        result[period - 1] = sum;

        for (let i = period; i < data.length; i++) {
            const prevSmooth = result[i - 1];
            if (prevSmooth === null) {
                result[i] = data[i];
            } else {
                // Wilder smoothing 核心公式: PrevSum - (PrevSum / period) + CurrentValue
                result[i] = prevSmooth - (prevSmooth / period) + data[i];
            }
        }
        return result;
    }
}