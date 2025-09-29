import * as dateFns from 'date-fns';
import * as fs from 'fs';
import './static/js/lang.js';
import * as csv from './csv-utils.js';
import * as st from './trading-strategy.js';
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
    BullBear
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
    entryDate: new Date('2024-01-01'), //dateFns.addYears(dateFns.addMonths(new Date(), -6), -1), // 取前一年半資料
    exitDate: new Date(),
    //entryStrategy: st.BullTigerEntry,
    entryStrategy: st.BBEntryExit,
    exitStrategy: [st.BBEntryExit], //[st.DynamicStopExit, st.RsiTigerExit],
    //exitStrategy: st.RsiTigerExit,
    //entryStrategy: st.MacdMaEntry,
    //exitStrategy: st.MacdMaExit,
    //stopLossPct: 0.03, // 止損小於入場價格的 3%
    takeProfitPct: 0.05, // 固定止盈大於入場價格的 10%
    //dynamicStopPct: 0.05, // 動態止損小於曾經最高價格的 5%
    //maxHoldPeriod: 30 // 最大持倉周期 30 天
};

function processTrading(dailies, params) {
    // 參數優化
    const optimizer = new ParameterOptimizer(dailies);
    const paramGrid = {
        ma: [...Array(30).keys()].map(i => i + 15),
        stopLossPct: [0.02, 0.03, 0.04],
        takeProfitPct: [0.08, 0.1, 0.12, 10],
        entryStrategy: [st.TigerEntry],
        exitStrategy: [st.TigerExit]
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
    const TOP10 = ['2382', '2330', '2317', '6805', '2404', '4728', '6183', '3130', '6754', '2308'];
	
    if (STOCK_CODE && STOCK_CODE != 'all' && STOCK_CODE != 'csv' && STOCK_CODE != 'invest') {
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
		const stock = await service.getStock('3130');
		console.log(await service.fetchDividendData(stock));
		
        //console.log(await service.realtime(['0050', '3131', 'AAPL']));
        //const stocks = await service.stocks();
        //const codes = stocks.filter(s => s.country == 'tw').map(s => s.code);
        //const result = await service.realtime(codes);
        //await service.sync();
        //console.log(await service.findStock('AAPL'));
		//const result = await service.backtest('all');
		//console.log(result);
        
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
		for (const year of [2023]) { //, 2024, 2025
			params.entryDate = new Date(year + '-09-28');
			params.exitDate = new Date(year + 2 + '-09-28');
			//params.transient = true;
			//let	tests = await service.backtest(TOP10, params);	
	        //let result = service.invest(tests, null, params.entryDate, params.exitDate);
            const investor = new Investor(['2382', '2317'], 555022, params);
            const result = await investor.invest(TOP10, params);
	        //console.log(result);
            console.log(JSON.stringify(result.data));
	        console.log('==========');
	        //fs.writeFileSync(`${TODAY}-${year}-TOP10-布林策略返場不止盈不止損-invest.csv`, result.csv);

	        /*const stocks = await service.stocks();
			codes = stocks.map(s => s.code);
		    // Fisher-Yates 洗牌
		    for (let i = codes.length - 1; i > 0; i--) {
		      const j = Math.floor(Math.random() * (i + 1));
		      [codes[i], codes[j]] = [codes[j], codes[i]];
		    }
			//tests = await service.findTests({ code: { [Op.in]: codes.slice(0, 20) } });
			tests = await service.backtest(codes.slice(0, 20), { transient: true });	
			result = service.invest(tests);
			console.log(result);
			fs.writeFileSync(today + '-random-不止盈重新入場-invest.csv', result.csv);*/			
		}
    }
}

main();