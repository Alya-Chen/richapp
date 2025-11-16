export class ObvMacd {
    /**
     * @param {Array<{timestamp?:number|Date, open:number, high:number, low:number, close:number, volume:number}>} data K線數據
     * @param {Object} options 指標參數
     */
    constructor(data, options = {}) {
        this.data = Array.isArray(data) ? data.slice() : [];
        this.options = {
            // OBV 相關
            windowLen:   options.windowLen   ?? 28,  // 用來算 stdev(high-low)、OBV 偏離 stdev
            vLen:        options.vLen        ?? 14,  // OBV 平滑長度
            obvLength:   options.obvLength   ?? 1,   // 影子價格 out 的 EMA 長度

            // MACD 相關
            maType:      options.maType      ?? 'DEMA', // 'EMA' | 'DEMA' | 'TEMA'
            maLength:    options.maLength    ?? 9,      // OBV 影子 MA 長度
            slowLength:  options.slowLength  ?? 26,     // 價格慢 EMA 長度

            // 斜率 / T-Channels / Pivot
            slopeLength:    options.slopeLength    ?? 2,  // 線性回歸長度
            tChannelPeriod: options.tChannelPeriod ?? 50, // T-Channels 內部平均視窗
            pivotPeriod:    options.pivotPeriod    ?? 50  // pivot 搜尋視窗
        };

        this._validateOptions();
        this._results = null; // 緩存計算結果
    }

    // ========= 配置驗證 =========

    _validateOptions() {
        const { maType, windowLen, vLen, obvLength, maLength, slowLength, slopeLength } = this.options;

        // 驗證 MA 類型
        const validMATypes = ['EMA', 'DEMA', 'TEMA'];
        if (!validMATypes.includes(maType)) {
            throw new Error(`不支持的 MA 類型: ${maType}，支持的類型: ${validMATypes.join(', ')}`);
        }

        // 驗證參數範圍
        const validations = [
            { name: 'windowLen', value: windowLen, min: 2 },
            { name: 'vLen', value: vLen, min: 2 },
            { name: 'obvLength', value: obvLength, min: 1 },
            { name: 'maLength', value: maLength, min: 1 },
            { name: 'slowLength', value: slowLength, min: 1 },
            { name: 'slopeLength', value: slopeLength, min: 2 },
            { name: 'tChannelPeriod', value: this.options.tChannelPeriod, min: 5 },
            { name: 'pivotPeriod', value: this.options.pivotPeriod, min: 5 }
        ];

        for (const { name, value, min } of validations) {
            if (value < min) {
                throw new Error(`參數 ${name} 必須大於等於 ${min}，當前值: ${value}`);
            }
            if (!Number.isInteger(value)) {
                throw new Error(`參數 ${name} 必須是整數，當前值: ${value}`);
            }
        }
    }

    // ========= 基本工具 =========

    /** 簡單移動平均 */
    static _sma(values, length, endIndex) {
        if (endIndex === undefined) endIndex = values.length - 1;
        if (length <= 0) return null;
        if (endIndex + 1 < length) return null;

        let sum = 0;
        for (let i = endIndex - length + 1; i <= endIndex; i++) {
            const v = values[i];
            if (v == null) return null;
            sum += v;
        }
        return sum / length;
    }

    /** 指數移動平均，遇到 null 會跳過直到有第一個非 null */
    static _ema(values, length) {
        const res = new Array(values.length).fill(null);
        if (length <= 0) return res;

        const k = 2 / (length + 1);
        let emaPrev = null;

        for (let i = 0; i < values.length; i++) {
            const v = values[i];
            if (v == null) {
                res[i] = emaPrev;
                continue;
            }
            if (emaPrev == null) {
                emaPrev = v;
            } else {
                emaPrev = v * k + emaPrev * (1 - k);
            }
            res[i] = emaPrev;
        }
        return res;
    }

    /** 標準差 */
    static _stdev(values, length, endIndex) {
        if (endIndex === undefined) endIndex = values.length - 1;
        if (length <= 0) return null;
        if (endIndex + 1 < length) return null;

        let sum = 0;
        for (let i = endIndex - length + 1; i <= endIndex; i++) {
            const v = values[i];
            if (v == null) return null;
            sum += v;
        }
        const mean = sum / length;
        let sq = 0;
        for (let i = endIndex - length + 1; i <= endIndex; i++) {
            const v = values[i];
            const d = v - mean;
            sq += d * d;
        }
        return Math.sqrt(sq / length);
    }

    /** DEMA */
    static _dema(src, len) {
        const ema1 = this._ema(src, len);
        const ema2 = this._ema(ema1, len);
        return src.map((_, i) => {
            if (ema1[i] == null || ema2[i] == null) return null;
            return 2 * ema1[i] - ema2[i];
        });
    }

    /** TEMA */
    static _tema(src, len) {
        const ema1 = this._ema(src, len);
        const ema2 = this._ema(ema1, len);
        const ema3 = this._ema(ema2, len);
        return src.map((_, i) => {
            if (ema1[i] == null || ema2[i] == null || ema3[i] == null) return null;
            return 3 * (ema1[i] - ema2[i]) + ema3[i];
        });
    }

    /** 簡化 myma：只支援 EMA/DEMA/TEMA 三種 */
    static _applyMA(src, len, type) {
        switch (type) {
            case 'EMA':
                return this._ema(src, len);
            case 'DEMA':
                return this._dema(src, len);
            case 'TEMA':
                return this._tema(src, len);
            default:
                return this._dema(src, len); // 預設用 DEMA
        }
    }

    // ========= OBV + 影子價格 =========

    /** 計算 OBV、shadow、out */
    _calcObvShadow() {
        const n = this.data.length;
        const high = this.data.map(d => d.high);
        const low  = this.data.map(d => d.low);
        const close= this.data.map(d => d.close);
        const vol  = this.data.map(d => d.volume);

        const { windowLen, vLen } = this.options;

        // OBV
        const obv = new Array(n).fill(0);
        for (let i = 1; i < n; i++) {
            const diff = close[i] - close[i - 1];
            const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
            obv[i] = obv[i - 1] + sign * vol[i];
        }

        // 價格波動 stdev(high-low)
        const hlDiff = high.map((h, i) => h - low[i]);
        const priceSpread = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            priceSpread[i] = ObvMacd._stdev(hlDiff, windowLen, i);
        }

        // OBV 平滑 & 偏離 stdev
        const smooth = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            smooth[i] = ObvMacd._sma(obv, vLen, i);
        }
        const vMinusSmooth = obv.map((v, i) =>
            smooth[i] == null ? null : v - smooth[i]
        );

        const vSpread = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            vSpread[i] = ObvMacd._stdev(vMinusSmooth, windowLen, i);
        }

        const shadow = new Array(n).fill(null);
        const out    = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            const vs = vSpread[i];
            const ps = priceSpread[i];
            if (vs == null || vs === 0 || ps == null) continue;

            const sh = (obv[i] - smooth[i]) / vs * ps;
            shadow[i] = sh;
            out[i] = sh > 0 ? high[i] + sh : low[i] + sh;
        }

        return { obv, shadow, out };
    }

    // ========= 線性回歸 =========

    /**
     * 對 series 做長度 len 的線性回歸
     * 回傳 { slope[], intercept[] }
     */
    static _calcSlope(series, len) {
        const n = series.length;
        const slope = new Array(n).fill(null);
        const intercept = new Array(n).fill(null);

        if (len <= 1) return { slope, intercept };

        for (let i = 0; i < n; i++) {
            if (i + 1 < len) continue;

            let sumX = 0, sumY = 0, sumXSqr = 0, sumXY = 0;
            let valid = true;

            for (let j = 0; j < len; j++) {
                const x = j + 1; // 1..len
                const y = series[i - len + 1 + j];
                if (y == null) {
                    valid = false;
                    break;
                }
                sumX += x;
                sumY += y;
                sumXSqr += x * x;
                sumXY += x * y;
            }

            if (!valid) continue;

            const denom = len * sumXSqr - sumX * sumX;
            if (denom === 0) continue;

            const s = (len * sumXY - sumX * sumY) / denom;
            const avg = sumY / len;
            const b = avg - (s * sumX) / len + s;

            slope[i] = s;
            intercept[i] = b;
        }

        return { slope, intercept };
    }

    // ========= T-Channels (修正版本) =========

    /**
     * 修正版 T-Channels：使用滑動窗口避免數值溢出
     * 傳回 { b5, dev5, oc, signalUp, signalDown }
     */
    static _calculateTChannels(src, period = 50, p = 1) {
        const n = src.length;
        const b5 = new Array(n).fill(null);
        const dev5 = new Array(n).fill(null);
        const oc = new Array(n).fill(0);
        const signalUp = new Array(n).fill(false);
        const signalDown = new Array(n).fill(false);

        for (let i = 0; i < n; i++) {
            const v = src[i];
            if (v == null) {
                if (i > 0) {
                    b5[i] = b5[i - 1];
                    dev5[i] = dev5[i - 1];
                    oc[i] = oc[i - 1];
                }
                continue;
            }

            const prevB = i > 0 && b5[i - 1] != null ? b5[i - 1] : v;

            // 使用滑動窗口計算平均絕對偏差
            let sumAbsDiff = 0;
            let count = 0;
            const start = Math.max(0, i - period + 1);

            for (let j = start; j <= i; j++) {
                if (src[j] != null && (j === 0 || b5[Math.max(0, j - 1)] != null)) {
                    const prevVal = j === 0 ? src[j] : b5[j - 1];
                    sumAbsDiff += Math.abs(src[j] - prevVal);
                    count++;
                }
            }

            const a15 = count > 0 ? (sumAbsDiff / count) * p : Math.abs(v);

            let curB;
            if (v > prevB + a15) {
                curB = v;
            } else if (v < prevB - a15) {
                curB = v;
            } else {
                curB = prevB;
            }

            b5[i] = curB;

            if (i === 0) {
                dev5[i] = a15;
                oc[i] = 0;
                continue;
            }

            // 更新 dev5
            dev5[i] = curB !== b5[i - 1] ? a15 : (dev5[i - 1] != null ? dev5[i - 1] : a15);

            // 更新方向
            const diff = curB - b5[i - 1];
            if (diff > 0) {
                oc[i] = 1;
            } else if (diff < 0) {
                oc[i] = -1;
            } else {
                oc[i] = oc[i - 1] ?? 0;
            }

            // 檢測信號（加入強度過濾）
            if (i > 0) {
                const directionChanged = oc[i] !== oc[i - 1];
                const hasStrength = Math.abs(diff) > a15 * 0.1; // 至少 10% 的通道寬度變化

                if (directionChanged && hasStrength) {
                    if (oc[i] === 1) {
                        signalUp[i] = true;
                    } else if (oc[i] === -1) {
                        signalDown[i] = true;
                    }
                }
            }
        }

        return { b5, dev5, oc, signalUp, signalDown };
    }

    // ========= Pivot =========

    /** 在 tt1 上偵測 pivot 高低點 */
    static _calculatePivots(series, period) {
        const n = series.length;
        const highs = new Array(n).fill(null);
        const lows  = new Array(n).fill(null);

        for (let i = 0; i < n; i++) {
            const v = series[i];
            if (v == null) continue;

            const start = Math.max(0, i - period + 1);
            let isMax = true;
            let isMin = true;

            for (let j = start; j <= i; j++) {
                const vv = series[j];
                if (vv == null) continue;
                if (vv > v) isMax = false;
                if (vv < v) isMin = false;
                if (!isMax && !isMin) break;
            }

            if (isMax && i >= 1 && i + 1 < n) {
                if (series[i] > series[i - 1] && series[i] > series[i + 1]) {
                    highs[i] = series[i];
                }
            }
            if (isMin && i >= 1 && i + 1 < n) {
                if (series[i] < series[i - 1] && series[i] < series[i + 1]) {
                    lows[i] = series[i];
                }
            }
        }

        return { highs, lows };
    }

    // ========= 信號置信度計算 =========

    /**
     * 計算信號置信度
     */
    _calculateSignalConfidence(current, previous, crossUp, crossDown) {
        let confidence = 0.5; // 基礎置信度

        // MACD 強度
        if (current.macd != null) {
            const macdStrength = Math.min(Math.abs(current.macd) / 2, 1);
            confidence += macdStrength * 0.2;
        }

        // 趨勢一致性
        if ((current.channelDirection === 1 && current.macd > 0) ||
            (current.channelDirection === -1 && current.macd < 0)) {
            confidence += 0.15;
        }

        // 樞軸點確認
        if (current.pivotHigh != null || current.pivotLow != null) {
            confidence += 0.1;
        }

        // 多重信號確認
        if ((crossUp && current.signalUp) || (crossDown && current.signalDown)) {
            confidence += 0.15;
        }

        // 成交量確認（如果可用）
        if (current.volume && previous && previous.volume) {
            const volumeIncrease = current.volume > previous.volume * 1.2;
            if (volumeIncrease) {
                confidence += 0.1;
            }
        }

        return Math.min(Math.max(confidence, 0), 1); // 限制在 0-1 範圍
    }

    // ========= 主計算流程 =========

    /**
     * 計算整個指標
     * 回傳每根 K 的結果陣列
     */
    calculate() {
        const n = this.data.length;
        if (n === 0) {
            this._results = [];
            return this._results;
        }

        const timestamps = this.data.map(d => d.timestamp ?? null);
        const open  = this.data.map(d => d.open);
        const high  = this.data.map(d => d.high);
        const low   = this.data.map(d => d.low);
        const close = this.data.map(d => d.close);
        const vol   = this.data.map(d => d.volume);

        const {
            obvLength,
            maType,
            maLength,
            slowLength,
            slopeLength,
            tChannelPeriod,
            pivotPeriod
        } = this.options;

        // 1) OBV + 影子價
        const { obv, shadow, out } = this._calcObvShadow();

        // 2) obvEMA & obvMA
        const obvEMA = ObvMacd._ema(out, obvLength);
        const obvMA  = ObvMacd._applyMA(obvEMA, maLength, maType);

        // 3) 價格慢線
        const slowMA = ObvMacd._ema(close, slowLength);

        // 4) 自訂 MACD = obvMA - slowMA
        const macd = obvMA.map((m, i) => {
            if (m == null || slowMA[i] == null) return null;
            return m - slowMA[i];
        });

        // 5) 線性回歸 → tt1
        const { slope, intercept } = ObvMacd._calcSlope(macd, slopeLength);
        const tt1 = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            if (slope[i] == null || intercept[i] == null) continue;
            tt1[i] = intercept[i] + slope[i] * slopeLength;
        }

        // 6) T-Channels on tt1 (使用修正版本)
        const tChan = ObvMacd._calculateTChannels(tt1, tChannelPeriod, 1);
        const b5  = tChan.b5;
        const dev5= tChan.dev5;
        const oc  = tChan.oc; // 1 / -1 / 0
        const signalUp = tChan.signalUp;
        const signalDown = tChan.signalDown;

        // 7) pivot on tt1
        const pivots = ObvMacd._calculatePivots(tt1, pivotPeriod);

        // 8) 整合結果
        const results = [];
        for (let i = 0; i < n; i++) {
            results.push({
                index: i,
                timestamp: timestamps[i],
                open: open[i],
                high: high[i],
                low: low[i],
                close: close[i],
                volume: vol[i],

                obv: obv[i],
                shadow: shadow[i],
                out: out[i],
                obvEMA: obvEMA[i],
                obvMA: obvMA[i],
                slowMA: slowMA[i],
                macd: macd[i],

                slope: slope[i],
                intercept: intercept[i],
                tt1: tt1[i],

                tChannel: b5[i],
                tDev: dev5[i],
                channelDirection: oc[i], // 1=up, -1=down, 0=flat/none
                signalUp: signalUp[i],
                signalDown: signalDown[i],

                pivotHigh: pivots.highs[i],
                pivotLow: pivots.lows[i],

                color: oc[i] === 1 ? 'blue' :
                       oc[i] === -1 ? 'red'  :
                       null
            });
        }

        this._results = results;
        return results;
    }

    // ========= 公用方法 =========

    /** 確保已計算 */
    _ensureCalculated() {
        if (!this._results || this._results.length !== this.data.length) {
            this.calculate();
        }
    }

    /**
     * 取得「最新一根」的綜合訊號
     * trend: bullish / bearish / neutral
     * signal: buy / sell / hold / none
     * pivot: resistance / support / none
     */
    getSignals() {
        this._ensureCalculated();

        if (!this._results || this._results.length === 0) return null;

        const lastIndex = this._results.length - 1;
        const last = this._results[lastIndex];
        const prev = lastIndex > 0 ? this._results[lastIndex - 1] : null;

        // 趨勢方向
        let trend;
        if (last.channelDirection === 1) trend = 'bullish';
        else if (last.channelDirection === -1) trend = 'bearish';
        else trend = 'neutral';

        // pivot 狀態
        const pivotState =
            last.pivotHigh != null ? 'resistance' :
            last.pivotLow  != null ? 'support'    :
            'none';

        // MACD 零軸交叉檢測（加入閾值過濾）
        const macd = last.macd;
        const macdPrev = prev ? prev.macd : null;
        const threshold = 0.001; // 避免微小波動產生的假信號

        const crossUp = prev && macdPrev != null && macdPrev <= threshold && macd > threshold;
        const crossDown = prev && macdPrev != null && macdPrev >= -threshold && macd < -threshold;

        // 綜合信號生成
        let signal;
        let signalSource = '';

        if (crossUp && last.signalUp) {
            signal = 'buy';
            signalSource = 'MACD＋上升通道';
        } else if (crossDown && last.signalDown) {
            signal = 'sell';
            signalSource = 'MACD＋下降通道';
        } else if (crossUp) {
            signal = 'buy';
            signalSource = 'MACD 上穿零軸';
        } else if (crossDown) {
            signal = 'sell';
            signalSource = 'MACD 下穿零軸';
        } else if (last.signalUp) {
            signal = 'buy';
            signalSource = '上升通道';
        } else if (last.signalDown) {
            signal = 'sell';
            signalSource = '下降通道';
        } else {
            signal = 'hold';
            signalSource = '無信號';
        }

        // 計算置信度
        const confidence = this._calculateSignalConfidence(last, prev, crossUp, crossDown);

        return {
            index: lastIndex,
            timestamp: last.timestamp,
            close: last.close,
            trend,           // 'bullish' | 'bearish' | 'neutral'
            signal,          // 'buy' | 'sell' | 'hold'
            signalSource,    // 信號來源
            confidence,      // 0-1 的置信度
            macd: last.macd,
            pivot: pivotState,
            pivotPrice: last.pivotHigh || last.pivotLow || null,
            details: {
                channelDirection: last.channelDirection,
                hasMACDCross: crossUp || crossDown,
                hasTChannelSignal: last.signalUp || last.signalDown,
                hasPivot: pivotState !== 'none'
            }
        };
    }

    /** 只取簡單交易信號字串 */
    getSimpleSignal() {
        const s = this.getSignals();
        return s ? s.signal : 'hold';
    }

    /**
     * 取得所有 K 棒對應的信號摘要（方便畫圖或回測）
     */
    getAllSignals() {
        this._ensureCalculated();
        if (!this._results) return [];

        const signals = [];
        for (let i = 0; i < this._results.length; i++) {
            const r = this._results[i];
            const prev = i > 0 ? this._results[i - 1] : null;

            let trend;
            if (r.channelDirection === 1) trend = 'bullish';
            else if (r.channelDirection === -1) trend = 'bearish';
            else trend = 'neutral';

            const pivotState =
                r.pivotHigh != null ? 'resistance' :
                r.pivotLow  != null ? 'support'    :
                'none';

            const macd = r.macd;
            const macdPrev = prev ? prev.macd : null;
            const threshold = 0.001;

            const crossUp = prev && macdPrev != null && macdPrev <= threshold && macd > threshold;
            const crossDown = prev && macdPrev != null && macdPrev >= -threshold && macd < -threshold;

            let signal;
            let signalSource = '';

            if (crossUp && r.signalUp) {
                signal = 'buy';
                signalSource = 'MACD＋上升通道';
            } else if (crossDown && r.signalDown) {
                signal = 'sell';
                signalSource = 'MACD＋下降通道';
            } else if (crossUp) {
                signal = 'buy';
                signalSource = 'MACD 上穿零軸';
            } else if (crossDown) {
                signal = 'sell';
                signalSource = 'MACD 下穿零軸';
            } else if (r.signalUp) {
                signal = 'buy';
                signalSource = '上升通道';
            } else if (r.signalDown) {
                signal = 'sell';
                signalSource = '下降通道';
            } else {
                signal = 'hold';
                signalSource = '無信號';
            }

            const confidence = this._calculateSignalConfidence(r, prev, crossUp, crossDown);

            signals.push({
                index: i,
                timestamp: r.timestamp,
                close: r.close,
                trend,
                signal,
                signalSource,
                confidence,
                macd: r.macd,
                pivot: pivotState,
                pivotPrice: r.pivotHigh || r.pivotLow || null
            });
        }

        return signals;
    }

    /** 取得完整計算結果（畫圖用） */
    getResults() {
        this._ensureCalculated();
        return this._results;
    }

    /** 更換整組 K 線資料 */
    setData(data) {
        this.data = Array.isArray(data) ? data.slice() : [];
        this._results = null;
    }

    /** 追加一根 K 線（例如即時更新） */
    update(bar) {
        if (bar) this.data.push(bar);
        this._results = null;
    }

    /** 批量更新數據 */
    updateBatch(bars) {
        if (Array.isArray(bars)) {
            this.data.push(...bars);
        }
        this._results = null;
    }

    /** 重置 */
    reset() {
        this.data = [];
        this._results = null;
    }

    /** 簡單查看狀態 */
    getStatus() {
        return {
            dataLength: this.data.length,
            resultsLength: this._results ? this._results.length : 0,
            options: this.options,
            lastSignal: this.getSimpleSignal()
        };
    }
}