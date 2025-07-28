import crypto from 'crypto';
import schedule from 'node-schedule';
import * as fs from 'fs';
import * as dateFns from 'date-fns';
import './static/js/lang.js';
import * as db from './stock-db.js';
import * as st from './trading-strategy.js';
import {
	Crawler
} from './stock-crawler.js';
import {
	TradingSystem
} from './trading-sys.js';
import {
	BullBear
} from './static/js/macd-kdj.js';

const STOCK_DIR = 'data/stock/';

class Service {
	constructor() {
		this.inited = false;
	}

	static async create() {
		const instance = new Service();
		instance.inited = await db.initDb();
		if (!instance.inited) {
			console.error('初始化數據庫失敗！');
		}
		return instance;
	}

	async stocks() {
		const stocks = await db.Stock.findAll({
			order: ['otc', 'code']
		});
		return stocks.map(s => s.toJSON());
	}

	async users() {
		const users = await db.User.findAll();
		if (!users.length) {
			await db.User.create({
				name: '🤖 Winnie'
			});
			await db.User.create({
				name: '🎃 Tin'
			});
		}
		return users.map(u => u.toJSON());
	}
	
	async realtime(codes) {
		const dailies = await new Crawler().realtime(codes);
		const today = new Date();
		for (let i = 0; i < dailies.length; i++) {
			const daily = dailies[i];
			try {
				if (!daily.open) continue; //!today.isSameDay(daily.date) || 
				await db.StockDaily.save(daily);
			} catch (error) {
				db.Log.error(`${daily.code} 股票即時資料儲存失敗 ${error}`);
			}
		}
		return dailies;
	}

	async sync(code, forced) {
		const stocks = await this.stocks();
		for (let i = 0; i < stocks.length; i++) {
			const stock = stocks[i];
			//if (!stock.otc) continue;
			//if (stock.id < 264) continue;
			if (code && stock.code != code) continue;
			const last = { date: new Date('2025-06-20') };//forced ? null : await db.StockDaily.last(stock.code);
			const result = await new Crawler(stock).fetchAll(last ? new Date(last.date) : null);
			for (let i = 0; i < result.length; i++) {
				const daily = result[i];
				daily.code = stock.code;
				this.saveDaily(daily);
			}
			if (code) db.Log.info(`${stock.code} ${stock.name} 股票 ${result.length} 筆資料同步完成`);
		}
	}

	async realtimeJob() {
		const hour = new Date().getHours();
		// 台：09:00-14:00，美：16:00-08:00
		const country = (hour >= 9 && hour <= 14) ? 'tw' : 'us';
		try {
			const stocks = (await this.stocks()).filter(s => s.country == country);
			const codes = stocks.map(s => s.code);
			console.log(`[${new Date().toLocaleString()}] 啟動股票即時同步抓取任務`);
			await this.realtime(codes);
			for (let i = 0; i < stocks.length; i++) {
				const stock = stocks[i];
				const params = { code: stock.code, ma: stock.defaultMa }
				const test = await this.backtest(stock.code, params);
				this.saveTest(stock, test);
			}
			//await this.backtest('all');
			console.log(`[${new Date().toLocaleString()}] 股票即時同步任務執行完成`);
		} catch (error) {
			db.Log.error(`股票即時同步任務執行失敗 ${error}`);
		}
	}
	
	scheduleSync(isDev) {
		const rule1 = new schedule.RecurrenceRule();
		rule1.dayOfWeek = [1, 2, 3, 4, 5]; // 周一到周五
		rule1.hour = new schedule.Range(0, 23); // 每小時執行
		rule1.minute = new schedule.Range(0, 59, 3); // 每 5 分鐘
		rule1.tz = 'Asia/Taipei'; // 設置時區
		schedule.scheduleJob(rule1, this.realtimeJob.bind(this));
		if (isDev) return;
		
		// 配置交易日時間規則（以台灣股市為例）
		const rule2 = new schedule.RecurrenceRule();
		rule2.dayOfWeek = [1, 2, 3, 4, 5]; // 周一到周五
		rule2.hour = 14; // 收盤後執行（14:10）
		rule2.minute = 10;
		rule2.tz = 'Asia/Taipei'; // 設置時區
		// 初始化定時任務
		schedule.scheduleJob(rule2, async () => {
			try {
				console.log(`[${new Date().toLocaleString()}] 啟動股票資料同步抓取任務`);
				await this.sync();
				db.Log.info(`股票資料同步任務執行完成`);
			} catch (error) {
				db.Log.error(`股票資料同步任務執行失敗 ${error}`);
			}
			const stocks = this.checkDailies();
			if (stocks.length) db.Log.error(`${stocks.join(",")} 無今日股價資料`);
			try {
				console.log(`[${new Date().toLocaleString()}] 啟動股票回測任務`);
				await this.backtest('all');
				db.Log.info(`股票回測任務執行完成`);
			} catch (error) {
				db.Log.error(`股票回測任務執行失敗 ${error}`);
			}
		});		
	}

	async backtest(code, params) {
		//const now = new Date().getTime();
		params = Object.assign({
			entryDate: dateFns.addYears(dateFns.addMonths(new Date(), -6), -1),  // 取前一年半資料 new Date('2024/01/01')
			exitDate: new Date(),
			threshold: 0.005, // MA 需增量 0.5%
			volumeRate: 1.2, // 交易需增量倍數
			breakout: true, // 入場需符合二日法則
			reentry: true, // 過熱出場後是否要重複入場
			entryStrategy: st.BullTigerEntry,
			exitStrategy: [st.RsiTigerExit],
			//stopLossPct: 0.03, // 止損小於入場價格的 3%
			//takeProfitPct: 0.1, // 固定止盈大於入場價格的 10%
			//dynamicStopPct: 0.05, // 動態止損小於曾經最高價格的 5%
			//maxHoldPeriod: 30 // 最大持倉周期 30 天
		}, params || {});
		if (code != 'all' && !Array.isArray(code)) { // ma：從 params 設定取得
			const startDate = dateFns.addYears(params.entryDate, -1);
			const dailies = await this.dailies(code, startDate);
			if (!dailies.length) return {};
			const sys = new TradingSystem(dailies, params);
			const backtest = sys.backtest();
			const trade = backtest.trades[backtest.trades.length - 1];
			const last = sys.data.pop();
			const prev = sys.data.pop();
			backtest.alerts = null;
			const alerts = {
				code,
				date: last.date,
                                ma: last.ma.scale(2),
				close: last.close
			};
			if (!trade.exitDate) { // 開倉中
				if (prev.close > prev.ma && last.ma > last.close) backtest.alerts = alerts;
			}
			else {
				if (prev.ma > prev.close && last.close > last.ma) backtest.alerts = alerts;
			}
			return backtest;
		}
		const result = [];
		const stocks = await this.stocks();
		for (const stock of stocks) {
			if (Array.isArray(code) && !code.find(c => c == stock.code)) continue;
			const count = await this.countDaily(stock.code);
			if (!count) {
				console.log(`${stock.code} ${stock.name} 缺歷史交易資料跳過`);
				continue;
			}
			const startDate = dateFns.addYears(params.entryDate, -1);
			const dailies = await this.dailies(stock.code, startDate);
			const trade = (stock.trades || []).find(t => t.entryDate && !t.exitDate);
			let best = null;
			if (trade) { // 正在交易中，不作全部回測，不改 MA
				params.code = stock.code;
				params.ma = trade.ma;
				best = new TradingSystem(dailies, params).backtest();
			}
			else {
				const results = [];
				[...Array(30).keys()].map(i => i + 16).forEach(ma => {
					params.ma = ma;
					params.code = stock.code;
					results.push(new TradingSystem(dailies, params).backtest());
				});
				best = results.sort((a, b) =>
					b.profit - a.profit
				)[0];
				stock.defaultMa = best.ma;				
			}
                        const profitRate = (best.profitRate * 100).scale(0) + '%';
			best.code = stock.code;
			best.name = stock.name;
			best.opened = best.trades.find(trade => trade.status != 'closed') !== undefined;
			console.log(`[${new Date().toLocaleString()}] ${stock.code} ${stock.name} MA${best.ma} ${best.profit} ${profitRate} ${best.opened ? '開倉中' : ''}`);
			//console.log(best.trades);
			//const filePath = `${DATA_DIR}${code} ${stock.name} MA${best.ma} (${best.profit} ${profitRate}).csv`;
			//csv.writeFile(filePath, best.trades);
			if (!params.transient) {
				this.saveTest(stock, best);
				stock.financial = Object.assign(stock.financial || {}, new BullBear(dailies).calculate());
				this.saveStock(stock);
				//console.log(`${stock.code} ${JSON.stringify(stock.financial)}`);				
			}
			result.push(best);
		}
		return result;
		//console.log(`backtest ${new Date().getTime() - now}`);
	}

	async exportCsv(tests) {
		const results = [];
		results.push(`"代號","公司","MA","總獲利率","總獲利金額","總勝率","返場獲利率","返場獲利金額","返場勝率","返場交易數","盈虧比","期望值","總交易數"`);
		for (let i = 0; i < tests.length; i++) {
			if (!tests[i].trades.length) continue;
			const test = tests[i];
			test.result = test.result || {};
			const stock = await this.getStock(test.code);
			//console.log(test);
                        const profitRate = (test.profitRate).scale(2);
                        const winRate = (test.winRate || test.result.winRate || 0).scale(2);
                        const pnl = (test.pnl || test.result.pnl || 0).scale(2);
                        const expectation = (test.expectation || test.result.expectation || 0).scale(2);
                        const reentryWinRate = (test.reentryWinRate || test.result.reentryWinRate || 0).scale(2);
                        const reentryProfit = (test.reentryProfit || test.result.reentryProfit || 0).scale(2);
                        const reentryProfitRate = (reentryProfit / test.profit).scale(2);
			const reentry = test.reentry || test.result.reentry || 0;
			const otc = stock.otc ? '[櫃]' : '';
			test.trades = test.trades || test.result.trades;
			results.push(`"${stock.code}","${stock.name + otc}",${test.ma},${profitRate},${test.profit},${winRate},${reentryProfitRate},${reentryProfit},${reentryWinRate},${reentry},${pnl},${expectation},${test.trades.length}`);
		};
		return results.join('\r\n');	
	}
	
	invest(tests, money, entryDate, exitDate) {
	    tests = Array.from(
	        tests.reduce((map, test) => {
	            const existing = map.get(test.code);
	            if (!existing || new Date(test.endDate) > new Date(existing.endDate)) {
	                map.set(test.code, test);
	            }
	            return map;
	        }, new Map()).values()
	    );
		money = money || (200 * 10000)
	    entryDate = entryDate || new Date(new Date().getFullYear() + '/01/01');
	    exitDate = exitDate || new Date();
	    const trades = [];
	    const invest = {
	        money: money,
	        profit: 0
	    };
	    const csv = [];
	    csv.push(`"代號","公司","購入日期","購入價格","剩餘本金","賣出日期","賣出價格","單筆收益","累積收益","期末本金","出場原因"`);
	    while (true) {
	        if (entryDate.isSameDay(exitDate)) break;
	        for (let i = 0; i < tests.length; i++) {
	            const test = tests[i];
				test.trades = test.trades || test.result.trades;
	            let trade = test.trades.find(t => t.status == 'closed' && exitDate.isAfter(t.exitDate) && entryDate.isSameDay(t.entryDate));
	            if (trade) {
	                const price = 1000 * trade.entryPrice;
	                if (invest.money > price) {
	                    invest.money -= price;
	                    //console.log(`買 ${test.code} ${test.name} ${trade.entryDate} ${trade.entryPrice} ${invest.money}`);
	                    trades.push({
	                        code: test.code,
	                        name: test.name,
	                        ma: test.ma,
							entryRemain: invest.money,
	                        ...trade
	                    });
	                }
	            }
	            trade = trades.find(t => t.code == test.code && t.status == 'closed' && entryDate.isSameDay(t.exitDate));
	            if (trade) {
	                const price = 1000 * trade.exitPrice;
	                invest.money += price;
	                trade.profit = (1000 * trade.profit).scale();
	                invest.profit += trade.profit;
	                trades.find(t => t.code == trade.code).status = 'done';
					const reason = trade.exitReason + (trade.reentry ? '（返場）' : '');
	                csv.push(`"${trade.code}","${trade.name}（${trade.ma}）","${trade.entryDate}",${trade.entryPrice.scale()},${trade.entryRemain.scale()},"${trade.exitDate}",${trade.exitPrice.scale()},${trade.profit.scale()},${invest.profit.scale()},${invest.money.scale()},"${reason}"`);
	            }
	        };
	        entryDate.addDays(1);
	    }
	    return {
	        csv: csv.join('\r\n'),
	        money: invest.money.scale(),
	        profit: invest.profit.scale(),
	        trades
	    };	
	}
	
	async getUser(id) {
		const user = await db.User.findOne({
			where: {
				id
			}
		});
		return user ? user.toJSON() : {};
	}

	async saveUser(user) {
		return await db.User.save(user);
	}

	async getStock(code) {
		const stock = await db.Stock.findOne({
			where: {
				code
			}
		});
		return stock ? stock.toJSON() : {};
	}

	async findStock(code) {
		return await new Crawler({ code }).fetchMeta();
	}
	
	async saveStock(stock) {
		return await db.Stock.save(stock);
	}

	async stocks() {
		const stocks = await db.Stock.findAll({
			order: ['otc', 'code']
		});
		return stocks.map(s => s.toJSON());
	}

	async addStock(code, name) {
		const exist = await db.Stock.findByCode(code);
		if (exist) {
			exist.name = name;
			return db.Stock.save(exist);
		}
		const stocks = JSON.parse(fs.readFileSync(STOCK_DIR + '/stocks.json', 'utf8'));
		const stock = stocks.find(s => s.Code == code) || { otc: true, Code: code, Name: name };
		stock.country = Number.isInteger(code.charAt(0)) ? 'tw' : 'us';
		return await db.Stock.save({
			code: stock.Code,
			name: stock.Name,
			country: stock.country,
			otc: stock.otc == true && stock.country != 'us'
		});
	}
	
	async notes(owner) {
		const notes = await db.Note.findByOwner(owner);
		return notes;
	}

	async saveNote(note) {
		return await db.Note.save(note);
	}

	async delNote(id) {
		return await db.Note.del(id);
	}
	
	async logs(limit) {
		const logs = await db.Log.last(limit);
		return logs;
	}
	
	async trades() {
		const trades = await db.Stock.findTrades();
		return trades;
	}
	
	async findTests(where, orderBy) {
		const params = {
			order: orderBy ? [orderBy] : ['code']
		};
		if (where) {
			params.where = where;
		}
		const result = await db.Backtest.findAll(params);
		return result.length ? result : [];
	}

	async saveTest(stock, result) {
		const params = Object.assign({}, result.params);
		delete params.code;
		delete params.transient;
		delete params.entryDate;
		delete params.exitDate;
		const backtest = {
			code: stock.code,
			name: stock.name,
			ma: result.ma,
			opened: result.opened,
			params: params,
			startDate: result.startDate,
			endDate: result.endDate,
			profit: result.profit,
			profitRate: result.profitRate,
			lastModified: new Date(),
			result
		};		
		backtest.paramsMD5 = crypto.createHash('md5').update(JSON.stringify(backtest.params)).digest('hex');
		try {
			let loaded = await this.findTests({
				code: stock.code
			});
			loaded = loaded.find(t => t.ma == backtest.ma && t.paramsMD5 == backtest.paramsMD5);
			if (loaded) {
				loaded.set(backtest);
				return await loaded.save();
			} else {
				return await db.Backtest.create(backtest);
			}
		} catch (error) {
			db.Log.error(`${stock.code} ${stock.name} 測試結果保存到數據庫失敗: ${error.message}`);
			return null;
		}
	}
	
	async saveDaily(daily) {
		return await db.StockDaily.save(daily);
	}
	
	async countDaily(code) {
		return await db.StockDaily.count({
			where: {
				code
			}
		});
	}
	
	async dailies(code, startDate) {
		startDate = startDate || dateFns.addYears(dateFns.addMonths(new Date(), -6), -3); // 取前兩年半資料
		let result = await db.StockDaily.query(code, startDate, new Date());
		if (!result.length) {
			const stock = await this.getStock(code);
			result = await new Crawler(stock).fetchAll();
			await db.StockDaily.saveAll(code, result);
			result = await db.StockDaily.query(code, startDate, new Date());
		}
		return result.map(s => s.toJSON()).map(s => ({
			...s,
			date: new Date(s.date)
		}));
	}

	async lastDailies() {
		const result = await db.StockDaily.last();
		return result.map(s => s.toJSON());
	}
	
	async checkDailies() {
		const stocks = await this.stocks();
		let lastDate = '1980-01-01';
		let result = [];
		for (let i = 0; i < stocks.length; i++) {
			const stock = stocks[i];
			const daily = await db.StockDaily.last(stock.code);
			if (!daily) continue;
			result.push(daily);
			lastDate = (lastDate > daily.date) ? lastDate : daily.date;
		}
		result = result.filter(daily => lastDate > daily.date).map(daily => {
			return stocks.find(s => s.code == daily.code).name;
		});
		return result;
	}
	
	async saveTrade(trade) {
		return await db.StockTrade.save(trade);
	}
	
	async fetchDividendData(stock) {
		return await new Crawler(stock).fetchDividendData();
	}	
}

const stockService = await Service.create();

export {
	stockService
};