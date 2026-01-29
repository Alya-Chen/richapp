import axios from 'axios';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';
import * as dateFns from 'date-fns';
import * as dateUtils from './date-utils.js';
import * as db from './stock-db.js';

// --- Constants ---
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// Yahoo Sources (Primary)
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';

// US Sources (Backup)
const FINNHUB_KEY = 'd5f04upr01qrb2hbc420d5f04upr01qrb2hbc42g';
const FINNHUB_V1 = 'https://finnhub.io/api/v1';

// TW Sources (Backup)
const TWSE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const TPEX = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock';
const TWSE_REALTIME = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const DIVIDEND = `https://tw.stock.yahoo.com/quote/STOCK_NO/dividend`;

/**
 * 基礎爬蟲類別 (Base Class)
 */
export class Crawler {
    constructor(stock) {
        if (stock) {
            this.stockNo = stock.code;
            this.otc = stock.otc;
            this.country = stock.country;
        }
    }

    // 工廠模式：預設回傳 YahooCrawler，它會負責處理 Fallback
    static create(stock) {
        return new YahooCrawler(stock);
    }

    // 共用方法：抓取股利 (Yahoo 頁面結構對台美股相似，故保留在 Base)
    async fetchDividendData() {
        const symbol = (this.country === 'us') ?
            this.stockNo :
            (this.otc ? `${this.stockNo}.TWO` : `${this.stockNo}.TW`);

        const url = DIVIDEND.replace('STOCK_NO', symbol);

        try {
            const { data: html } = await axios.get(url, { headers: HEADERS });
            const $ = cheerio.load(html);
            const results = [];
            $('section').each((_, section) => {
                const title = $(section).find('h3').text();
                if (title.includes('股利政策')) {
                    $(section).find('table tbody tr').each((_, row) => {
                        const cells = $(row).find('td').map((i, el) => $(el).text().trim()).get();
                        if (cells.length >= 5) {
                            results.push({
                                年度: cells[0],
                                現金股利: cells[1],
                                股票股利: cells[2],
                                合計: cells[3],
                                除息日: cells[4],
                            });
                        }
                    });
                }
            });
            return results;
        } catch (error) {
            db.Log.error(`抓取 ${this.stockNo} 股利資料錯誤: ${error.message}`);
            return [];
        }
    }

    async fetchAll(period1, period2) { throw new Error("Method not implemented."); }
    async realtime(codes) { throw new Error("Method not implemented."); }
}

/**
 * Yahoo 爬蟲 (Primary)
 * 優先嘗試 Yahoo API，失敗時自動降級使用 UsCrawler 或 TwCrawler
 */
class YahooCrawler extends Crawler {
    getYahooSymbol(code, country, otc) {
        const targetCode = code || this.stockNo;
        const targetCountry = country || this.country;
        const targetOtc = otc !== undefined ? otc : this.otc;
        if (targetCountry === 'us') return targetCode;
        return targetOtc ? `${targetCode}.TWO` : `${targetCode}.TW`;
    }

	convertToUST(timezone, date) {
		if (timezone.includes('Taipei')) return date;
		const usDateStr = date.toLocaleString('en-US', {
			timeZone: 'America/New_York'
		});
		return new Date(usDateStr);
	}

    // 1. 歷史報價 (v8)
    async fetchAll(period1, period2) {
        const symbol = this.getYahooSymbol();
        const p1 = Math.floor((period1 || new Date('2020-01-01')).getTime() / 1000);
        const p2 = Math.floor((period2 || new Date()).getTime() / 1000);

        try {
            const { data } = await axios.get(`${YAHOO_CHART}${symbol}`, {
                params: { period1: p1, period2: p2, interval: '1d', events: 'history' },
                headers: HEADERS, timeout: 5000
            });
            return this.parseChartData(data);
        } catch (error) {
            console.warn(`[Yahoo Chart] 歷史抓取失敗，嘗試備案...`);
            const backup = this.country === 'us' ? new UsCrawler(this) : new TwCrawler(this);
            return await backup.fetchAll(period1, period2);
        }
    }

    // 2. 即時報價
    async realtime(codes) {
        const results = [];
        const stocks = await db.Stock.findAll();

        for (const code of codes) {
            const stock = stocks.find(s => s.code == code);
            const symbol = this.getYahooSymbol(code, stock?.country, stock?.otc);
            try {
                // v8 chart 不帶日期參數時，會回傳最後一筆報價
                const { data } = await axios.get(`${YAHOO_CHART}${symbol}`, {
                    params: { interval: '1m', range: '1d' }, // 抓取當天 1 分鐘線，主要取 meta
                    headers: HEADERS, timeout: 5000
                });
                const meta = data.chart?.result?.[0]?.meta;
                if (!meta) throw new Error("No Meta Data");
                const indicators = data.chart?.result?.[0]?.indicators?.quote?.[0];
				// Open 的取法：優先取 indicators 裡的第一筆，若無則參考 meta
                const openPrice = (indicators?.open && indicators.open[0])
                              ? indicators.open[0]
                              : meta.regularMarketPrice;

                results.push({
                    code: code,
                    date: this.convertToUST(meta.exchangeTimezoneName, new Date(meta.regularMarketTime * 1000)),
                    open: openPrice,
                    high: meta.regularMarketDayHigh || meta.regularMarketPrice,
                    low: meta.regularMarketDayLow || meta.regularMarketPrice,
                    close: meta.regularMarketPrice,
					volume: meta.regularMarketVolume,
                    pre: meta.previousClose,
                    diff: meta.regularMarketPrice - meta.previousClose,
                    diffRate: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
                });
				if (codes.length > 1) await randomDelay(100, 250);
            } catch (error) {
                console.warn(`[Yahoo Realtime] ${code} 失敗 ${error}，嘗試備案...`);
                // 單筆失敗時，改用對應的 Backup (Finnhub 或 TWSE)
                const backup = (stock?.country === 'us') ? new UsCrawler(stock) : new TwCrawler(stock);
                const bData = await backup.realtime([code]);
                if (bData.length > 0) results.push(bData[0]);
            }
        }
        return results;
    }

	parseChartData(data) {
		const result = data.chart?.result?.[0];
		if (!result) return [];

		const { timestamp, indicators, meta } = result;
		const quote = indicators.quote[0];

		// 1. 初步整理：將陣列轉為物件，並過濾掉無效資料 (null)
		// Yahoo 有時會在非交易時段回傳 timestamp 但數值為 null
		const quotes = timestamp.map((ts, i) => ({
			date: new Date(ts * 1000),
			open: quote.open[i],
			high: quote.high[i],
			low: quote.low[i],
			close: quote.close[i],
			volume: quote.volume[i] || 0
		})).filter(item => item.close != null && item.open != null);

		// 2. 計算 diff (漲跌) 與 diffRate (漲跌幅)
		// 初始基準：使用 meta 裡的 chartPreviousClose (這段區間的前一日收盤價)
		let previousClose = meta.chartPreviousClose;
		quotes.forEach((item) => {
			// 只有當我們有「前一日收盤價」時才能算漲跌
			if (previousClose != null) {
				// 計算漲跌 (今日收盤 - 昨日收盤)
				const diffVal = item.close - previousClose;
				// 計算漲跌幅 %
				const diffRateVal = (diffVal / previousClose) * 100;
				// 處理浮點數精度問題 (例如 0.1 + 0.2 = 0.300000004)
				item.diff = parseFloat(diffVal.toFixed(2));
				item.diffRate = parseFloat(diffRateVal.toFixed(2));
			} else {
				item.diff = 0;
				item.diffRate = 0;
			}
			// 重要：將「今日收盤」更新為「明日的昨日收盤」，供下一次迴圈使用
			previousClose = item.close;
		});

		return quotes;
	}
}

/**
 * 美股備用爬蟲 (UsCrawler) -> Stooq / Finnhub
 */
class UsCrawler extends Crawler {
    constructor(stock) {
        super(stock);
    }

    // 使用 Stooq 抓取歷史資料 (CSV)
    async fetchAll(period1, period2) {
        const p1 = period1 || new Date('2020-01-01');
        const p2 = period2 || new Date();
        const from = dateFns.format(p1, 'yyyyMMdd');
        const to = dateFns.format(p2, 'yyyyMMdd');

        try {
            const url = `https://stooq.com/q/d/l/?s=${this.stockNo}.us&i=d&d1=${from}&d2=${to}`;
            const { data } = await axios.get(url, { responseType: 'text', headers: HEADERS });
            if (data.includes('No data')) {
                console.log(`[Stooq] ${this.stockNo} 在 ${from}~${to} 無資料`);
                return [];
            }
            const records = parse(data, { columns: true, skip_empty_lines: true });
            const quotes = records.map(row => ({
                date: new Date(row.Date),
                open: parseFloat(row.Open),
                high: parseFloat(row.High),
                low: parseFloat(row.Low),
                close: parseFloat(row.Close),
                volume: parseInt(row.Volume) || 0
            })).sort((a, b) => a.date - b.date);
            // 計算漲跌
            for (let i = 1; i < quotes.length; i++) {
                quotes[i].diff = quotes[i].close - quotes[i-1].close;
            }
            return quotes;
        } catch (error) {
            db.Log.error(`[Stooq] ${this.stockNo} 歷史資料錯誤: ${error.message}`);
            throw error;
        }
    }

    // 使用 Finnhub 抓取即時資料 (JSON)
    async realtime(codes) {
        const results = [];
        try {
            for (const code of codes) {
                // Finnhub 免費版需逐一請求
                const { data: q } = await axios.get(`${FINNHUB_V1}/quote`, {
                    params: { symbol: code, token: FINNHUB_KEY },
                    timeout: 5000
                });

                results.push({
                    code: code,
                    date: q.t ? new Date(q.t * 1000) : new Date(),
                    open: q.o,
                    high: q.h,
                    low: q.l,
                    close: q.c,
                    diff: q.d,
                    diffRate: q.dp,
                    pre: q.pc,
                    volume: 0
                });

                // 避免觸發 Finnhub 60次/分 限制
                if (codes.length > 1) await randomDelay(1100, 1500);
            }
            console.log(`[Finnhub] 成功抓取 ${results.length} 筆美股即時資料`);
            return results;
        } catch (error) {
            db.Log.error(`[Finnhub] 即時股價失敗: ${error.message}`);
            await randomDelay(2000, 3000); // 發生錯誤時多休息一下
            throw error;
        }
    }
}

/**
 * 台股備用爬蟲 (TwCrawler) -> TWSE / TPEX
 */
class TwCrawler extends Crawler {
    constructor(stock) {
        super(stock);
    }

    // 抓取台股歷史資料 (自動判斷上市/上櫃並分月抓取)
    async fetchAll(period1, period2) {
        let startDate = period1 || new Date('2020-01-01');
        startDate.setDate(1); // 強制從該月1號開始
        const endDate = period2 || new Date();

        const dates = [];
        while (startDate <= endDate) {
            dates.push(dateFns.format(startDate, this.otc ? 'yyyy/MM/dd' : 'yyyyMMdd'));
            startDate = dateFns.addMonths(startDate, 1);
        }

        const results = [];
        for (const date of dates) {
            try {
                const result = this.otc ? await this.fetchTwOtc(date) : await this.fetchTw(date);
                console.log(`[TW] 完成抓取 ${this.stockNo} ${date} 共 ${result.data.length} 筆`);
                results.push(result.data);
                await randomDelay(2000, 3000); // 台股官方 API 需要較長延遲以免被擋
            } catch (error) {
                db.Log.error(`[TW] ${this.stockNo} ${date} 抓取失敗: ${error.message}`);
                // 不拋出錯誤，讓迴圈繼續抓下個月
            }
        }
        return results.flat();
    }

    // 私有方法：抓取上市 (TWSE) 單月資料
    async fetchTw(date) {
        const params = {
            date: date,
            stockNo: this.stockNo,
            response: 'json',
            _: Date.now()
        };

        const response = await axios.get(TWSE, { params, headers: HEADERS, timeout: 10000 });
        const rawData = response.data;

        if (rawData.stat !== 'OK') throw new Error(rawData.stat);

        const data = rawData.data.map(item => ({
            date: dateUtils.convertTwDate(item[0]),
            volume: parseInt(item[1].replace(/,/g, '')),
            money: parseInt(item[2].replace(/,/g, '')),
            open: parseFloat(item[3].replace(/,/g, '')),
            high: parseFloat(item[4].replace(/,/g, '')),
            low: parseFloat(item[5].replace(/,/g, '')),
            close: parseFloat(item[6].replace(/,/g, '')),
            diff: parseFloat(item[7].replace(/[+X]/g, '')),
            transCount: parseInt(item[8].replace(/,/g, ''))
        })).filter(d => !isNaN(d.open));

        return { data };
    }

    // 私有方法：抓取上櫃 (TPEX) 單月資料
    async fetchTwOtc(date) {
        const params = { date: date, code: this.stockNo, response: 'utf-8' }; // TPEX 特定參數
        const response = await axios.get(TPEX, { params, headers: HEADERS, responseType: 'json', timeout: 10000 });

        // 修正：TPEX 有時回傳 JSON，但有時需要處理格式
        // 如果是 JSON 結構 (新版 API)
        const rawData = response.data;
        if (!rawData.aaData) return { data: [] };

        const data = rawData.aaData.map(item => ({
             date: dateUtils.convertTwDate(item[0]),
             volume: parseInt(item[1].replace(/,/g, '')),
             money: parseInt(item[2].replace(/,/g, '')),
             open: parseFloat(item[3].replace(/,/g, '')),
             high: parseFloat(item[4].replace(/,/g, '')),
             low: parseFloat(item[5].replace(/,/g, '')),
             close: parseFloat(item[6].replace(/,/g, '')),
             diff: parseFloat(item[7].replace(/[+X]/g, '')),
             transCount: parseInt(item[8].replace(/,/g, ''))
        })).filter(d => !isNaN(d.open));

        return { data };
    }

    // 抓取台股即時資料 (支援批次)
    async realtime(codes) {
        return this.realtimeTwRecursive(codes);
    }

    // 遞迴批次處理 (每次 100 筆)
    async realtimeTwRecursive(allCodes, start = 0, result = []) {
        let batchCodes = allCodes.slice(start, start + 100);
        if (batchCodes.length === 0) return result.flat();

        // 查詢 DB 轉換代碼格式 (tse_1101.tw / otc_8044.tw)
        const stocks = await db.Stock.findAll();
        const queryCodes = batchCodes.map(code => {
            const stock = stocks.find(s => s.code == code);
            if (!stock) return null;
            return stock.otc ? `otc_${code}.tw` : `tse_${code}.tw`;
        }).filter(c => c).join('|');

        if (!queryCodes) return result;

        try {
            const response = await axios.get(TWSE_REALTIME, {
                params: { ex_ch: queryCodes, _: Date.now() },
                headers: HEADERS,
                timeout: 10000
            });

            const rawData = response.data;
            if (rawData.rtmessage !== 'OK') throw new Error(rawData.rtmessage);

            const dailies = rawData.msgArray.map(item => ({
                code: item.c,
                date: new Date(parseInt(item.tlong)),
                volume: parseInt(item.tv) || 0,
                open: parseFloat(item.o),
                high: parseFloat(item.h),
                low: parseFloat(item.l),
                // 如果沒有成交價(z)，改用最高買價(b)的第一檔
                close: parseFloat(item.z !== '-' ? item.z : (item.b ? item.b.split('_')[0] : 0)),
                pre: parseFloat(item.y),
            }));

            // 補算漲跌
            dailies.forEach(day => {
                if(day.pre) {
                    day.diff = parseFloat((day.close - day.pre).toFixed(2));
                    day.diffRate = parseFloat((day.diff / day.pre).toFixed(4)); // 修正小數點邏輯
                }
            });

            result.push(dailies);
            // 遞迴下一批
            return await this.realtimeTwRecursive(allCodes, start + 100, result);

        } catch (error) {
            db.Log.error(`[TW Realtime] 抓取失敗: ${error.message}`);
            throw error;
        }
    }
}

// 輔助函式：隨機延遲
async function randomDelay(min = 1000, max = 2000) {
    const delay = Math.random() * (max - min) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}