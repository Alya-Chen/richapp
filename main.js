import * as fs from 'fs';
import * as db from './stock-db.js';
import './static/js/lang.js';
import * as st from './trading-strategy.js';
import { STRATEGY_PRESETS } from './trading-strategy.js';
import { TradingSystem } from './trading-sys.js';
import { stockService as service } from './stock-service.js';
import { Investor, WeeklyInvestor } from './stock-investor.js';

process.env.TZ = 'Asia/Taipei';

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
	case 'sync':         return sync(ARGS[0], ARGS[1]);
	case 'sync-weekly':  return syncWeekly(ARGS[0], ARGS[1]);
	case 'backtest':     return backtest(ARGS[0], ARGS[1], ARGS.slice(2));
	case 'backtest-all': return backtestAll(ARGS[0], ARGS.slice(1));
	case 'invest':       return invest(ARGS[0], ARGS[1], ARGS.slice(2));
	case 'invest-weekly': {
		const s_ = STRATEGIES[ARGS[1]];
		const isMix = s_ && st[s_.entry]?.name?.includes('混合');
		return invest(ARGS[0], ARGS[1], [...ARGS.slice(2), ...(isMix ? [] : ['--weekly'])]);
	}
	case 'list-stocks':  return listStocks();
	case 'weekly-analysis':return weeklyAnalysis(ARGS[0] || 'weeklyMacd', ARGS.slice(1));
	default:             showHelp();
	}
}

async function sync(code, forced) {
	forced = forced === 'forced' || forced === 'f' || forced === 'true';
	if (code && code !== 'all') { await service.sync(code, forced); console.log(`${code} done`); return; }
	const stocks = USER_ID ? await userCodes() : (await service.stocks()).filter(s => s.country === 'tw').map(s => s.code);
	if (!stocks?.length) { console.log(USER_ID ? 'User has no stared stocks' : 'No stocks found'); return; }
	console.log(`Sync ${stocks.length} stocks${forced ? ' (forced)' : ''}${USER_ID ? `  user=#${USER_ID}` : ''}`);
	for (const s of stocks) { process.stdout.write(`${s}... `); await service.sync(s, forced); console.log('done'); }
}

async function syncWeekly(code, forced) {
	forced = forced === 'forced' || forced === 'f' || forced === 'true';
	if (code && code !== 'all') { await service.syncWeekly(code, forced); console.log(`${code} done`); return; }
	const codes = USER_ID ? await userCodes() : (await service.stocks()).filter(s => s.country === 'tw').map(s => s.code);
	if (!codes?.length) { console.log(USER_ID ? 'User has no stared stocks' : 'No stocks found'); return; }
	console.log(`Sync weekly ${codes.length} stocks${forced ? ' (forced)' : ''}${USER_ID ? `  user=#${USER_ID}` : ''}`);
	for (const c of codes) { process.stdout.write(`${c}... `); await service.syncWeekly(c, forced); console.log('done'); }
}

async function backtest(code, strategy = 'adx', extras = []) {
	const s = { ...(STRATEGIES[strategy] || STRATEGIES.adx) };
	const params = buildParams(s, extras);
	const stock = await service.getStock(code);
	if (!stock) { console.log('Stock not found:', code); return; }
	const data = s.weekly ? await service.weeklies(code, new Date('2019-01-01')) : await service.dailies(code, new Date('2019-01-01'));
	if (!data?.length) { console.log('No data'); return; }
	if (params.marketFilter) {
		const marketStart = dateFns.addYears(params.entryDate, -2);
		const marketRows = await service.weeklies('0050', marketStart);
		const marketCloses = marketRows.map(r => r.close).filter(c => c != null);
		const period = params.marketMAPeriod || 20;
		params.marketData = marketRows.map((r, i) => {
			if (i < period - 1) return { date: r.date, close: r.close, ma20: null };
			const ma = marketCloses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
			return { date: r.date, close: r.close, ma20: ma };
		});
	}
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
	let cumWins = 0, cumLosses = 0;
	for (const code of codes) {
		process.stdout.write(`${code}... `);
		const r = await service.backtest(code, { ...params, transient: true, weekly: s.weekly, entryStrategy: s.entry, exitStrategy: s.exit }, true);
		if (!r || !r.trades) { console.log('no data'); continue; }
		const closedTrades = (r.trades || []).filter(t => t.duration > 0);
		const trades = closedTrades.length;
		const profit = r.profit || 0;
		const winRate = ((r.winRate || 0) * 100).scale(1);
		const sumWins = closedTrades.filter(t => t.profit > 0).reduce((s, t) => s + t.profit, 0);
		const sumLosses = Math.abs(closedTrades.filter(t => t.profit < 0).reduce((s, t) => s + t.profit, 0)) || 1;
		const pnl = (sumWins / sumLosses).scale(2);
		const wr = (r.winRate || 0);
		const exp = ((pnl * wr) - (1 - wr)).scale(2);
		console.log(`${profit > 0 ? '+' : ''}${profit.scale(0)} (${trades}) win:${winRate}%`);
		cumWins += sumWins; cumLosses += sumLosses;
		results.push({ code, trades, profit, profitRate: r.profitRate || 0, winRate, pnl, expectation: exp });
	}
	if (!results.length) return;
	const csv = ['code\ttrades\tprofit\tprofitRate\twinRate\tpnl\texpectation',
		...results.map(r => [r.code, r.trades, r.profit.scale(0), ((r.profitRate)*100).scale(1)+'%', r.winRate+'%', r.pnl, r.expectation].join('\t'))
	].join('\n');
	const aggPnl = cumLosses ? (cumWins / cumLosses).scale(2) : 0;
	fs.writeFileSync(`${DATA_DIR}backtest-${strategy}-user${USER_ID||'all'}-${new Date().toISOString().slice(0,10)}.meta`, `aggWins=${cumWins}\naggLosses=${cumLosses}\naggPnl=${aggPnl}`);
	console.log(`\nAggregate: ${cumWins.toFixed(0)} wins / ${cumLosses.toFixed(0)} losses = pnl ${aggPnl}`);
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
	const codes = code === 'all'
		? (USER_ID ? await userCodes() : (await service.stocks()).filter(s => s.country === 'tw').map(s => s.code))
		: code.split(',').filter(Boolean);
	const codeLabel = code === 'all' ? `all-user${USER_ID || ''}` : codes.join('&');
	const InvestorClass = useWeekly ? WeeklyInvestor : Investor;
	const inv = new InvestorClass(codes, 1000000, { ...params, entryStrategy: s.entry, exitStrategy: s.exit, weekly: useWeekly });
	console.log(`Invest ${codeLabel}  ${strategy}  ${useWeekly ? 'weekly' : 'daily'}${user ? `  user=#${USER_ID}` : ''}`);
	const result = await inv.invest();
	const done = (result.trades || []).filter(t => t.status === 'done');
	const s_ = result.data?.summary || {};
	console.log(`Trades: ${done.length}  Profit: ${result.profit > 0 ? '+' : ''}${result.profit.scale(0)}  Final: ${result.money}`);
	if (s_.winRate != null) console.log(`  WinRate: ${(s_.winRate*100).scale(1)}%  PnL: ${s_.pnl}  Expectation: ${s_.expectation}  MaxDD: ${(s_.maxDrawdown*100).scale(1)}%  Tax: ${s_.tax.scale(0)}  Net: ${s_.netProfit.scale(0)}`);
	if (done.length > 0) { fs.writeFileSync(`${DATA_DIR}${codeLabel}-${strategy}-invest${user?'-u'+USER_ID:''}-${new Date().toISOString().slice(0,10)}.csv`, result.csv); }
}

function buildParams(s, extras) {
	const p = { transient: true };
	p.entryStrategy = st[s.entry];
	p.exitStrategy = s.exit.map(e => st[e]).filter(Boolean);
	for (const [k, v] of Object.entries(s.params || {})) p[k] = v;
	for (const e of extras) { const [k, v] = e.split('='); if (k && v !== undefined) p[k] = v === 'true' ? true : v === 'false' ? false : isNaN(Number(v)) ? v : Number(v); }
	return p;
}

async function weeklyAnalysis(strategy = 'weeklyMacd', extras = []) {
	await resolveUser();
	const s = { ...(STRATEGIES[strategy] || STRATEGIES.weeklyMacd) };
	const years = ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];
	const now = new Date();
	const curYear = now.getFullYear();
	const results = [];
	for (const y of years) {
		const endDate = (y === '2026' || y === String(curYear)) ? now.toISOString().slice(0, 10) : y + '-12-31';
		process.stdout.write(`\n  ${y}... `);
		const baseParams = buildParams(s, [...extras, `entryDate=${y}-01-02`, `exitDate=${endDate}`]);
		if (typeof baseParams.entryDate === 'string') baseParams.entryDate = new Date(baseParams.entryDate);
		if (typeof baseParams.exitDate === 'string') baseParams.exitDate = new Date(baseParams.exitDate);
		const codes = USER_ID ? await userCodes() : (await service.stocks()).filter(x => x.country === 'tw').map(x => x.code);
		let totalTrades = 0, totalProfit = 0, wins = 0, total = 0, cumW = 0, cumL = 1;
		let tradeWins = 0, tradeLosses = 0; // 逐筆交易勝負
		for (const code of codes) {
			const r = await service.backtest(code, { ...baseParams, transient: true, weekly: s.weekly, entryStrategy: s.entry, exitStrategy: s.exit }, true);
			if (!r || !r.trades) continue;
			// 計入持倉中交易的未實現損益
			let stockProfit = 0;
			let stockTrades = 0;
			let stockW = 0, stockL = 0;
			for (const t of r.trades) {
				if (!(t.duration > 0 || t.status === 'open')) continue;
				stockTrades++;
				const p = t.profit ?? ((r.close && t.entryPrice) ? (r.close - t.entryPrice) : 0);
				stockProfit += p;
				if (p > 0) stockW += p; else stockL += Math.abs(p);
			}
			totalTrades += stockTrades; totalProfit += stockProfit; total++;
			if (stockProfit > 0) wins++;
			cumW += stockW; cumL += stockL;
			// 逐筆交易勝負（與上方共用同一 profit 計算邏輯）
			for (const t of r.trades) {
				if (!(t.duration > 0 || t.status === 'open')) continue;
				const tp = t.profit ?? ((r.close && t.entryPrice) ? (r.close - t.entryPrice) : 0);
				tp > 0 ? tradeWins++ : tradeLosses++;
			}
		}
		const pnl = cumL > 1 ? (cumW / cumL).scale(2) : 0;
		const wr = total ? (wins / total * 100).toFixed(0) : '—';
		results.push({ year: y, trades: totalTrades, profit: totalProfit, wr, pnl, wins, total, tradeWins, tradeLosses, cumW, cumL: cumL === 1 ? 0 : cumL });
		process.stdout.write(`${totalTrades}筆 損益 ${totalProfit > 0 ? '+' : ''}${totalProfit.scale(0)}`);
	}
	console.log('\n\n─'.repeat(50));
	console.log(`\n### ${s.desc || strategy} 分年度績效（USER ${USER_ID || 1}）\n`);
	console.log('年度\t筆數\t勝率\t盈虧比\t總損益\t賺錢股');
	for (const r of results) {
		console.log(`${r.year}\t${r.trades}\t${r.wr}%\t${r.pnl}\t${r.profit > 0 ? '+' : ''}${r.profit.scale(0)}\t${r.wins}/${r.total}`);
	}
	const ttl = results.reduce((s, r) => s + r.trades, 0);
	const ttp = results.reduce((s, r) => s + r.profit, 0);
	const tw = results.reduce((s, r) => s + r.tradeWins, 0);
	const tl = results.reduce((s, r) => s + r.tradeLosses, 0);
	const twr = (ttl > 0) ? ((tw / ttl) * 100).toFixed(1) : '—';
	const avgExp = (ttl > 0) ? (ttp / ttl).toFixed(2) : '—';
	// 盈虧比 = 總贏錢 / 總賠錢（近似：均利/筆 × 勝率 ÷ ((1-勝率) × 均虧)）
	// 直接以 profit 方向估算：但更準確需各 year cumW/cumL 累計
	const aggCumW = results.reduce((s, r) => s + r.cumW, 0);
	const aggCumL = results.reduce((s, r) => s + r.cumL, 0);
	const aggPnl = (aggCumL > 1) ? (aggCumW / aggCumL).toFixed(2) : '—';
	console.log(`合計\t${ttl}\t${twr}%\t${aggPnl}\t${ttp > 0 ? '+' : ''}${ttp.scale(0)}\t—`);
	console.log(`\n匯總指標（逐筆交易層級）:`);
	console.log(`  總筆數=${ttl}  勝率=${twr}%  盈虧比=${aggPnl}  均利/筆=${avgExp}`);
}

async function listStocks() {
	(await service.stocks()).forEach(s => console.log(s.code, s.country || 'tw'));
}

main().catch(console.error);