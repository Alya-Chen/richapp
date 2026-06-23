import * as fs from 'fs';
import * as db from './stock-db.js';
import './static/js/lang.js';
import * as st from './trading-strategy.js';
import { STRATEGY_PRESETS } from './trading-strategy.js';
import { TradingSystem } from './trading-sys.js';
import { stockService as service } from './stock-service.js';
import { Investor, WeeklyInvestor } from './stock-investor.js';

const DATA_DIR = 'data/';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USER_ID = parseGlobalUser();
let _user;
const STRATEGIES = STRATEGY_PRESETS;

function parseGlobalUser() {
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		if ((argv[i] === '-u' || argv[i] === '--user') && i + 1 < argv.length) {
			process.argv.splice(process.argv.indexOf(argv[i]), 2);
			return parseInt(argv[i + 1]);
		}
	}
	return null;
}

async function resolveUser() {
	if (_user) return _user;
	if (!USER_ID) return null;
	await db.initDb();
	_user = await db.User.findByPk(USER_ID);
	if (!_user) { console.error(`User #${USER_ID} not found`); process.exit(1); }
	return _user;
}

async function userCodes() {
	const user = await resolveUser();
	if (!user) return null;
	return user.settings?.stared?.filter(Boolean) || [];
}

function showHelp() {
	console.log(`
Usage: node main.js [-u <userId>] <command> [args...]

Options:
  -u, --user <id>      以使用者關注股票與策略參數執行

Commands:
  sync <code|all>              同步日線
  sync-all [weekly]            同步全部台股
  backtest <code|all> [策略]   跑回測 (adx, weeklyAdx, weeklyTrend, macd)
  invest <code> [策略]         資金管理（日線）
  invest-weekly <code> [策略]  資金管理（週線）
  list-stocks                  列出股票

範例:
  node main.js backtest 2330 weeklyAdx drawdownRate=0.4
  node main.js backtest-all weeklyAdx
  node main.js -u 2 backtest-all weeklyAdx
  node main.js -u 2 invest 2330
`);
}

async function main() {
	const [CMD, ...ARGS] = process.argv.slice(2);
	switch (CMD) {
	case 'sync':         return sync(ARGS[0]);
	case 'sync-all':     return syncAll(ARGS[0]);
	case 'backtest':     return backtest(ARGS[0], ARGS[1], ARGS.slice(2));
	case 'backtest-all': return backtestAll(ARGS[0], ARGS.slice(1));
	case 'invest':       return invest(ARGS[0], ARGS[1], ARGS.slice(2));
	case 'invest-weekly':return invest(ARGS[0], ARGS[1], [...ARGS.slice(2), '--weekly']);
	case 'list-stocks':  return listStocks();
	default:             showHelp();
	}
}

async function sync(code) {
	if (code && code !== 'all') { await service.sync(code); console.log(`${code} done`); return; }
	const stocks = await service.stocks();
	for (const s of stocks) { process.stdout.write(`${s.code} ${s.name}... `); await service.sync(s.code); console.log('done'); }
}

async function syncAll(interval) {
	const fn = interval === 'weekly' ? 'syncWeekly' : 'sync';
	const codes = USER_ID ? await userCodes() : (await service.stocks()).filter(s => s.country === 'tw').map(s => s.code);
	if (!codes?.length) { console.log(USER_ID ? 'User has no stared stocks' : 'No stocks found'); return; }
	console.log(`Sync ${codes.length} stocks  ${interval||'daily'}${USER_ID ? `  user=#${USER_ID}` : ''}`);
	for (const code of codes) { process.stdout.write(`${code}... `); await service[fn](code); console.log('done'); }
}

async function backtest(code, strategy = 'adx', extras = []) {
	const s = { ...(STRATEGIES[strategy] || STRATEGIES.adx) };
	const params = buildParams(s, extras);
	const stock = await service.getStock(code);
	if (!stock) { console.log('Stock not found:', code); return; }
	const data = s.weekly ? await service.weeklies(code, new Date('2019-01-01')) : await service.dailies(code, new Date('2019-01-01'));
	if (!data?.length) { console.log('No data'); return; }
	const sys = new TradingSystem(data, { ...params, code });
	const result = sys.backtest();
	const trades = (result.trades || []).filter(t => t.duration > 0);
	const profit = result.profit || 0;
	console.log(`\n${stock.code} ${stock.name}  ${strategy}  Trades: ${trades.length}  Profit: ${profit > 0 ? '+' : ''}${profit.scale(0)}  Rate: ${((result.profitRate||0)*100).scale(1)}%`);
	trades.forEach((t,i) => console.log(`  #${i+1} ${(t.entryDate?.toISOString?.()?.slice(0,10)||'').slice(2)}→${(t.exitDate?.toISOString?.()?.slice(0,10)||'').slice(2)}  ${t.entryPrice.scale(0)}→${t.exitPrice.scale(0)}  ${t.profit>0?'+':''}${t.profit.scale(0)}`));
	fs.writeFileSync(`${DATA_DIR}${code}-${strategy}-${new Date().toISOString().slice(0,10)}.csv`, JSON.stringify(result.trades, null, 2));
}

async function backtestAll(strategy = 'adx', extras = []) {
	const s = { ...(STRATEGIES[strategy] || STRATEGIES.adx) };
	const params = buildParams(s, extras);
	if (typeof params.entryDate === 'string') params.entryDate = new Date(params.entryDate);
	if (typeof params.exitDate === 'string') params.exitDate = new Date(params.exitDate);
	const codes = USER_ID ? await userCodes() : (await service.stocks()).filter(x => x.country === 'tw').map(x => x.code);
	if (!codes?.length) { console.log(USER_ID ? 'User has no stared stocks' : 'No stocks found'); return; }
	console.log(`\nBacktest ${codes.length} stocks  ${strategy}${USER_ID ? `  user=#${USER_ID}` : ''}`);
	const results = [];
	for (const code of codes) {
		process.stdout.write(`${code}... `);
		const r = await service.backtest(code, { ...params, transient: true, entryStrategy: s.entry, exitStrategy: s.exit }, true);
		if (!r || !r.trades) { console.log('no data'); continue; }
		const trades = (r.trades || []).filter(t => t.duration > 0).length;
		const profit = r.profit || 0;
		console.log(`${profit > 0 ? '+' : ''}${profit.scale(0)} (${trades})`);
		results.push({ code, trades, profit, profitRate: r.profitRate || 0 });
	}
	if (!results.length) return;
	const csv = ['code\ttrades\tprofit\tprofitRate', ...results.map(r => [r.code, r.trades, r.profit.scale(0), ((r.profitRate)*100).scale(1)+'%'].join('\t'))].join('\n');
	fs.writeFileSync(`${DATA_DIR}backtest-${strategy}-user${USER_ID||'all'}-${new Date().toISOString().slice(0,10)}.csv`, csv);
	console.log(`Saved: ${DATA_DIR}backtest-${strategy}-user${USER_ID||'all'}-${new Date().toISOString().slice(0,10)}.csv`);
}

async function invest(code, strategy, extras = []) {
	const user = await resolveUser();
	if (!strategy && user?.settings?.params) {
		const up = user.settings.params;
		strategy = up.entryStrategy === 'WeeklyTrendEntry' ? 'weeklyTrend'
			: up.entryStrategy === 'AdxEntry' ? (up.weekly ? 'weeklyAdx' : 'adx')
			: up.entryStrategy === 'MacdEntry' ? 'macd' : 'adx';
	}
	const s = { ...(STRATEGIES[strategy] || STRATEGIES.adx) };
	const useWeekly = extras.includes('--weekly') || s.weekly;
	const params = buildParams(s, extras.filter(e => !e.startsWith('--')));
	const explicitParams = new Set(extras.filter(e => !e.startsWith('--')).map(e => e.split('=')[0]));
	if (user?.settings?.params) {
		for (const k of ['adxRate', 'drawdownRate', 'raiseRate', 'reentry']) {
			if (user.settings.params[k] !== undefined && !explicitParams.has(k)) params[k] = user.settings.params[k];
		}
	}
	if (!params.entryDate) params.entryDate = new Date('2020-01-01');
	if (typeof params.entryDate === 'string') params.entryDate = new Date(params.entryDate);
	if (typeof params.exitDate === 'string') params.exitDate = new Date(params.exitDate);
	const InvestorClass = useWeekly ? WeeklyInvestor : Investor;
	const inv = new InvestorClass([code], 1000000, { ...params, entryStrategy: s.entry, exitStrategy: s.exit, weekly: useWeekly });
	console.log(`Invest ${code}  ${strategy}  ${useWeekly ? 'weekly' : 'daily'}${user ? `  user=#${USER_ID}` : ''}`);
	const result = await inv.invest();
	const done = (result.trades || []).filter(t => t.status === 'done');
	console.log(`Trades: ${done.length}  Profit: ${result.profit > 0 ? '+' : ''}${result.profit.scale(0)}  Final: ${result.money}`);
	if (done.length > 0) { fs.writeFileSync(`${DATA_DIR}${code}-${strategy}-invest${user?'-u'+USER_ID:''}-${new Date().toISOString().slice(0,10)}.csv`, result.csv); }
}

function buildParams(s, extras) {
	const p = { transient: true };
	p.entryStrategy = st[s.entry];
	p.exitStrategy = s.exit.map(e => st[e]).filter(Boolean);
	for (const [k, v] of Object.entries(s.params || {})) p[k] = v;
	for (const e of extras) { const [k, v] = e.split('='); if (k && v !== undefined) p[k] = isNaN(Number(v)) ? v : Number(v); }
	return p;
}

async function listStocks() {
	(await service.stocks()).forEach(s => console.log(s.code, s.country || 'tw'));
}

main().catch(console.error);