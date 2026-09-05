import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { writeFileSync } from 'fs';
import {
	stockService
} from './stock-service.js';
import {
	Investor,
	WeeklyInvestor
} from './stock-investor.js';
import * as st from './trading-strategy.js';
import crypto from 'crypto';
import { createAgentSession, ModelRegistry, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { createTools } from './ai-tools.js';

process.env.TZ = 'Asia/Taipei';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pidFile = path.join(__dirname, 'app.pid');
writeFileSync(pidFile, process.pid.toString());

// 開發環境不啟動同步任務
if (!existsSync(path.join(__dirname, 'dev'))) {
	stockService.scheduleSync();
}

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
});

app.post('/sql', async (req, res) => {
	const result = await stockService.execSql(req.body.commands);
	res.json(result);
});

app.get('/users{/:userId}', async (req, res) => {
	const users = await stockService.users();
	const userId = parseInt(req.params.userId || req.session.userId || 1);
	req.session.userId = userId;
	const user = users.find(u => u.id == userId);
	const totalCapital = await stockService.getTotalCapital();
  	res.json({ users, user, totalCapital });
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
	const user = await getUser(req);
	const where = Object.assign({}, { userId: user.id }, req.query);
	where.shadow = where.shadow === 'true';
	const trades = await stockService.trades(where);
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
	const trade = req.body;
	trade.userId = 1;
	if (trade.destroy) {
		await stockService.deleteTrade(trade.id);
	}
	else {
		await stockService.saveTrade(trade);
	}
	const stock = await stockService.getStock(req.params.code);
	res.json(stock.trades.find(t => t.entryDate && !t.exitDate));
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
	const user = await getUser(req);
	const tests = await stockService.findTests({ opened: true, userId: user.id });
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
	const params = Object.assign({ userId: user.id }, req.params);
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
			const strategy = st[key];
			if (typeof strategy !== 'function' || !strategy?.prototype) return;
			if (strategy.prototype.hasOwnProperty('checkEntry') && strategy.enabled) strategies.entryStrategies.push({ key, name: strategy.name });
			if (strategy.prototype.hasOwnProperty('checkExit') && strategy.enabled) strategies.exitStrategies.push({ key, name: strategy.name });
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
	try {
		stockService.simulating = true;
		const isWeekly = params.weekly || /^Weekly/i.test(params.entryStrategy);
		const InvestorClass = isWeekly ? WeeklyInvestor : Investor;
		const result = await new InvestorClass(codes, money, params).invest();
  		res.json(result);
	}
	finally {
			stockService.simulating = false;
	}
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
	const user = await getUser(req);
	if (code != 'all') {
		await stockService.sync(code, req.params.forced);
		const stock = await stockService.getStock(code);
		const params = user.settings?.params;
		params.userId = user.id;
		params.ma = stock.defaultMa;
		const result = await stockService.backtest(code, params);
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

// AI 助手：sessionId -> { session: AgentSession, userId, lastMessageId }
// 純記憶體、跟著 server process 生命週期，重啟會遺失（AssistantMessage 表仍保留歷史紀錄可供查閱）
// 詳見 README「AI 助手整合」章節
const aiSessions = new Map();

app.post('/ai/chat', async (req, res) => {
	const user = await getUser(req);
	const providers = user.settings?.aiProviders;
	if (!providers?.active || !providers.providers?.[providers.active]?.apiKey) {
		return res.status(400).json({ error: '尚未設定 AI provider／API 金鑰，請先至設定頁面設定' });
	}
	const message = req.body.message;
	if (!message) {
		return res.status(400).json({ error: 'message 為必填' });
	}

	let sessionId = req.body.sessionId;
	let entry = sessionId ? aiSessions.get(sessionId) : null;
	if (entry && entry.userId !== user.id) entry = null; // 防止用猜測/偷來的 sessionId 接到別人的對話

	if (!entry) {
		const active = providers.active;
		const conf = providers.providers[active];
		const runtime = await ModelRuntime.create();
		await runtime.setRuntimeApiKey(active, conf.apiKey);
		const modelRegistry = new ModelRegistry(runtime);
		const model = modelRegistry.find(active, conf.defaultModel);
		if (!model) {
			return res.status(400).json({ error: `找不到模型 ${active}/${conf.defaultModel}` });
		}
		const { session } = await createAgentSession({
			model,
			modelRuntime: runtime,
			sessionManager: SessionManager.inMemory(),
			noTools: 'builtin',
			customTools: createTools(user.id)
		});
		sessionId = crypto.randomUUID();
		entry = { session, userId: user.id, lastMessageId: null };
		aiSessions.set(sessionId, entry);
	}

	res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	const write = (obj) => res.write(JSON.stringify(obj) + '\n');

	const userMsg = await stockService.saveAssistantMessage({
		userId: user.id, sessionId, parentId: entry.lastMessageId, role: 'user', content: message
	});
	entry.lastMessageId = userMsg.id;

	let fullText = '';
	const unsubscribe = entry.session.subscribe((event) => {
		if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
			fullText += event.assistantMessageEvent.delta;
			write({ type: 'text_delta', delta: event.assistantMessageEvent.delta });
		} else if (event.type === 'tool_execution_start') {
			write({ type: 'tool_call', toolName: event.toolName, args: event.args });
		} else if (event.type === 'tool_execution_end') {
			write({ type: 'tool_result', toolName: event.toolName, isError: event.isError });
		}
	});

	try {
		await entry.session.prompt(message);
		const assistantMsg = await stockService.saveAssistantMessage({
			userId: user.id, sessionId, parentId: entry.lastMessageId, role: 'assistant', content: fullText
		});
		entry.lastMessageId = assistantMsg.id;
		write({ type: 'done', sessionId });
	} catch (e) {
		write({ type: 'error', message: e.message });
	} finally {
		unsubscribe();
		res.end();
	}
});

app.listen(port, () => {
	console.log(`[${new Date().toLocaleString()}] WebServer is listening at http://localhost:${port}`)
})