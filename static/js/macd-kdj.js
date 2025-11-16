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
            return prev10 && ((m - prev10) / 10 > 0);
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
            // 1. DIF（快線）由下往上穿越 DEA（慢線）
            // 2. DEA 線為正：必須在零軸上方，表示目前處於多頭趨勢
            if (prev.diff < prev.dea && curr.diff >= curr.dea) { // && curr.dea >= 0
                curr.golden = true; // 金叉
            }
            if (prev.diff > prev.dea && curr.diff <= curr.dea) { //  && curr.dea >= 0
                curr.dead = true; // 死亡交叉
            }
        }
        return diffArray;
    }

    // Bullish Engulfing（看漲吞噬形態） 是一種常見的 K 線反轉形態，通常出現在 下跌趨勢末端，暗示潛在的反轉上漲
    detectBearishEngulfing(diffArray) {
        const result = [false]; // 第一根沒辦法判斷
        for (let i = 1; i < this.data.length; i++) {
            if (!diffArray[i]) continue;
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

// Average Directional Index
export class Adx {
    constructor(data, {
        period = 14
    } = {}) {
        this.data = data; // 每個元素應該包含 { high, low, close }
        this.period = period;
    }

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
            // 即使數據不足，也返回與 data 等長的 null 陣列
            return this.data.map(() => ({ adx: null, plusDi: null, minusDi: null }));
        }

        for (let i = 0; i < this.data.length; i++) {
            // --- 1. 計算 +DM, -DM, 和 TR ---
            // 從第二根 K 棒開始 (i=1)
            if (i === 0) {
                adxArray.push({ adx: null, plusDi: null, minusDi: null });
                continue;
            }

            const current = this.data[i];
            const prev = this.data[i - 1];
            // 計算 Directional Movement (DM)
            let upMove = current.high - prev.high;
            let downMove = prev.low - current.low;

            let plusDm = 0;
            let minusDm = 0;
            if (upMove > downMove && upMove > 0) {
                plusDm = upMove;
            }
            if (downMove > upMove && downMove > 0) {
                minusDm = downMove;
            }

            // 計算 True Range (TR)
            let tr = Math.max(
                current.high - current.low,
                Math.abs(current.high - prev.close),
                Math.abs(current.low - prev.close)
            );

            // 儲存原始值以供後續平滑
            plusDms.push(plusDm);
            minusDms.push(minusDm);
            trs.push(tr);

            // --- 2. 平滑 DM 和 TR ---
            // 我們需要 'period' 個數值來開始平滑

            let currentPlusDi = null;
            let currentMinusDi = null;
            let currentAdx = null;
            if (i < this.period) {
                // 在第一個 'period' 週期內，僅累積初始總和
                smoothPlusDm += plusDm;
                smoothMinusDm += minusDm;
                smoothTr += tr;
                adxArray.push({ adx: null, plusDi: null, minusDi: null });
                continue;
            }
            else if (i === this.period) {
                // 在第 'period' 根 K 棒，完成第一次加總 (使用 i=1 到 i=period 的數據)
                smoothPlusDm += plusDm;
                smoothMinusDm += minusDm;
                smoothTr += tr;
            }
            else {
                // 'period' 之後，使用 Wilder's Smoothing (EMA with alpha = 1/period)
                // 範例 (14天): (前值 * 13 + 現值) / 14
                smoothPlusDm = (smoothPlusDm * (this.period - 1) + plusDm) / this.period;
                smoothMinusDm = (smoothMinusDm * (this.period - 1) + minusDm) / this.period;
                smoothTr = (smoothTr * (this.period - 1) + tr) / this.period;
            }

            // --- 3. 計算 +Di 和 -Di ---
            // 避免除以零
            if (smoothTr === 0) {
                currentPlusDi = 0;
                currentMinusDi = 0;
            } else {
                currentPlusDi = 100 * (smoothPlusDm / smoothTr);
                currentMinusDi = 100 * (smoothMinusDm / smoothTr);
            }

            // --- 4. 計算 DX ---
            let diSum = currentPlusDi + currentMinusDi;
            let dx = 0;
            if (diSum !== 0) {
                dx = 100 * (Math.abs(currentPlusDi - currentMinusDi) / diSum);
            }
            dxs.push(dx); // 儲存 DX 值以計算 ADX

            // --- 5. 計算 ADX (DX 的平滑移動平均) ---
            // 我們需要 'period' 個 DX 值來計算第一個 ADX
            // 第一個 DX 在 i = period 時算出
            // 第 'period' 個 DX 在 i = period + (period - 1) = (2 * period) - 1 時算出

            if (i < (2 * this.period) - 1) {
                // 數據不足以計算 ADX
                currentAdx = null;
            }
            else if (i === (2 * this.period) - 1) {
                // 計算第一個 ADX (DXs 陣列中現在有 period 個值)
                adx = dxs.reduce((a, b) => a + b, 0) / this.period;
                currentAdx = adx;
            }
            else {
                // 計算後續的 ADX (使用 Wilder's Smoothing)
                adx = (adx * (this.period - 1) + dx) / this.period;
                currentAdx = adx;
            }
            const day = this.data[i];
            const time = day.date ? Date.parse(day.date) : null;
            adxArray.push({ time, val: currentAdx, plusDi: currentPlusDi, minusDi: currentMinusDi });
        }
        return this.detectCrossovers(adxArray);
    }

    detectCrossovers(adxArray) {
        for (let i = 1; i < adxArray.length; i++) {
            const current = adxArray[i];
            const prev = adxArray[i - 1];
            // 確保有足夠的資料
            if (!current || !prev ||
                current.plusDi == null || current.minusDi == null || current.adx == null ||
                prev.plusDi == null || prev.minusDi == null || prev.adx == null) {
                continue;
            }
            // 檢查 ADX 趨勢（上升或下降）
            const adxRising = i > 1 && adxArray[i - 1].adx != null && adxArray[i - 2]?.adx != null
                ? current.adx > prev.adx
                : false;

            // +DI 向上穿越 -DI（黃金交叉）
            if (prev.plusDi <= prev.minusDi && current.plusDi > current.minusDi) {
                current.diGolden = true;
                // 強烈買入訊號：ADX > 20 且正在上升
                if (current.adx > 20 && adxRising) {
                    current.strongBuy = true;
                }
            }
            // -DI 向上穿越 +DI（死亡交叉）
            if (prev.minusDi <= prev.plusDi && current.minusDi > current.plusDi) {
                current.diDead = true;
                // 強烈賣出訊號：ADX > 20 且正在上升
                if (current.adx > 20 && adxRising) {
                    current.strongSell = true;
                }
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