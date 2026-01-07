import axios from 'axios';
import { parse } from 'csv-parse/sync';
import * as cheerio from 'cheerio';
import * as dateFns from 'date-fns';
import * as dateUtils from './date-utils.js';
import * as db from './stock-db.js';

// --- https://finnhub.io/dashboard 設定 ---
const FINNHUB_KEY = 'd5f04upr01qrb2hbc420d5f04upr01qrb2hbc42g'; // 建議放入環境變數
const FINNHUB_V1 = 'https://finnhub.io/api/v1';
const TWSE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY';
const TPEX = 'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock'; //code=1264&date=2025%2F04%2F01
const TWSE_REALTIME = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const DIVIDEND = `https://tw.stock.yahoo.com/quote/STOCK_NO/dividend`;
const HEADERS = {
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

export class Crawler {
	constructor(stock) {
		if (stock) {
			this.stockNo = stock.code;
			this.otc = stock.otc;
			this.country = stock.country;
		}
	}

	async fetchDividendData() {
		const url = DIVIDEND.replace('STOCK_NO', (this.country == 'us') ? this.stockNo : (this.otc ? `${this.stockNo}.TWO` : `${this.stockNo}.TW`));
		try {
			const {
				data: html
			} = await axios.get(url, {
				headers: HEADERS
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

	async fetchAll(period1 = new Date('2020-01-01'), period2 = new Date() ) {
		if (this.country == 'tw') {
			return this.fetchAllTw(period1);
		}
		const from = dateFns.format(period1, 'yyyyMMdd');
    	const to = dateFns.format(period2, 'yyyyMMdd');
		try {
			const url = `https://stooq.com/q/d/l/?s=${this.stockNo}.us&i=d&d1=${from}&d2=${to}`;
			const { data } = await axios.get(url, {
				responseType: 'text',
				headers: HEADERS
			});
			if (data.includes('No data')) {
            	console.log(`${this.stockNo} 在 ${from}~${to} 區間無資料。`);
            	return [];
        	}

			// 解析 CSV 資料
			const records = parse(data, {
				columns: true, // 自動將第一行作為物件的 Key (Date, Open, High...)
				skip_empty_lines: true
			});

			const quotes = records.map(row => ({
				date: new Date(row.Date),
				open: parseFloat(row.Open),
				high: parseFloat(row.High),
				low: parseFloat(row.Low),
				close: parseFloat(row.Close),
				volume: parseInt(row.Volume) || 0
			})).sort((a, b) => a.date - b.date); // 確保日期由舊到新排序

			// 計算漲跌 (diff)
			quotes.forEach((item, idx) => {
				if (idx === 0) return;
				item.diff = item.close - quotes[idx - 1].close;
			});

			return quotes;
		} catch (error) {
			db.Log.error(`Stooq 抓取 ${this.stockNo} 歷史資料錯誤: ${error.message}`);
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
		// 先取回台灣股票資料
		const results = await this.realtimeTw(codes.filter(c => this.country == 'tw'));
		const stocks = await db.Stock.findAll();
		try {
			for (const code of codes) {
				const stock = stocks.find(s => s.code == code);
				if (!stock || stock.country == 'tw') continue;
				// 只抓美股資料
				const { data: q } = await axios.get(`${FINNHUB_V1}/quote`, {
					params: { symbol: code, token: FINNHUB_KEY }
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
					volume: 0 // Finnhub quote 介面不提供即時累積成交量，需另接 API
				});
				await randomDelay(); // 避免過快請求
			}
			console.log(`[${new Date().toLocaleString()}] 成功抓取 ${results.length} 筆即時股價資料`);
			return results;
		} catch (error) {
			db.Log.error(`Finnhub 抓取即時股價失敗: ${error.message}`);
			throw error;
		}
	}

	async fetchAllTw(startDate = new Date('2020-01-01')) {
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
			const response = await axios.get(TWSE, {
				params,
				headers: HEADERS,
				timeout: 10000
			});

			const result = {
				stockNo,
				data: []
			};
			// 處理回應數據
			const rawData = response.data;
			if (rawData.total == 0) return result;
			if (rawData.stat !== 'OK') {
				throw new Error(`抓取 ${this.stockNo} 錯誤: ${rawData.stat || '未知錯誤'}`);
			}
			// 轉換數據格式
			result.data = rawData.data.map(item => ({
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

			if (result.data.length) {
				result.dateRange = {
					start: result.data[0].date,
					end: result.data[result.data.length - 1].date
				};
			}
			return result;
		} catch (error) {
			db.Log.error(` 抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
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
			const response = await axios.get(TPEX, {
				params,
				headers: HEADERS,
				responseType: 'blob',
				timeout: 10000
			});

			const result = {
				stockNo,
				data: []
			};
			if (response.data.includes('共0筆')) return result;
			// 處理回應數據
			const rawData = response.data.split('\r\n').slice(5);
			//console.log(rawData);
			// 轉換數據格式，日 期,成交張數,成交仟元,開盤,最高,最低,收盤,漲跌,筆
			rawData.forEach(item => {
				item = [...item.matchAll(/"([^"]*)"/g)].map(match => {
					const cleaned = match[1].replace(/,/g, '');
					return isNaN(cleaned) ? cleaned : Number(cleaned);
				});
				if (item.length != 9 || isNaN(item[3])) return;
				result.data.push({
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
			if (result.data.length) {
				result.dateRange = {
					start: result.data[0].date,
					end: result.data[result.data.length - 1].date
				};
			}
			return result;
		} catch (error) {
			db.Log.error(`TPEX 抓取 ${this.stockNo} 錯誤: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}

	async realtimeTw(allCodes, start = 0, result = []) {
		let codes = allCodes.slice(start, start + 100);
		if (codes.length === 0) {
			if (result.length) console.log(`[${new Date().toLocaleString()}] 成功抓取台灣即時股價資料`);
			return result.flat();
		}
		const stocks = await db.Stock.findAll();
		codes = codes.map(code => {
			const stock = stocks.find(s => s.code == code);
			if (!stock) throw new Error(`股票代碼 ${code} 不存在！`);
			return stock.otc ? `otc_${code}.tw` : `tse_${code}.tw`;
		}).join('|');
		try {
			const response = await axios.get(TWSE_REALTIME, {
				params: {
					ex_ch: codes,
					_: new Date().getTime()
				},
				headers: HEADERS,
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
                    day.diff = parseFloat((day.close - day.pre).scale(2));
                    day.diffRate = parseFloat((day.diff / day.pre).scale(2));
            });
			result.push(dailies);
			return await this.realtimeTw(allCodes, start + 100, result);
		} catch (error) {
			db.Log.error(`TWSE 抓取台灣即時股價資料失敗: ${error.message || '未知錯誤'}`);
			throw error;
		}
	}
}

async function randomDelay(min = 3000, max = 5000) {
	return new Promise(resolve =>
		setTimeout(resolve, Math.random() * (max - min) + min)
	);
}