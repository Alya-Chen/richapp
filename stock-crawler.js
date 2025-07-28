import axios from 'axios';
import * as cheerio from 'cheerio';
import * as dateFns from 'date-fns';
import * as dateUtils from './date-utils.js';
import * as db from './stock-db.js';
import yahooFinance from 'yahoo-finance2';

const API_URL = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const OTC_URL = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock'; //code=1264&date=2025%2F04%2F01
const REALTIME_URL = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const DIVIDEND_URL = `https://tw.stock.yahoo.com/quote/STOCK_NO/dividend`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const NUMBER = /^\d+$/;

export class Crawler {
	constructor(stock) {
		if (stock) {
			this.stockNo = stock.code;
			this.otc = stock.otc;
			this.country = stock.country;
		}
		yahooFinance.suppressNotices(['yahooSurvey']);
	}

	async fetchMeta() {
		const codes = !NUMBER.test(this.stockNo.charAt(0)) ? [this.stockNo] : [`${this.stockNo}.TW`, `${this.stockNo}.TWO`];
		try {
			const quotes = await yahooFinance.quote(codes);
			return quotes.length ? quotes[0] : null;
		} catch (error) {
			db.Log.error(`抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async fetchDividendData() {
		const url = DIVIDEND_URL.replace('STOCK_NO', (this.country == 'us') ? this.stockNo : (this.otc ? `${this.stockNo}.TWO` : `${this.stockNo}.TW`));
		try {
			const {
				data: html
			} = await axios.get(url, {
				headers: {
					'User-Agent': USER_AGENT
				},
			});

			const $ = cheerio.load(html);
			const results = [];
			// 找到包含股利的表格（根據網頁結構）
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
			db.Log.error(`抓取 ${this.stockNo} 股利日期資料錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async fetchAll(period1, period2) {
		period1 = period1 || new Date('2020-01-01');
		period2 = period2 || new Date();
		try {
			const code = (this.country == 'us') ? this.stockNo : (this.otc ? `${this.stockNo}.TWO` : `${this.stockNo}.TW`);
			const rawData = await yahooFinance.chart(code, {
				period1,
				period2
			});
			// 轉換數據格式
			const quotes = rawData.quotes.filter(d => d.open && !isNaN(d.open));
			quotes.forEach((item, idx) => {
				if (idx == 0) return;
				item.diff = item.close - quotes[idx - 1].close;
			});
			console.log(`${this.stockNo} 抓取成功共 ${quotes.length} 筆資料`);
			return quotes;
		} catch (error) {
			db.Log.error(`抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	convertToUST(market, date) {
		if (market != 'us_market') return date;
		const usDateStr = date.toLocaleString('en-US', {
			timeZone: 'America/New_York'
		});
		return new Date(usDateStr);
	}

	async realtime(codes) {
		const stocks = await db.Stock.findAll();
		codes = codes.map(code => {
			const stock = stocks.find(s => s.code == code);
			return (stock.country == 'us') ? code : (stock.otc ? `${code}.TWO` : `${code}.TW`);
		});
		try {
			const quotes = await yahooFinance.quote(codes);
			const preMarket = (quotes.length && quotes[0].marketState == 'PRE');
			// 還沒有報價的資料先過濾掉
			const dailies = quotes.filter(q => preMarket ? q.preMarketTime : q.regularMarketTime).map(q => {
				const open = preMarket ? (q.preMarketPrice - q.preMarketChange) : q.regularMarketOpen;
				return {
					open,
					code: q.symbol.replace('.TWO', '').replace('.TW', ''),
					date: this.convertToUST(q.market, preMarket ? q.preMarketTime : q.regularMarketTime),
					volume: preMarket ? 0 : q.regularMarketVolume,
					high: preMarket ? Math.max(open, q.preMarketPrice) : q.regularMarketDayHigh,
					low: preMarket ? Math.min(open, q.preMarketPrice) : q.regularMarketDayLow,
					close: preMarket ? q.preMarketPrice : q.regularMarketPrice,
					diff: preMarket ? q.preMarketChange : q.regularMarketChange,
					diffRate: preMarket ? q.preMarketChangePercent : q.regularMarketChangePercent,
					pre: q.regularMarketPreviousClose
				};
			});
			console.log(`[${new Date().toLocaleString()}] 成功抓取 ${dailies.length} 筆即時股價資料`);
			return dailies;
		} catch (error) {
			db.Log.error(`抓取即時股價資料失敗: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async fetchAllTw(startDate) {
		startDate = startDate || new Date('2020-01-01');
		startDate.setDate(1);
		const dates = [];
		const today = new Date();
		while (startDate <= today) {
			dates.push(dateFns.format(startDate, this.otc ? 'yyyy/MM/dd' : 'yyyyMMdd'));
			startDate = dateFns.addMonths(startDate, 1);
		}
		const results = [];
		for (const date of dates) {
			try {
				const result = this.otc ? await this.fetchTwOtc(date) : await this.fetchTw(date);
				console.log(`完成抓取 ${this.stockNo} ${date} 共 ${result.data.length} 筆資料`);
				results.push(result.data);
				await randomDelay(); // 避免過快請求
			} catch (error) {
				db.Log.error(`${this.stockNo} ${date} 抓取失敗: ${error.message || '未知錯誤'}`);
				return results.flat();
			}
		}
		console.log(`${this.stockNo} 抓取成功共 ${results.flat().length} 筆資料`);
		return results.flat();
	}

	async fetchTw(date) {
		try {
			// 參數驗證
			if (!/^\d{4,}[A-Z]?$/.test(this.stockNo)) throw new Error('股票代碼格式錯誤');

			const stockNo = this.stockNo;
			// 設置請求參數
			const params = {
				date: date,
				stockNo,
				response: 'json',
				_: Date.now() // 避免快取
			};

			// 發送請求
			const response = await axios.get(API_URL, {
				params,
				headers: {
					'User-Agent': USER_AGENT
				},
				timeout: 10000
			});

			// 處理回應數據
			const rawData = response.data;
			if (rawData.total == 0) {
				return {
					stockNo,
					data: []
				};
			}
			if (rawData.stat !== 'OK') {
				throw new Error(`抓取 ${this.stockNo} 錯誤: ${rawData.stat || '未知錯誤'}`);
			}

			// 轉換數據格式
			const processedData = rawData.data.map(item => ({
				date: dateUtils.convertTwDate(item[0]),
				volume: parseInt(item[1].replace(/,/g, '')),
				money: parseInt(item[2].replace(/,/g, '')),
				open: parseFloat(item[3].replace(/,/g, '')),
				high: parseFloat(item[4].replace(/,/g, '')),
				low: parseFloat(item[5].replace(/,/g, '')),
				close: parseFloat(item[6].replace(/,/g, '')),
				diff: parseFloat(item[7].replace('+', '').replace('X', '')),
				transCount: parseInt(item[8].replace(/,/g, ''))
			})).filter(d => !isNaN(d.open));
			return {
				stockNo,
				dateRange: {
					start: processedData[0].date,
					end: processedData[processedData.length - 1].date
				},
				data: processedData
			};
		} catch (error) {
			db.Log.error(`抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async fetchTwOtc(date) {
		try {
			// 參數驗證
			if (!/^\d{4,}[A-Z]?$/.test(this.stockNo)) throw new Error('股票代碼格式錯誤');

			const stockNo = this.stockNo;
			// 設置請求參數
			const params = {
				date: date,
				code: stockNo,
				response: 'utf-8'
			};

			// 發送請求
			const response = await axios.get(OTC_URL, {
				params,
				headers: {
					'User-Agent': USER_AGENT
				},
				responseType: 'blob',
				timeout: 10000
			});

			if (response.data.includes('共0筆')) return {
				stockNo,
				data: []
			};
			// 處理回應數據
			const rawData = response.data.split('\r\n').slice(5);
			//console.log(rawData); 
			// 轉換數據格式，日 期,成交張數,成交仟元,開盤,最高,最低,收盤,漲跌,筆
			const processedData = [];
			rawData.forEach(item => {
				item = [...item.matchAll(/"([^"]*)"/g)].map(match => {
					const cleaned = match[1].replace(/,/g, '');
					return isNaN(cleaned) ? cleaned : Number(cleaned);
				});
				if (item.length != 9 || isNaN(item[3])) return;
				processedData.push({
					date: dateUtils.convertTwDate(item[0]),
					volume: parseInt(item[1]),
					money: parseInt(item[2]),
					open: parseFloat(item[3]),
					high: parseFloat(item[4]),
					low: parseFloat(item[5]),
					close: parseFloat(item[6]),
					diff: parseFloat(item[7]),
					transCount: parseInt(item[8])
				});
			});
			return {
				stockNo,
				dateRange: {
					start: processedData[0].date,
					end: processedData[processedData.length - 1].date
				},
				data: processedData
			};
		} catch (error) {
			db.Log.error(`抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async realtimeTw(allCodes, start = 0, result = []) {
		let codes = allCodes.slice(start, start + 100);
		if (codes.length === 0) {
			console.log(`[${new Date().toLocaleString()}] 成功抓取即時股價資料`);
			return result.flat();
		}
		const stocks = await db.Stock.findAll();
		codes = codes.map(code => {
			const stock = stocks.find(s => s.code == code);
			return stock.otc ? `otc_${code}.tw` : `tse_${code}.tw`;
		}).join('|');
		try {
			const response = await axios.get(REALTIME_URL, {
				params: {
					ex_ch: codes,
					_: new Date().getTime()
				},
				headers: {
					'User-Agent': USER_AGENT
				},
				timeout: 10000
			});

			// 處理回應數據
			const rawData = response.data;
			if (rawData.rtmessage !== 'OK') {
				throw new Error(`API 回應錯誤: ${rawData.rtmessage || '未知錯誤'}`);
			}

			// 轉換數據格式
			// 'c','n','z','tv','v','o','h','l','y', 'tlong'
			// 'c 股票代號','n 公司簡稱','z 成交價','tv 成交量','v 累積成交量','o 開盤價','h 最高價','l 最低價','y 昨收價', 'tlong 資料更新時間'
			// 沒有成交價，取最高買價 b 161.6500_161.6000_161.5500_161.5000_161.4500_
			const dailies = rawData.msgArray.map(item => ({
				code: item.c,
				date: new Date(parseInt(item.tlong)),
				volume: parseInt(item.tv) || 0,
				open: parseFloat(item.o),
				high: parseFloat(item.h),
				low: parseFloat(item.l),
				close: parseFloat(item.z != '-' ? item.z : (item.b ? item.b.split('_').shift() : 0)),
				pre: parseFloat(item.y),
			}));
			dailies.forEach(day => {
				day.diff = parseFloat((day.close - day.pre).toFixed(2));
				day.diffRate = parseFloat((day.diff / day.pre).toFixed(2));
			});
			result.push(dailies);
			return await this.realtimeTw(allCodes, start + 100, result);
		} catch (error) {
			db.Log.error(`抓取即時股價資料失敗: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}
}

async function randomDelay(min = 3000, max = 5000) {
	return new Promise(resolve =>
		setTimeout(resolve, Math.random() * (max - min) + min)
	);
}