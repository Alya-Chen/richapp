/**
 * 均線支撐力分析器 (Moving Average Support Analyzer)
 * 找出 15 日到 45 日間，哪條均線在下跌後提供最強大的反彈支撐。
 */

// 擴充 Number 原型，用於四捨五入到指定小數點位數
if (!Number.prototype.scale) {
    Number.prototype.scale = function(n) {
        return Math.round(this * Math.pow(10, n)) / Math.pow(10, n);
    };
}

export class MovingAverageAnalyzer {
    /**
     * @param {Array<Object>} data 股票區間資料
     * 格式: Array<{ code, date, open, high, low, close, volume }>
     */
    constructor(data, options = {}) {
        this.CONTEXT_RANGE = 0.015; // 判斷是否在 MA 附近的範圍 (1.5%)
        // 確保資料按日期排序，以利計算
        this.data = data.sort((a, b) => new Date(a.date) - new Date(b.date));
        this.allMAs = {}; // 儲存所有 MA 計算結果
        this.supportCounts = {}; // 儲存支撐次數 (現為支撐分數)
	    this.minPeriod = options.minPeriod || 15;
	    this.maxPeriod = options.maxPeriod || 45;
        this.reboundThreshold = options.reboundThreshold || 0.005; // 反彈幅度門檻 (0.5%)
    }

    /**
     * 計算簡單移動平均 (Simple Moving Average, SMA)
     * @param {number} period 均線週期
     * @returns {Array<number|null>} 每日 MA 值
     */
    calculateSMA(period) {
        const maArray = [];
        for (let i = 0; i < this.data.length; i++) {
            if (i < period - 1) {
                maArray.push(null);
                continue;
            }
            const slice = this.data.slice(i - period + 1, i + 1);
            const sum = slice.reduce((acc, day) => acc + day.close, 0);
            maArray.push((sum / period).scale(2)); // MA 值保留兩位小數
        }
        return maArray;
    }

    /**
     * 步驟 1: 計算所有指定範圍內的均線
     */
    calculateAllMAs() {
        console.log(`[步驟 1] 開始計算 ${this.minPeriod} 到 ${this.maxPeriod} 日所有均線...`);
        for (let p = this.minPeriod; p <= this.maxPeriod; p++) {
            this.allMAs[p] = this.calculateSMA(p);
            this.supportCounts[p] = 0; // 初始化計數器
        }
    }

    /**
     * 步驟 2: 分析每條均線的支撐力 (下跌後反彈次數及持續時間)
     * * 定義：
     * 1. 股價處於 MA 附近的下跌情境 (前一日收盤價在 MA 的 1.5% 範圍內)。
     * 2. 當日股價最低點 (low) 觸及或穿過均線 (low < MA)。
     * 3. 成功反彈 (當日收盤守住 MA 或次日收盤價顯著反彈)。
     * 4. [修正] 支撐力分數 = 連續收盤在 MA 上方的天數。
     */
    analyzeSupportStrength() {
        console.log(`[步驟 2] 分析各均線的支撐與反彈次數與持續力...`);
        const numDays = this.data.length;

        for (const period in this.allMAs) {
            const maArray = this.allMAs[period];
            const p = parseInt(period);

            if (numDays < p) continue;

            // i 為當前分析日期的索引
            for (let i = p; i < numDays - 1; i++) {
                const maToday = maArray[i];
                const dayToday = this.data[i];
                const dayPrev = this.data[i - 1];
                const dayNext = this.data[i + 1];

                if (maToday === null) continue;

                // --- 判斷支撐條件 ---
                // A. 條件一：發生測試 (Tested the MA)
                const isTested = dayToday.low <= maToday;

                // B. 條件二：下跌情境確認 (Decline Context)
                // 前一日收盤價必須在 MA 的 -1.5% 到無限高範圍內 (即 MA 附近或上方)
                const isInDeclineContext = dayPrev.close >= maToday * (1 - this.CONTEXT_RANGE);

                // C. 條件三：發生反彈 (Rebound Check) - 觸發反彈訊號
                const closedAboveMA = dayToday.close > maToday;
                const nextDayRebound = dayNext.close > maToday * (1 + this.reboundThreshold);
                const isReboundTriggered = closedAboveMA || nextDayRebound;

                // 組合：MA 必須被測試 AND 測試發生在 MA 附近 AND 反彈訊號被觸發
                if (isTested && isInDeclineContext && isReboundTriggered) {

                    // --- 新增：計算反彈持續天數作為分數 (Streak Scoring) ---
                    let streakLength = 0;
                    let k; // k: 價格站穩 MA 的起始日

                    // 1. 確認站穩 MA 的起始日 (k)
                    if (closedAboveMA) {
                        k = i; // 當天收盤價就站穩 MA
                    } else if (nextDayRebound) {
                        // 雖然當天沒站穩，但次日強勁反彈，必須確認次日收盤價是否站穩 MA
                        k = i + 1;
                        if (this.data[k].close <= maArray[k]) {
                            // 雖然有反彈訊號，但次日未能站穩 MA，只計 1 分作為單次弱支撐
                            this.supportCounts[p] += 1;
                            continue;
                        }
                    } else {
                        // 程式理論上不應該到達此處
                        continue;
                    }

                    // 2. 計算連續站穩 MA 的天數 (從 k 開始)
                    let checkIndex = k;

                    while (checkIndex < numDays) {
                        const maCheck = maArray[checkIndex];
                        const dayCheck = this.data[checkIndex];

                        // 檢查 MA 數據是否有效，且收盤價是否大於 MA
                        if (maCheck === null || dayCheck.close <= maCheck) {
                            break; // 斷開，反彈結束
                        }

                        // 連續收盤高於 MA，增加分數
                        streakLength++;
                        checkIndex++;
                    }

                    // 3. 賦予分數並移動主迴圈指針
                    this.supportCounts[p] += streakLength;

                    // 跳過已經計分的天數，避免重複計算同一個支撐事件
                    // 將 i 移動到 streak 結束的前一天，因為 for 迴圈還會執行 i++
                    i = checkIndex - 1;
                }
            }
        }
    }

    /**
     * 步驟 3: 匯總並排序結果
     * @returns {Array<Object>} 包含週期和支撐次數的排序列表
     */
    getRankedResults() {
        const ranked = Object.keys(this.supportCounts).map(period => ({
            period: parseInt(period),
            supportScore: this.supportCounts[period],
        }));

        // 依據支撐分數降序排序
        ranked.sort((a, b) => b.supportScore - a.supportScore);

        console.log(`[步驟 3] 支撐力分析完成。`);
        return ranked.filter(r => r.supportScore > 0); // 只顯示有支撐記錄的均線
    }

    /**
     * 執行完整分析流程
     * @returns {Array<Object>} 支撐力最強的均線列表 (已排序)
     */
    run() {
        if (this.data.length < this.maxPeriod) {
            console.error(`錯誤：資料量不足！至少需要 ${this.maxPeriod} 筆數據進行可靠分析。`);
            return [];
        }
        this.calculateAllMAs();
        this.analyzeSupportStrength();
        return this.getRankedResults();
    }
}