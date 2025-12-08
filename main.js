import * as dateFns from 'date-fns';
import * as fs from 'fs';
import './static/js/lang.js';
import * as csv from './csv-utils.js';
import {
    TradingSystem,
    ParameterOptimizer
} from './trading-sys.js';
import {
    stockService as service
} from './stock-service.js';
import {
    Investor
} from './stock-investor.js';
import {
    Op
} from 'sequelize';
import {
    BullBear, Adx, Atr, VolatilityAnalyzer
} from './static/js/macd-kdj.js';

//https://openapi.twse.com.tw/
//https://hackmd.io/@aaronlife/python-ex-stock-by-api
//https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=20250101&stockNo=2330&response=json
//https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=1264&date=2021%2F09%2F01&id=&response=utf-8
//https://www.tpex.org.tw/openapi/#/
//https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_0050.tw

const ARGS = process.argv.slice(2);
const STOCK_CODE = ARGS[0];
const DATA_DIR = 'data/';
const STOCK_DIR = 'data/stock/';

// 初始化參數
const params = {
    ma: ARGS[1] || 17,
    threshold: 0.005, // MA 需增量 0.5%
    volumeRate: 1.2, // 交易需增量倍數
    breakout: true, // 入場需符合二日法則
    reentry: true, // 出場後是否要重複入場
    entryDate: new Date('2025-06-01'), //dateFns.addYears(dateFns.addMonths(new Date(), -6), -1), // 取前一年半資料
    exitDate: new Date(),
    //entryStrategy: AdxEntry, BullTigerEntry, BBEntryExit, TwoDaysUpEntry
    entryStrategy: 'AdxEntry',
    exitStrategy: ['AdxExit'], //['DynamicStopExit', 'RsiTigerExit'],
    //entryStrategy: 'MacdMaEntry',
    //exitStrategy: ['MacdMaExit'],
    stopLossPct: 0.03, // 止損小於入場價格的 3%
    takeProfitPct: 0.05, // 固定止盈大於入場價格的 5%
    dynamicStopPct: 0.07, // 動態止損小於曾經最高價格的 7%
    //maxHoldPeriod: 30 // 最大持倉周期 30 天
};

function processTrading(dailies, params) {
    // 參數優化
    const optimizer = new ParameterOptimizer(dailies);
    const paramGrid = {
        ma: [...Array(30).keys()].map(i => i + 15),
        stopLossPct: [0.02, 0.03, 0.04],
        takeProfitPct: [0.08, 0.1, 0.12, 10],
        entryStrategy: ['TigerEntry'],
        exitStrategy: ['TigerExit']
    };
    const results = optimizer.gridSearch(paramGrid);
    const best = results.sort((a, b) =>
        //b.returns - a.returns
        b.profit - a.profit
    )[0];

    console.dir(results.slice(0, 5));
    console.dir(best);
    console.dir(best.params);
    console.dir(best.trades);
    return results;
}

// ================== 使用示例 ==================
async function main() {
    //const dailies = await service.realtime(['0050']);
    //console.log(dailies);
    //await service.sync();
    const TODAY = new Date().toLocaleDateString().replaceAll('/', '');
    const TOP10 = ['2382', '2330', '2317', '6805', '2404', '4728', '6183', '3130', '6754', '2308', '6669', '2376', '2454'];

    if (STOCK_CODE && STOCK_CODE != 'all' && STOCK_CODE != 'csv' && STOCK_CODE != 'invest' && STOCK_CODE != 'analysis') {
        //const tests = await service.findTest(STOCK_CODE);
        //console.log(tests[0].params);
        const stock = await service.getStock(STOCK_CODE);
        const result = await service.backtest(STOCK_CODE, params);
        const profitRate = (result.profitRate * 100).scale(0) + '%';
        console.log(`${stock.code} ${stock.name} MA${result.ma} ${result.profit} ${profitRate}`);
        console.log(result);
        //console.log(result.trades);
        //const filePath = `${DATA_DIR}${stock.code} ${stock.name} MA${result.ma} (${result.profit} ${profitRate}).csv`;
        //csv.writeFile(filePath, result.trades);
        //await service.saveTest(stock, result);
    }
    if (STOCK_CODE == 'all') {
		//const stock = await service.getStock('3130');
		//console.log(await service.fetchDividendData(stock));

        //console.log(await service.realtime(['0050', '3131', 'AAPL']));
        //const stocks = await service.stocks();
        //const codes = stocks.filter(s => s.country == 'tw').map(s => s.code);
        //const result = await service.realtime(codes);
        //await service.sync();
        //console.log(await service.findStock('AAPL'));
        const user = await service.getUser(1);
        const params = user.settings.params;
        params.userId = user.id;
        console.log(params);
        const result = await service.backtest('all', params);
        console.log(result.length);
		//const result = await service.backtest(['AAPL', '6721'], {
        //    transient: true
		//});
        //console.log(service.invest(result));
        //const codes = ['6721'];
        //for (let i = 0; i < codes.length; i++) await service.sync(codes[i], true);
        /*const stocks = await service.stocks();
        const startDate = new Date('2024-06-06');
        for (let i = 0; i < stocks.length; i++) {
        	const stock = stocks[i];
        	const dailies = await service.dailies(stock.code, startDate);
        	stock.financial = Object.assign(stock.financial || {}, new BullBear(dailies).calculate());
        	console.log(`${stock.code} ${JSON.stringify(stock.financial.bullscore)}`);
        	service.saveStock(stock);
        }*/
    }
    if (STOCK_CODE == 'csv') {
        //const tests = await service.findTests(null, [
        //    ['profitRate', 'DESC']
		//]);
		const stocks = await service.stocks();
		const codes = stocks.filter(s => s.country == 'tw').map(s => s.code);
		for (const year of [2023, 2024, 2025]) {
			params.entryDate = new Date(year + '-01-01');
			params.exitDate = new Date(year + '-12-31');
			params.transient = true;
			const tests = await service.backtest(codes, params);
        	const csv = await service.exportCsv(tests);
	        //console.log(csv);
	        fs.writeFileSync(`${TODAY}-${year}-TOP10-金牛5％止盈不止損.csv`, csv);
		}
    }
    if (STOCK_CODE == 'invest') {
		const stocks = await service.stocks();
        const money = 555022;
        params.transient = true;
        //params.dynamic = true;
        //params.usingTigerMa = true;
        const startDate = dateFns.addYears(new Date(), -2);
        const csv = [];
        for (const code of TOP10) {
            console.log(`Investing ${code}`);
            params.entryDate = new Date('2025-01-01');
            const investor = new Investor([code], money, params);
            const result = await investor.invest();
            console.log(result.csv);
            csv.push(result.csv);
        }
        fs.writeFileSync(`data/${TODAY}-TOP10.csv`, csv.join('\r\n\r\n'));
    }
    if (STOCK_CODE == 'analysis') {
        const startDate = dateFns.addYears(new Date(), -2);
        const csv = [];
        for (const code of ['6669']) {
            console.log(`Investing ${code}`);
            const data = await service.dailies(code, startDate);
            const adxResults = new Adx(data, { period: 14 }).calculate();
            const atrResults = new Atr(data, { period: 14 }).calculate();
            const analyzer = new VolatilityAnalyzer(adxResults, atrResults);
            const today = new Date().toISOString().substring(0, 10);
            const oneYearAgo = dateFns.addYears(new Date(), -1);
            for (let i = 0; i <= 3600; i++) {
                const targetDate = dateFns.addDays(oneYearAgo, i);
                if (targetDate.toISOString().substring(0, 10) > today) break;
                const result = analyzer.run(targetDate);
                if (result.error) continue;
                const note = JSON.stringify(result.note) + result.diSignal.split(' ')[0];
                if (note != analyzer.note) {
                    result.code = code;
                    result.name = (await service.getStock(code)).name;
                    analyzer.note = note;
                    csv.push(JSON.stringify(result));
                }
            }
        }
        fs.writeFileSync(`data/${TODAY}-9996.csv`, csv.join('\r\n\r\n'));
    }
}

main();