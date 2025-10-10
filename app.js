import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
	stockService
} from './stock-service.js';
import {
	Investor
} from './stock-investor.js';
import * as st from './trading-strategy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

stockService.scheduleSync(__filename.includes('投資'));

const app = express();
const port = 5001;

app.set('trust proxy', 1) // trust first proxy
app.use(session({
	name: 'richapp',
	secret: 'cmljaGFwcA==',
	resave: true,
	saveUninitialized: false,
	cookie: { secure: false }
}));

app.use(express.static('static'))
app.use(express.json());

const getUser = async (req) => {
	return await stockService.getUser(req.session.userId || 1);
};

app.get('/', (req, res) => {
	res.redirect('/index.html');
})

app.get('/users{/:userId}', async (req, res) => {
	const users = await stockService.users();
	const userId = parseInt(req.params.userId || req.session.userId || 1);
	req.session.userId = userId;
	const user = users.find(u => u.id == userId);
  	res.json({ users, user });
});

app.get('/stocks', async (req, res) => {
	const stocks = await stockService.stocks();
  	res.json(stocks);
});

app.get('/logs', async (req, res) => {
	const logs = await stockService.logs(req.params.limit || 20);
  	res.json(logs);
});

app.get('/trades', async (req, res) => {
	const trades = await stockService.trades();
  	res.json(trades);
});

app.get('/dividends', async (req, res) => {
	const trades = await stockService.trades();
  	res.json(trades.filter(t => t.payDate));
});

app.get('/stock/:code{/:ma}', async (req, res) => {
	if (req.headers.accept.includes('application/json')) {
		const stock = await stockService.getStock(req.params.code);
		stock.defaultMa = req.params.ma || stock.defaultMa;
		return res.json(stock);
	}
	res.sendFile('static/index.html', { root: __dirname });
});

app.post('/stock/:code/financial', async (req, res) => {
	let stock = await stockService.getStock(req.params.code);
	stock.financial = Object.assign(stock.financial || {}, req.body);
	stock = await stockService.saveStock(stock);
	res.json(stock);
});

app.post('/stock/:code/trade', async (req, res) => {
	const stock = await stockService.getStock(req.params.code);
	stock.trades = stock.trades || [];
	const trade = stock.trades.find(t => t.id == req.body.id) || req.body;
	if (trade.id) {
		Object.assign(trade, req.body);
		trade.invest = null;
		if (!trade.logs.length) { // 刪除
			stock.trades = stock.trades.filter(t => t.id != trade.id);
		}
		else {
			trade.logs = trade.logs.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
			const total = trade.logs.reduce((sum, l) => sum + (l.act == '買入' ? l.amount : -l.amount), 0);
			if (!total) {
				trade.exitDate = trade.logs[trade.logs.length - 1].date;
			}			
		}
	}
	else {
		trade.id = new Date().getTime();
		trade.ma = stock.defaultMa;
		trade.entryDate = trade.logs[0].date;
		stock.trades.push(trade);
	}
	await stockService.saveStock(stock);
	res.json(trade);
});

app.post('/stock/:code/dividend', async (req, res) => {
	const stock = await stockService.getStock(req.params.code);
	stock.trades = stock.trades || [];
	const trade = stock.trades.find(t => t.id == req.body.id) || req.body;
	if (trade.id) {
		if (trade.amount) {
			Object.assign(trade, req.body);			
		}
		else { // 刪除
			stock.trades = stock.trades.filter(t => t.id != trade.id);
		}
	}
	else {
		trade.id = new Date().getTime();
		trade.type = 'dividend';
		stock.trades.push(trade);
	}
	await stockService.saveStock(stock);
	res.json(trade);
});

app.get('/stock/add/:code/:name', async (req, res) => {
	const stock = await stockService.addStock(req.params.code, req.params.name);
	res.json(stock);
});

app.get('/notes/:owner', async (req, res) => {
	const notes = await stockService.notes(req.params.owner);
  	res.json(notes);
});

app.post('/note', async (req, res) => {
	const note = await stockService.saveNote(req.body);
	res.json(note);
});

app.delete('/note/:id', async (req, res) => {
	const count = await stockService.delNote(req.params.id);
  	res.json(count);
});

app.get('/realtime{/:codes}', async (req, res) => {
	if ('all' == req.params.codes) return res.json(await stockService.lastDailies());
  	res.json(await stockService.realtime(req.params.codes.split('|')));
});

app.get('/star/:code', async (req, res) => {
	const user = await getUser(req);
	const code = req.params.code;
	const settings = user.settings || { stared: [] };
	if (settings.stared.find(s => s == code)) {
		settings.stared = settings.stared.filter(s => s != code);
	}
	else {
		settings.stared.push(code);
	}
	user.settings = settings;
	await stockService.saveUser(user);
  	res.json(user);
});

app.get('/backtest/opened', async (req, res) => {
	const tests = await stockService.findTests({ opened: true, userId: req.session.userId });
  	res.json(tests);
});

app.get('/backtest/:code{/:ma}', async (req, res) => {
	if ('all' == req.params.code) {
		const users = await stockService.users();
		for (let i = 0; i < users.length; i++) {
			const user = users[i];
			const params = user.settings?.params;
			if (!params) continue;
			params.userId = user.id;
			console.log(`[${new Date().toLocaleString()}] 啟動 ${user.name} 股票回測任務`);				
			await stockService.backtest('all', params);
		}	
		return res.json({ success: true });
	}
	const user = await getUser(req);
	const params = Object.assign({ userId: req.session.userId }, req.params);
	let result = await stockService.findTests(params, ['id', 'DESC']);
	result = result.map(t => t.toJSON());
	if (params.ma) {
		result = result.find(t => t.ma == params.ma);
		if (!result && user.settings.params) {
			Object.assign(params, user.settings.params);
			result = await stockService.backtest(params.code, params);
		}
		res.json(result ? result : {});
	}
	else {
		res.json(result.length ? result.reduce((t1, t2) => t1.profit > t2.profit ? t1 : t2) : {});		
	}
});

app.get('/simulate{/:codes}', async (req, res) => {
	const codes = req.params.codes;
	if (codes == 'strategies') {
		const strategies = { entryStrategies: [], exitStrategies: [] };
		Object.keys(st).forEach(key => {
			const strategy = new st[key]([], {});
			if (strategy.checkEntry && strategy.enabled) strategies.entryStrategies.push({ key, name: strategy.name });
			if (strategy.checkExit && strategy.enabled) strategies.exitStrategies.push({ key, name: strategy.name });
		});
		return res.json(strategies);
	}
	res.sendFile('static/index.html', { root: __dirname });
});

app.post('/simulate', async (req, res) => {
	const codes = req.body.codes;
	const money = req.body.money;
	const params = req.body.params;
	params.entryDate = new Date(params.entryDate);
	params.exitDate = new Date(params.exitDate);
	const result = await new Investor(codes, money, params).invest();
  	res.json(result);
});

app.get('/dailies/check', async (req, res) => {
  	res.json(await stockService.checkDailies());
});

app.get('/dailies/:code', async (req, res) => {
	const dailies = req.params.code ? await stockService.dailies(req.params.code) : [];
  	res.json(dailies);
});

app.get('/sync/:code{/:forced}', async (req, res) => {
	const code = req.params.code;
	if (code != 'all') {
		await stockService.sync(code, req.params.forced);
		const stock = await stockService.getStock(code);
		const result = await stockService.backtest(code, { ma: stock.defaultMa });
		res.json(result);
	}
	else {
		await stockService.sync();
		await stockService.backtest('all');
		res.json(true);
	}
});

app.get('/sys/params', async (req, res) => {
	const user = await getUser(req);
	res.json(user.settings.params || {});
});

app.post('/sys/params', async (req, res) => {
	const user = await getUser(req);
	delete req.body.entryDate;
	delete req.body.exitDate;
	delete req.body.codes;
	user.settings.params = req.body;
	await stockService.saveUser(user);
	res.json({ success: true });
});

app.listen(port, () => {
	console.log(`WebServer is listening at http://localhost:${port}`)
})