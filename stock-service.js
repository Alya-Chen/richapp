import schedule from 'node-schedule';
import * as fs from 'fs';
import * as dateFns from 'date-fns';
import './static/js/lang.js';
import * as db from './stock-db.js';
import * as st from './trading-strategy.js';
import * as QueryTypes from 'sequelize';
import {
	Crawler
} from './stock-crawler.js';
import {
	TradingSystem
} from './trading-sys.js';
import {
	BullBear
} from './static/js/macd-kdj.js';
import { console } from 'inspector';

const SLEEP = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const TOTAL_CAPITAL = 508528; // 617281

class Service {
	constructor() {
		this.inited = false;
		this.totalCapital = 0;
	}

	static async create() {
		const instance = new Service();
		instance.inited = await db.initDb();
		if (!instance.inited) {
			console.error('初始化數據庫失敗！');
		}
		instance.users();
		return instance;
	}

	async execSql(sqls) {
		if (!Array.isArray(sqls)) {
			sqls = [sqls];
		}
		const results = [];
		const sequelize = db.User.sequelize;
		for (const sql of sqls) {
			try {
				const upperCaseSql = sql.trim().toUpperCase();
				let queryType;
				if (upperCaseSql.startsWith('SELECT')) {
					queryType = QueryTypes.SELECT;
				} else if (upperCaseSql.startsWith('INSERT')) {
					queryType = QueryTypes.INSERT;
				} else if (upperCaseSql.startsWith('UPDATE')) {
					queryType = QueryTypes.UPDATE;
				} else if (upperCaseSql.startsWith('DELETE')) {
					queryType = QueryTypes.DELETE;
				}
				const result = await sequelize.query(sql, { type: queryType });
				results.push(result);
			} catch (error) {
				db.Log.error(`Error executing SQL: ${sql}`, error);
				results.push({ error: error.message });
			}
		}
		return results.length === 1 ? results[0] : results;
	}

	async getTotalCapital() {
		if (this.totalCapital) return this.totalCapital;
		const trades = await this.trades({ userId: 1, shadow: false });
		if (!trades.length) return TOTAL_CAPITAL;
		const profit = trades.reduce((total, trade) => {
			return total + (trade.exitDate ? trade.profit : 0);
		}, 0);
		this.totalCapital = (TOTAL_CAPITAL + profit).scale(0);
		return this.totalCapital;
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
		const dailies = await Crawler.create().realtime(codes);
		const today = new Date();
		for (let i = 0; i < dailies.length; i++) {
			const daily = dailies[i];
			try {
				if (!daily.open || !daily.close) {
					if (daily.code) db.Log?.info?.(`${daily.code} 缺資料跳過：open=${!!daily.open} close=${!!daily.close} date=${daily.date?.toLocaleDateString?.() || daily.date}`);
					continue;
				}
				await db.StockDaily.save(daily);
			} catch (error) {
				db.Log.error(`${daily.code} 股票即時資料儲存失敗`, error);
			}
		}
		return dailies;
	}

	async sync(code, forced) {
		if (code) {
			const stock = await this.getStock(code);
			if (!stock) return;
			const last = forced ? null : await db.StockDaily.last(code);
			const result = await Crawler.create(stock).fetchAll(last ? new Date(last.date) : null);
			for (const daily of result) {
				daily.code = code;
				this.saveDaily(daily);
			}
			db.Log.info(`${stock.code} ${stock.name} 股票 ${result.length} 筆資料同步完成`);
			return;
		}
		const stocks = await this.stocks();
		for (let i = 0; i < stocks.length; i++) {
			const stock = stocks[i];
			const last = forced ? null : await db.StockDaily.last(stock.code);
			const result = await Crawler.create(stock).fetchAll(last ? new Date(last.date) : null);
			for (let i = 0; i < result.length; i++) {
				const daily = result[i];
				daily.code = stock.code;
				this.saveDaily(daily);
			}
		}
	}

	async syncWeekly(code, forced) {
		if (code) {
			const stock = await this.getStock(code);
			if (!stock) return;
			const last = forced ? null : await db.StockWeekly.last(code);
			const result = await Crawler.create(stock).fetchAll(last ? new Date(last.date) : null, null, '1wk');
			for (const weekly of result) {
				weekly.code = code;
				this.saveWeekly(weekly);
			}
			db.Log.info(`${stock.code} ${stock.name} 週線 ${result.length} 筆資料同步完成`);
			return;
		}
		const stocks = await this.stocks();
		for (const stock of stocks) {
			const last = forced ? null : await db.StockWeekly.last(stock.code);
			const result = await Crawler.create(stock).fetchAll(last ? new Date(last.date) : null, null, '1wk');
			for (const weekly of result) {
				weekly.code = stock.code;
				this.saveWeekly(weekly);
			}
		}
	}

	async realtimeJob() {
		const hour = new Date().getHours();
		// 台：09:00-14:00，美：21:30-05:00
		const country = (hour >= 9 && hour <= 14) ? 'tw' : 'us';
		try {
			const stocks = (await this.stocks()).filter(s => s.country == country);
			const codes = stocks.map(s => s.code);
			console.log(`[${new Date().toLocaleString()}] 啟動 ${country} 股票即時同步抓取任務`);
			await this.realtime(codes);
			await this.realtimeBacktest(codes);
			console.log(`[${new Date().toLocaleString()}] ${country} 股票即時同步任務執行完成`);
		} catch (error) {
			db.Log.error(`${country} 股票即時同步任務執行失敗`, error);
		}
	}

	async realtimeBacktest(codes) {
		// 正在模擬回測中，不執行即時回測
		if (this.simulating) return;
		this.realtimeBacktest.count = this.realtimeBacktest.count || 0;
		if (this.realtimeBacktest.count++ % 2) return;
		const users = await db.User.findAll();
		for (let i = 0; i < users.length; i++) {
			const user = users[i];
			const params = user.settings?.params;
			if (!params) continue;
			params.userId = user.id;
			params.realtime = true;
			console.log(`[${new Date().toLocaleString()}] 啟動 ${user.name} 股票回測任務`);
			await this.backtest(codes, params);
		}
	}

	scheduleSync() {
		const rule1 = new schedule.RecurrenceRule();
		rule1.dayOfWeek = [1, 2, 3, 4, 5]; // 周一到周五
		// 台：09:00-14:00，美：21:30-05:00
		rule1.hour = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 21, 22, 23];
		rule1.minute = new schedule.Range(0, 59, 3); // 每 3 分鐘
		rule1.tz = 'Asia/Taipei'; // 設置時區
		schedule.scheduleJob(rule1, this.realtimeJob.bind(this));

		// 配置交易日時間規則（以台灣股市為例）
		const rule2 = new schedule.RecurrenceRule();
		rule2.dayOfWeek = [1, 2, 3, 4, 5]; // 周一到周五
		rule2.hour = [5, 14]; // 收盤後執行（05:10 美股，14:10 台股）
		rule2.minute = 10;
		rule2.tz = 'Asia/Taipei'; // 設置時區
		// 初始化定時任務
		schedule.scheduleJob(rule2, async () => {
			try {
				console.log(`[${new Date().toLocaleString()}] 啟動股票資料同步抓取任務`);
				await this.sync();
				db.Log.info(`股票資料同步任務執行完成`);
			} catch (error) {
				db.Log.error(`股票資料同步任務執行失敗`, error);
			}
			const stocks = this.checkDailies();
			if (stocks.length) db.Log.error(`${stocks.join(",")} 無今日股價資料`);
			try {
				const users = await db.User.findAll();
				for (let i = 0; i < users.length; i++) {
					const user = users[i];
					const params = user?.settings?.params;
					if (!params) continue;
					params.userId = user.id;
					console.log(`[${new Date().toLocaleString()}] 啟動 ${user.name} 股票回測任務`);
					await this.backtest('all', params);
				}
				db.Log.info(`股票回測任務執行完成`);
			} catch (error) {
				db.Log.error(`股票回測任務執行失敗`, error);
			}
		});
	}

	async backtest(codes, params, simulating) {
		params.entryDate = params.entryDate || dateFns.addYears(new Date(), -1);  // 取前一年資料
		params.exitDate = params.exitDate || new Date();
		//params = Object.assign({}, sysUser.settings.params, params || {});
		params.entryStrategy = st[params.entryStrategy];
		params.exitStrategy = params.exitStrategy.map(strategy => st[strategy]).filter(Boolean);
		if (codes != 'all' && !Array.isArray(codes)) { // ma：從 params 設定取得
			params.code = codes; // 設 code 讓 ADX_CACHE 正確區分各股
			const startLookback = params.weekly ? -2 : -1;
			const startDate = dateFns.addYears(params.entryDate, startLookback);
			const data = params.weekly
				? await this.weeklies(codes, startDate)
				: await this.dailies(codes, startDate);
			if (!data.length) return {};

			// maSensitive 策略：透過 findBest 做 walk-forward MA 優化（僅回測模式）
			if (simulating) {
				const maSensitive = params.entryStrategy?.maSensitive || params.exitStrategy?.find(s => s?.maSensitive);
				if (maSensitive) {
					const stock = await this.getStock(codes);
					if (stock) return await this.findBest(stock, params, data, true);
				}
			}

			const stock = await this.getStock(codes);
			// 大盤濾網：載入 0050 週線 MA20 資料
			if (params.marketFilter) {
				const marketStart = dateFns.addYears(params.entryDate, -2);
				const marketRows = await this.weeklies('0050', marketStart);
				const closes = marketRows.map(r => r.close).filter(c => c != null);
				const period = params.marketMAPeriod || 20;
				params.marketData = marketRows.map((r, i) => {
					if (i < period - 1) return { date: r.date, close: r.close, ma20: null };
					const ma = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
					return { date: r.date, close: r.close, ma20: ma };
				});
			}
			const sys = new TradingSystem(data, params);
			const backtest = sys.backtest();
			backtest.code = codes;
			backtest.name = stock?.name || '';
			// 取回測截止日前的最後收盤價（用於未實現損益計算）
			const exitData = data.filter(d => new Date(d.date) <= params.exitDate);
			backtest.close = exitData.length > 0 ? exitData[exitData.length - 1].close : null;
			backtest.prices = exitData.map(d => ({ date: new Date(d.date), close: d.close }));
			// 加計持倉中未實現損益（與 weeklyAnalysis 一致）
			const openPnL = (backtest.trades || [])
				.filter(t => t.status === 'open')
				.reduce((sum, t) => sum + ((backtest.close || t.entryPrice) - t.entryPrice), 0);
			if (openPnL) backtest.profit = ((backtest.profit || 0) + openPnL).scale();
			const trade = backtest.trades[backtest.trades.length - 1];
			const last = sys.data.pop();
			const prev = sys.data.pop();
			backtest.alerts = null;
			if (last && prev) {
				const alerts = {
					code: codes,
					date: last.date,
					ma: last.ma?.scale(2),
					close: last.close
				};
				if (trade && !trade.exitDate) {
					if (prev.close > prev.ma && last.ma > last.close) backtest.alerts = alerts;
				}
				if (trade && trade.exitDate) {
					if (prev.ma > prev.close && last.close > last.ma) backtest.alerts = alerts;
				}
			}
			return backtest;
		}
		const result = [];
		const stocks = await this.stocks();
		// 大盤濾網：載入 0050 週線 MA20 資料（共用一次）
		if (params.marketFilter) {
			const marketStart = dateFns.addYears(params.entryDate, -2);
			const marketRows = await this.weeklies('0050', marketStart);
			const closes = marketRows.map(r => r.close).filter(c => c != null);
			const period = params.marketMAPeriod || 20;
			params.marketData = marketRows.map((r, i) => {
				if (i < period - 1) return { date: r.date, close: r.close, ma20: null };
				const ma = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
				return { date: r.date, close: r.close, ma20: ma };
			});
		}
		for (const stock of stocks) {
			if (Array.isArray(codes) && !codes.find(c => c == stock.code)) continue;
			try {
			const startDate = dateFns.addYears(params.entryDate, -2);
			const data = params.weekly
				? await this.weeklies(stock.code, startDate)
				: await this.dailies(stock.code, startDate);
			if (!data.length) {
				console.log(`${stock.code} ${stock.name} 缺歷史交易資料跳過`);
				continue;
			}
			const trade = stock.trades.find(t => t.entryDate && !t.exitDate);
			let best = null;
			if (trade || params.realtime) { // 平日或正在交易中，不改 MA
				params.code = stock.code;
				params.ma = trade?.ma || stock.defaultMa;
				best = new TradingSystem(data, params).backtest();
			}
			else {
				best = await this.findBest(stock, params, data, simulating);
				stock.defaultMa = best.ma;
			}
            const profitRate = (best.profitRate * 100).scale(0) + '%';
			best.code = stock.code;
			best.name = stock.name;
			// 取回測截止日前的最後收盤價（用於未實現損益計算）
			const exitData = data.filter(d => new Date(d.date) <= params.exitDate);
			best.close = exitData.length > 0 ? exitData[exitData.length - 1].close : null;
			best.prices = exitData.map(d => ({ date: new Date(d.date), close: d.close }));
			// 加計持倉中未實現損益
			const openPnL2 = (best.trades || [])
				.filter(t => t.status === 'open')
				.reduce((sum, t) => sum + ((best.close || t.entryPrice) - t.entryPrice), 0);
			if (openPnL2) best.profit = ((best.profit || 0) + openPnL2).scale();
			best.opened = best.trades.find(trade => trade.status != 'closed') !== undefined;
			//console.log(`[${new Date().toLocaleString()}] ${stock.code} ${stock.name} MA${best.ma} ${best.profit} ${profitRate} ${best.opened ? '開倉中' : ''}`);
			//console.log(best.trades);
			//const filePath = `${DATA_DIR}${code} ${stock.name} MA${best.ma} (${best.profit} ${profitRate}).csv`;
			//csv.writeFile(filePath, best.trades);
			if (!params.transient) {
				this.saveTest(stock, best);
				stock.financial = Object.assign(stock.financial || {}, new BullBear(data).calculate());
				this.saveStock(stock);
				//console.log(`${stock.code} ${JSON.stringify(stock.financial)}`);
			}
			result.push(best);
			await SLEEP(50);
			} catch (e) {
				console.error(`${stock.code} ${stock.name} 回測失敗跳過: ${e.message}`);
				db.Log.error(`${stock.code} ${stock.name} 回測失敗: ${e.message}`);
			}
		}
		return result;
		//console.log(`backtest ${new Date().getTime() - now}`);
	}

	async findBest(stock, params, dailies, simulating) {
		// 若是回測，用 entryDate 的前 N 年資料來找最佳 MA（週線 2 年、日線 1 年）
		const lookback = simulating ? (params.weekly ? -2 : -1) : 0;
		const entryDate = simulating ? dateFns.addYears(params.entryDate, lookback) : params.entryDate;
		const exitDate = simulating ? new Date(params.entryDate) : params.exitDate;
		if (params.usingTigerMa && stock.tigerMa) {
			const ma = new String(stock.tigerMa).split(',')[0].split('/')[0];
			if (ma) {
				params.code = stock.code;
				params.ma = ma;
				return new TradingSystem(dailies, params).backtest()
			}
		}
		// 若有進出場策略標注 maSensitive，則 MA 16-46 進行回測找出最佳 MA
		const maSensitive = params.entryStrategy.maSensitive || params.exitStrategy.find(strategy => strategy.maSensitive);
		const maxMa = maSensitive ? 30 : 0;
		const paramsForBestMa = Object.assign({}, params, { entryDate, exitDate });
		const results = [];
		[...Array(maxMa).keys()].map(i => i + 16).forEach(ma => {
			paramsForBestMa.ma = ma;
			paramsForBestMa.code = stock.code;
			results.push(new TradingSystem(dailies, paramsForBestMa).backtest());
		});
		const best = results.sort((a, b) =>
			b.profit - a.profit
		)[0];
		params.code = stock.code;
		params.ma = best?.ma || params.ma || 20; // 沒有找到最佳 MA，則保留用戶設定的 MA
		return simulating ? new TradingSystem(dailies, params).backtest() : best;
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

	async getUser(id) {
		const user = await db.User.findOne({
			where: {
				id
			}
		});
		return user ? user.toJSON() : {};
	}

	async getUserByName(name) {
		const user = await db.User.findOne({
			where: {
				name
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
		const where = {
			code: stock.code,
			shadow: false
		};
		return stock ? Object.assign(stock.toJSON(), { trades: await db.Stock.trades(where) }) : {};
	}

	async findStock(code) {
		return await Crawler.create({ code }).fetchMeta();
	}

	async saveStock(stock) {
		return await db.Stock.save(stock);
	}

	async saveTrade(trade) {
		return await db.StockTrade.save(trade);
	}

	async deleteTrade(id) {
		return await db.StockTrade.del(id);
	}

	async getTradeById(id) {
		const trade = await db.StockTrade.findOne({ where: { id } });
		return trade ? trade.toJSON() : null;
	}

	async stocks() {
		const stocks = (await db.Stock.findAll({
			order: ['otc', 'code']
		})).map(s => s.toJSON());
		for (let i = 0; i < stocks.length; i++) {
			const stock = stocks[i];
			const where = {
				code: stock.code,
				shadow: false
			};
			stock.trades = await db.Stock.trades(where);
		}
		return stocks;
	}

	async addStock(code, name) {
		const exist = await db.Stock.findByCode(code);
		if (exist) {
			exist.name = name;
			return db.Stock.save(exist);
		}
		const stocks = JSON.parse(fs.readFileSync('static/stocks.json', 'utf8'));
		const stock = stocks.find(s => s.Code == code) || { otc: true, Code: code, Name: name };
		stock.country = code.match(/^\d/) ? 'tw' : 'us';
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

	async saveAssistantMessage(msg) {
		return await db.AssistantMessage.save(msg);
	}

	async assistantThread(userId, sessionId) {
		return await db.AssistantMessage.findBySession(userId, sessionId);
	}

	async assistantSessions(userId) {
		return await db.AssistantMessage.listSessions(userId);
	}

	async logs(limit) {
		const logs = await db.Log.last(limit);
		return logs;
	}

	async trades(where) {
		return await db.Stock.trades(where);
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
		['code', 'transient', 'realtime', 'entryDate', 'exitDate'].forEach(key => delete params[key]);
		const backtest = {
			code: stock.code,
			userId: params.userId,
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
		try {
			const loaded = await this.findTests({
				userId: params.userId,
				code: stock.code
			});
			if (loaded.length) {
				backtest.id = loaded[0].id;
			}
			return await db.Backtest.save(backtest);
		} catch (error) {
			db.Log.error(`${stock.code} ${stock.name} 測試結果保存到數據庫失敗`, error);
			return null;
		}
	}

	async saveDaily(daily) {
		return await db.StockDaily.save(daily);
	}

	async saveWeekly(weekly) {
		return await db.StockWeekly.save(weekly);
	}

	async countDaily(code) {
		return await db.StockDaily.count({
			where: {
				code
			}
		});
	}

	async countWeekly(code) {
		return await db.StockWeekly.count({
			where: { code }
		});
	}

	async dailies(code, startDate) {
		startDate = startDate || dateFns.addYears(new Date(), -2); // 取前兩年前資料
		let result = await db.StockDaily.query(code, startDate, new Date());
		if (!result.length) {
			const stock = await this.getStock(code);
			result = await Crawler.create(stock).fetchAll();
			await db.StockDaily.saveAll(code, result);
			result = await db.StockDaily.query(code, startDate, new Date());
		}
		return result.map(s => s.toJSON()).map(s => ({
			...s,
			date: new Date(s.date)
		}));
	}

	async weeklies(code, startDate) {
		startDate = startDate || dateFns.addYears(new Date(), -2);
		let result = await db.StockWeekly.query(code, startDate, new Date());
		if (!result.length) {
			const stock = await this.getStock(code);
			result = await Crawler.create(stock).fetchAll(null, null, '1wk');
			await db.StockWeekly.saveAll(code, result);
			result = await db.StockWeekly.query(code, startDate, new Date());
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

	async getDaily(code, date) {
		const startDate = dateFns.addYears(date, -7);
		const result = await db.StockDaily.query(code, startDate, date);
		return result.length ? result.pop().toJSON() : null;
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
		return await Crawler.create(stock).fetchDividendData();
	}
}

const stockService = await Service.create();

export {
	stockService
};