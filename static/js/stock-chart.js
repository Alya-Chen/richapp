class StockChart {
	constructor(container, data, callback) {
		this.container = container;
		this.data = data;
	}
	draw(axes) {
		axes = axes.filter(a => a.visible);
		const stockData = this.data.map(d => [d.date.getTime(), d.open, d.high, d.low, d.close, d.volume, d.diff]);
		const volumeData = this.data.map(d => [d.date.getTime(), d.volume || 0, (d.diff > 0 ? 'pink' : (d.diff < 0 ? 'lightgreen' : 'lightgray'))]);
		const bullbear = new BullBear(this.data).calculate();
		const bullbearFlags = [];
		bullbear.bullish.forEach(i => bullbearFlags.push({ x: Date.parse(i), title: '牛'}));
		bullbear.bearish.forEach(i => bullbearFlags.push({ x: Date.parse(i), title: '熊'}));
		//const exitAlerts = new ExitAlert(this.data).calculate();
		const macd = new Macd(this.data).calculate(); //  { fast: 5, slow: 34, dea: 5 }
		const macdData = macd.filter(i => i.diff).map(i => [i.time, i.diff]);
		const macdDeaData = macd.filter(i => i.dea).map(i => [i.time, i.dea]);
		const macdSlopeData = macd.map(i => i.slope);
		//const histogramData = macd.filter(i => i.histogram).map(i => [i.time, i.histogram]);
		const histogramData = [];
		macd.forEach((m, idx) => {
			if (!m.histogram) return;
			//const color = macdSlopeData[idx] ? '#80FFFF' : (m.histogram > 0 ? 'pink' : 'lightgreen');
			const diff = m.histogram - (macd[idx - 1].histogram || 0);
			const color = m.histogram > 0 ? (diff > 0 ? 'DarkSalmon' : 'Moccasin') : (diff > 0 ? 'Teal' : 'LightBlue')
			histogramData.push({ x: m.time, y: m.histogram, color });
		});
		const macdFlags = macd.filter(i => i.golden || i.dead).map(i => ({
			x: i.time,
			title: i.golden ? '⭕' : '❌',
			text: i.golden ? '金叉' : '死叉',
			color: i.golden ? 'green' : 'red'
		}));
		const lsrData = this.data.filter(i => i.lsr).map(i => [i.date.getTime(), i.lsr]);
		const rsi = new Rsi(this.data).calculate();
		const rsiData = rsi.filter(i => i && i.rsi).map(i => [i.time, i.rsi]);
		//console.log(rsi.filter(i => i && (i.bear || i.bull)).map(i => [i.time, i.bear, i.bull]))
		const kdj = new Kdj(this.data).calculate(); // { period: 9, k: 3, d: 3 }
		const kData = kdj.filter(i => i.k).map(i => [i.time, i.k]);		
		//const rsiFlags = rsi.filter(i => i && (i.golden || i.dead)).map(i => ({
		const rsiFlags = rsi.filter(i => i && i.dead).map(i => ({
			x: i.time,
			title: i.golden ? '⭕' : '❌',
			text: i.golden ? 'RSI 金叉' : 'RSI 死叉',
			color: i.golden ? 'green' : 'red'
		}));
		/*kdj.filter(i => i.golden).forEach(i => rsiFlags.push({
			x: i.time,
			title: '⭕',
			text: 'K 金叉',
			color: 'green'
		}));*/
		/*const cci = new Cci(this.data, { period: 50, limit: 100 }).calculate(); // { period: 14~25, 50, 84, limit: 100, 200, 220 }
		const cciData = cci.filter(i => i && i.cci).map(i => [i.time, i.cci]);
		const cciFlags = cci.filter(i => i && (i.golden || i.dead)).map(i => ({
			x: i.time,
			title: i.golden ? '⭕' : '❌',
			text: i.golden ? '金叉' : '死叉',
			color: i.golden ? 'green' : 'red'
		}));		
		const kdj = new Kdj(this.data).calculate(); // { period: 9, k: 3, d: 3 }
		const kData = kdj.filter(i => i.k).map(i => [i.time, i.k]);
		const dData = kdj.filter(i => i.d).map(i => [i.time, i.d]);
		const jData = kdj.filter(i => i.j).map(i => [i.time, i.j]);*/
		const kdjFlags = kdj.filter(i => i.golden || i.dead).map(i => ({
			x: i.time,
			title: i.golden ? '⭕' : '🧨',
			text: i.golden ? 'K 金叉' : 'K 死叉',
			color: i.golden ? 'green' : 'red'
		}));
		/////////////////////////////////////////////////////////////////////////////
		const params = {
			rangeSelector: {
				selected: 1
			}, // 預設顯示範圍
			//title: {
			//	text: 'K 線圖'
			//},		
			yAxis: [{
				labels: {
					align: 'right'
				},
				height: '45%' // K 線圖
			}, {
				labels: { // 成交量
					align: 'left'
				},
				top: '45%',
				height: '5%'
			}],
			series: [{
					id: 'candlestick',
					type: 'candlestick',
					yAxis: 0,
					name: 'K 線',
					data: stockData,
				    keys: ['x', 'open', 'high', 'low', 'close', 'volume', 'diff', 'prevVolume'],
					color: 'lightgreen',
					lineColor: 'green',
					upColor: 'pink',
					upLineColor: 'red',
				    tooltip: {
						pointFormatter: function () {
							const color = this.diff > 0 ? 'red' : (this.diff == 0 ? 'gray' : 'green');
                            const diffRate = (this.diff * 100 / (this.close - this.diff)).scale(2);
                            const diff = (this.diff > 0 ? ' ▲ ' : (this.diff == 0 ? ' ' : ' ▼ ')) + this.diff.scale(2) + `（${diffRate}%）`;
                            const close = `<span style="color:${color}">${this.close.scale(2)} ${diff}</span>`;
							const prevVolume = stockData[stockData.findIndex(d => d[0] == this.x) - 1][5];
							const isVolumeUp = this.volume > (prevVolume || 0);
							const volume = `<span style="color:green">${(this.diff > 0 && !isVolumeUp) ? '（價漲量縮）' : (this.diff < 0 && isVolumeUp ? '（價跌量漲）' : '')}</span>`;						
                            this.series.chart.setTitle({ text: `${Highcharts.dateFormat('%Y-%m-%d', this.x)} | ${close} | 開 ${this.open.scale(2)} | 高 ${this.high.scale(2)} | 低 ${this.low.scale(2)} | 量 ${this.volume}${volume}`});
							return false;
						}
				    },
					dataGrouping: {
						enabled: false
					} // 禁用自動分組
				},
				{
					type: 'column',
					yAxis: 1,
					name: '成交量',
					data: volumeData,
					keys: ['x', 'y', 'color']
				}, {
					type: 'flags',
					data: bullbearFlags,
					shape: 'flag',
					y: -20
				}
			]
		};
		if (axes.find(a => a.id == 'MACD')) {
			params.yAxis.push({
				labels: {
					align: 'left'
				},
				top: (axes.length == 1) ? '75%' : '50%',
				height: '25%'
			});
			params.series.push({
				type: 'column',
				name: 'MACD 柱狀圖',
				data: histogramData,
				yAxis: params.yAxis.length - 1,
				//color: 'pink',
				//negativeColor: 'lightgreen'
			}, {
				type: 'line',
				name: 'MACD 快線',
				data: macdData,
				yAxis: params.yAxis.length - 1,
				color: 'deeppink',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'line',
				name: 'MACD 慢線',
				data: macdDeaData,
				yAxis: params.yAxis.length - 1,
				color: 'LightSeaGreen',
				//dashStyle: 'ShortDash',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'flags',
				data: macdFlags,
				shape: 'flag',
				color: Highcharts.getOptions().colors[0],
				y: -20
			});
		}
		//if (axes.find(a => a.id == 'RSI')) {
			params.yAxis.push({
				labels: {
					align: 'left'
				},
				top: '75%',
				height: '25%',
				plotLines: [{
						value: 20,
						color: 'green',
						width: 1,
						dashStyle: 'Dash'
					},
					{
						value: 50,
						color: 'gray',
						width: 1,
						dashStyle: 'Dash'
					}, {
						value: 80,
						color: 'pink',
						width: 1,
						dashStyle: 'Dash'
					}
				]
			});
			params.series.push({
				type: 'line',
				name: 'K',
				data: kData,
				yAxis: params.yAxis.length - 1,
				color: 'plum',
				tooltip: {
					valueDecimals: 3
				} 
			}, {
				type: 'line',
				name: 'RSI',
				data: rsiData,
				yAxis: params.yAxis.length - 1,
				color: 'tomato',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'flags',
				data: rsiFlags,
				shape: 'flag',
				color: Highcharts.getOptions().colors[0],
				y: -40
			});
		//}
		if (axes.find(a => a.id == 'LSR')) {
			params.yAxis.push({
				labels: {
					align: 'left'
				},
				top: '75%',
				height: '25%',
				plotLines: [{
						value: 0,
						color: 'green',
						width: 1,
						dashStyle: 'Dash'
					}
				]
			});
			params.series.push({
				type: 'line',
				name: 'LSR',
				data: lsrData,
				yAxis: params.yAxis.length - 1,
				color: 'tomato',
				tooltip: {
					valueDecimals: 3
				} 
			});
		}
		/*
		if (axes.find(a => a.id == 'CCI')) {
			params.yAxis.push({
				labels: {
					align: 'left'
				},
				top: '75%',
				height: '25%',
				plotLines: [{
						value: -100,
						color: 'green',
						width: 1,
						dashStyle: 'Dash'
					}, {
						value: 100,
						color: 'pink',
						width: 1,
						dashStyle: 'Dash'
					}
				]
			});
			params.series.push({
				type: 'line',
				name: 'CCI',
				data: cciData,
				yAxis: params.yAxis.length - 1,
				color: 'orange',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'flags',
				data: cciFlags,
				shape: 'flag',
				color: Highcharts.getOptions().colors[0],
				y: -40
			});
		}
		if (axes.find(a => a.id == 'KDJ')) {
			params.yAxis.push({
				labels: {
					align: 'left'
				},
				top: '75%',
				height: '25%',
				plotLines: [{
						value: 20,
						color: 'green',
						width: 1,
						dashStyle: 'Dash'
					},
					{
						value: 50,
						color: 'lightgray',
						width: 1,
						dashStyle: 'Dash'
					}, {
						value: 80,
						color: 'pink',
						width: 1,
						dashStyle: 'Dash'
					}
				]
			});
			params.series.push({
				type: 'line',
				name: 'K',
				data: kData,
				yAxis: params.yAxis.length - 1,
				color: 'LightSeaGreen',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'line',
				name: 'D',
				data: dData,
				yAxis: params.yAxis.length - 1,
				color: 'deeppink',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'line',
				name: 'J',
				data: jData,
				yAxis: params.yAxis.length - 1,
				color: 'orange',
				dashStyle: 'ShortDash',
				tooltip: {
					valueDecimals: 3
				}
			}, {
				type: 'flags',
				data: kdjFlags,
				shape: 'flag',
				color: Highcharts.getOptions().colors[0],
				y: -40
			});
		}*/
		if (params.yAxis.length == 2) {
			params.yAxis[0].height = '95%';
			params.yAxis[1].top = '95%';
		}
		if (params.yAxis.length == 3) {
			params.yAxis[0].height = '70%';
			params.yAxis[1].top = '70%';
		}
		this.chart = Highcharts.stockChart(this.container, params);
		this.reset();
		if (axes.find(a => a.id == '20MA')) this.addMa(20);
		if (axes.find(a => a.id == '60MA')) this.addMa(60);
		if (axes.find(a => a.id == '120MA')) this.addMa(120);
		if (axes.find(a => a.id == '200MA')) this.addMa(200);
		if (axes.find(a => a.id == 'Bollinger')) this.addBollingerBands();
		return this;
	}
	get() {
		return this.chart;
	}
	update(d) {
		const series = this.chart.series[0];
		const last = series.data[series.data.length - 1];
		if (!new Date(last.x).isSameDay(d.date)) return;
		last.update([last.x, d.open, d.high, d.low, d.close, d.volume, d.diff]);
	}
	addMa(ma) {
		this.defaultMa = this.defaultMa || ma;
		const colors = ['IndianRed', 'SeaGreen', 'RoyalBlue', 'Plum', 'LightSalmon', 'PeachPuff']
		const maData = this.calculate(ma);
		this.chart.addSeries({
			type: 'line',
			name: `MA${ma}`,
			id: `ma-${ma}`,
			data: maData,
			color: colors[this.addMa.count++],
			lineWidth: 1.5,
			marker: {
				enabled: false
			}
		});
		return this;
	}
	addBollingerBands() {
		const bb = new BollingerBands(this.data, this.defaultMa).calculate();
		const upperData = bb.map(i => [i.time, i.upper]);
		const lowerData = bb.map(i => [i.time, i.lower]);
		this.chart.addSeries({
			type: 'line',
			name: `上軌`,
			data: upperData,
			color: 'LightPink',
			tooltip: { valueDecimals: 2 }
		});
		this.chart.addSeries({
			type: 'line',
			name: `下軌`,
			data: lowerData,
			color: 'DeepSkyBlue',
			tooltip: { valueDecimals: 2 }
		});					
	}	
	reset() {
		if (!this.chart.series) return;
		this.addMa.count = 0;		
		this.chart.series.forEach(series => {
			if (series.options.id?.startsWith('ma-')) {
				series.remove();
			}
		});
		return this;
	}
	calculate(period = 5) {
		const data = this.data;
		return data.map((day, index) => {
			if (index < period - 1) return null;
			const sum = data.slice(index - period + 1, index + 1).reduce((sum, curr) => sum + curr.close, 0);
			const ma = (sum / period).scale(2);
			return [day.date.getTime(), ma];
		}).filter(Boolean);
	}
}