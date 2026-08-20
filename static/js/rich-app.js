(function(window, $, angular) {
	'use strict';

	const SEC = 1000;
	const EIGHT_HOURS = 8 * 3600 * SEC;
	const ONE_DAY = 3 * EIGHT_HOURS;

	const app = angular.module('rich-app', [
		'ngRoute',
	]);
	///////////////////////////////////////////////////////////////////////////////
	app.config(['$locationProvider', '$sceProvider', '$routeProvider', function($locationProvider, $sceProvider, $router) {
		$locationProvider.html5Mode(true);
		$sceProvider.enabled(false);
		$router.when('/', {
			templateUrl: 'home.html',
			controller: 'homeCtrl'
		}).when('/stock/:code?/:ma?', {
			templateUrl: 'stock.html',
			controller: 'stockCtrl'
		}).when('/simulate/:codes?', {
			templateUrl: 'simulate.html',
			controller: 'simulateCtrl'
		}).otherwise({
			redirectTo: '/'
		});
	}]);
	///////////////////////////////////////////////////////////////////////////////
	class Service {
		constructor($http, $timeout, $root) {
			this.$http = $http;
			this.$timeout = $timeout;
			this.$root = $root;
		}
		sql(commands, callback) {
			this.$http.post(`/sql`, { commands }).then((res) => {
				callback(res.data);
			});
		}
		checkList(code, callback) {
			if (code == 'blank') {
				if (this.blankCheckList) return callback(this.blankCheckList);
				return this.$http.get('/js/check-list.json').then((res) => {
					this.blankCheckList = res.data;
					callback(res.data);
				});
			}
			this.$http.get('/stock/checkList/' + code).then((res) => {
				callback(res.data);
			});
		}
		add(stock, callback) {
			this.$http.get('/stock/add/' + stock.code + '/' + stock.name).then((res) => {
				callback(res.data);
			});
		}
		stock(code, callback) {
			this.$http.get('/stock/' + code).then((res) => {
				const stock = res.data;
				if (stock.financial && stock.financial['股利']) {
					stock.dividend = stock.financial['股利'].find(f => f['除息日'] != '--');
				}
				callback(res.data);
			});
		}
		sync(code, callback) {
			$.growlUI('', `${code} 開始進行資料同步與回測，請稍候...`);
			this.$http.get(`/sync/${code}/true`).then((res) => {
				$.growlUI('', `${code} 完成資料同步與回測`);
				callback(res.data);
			});
		}
		star(code, callback) {
			this.$http.get(`/star/${code}`).then((res) => {
				this.user = res.data;
				callback(this.user);
			});
		}
		trades(params, callback) {
			this.$http.get('/trades', { params }).then((res) => {
				res.data.forEach(t => {
					const stock = this._stocks.find(s => s.code == t.logs[0].code);
					t.code = stock.code;
					t.name = stock.name;
				});
				res.data.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
				if (callback) callback(res.data);
			});
		}
		trade(log, callback) {
			this.$http.post(`/stock/${log.code}/trade`, log).then((res) => {
				callback(res.data);
			});
		}
		dividend(trade, callback) {
			this.$http.post(`/stock/${trade.stockCode}/dividend`, trade).then((res) => {
				callback(res.data);
			});
		}
		realtime(codes, callback) {
			const now = new Date();
			this.$http.get('/realtime/' + codes).then((res) => {
				res.data.forEach(d => {
					d.isToday = now.isSameDay(new Date(d.date));
					d.date = (d.isToday) ? now : new Date(d.date);
					if (d.open) d.diffRate = d.diff / (d.close - d.diff);
				});
				callback(res.data);
			});
		}
		stocks(callback) {
			this.$http.get('/stocks').then((res) => {
				this._stocks = res.data;
				this._stocks.forEach(stock => this.backtest(stock));
				if (callback) callback(this._stocks);
				this.$timeout(() => { this.$root.$broadcast('stocksLoaded', this._stocks) }, 175);
			});
		}
		users(callback, userId) {
			userId = userId || Cookies.get('userId');
			const url = '/users' + (userId ? '/' + userId : '');
			this.$http.get(url).then((res) => {
				const users = res.data.users;
				userId = res.data.user.id;
				Cookies.set('userId', userId);
				this.user = users.find(u => u.id == userId);
				callback(users, this.user, res.data.totalCapital);
			});
		}
		dailies(stock, callback) {
			this.$http.get('/dailies/' + stock.code).then((res) => {
				const data = res.data;
				data.forEach(d => d.date = new Date(d.date));
				this.withMa(data, stock.defaultMa, true).withMa(data, 20).withMa(data, 60).withMa(data, 120); //.lsr(data);
				const last = data[data.length - 1];
				//if (last.lsr > -20 && last.lsr < 20)
				//console.log(`${code} ${last.lsr}`);
				callback(data);
			});
		}
		withMa(data, period, defaulted) {
			data.forEach((day, index) => {
				if (index < period - 1) return null;
				const ma = (data.slice(index - period + 1, index + 1).reduce((sum, curr) => sum + curr.close, 0) / period).scale(2);
				if (defaulted) day.ma = ma;
				else day['ma' + period] = ma;
			});
			return this;
		}
		lsr(data) {
			data.forEach((day) => {
				if (!day.ma20 || !day.ma60 || !day.ma120) return null;
				day.lsr = parseFloat([(day.ma20 - day.ma60), (day.ma60 - day.ma120)].reduce((sum, diff) => sum + (diff > 0 ? diff : -diff), 0).scale(2));
				day.lsr = (day.ma20 > day.ma60 && day.ma60 > day.ma120 && day.ma20 > day.ma120) ? day.lsr : -day.lsr;
			});
		}
		simulate(codes, money, params, callback) {
			const data = { codes, money, params };
			this.$http.post('/simulate', data).then((res) => {
				if (callback) callback(res.data);
			});
		}
		strategies(callback) {
			this.$http.get('/simulate/strategies').then((res) => {
				if (callback) callback(res.data);
			});
		}
		notes(owner, callback) {
			owner = owner.replaceAll('/', '／');
			this.$http.get('/notes/' + owner).then((res) => {
				const notes = res.data;
				this.$root.$broadcast('notesLoaded', notes);
				if (callback) callback(notes);
			});
		}
		logs(callback) {
			this.$http.get('/logs').then((res) => {
				const today = new Date();
				res.data = res.data.filter(l => today.isSameDay(l.date));
				const seen = new Set();
				const logs = [];
				for (const log of res.data) {
				    log.msg = log.msg.replace(/^\[.*?\]\s*/, '');
				    if (!seen.has(log.msg)) {
				      seen.add(log.msg);
				      logs.push(log);
				    }
				}
				this.$root.$broadcast('logsLoaded', logs);
				if (callback) callback(logs);
			});
		}
		saveNote(note, callback) {
			note.owner = note.owner.replaceAll('/', '／');
			this.$http.post('/note', note).then((res) => {
				if (callback) callback(res.data);
			});
		}
		delNote(id, callback) {
			this.$http.delete('/note/' + id).then((res) => {
				if (callback) callback(res.data);
			});
		}
		backtest(stock, callback) {
			if (stock.financial && stock.financial.bullscore) {
				const symbols = stock.financial.bullscore.map(s => (s == 1) ? '🐮' : '🐼');
				stock.financial.bullscore = symbols.join('');
			}
			this.$timeout.cancel(this.backtest.timer);
			this.backtest.stocks = this.backtest.stocks || [];
			stock.callback = callback;
			if (!this.backtest.stocks.find(s => s.code == stock.code && s.callback == callback)) this.backtest.stocks.push(stock);
			this.backtest.timer = this.$timeout(() => {
				this.backtest.stocks.forEach((stock) => {
					this.$http.get(`/backtest/${stock.code}/${stock.defaultMa}`).then((res) => {
						res.data = res.data.result ? res.data.result : res.data;
						res.data.code = stock.code;
						if (stock.callback) stock.callback(res.data);
						this.$root.$broadcast('testLoaded', res.data);
					});
				});
				this.backtest.stocks = [];
			}, SEC);
		}
		getParams(callback) {
			const url = `/sys/params`;
			this.$http.get(url).then((res) => {
				if (callback) callback(res.data);
			});
		}
		saveParams(params, callback) {
			const url = `/sys/params`;
			this.$http.post(url, params).then((res) => {
				if (callback) callback(res.data);
			});
		}
		debounce(fn, delay = 1000) {
			let timer = null;
			return (...args) => {
				this.$timeout.cancel(timer);
				timer = this.$timeout(() => {
					fn(...args);
				}, delay);
			}
		}
	};

	app.factory('service', ['$http', '$timeout', '$rootScope', function($http, $timeout, $rootScope) {
		return new Service($http, $timeout, $rootScope);
	}]);
	///////////////////////////////////////////////////////////////////////////////
	const dt = function() {
		return function(input) {
			if (!input) return input;
			if (angular.isString()) {
				if (!input.includes('T')) return input;
				input = input.replace('.000Z', '');
			}
			const date = new Date(input);
			input = date.toLocaleString();
			return input.split(' ')[0];
		};
	};
	const pct = function() {
		return function(input) {
			const value = parseFloat(input);
			return Number.isFinite(value) ? (value * 100).scale(2) : '';
		};
	};
	app.filter('dt', dt);
	app.filter('pct', pct);
	///////////////////////////////////////////////////////////////////////////////
	const controllers = {
		index: function($$, $location, $timeout, service) {
			$$.name = '發財 APP';
			$$.mas = [...Array(30).keys()].map(i => i + 16);
			$$.stocks = [];
			$$.invested = {
				date: new Date(),
				totalCapital: 0,
				cost: 0,
				profit: 0,
				diffRate: 0,
				profitRate: 0,
				stocks: []
			};
			$$.add = {
				blank: function() {
					this.save.result = '';
					$.blockUI({
						message: $('#stock-form'),
						onOverlayClick: $.unblockUI
					});
				},
				save: function() {
					if (!this.code) $.unblockUI();
					if ($$.stocks.find(s => s.code == this.code)) {
						return $location.url('/stock/' + this.code);
					}
					service.add(this, (stock) => {
						if (stock.error) return this.save.result = stock.error;
						this.save.result = `成功加入 ${stock.code} ${stock.name}`;
						service.stocks((stocks) => {
							$$.stocks = stocks;
						});
						service.sync(this.code, (test) => {
							$$.$broadcast('testLoaded', test);
						});
					});
				}
			};
			$$.sql = {
				show: function() {
					this.result = $('#sql-result');
					$.blockUI({
						message: $('#sql-form'),
						onOverlayClick: $.unblockUI
					});
				},
				exec: function() {
					this.result.css('height', '0px');
					service.sql(this.commands, (data) => {
						this.result.jsonBrowse(data);
						this.result.css('height', '300px');
					});
				}
			};
			$$.home = function() {
				$location.url('/');
			};
			$$.change = function() {
				$location.url('/stock/' + $$.stock.code);
			};
			$$.switch = function() {
				service.users(() => location.reload(), $$.user.id);
			};
			$$.changeMa = function() {
				$$.$broadcast('maChanged', $$.stock.defaultMa);
			};
			$$.theme = {
				list: ['rosewood', 'tavily', 'chatgpt', 'midnight', 'clover', 'canvas', 'lowkeynoodle', 'fardream', 'fullanimal', 'unfriendlyqueen', 'fancyriver'],
				current: document.documentElement.getAttribute('data-theme') || 'clover',
				change: function() {
					document.documentElement.setAttribute('data-theme', $$.theme.current);
					try { localStorage.setItem('rich-theme', $$.theme.current); } catch (e) {}
				}
			};
			try {
				const saved = localStorage.getItem('rich-theme');
				if (saved && $$.theme.list.indexOf(saved) >= 0) {
					$$.theme.current = saved;
					document.documentElement.setAttribute('data-theme', saved);
				}
			} catch (e) {}
			$$.chat = {
				messages: [],
				input: '',
				send: function() {
					const text = ($$.chat.input || '').trim();
					if (!text) return;
					$$.chat.messages.push({ from: 'user', text });
					$$.chat.input = '';
					$$.chat.messages.push({ from: 'ai', text: '（AI 功能尚未實作）' });
				},
				keypress: function(evt) {
					if (evt.keyCode === 13) $$.chat.send();
				}
			};
			$$.note = {
				edit: function(model) {
					this.model = model || {};
					this.model.owner = this.model.owner || location.pathname;
					$.blockUI({
						message: $('#note-form'),
						onOverlayClick: $.unblockUI
					});
				},
				save: function() {
					if (!this.model.title) return;
					service.saveNote(this.model, (notes) => {
						service.notes(this.model.owner);
						//this.model = {};
						$.unblockUI();
					});
				},
				destroy: function() {
					if (confirm(`確認要刪除 ${this.model.title}？`)) {
						service.delNote(this.model.id, () => {
							service.notes(location.pathname);
							$.unblockUI();
						});
					}
				}
			};
			$$.simulate = {
				stockGroups: ['我選的股票', '我的關注','可交易','全部台股','全部上市台股','全部上櫃台股','全部美股'],
				open: function() {
					let codes = $$.stocks.filter(s => s.checked).map(s => s.code).join('&');
					if ($$.simulate.stockGroup == '我選的股票' && !codes) return $.growlUI('', `請選擇至少一支股票！`);
					codes = codes || $$.simulate.stockGroup;
					window.open(`/simulate/${codes}`, `_simulate/${codes}`);
				},
				setup: function() {
					const url = $location.url();
					if (url.startsWith('/stock/')) {
						const code = url.match(/stock\/([\da-zA-Z]+)/)[1];
						return window.open(`/simulate/${code}`, `_simulate/${code}`);
					}
					const stocks = $$.stocks.filter(s => s.checked);
					$$.simulate.stockGroup = stocks.length ? '我選的股票' : '我的關注';
					$.blockUI({
						message: $('#simulate-form'),
						onOverlayClick: $.unblockUI
					});
				}
			};
			$$.$on('stockLoaded', (_, code) => {
				$$.stock = $$.stocks.find(s => s.code == code);
			});
			$$.$on('stockChecked', (_, stock) => {
				$$.stocks.find(s => s.code == stock.code).checked = stock.checked;
			});
			$$.$on('noteEditing', (_, note) => {
				$$.note.model = note;
				$$.note.edit(note);
			});
			$$.$on('testLoaded', (_, test) => {
				if (!test.code || !test.profit) return;
				const profitRate = (test.profitRate * 100).scale();
				const stock = $$.stocks.find(s => s.code == test.code);
				stock.profit = `${test.profit} ➜ ${profitRate}%`;
				stock.ma = `【${stock.defaultMa}${stock.tigerMa ? ' ' + stock.tigerMa : ''}】`;
			});
			$$.$on('inited', (_, user, totalCapital) => {
				$$.invested.totalCapital = totalCapital;
				service.strategies((strategies) => {
					const params = user.settings.params || {};
					$$.entryStrategy = { name: strategies.entryStrategies.find(s => s.key == params.entryStrategy).name, reentry: params.reentry, weekly: params.weekly };
					$$.exitStrategy = { name: params.exitStrategy.map(strategy => strategies.exitStrategies.find(s => s.key == strategy).name).join('＆') };
					if ($$.exitStrategy.name.includes('動態止盈止損')) {
						$$.exitStrategy.dynamicStop = true;
						$$.exitStrategy.stopLossPct = params.stopLossPct * 100;
						$$.exitStrategy.takeProfitPct = params.takeProfitPct * 100;
					}
					[$$.entryStrategy, $$.exitStrategy].filter(s => s.name.includes('ADX')).forEach(s => {
						s.adxRate = params.adxRate * 100;
						s.drawdownRate = params.drawdownRate * 100;
						s.raiseRate = params.raiseRate * 100;
					});
					if (!$$.$$phase) $$.$apply();
				});
			});
			service.users((users, user, totalCapital) => {
				$$.users = users;
				$$.user = user;
				service.stocks((stocks) => $$.stocks = stocks);
				$timeout(() => $$.$broadcast('inited', user, totalCapital), 150);
			});
		},
		home: function($$, $location, $timeout, service) {
			$$.blocks = {};
			$$.stareds = [];
			$$.openeds = [];
			$$.todays = [];
			$$.closeds = [];
			$$.bulls = [];
			$$.strategyNames = {
				AdxEntry: 'ADX',
				MacdEntry: 'MACD',
				MacdMixEntry: 'MACD 混',
				AdxMacdEntryExit: 'ADX+MACD',
				TwoDaysUpEntry: '二日突破',
				MaCrossEntryExit: 'MA 交叉',
				WeeklyTrendEntry: '週線趨勢',
				BBEntryExit: '布林通道',
				ObvMacdEntryExit: 'OBV+MACD',
				TigerEntry: 'Tiger',
				BullTigerEntry: 'Bull Tiger'
			};
			$$.strategyPanel = {
				open: false,
				list: [
					{ rank: 1, strategy: 'MACD 週線', total: 245, rawProfit: 12921, afterTaxProfit: 12492, costRatio: '3.3%', winRate: '53.9%', profitFactor: 3.98, afterTaxPerTrade: 51.06 },
					{ rank: 2, strategy: 'ADX 週線', total: 138, rawProfit: 5698, afterTaxProfit: 5457, costRatio: '4.2%', winRate: '60.1%', profitFactor: 2.80, afterTaxPerTrade: 39.50 },
					{ rank: 3, strategy: 'ADX+MACD 週線', total: 220, rawProfit: 9025, afterTaxProfit: 8640, costRatio: '4.3%', winRate: '54.1%', profitFactor: 3.31, afterTaxPerTrade: 39.30 },
					{ rank: 4, strategy: 'MA 交叉週線', total: 366, rawProfit: 12153, afterTaxProfit: 11513, costRatio: '5.3%', winRate: '48.4%', profitFactor: 3.01, afterTaxPerTrade: 31.43 },
					{ rank: 5, strategy: '週線趨勢', total: 116, rawProfit: 2958, afterTaxProfit: 2755, costRatio: '6.9%', winRate: '48.3%', profitFactor: 4.14, afterTaxPerTrade: 23.75 },
					{ rank: 6, strategy: '二日突破週線', total: 695, rawProfit: 16018, afterTaxProfit: 14802, costRatio: '7.6%', winRate: '35.1%', profitFactor: 2.59, afterTaxPerTrade: 21.30 },
					{ rank: 7, strategy: '布林通道週線', total: 55, rawProfit: 498, afterTaxProfit: 402, costRatio: '19.3%', winRate: '41.8%', profitFactor: 2.16, afterTaxPerTrade: 7.31 }
				]
			};
			$$.openStrategyPanel = function(stock, evt) {
				if (evt && evt.stopPropagation) evt.stopPropagation();
				stock._strategyOpen = !stock._strategyOpen;
				if (stock._strategyOpen && !stock._strategiesLoaded) {
					$$.loadStrategies(stock);
				}
			};
			$$.loadStrategies = function(stock) {
				stock._strategiesLoading = true;
				stock._strategiesLoaded = false;
				setTimeout(function() {
					stock._strategies = $$.strategyPanel.list;
					stock._strategiesLoading = false;
					stock._strategiesLoaded = true;
					if (!$$.$$phase) $$.$apply();
				}, 600);
			};
			$$.reloadStrategies = function(stock, evt) {
				if (evt && evt.stopPropagation) evt.stopPropagation();
				stock._strategiesLoaded = false;
				$$.loadStrategies(stock);
			};
			$$.selectStrategy = function(stock, s, evt) {
				if (evt && evt.stopPropagation) evt.stopPropagation();
				console.log('[strategyPanel] selectStrategy', stock.code, s.strategy);
				stock._strategyOpen = false;
			};
			$$.invested = {  // 已經購買的股票紀錄
				date: new Date(),
				totalCapital: 0,
				cost: 0,
				profit: 0,
				diffRate: 0,
				profitRate: 0,
				stocks: []
			};
			// Master 的股票交易紀錄
			$$.shadowed = Object.assign({}, $$.invested, { stocks: [] });
			$$.changeTo = function(code) {
				window.open(`/stock/${code}`, `_stock/${code}`);
			};
			$$.edit = function(note) {
				$$.$emit('noteEditing', note);
			};
			$$.realtime = function() {
				if ($location.url() !== '/') return;
				service.realtime('all', realtimes => {
					const stocks = $$.stareds.concat($$.openeds, $$.todays, $$.closeds, $$.bulls);
					realtimes.forEach(realtime => {
						if (!realtime.open) return;
						const stock = stocks.find(s => s.code == realtime.code);
						if (stock) {
							stock.realtime = realtime;
							if (stock.trade && !stock.trade.exitDate) {
								const entryPrice = stock.trade.entryPrice;
								stock.realtime.profitRate = (realtime.close - entryPrice) / entryPrice;
							}
						}
					});
					const isAfterTrading = new Date().isAfterTrading();
					if (!isAfterTrading) service.stocks(); // triger stocks backtest
					$timeout($$.realtime, (isAfterTrading ? 180 : 30) * SEC);
				});
			};
			$$.financial = function(stock, evt) {
				if (!stock.financial || !stock.financial['本益比']) return;
				const title = ['近一季EPS', '近四季EPS', '季成長率', '毛利率', '營益率', '淨利率', '月增率', '年增率', '近四季ROE', '近四季ROA', '本益比', '股淨比'].map(k => `${k}：${stock.financial[k]}`);
				evt.target.title = title.join('\n');
			};
			$$.invest = function(stock) {
				service.dailies(stock, (dailies) => {
					stock.trade.invest = new AdxInvest(dailies, stock.defaultMa).start(stock.trade);
					if (!$$.invested.stocks.find(i => i.code == stock.code)) {
						$$.invested.stocks.push({ code: stock.code, invest: stock.trade.invest });
						$$.invested.profit += stock.trade.invest.netProfit;
						// 尚未被模擬賣出
						if (!stock.trade.invest.totalInvested) return $$.invested.cost += stock.trade.logs.filter(l => l.act == '買入').reduce((sum, l) => sum + (l.price * l.amount), 0);
						$$.invested.cost += stock.trade.invest.avgCost * stock.trade.invest.totalInvested;
						$$.invested.profitRate = $$.invested.profit / $$.invested.cost;
					}
				});
			};
			$$.shadow = function(stock) {
				service.dailies(stock, (dailies) => {
					stock.shadow.invest = new AdxInvest(dailies, stock.defaultMa).start(stock.shadow);
					if (!$$.shadowed.stocks.find(i => i.code == stock.code)) {
						$$.shadowed.stocks.push({ code: stock.code, invest: stock.shadow.invest });
						$$.shadowed.profit += stock.shadow.invest.netProfit;
						// 尚未被模擬賣出
						if (!stock.shadow.invest.totalInvested) return $$.shadowed.cost += stock.shadow.logs.filter(l => l.act == '買入').reduce((sum, l) => sum + (l.price * l.amount), 0);
						$$.shadowed.cost += stock.shadow.invest.avgCost * stock.shadow.invest.totalInvested;
						$$.shadowed.profitRate = $$.shadowed.profit / $$.shadowed.cost;
						$$.invested.diffRate = $$.invested.profitRate - $$.shadowed.profitRate;
					}
				});
			};
			$$.showTrades = function(shadow) {
				$$.trades = [];
				$$.trades.netProfit = 0;
				$$.trades.totalDividend = 0;
				const calTrade = function(stock, dailies, trade) {
					const invest = new AdxInvest(dailies, trade.ma).start(trade);
					$$.trades.push({ ...stock, ...invest });
					$$.trades.netProfit += invest.netProfit;
					$$.trades.netProfitRate = $$.trades.netProfit / $$.invested.totalCapital;
				}
				service.trades({ shadow }, (trades) => {
					trades.forEach(trade => {
						const stock = { code: trade.code, name: trade.name };
						if (trade.type == 'dividend') {
							$$.trades.totalDividend += trade.payment;
							return $$.trades.push({ ...stock, ...trade });
						}
						if (!trade.exitDate) return service.dailies(stock, (dailies) => calTrade(stock, dailies, trade));
						calTrade(stock, [], trade);
					});
				});
				$.blockUI({
					message: $('#trades-block'),
					onOverlayClick: $.unblockUI,
					css: { width: '70%', height: '60%', left: '15%', top: '20%' }
				});
			};
			$$.showStareds = function(user) {
				const stareds = (user.settings || {
					stared: []
				}).stared;
				$$.stareds = $$.stocks.filter(s => stareds.find(ss => ss == s.code));
				$timeout($$.realtime, 3 * SEC);
				$$.blocks['❤️ 我的關注'] = $$.stareds;
				$$.blocks['🧨 今日清倉'] = $$.todays;
				$$.blocks['📣 可交易'] = $$.openeds;
				$$.blocks['🧹 近兩週已清倉'] = $$.closeds;
				$$.blocks['🐮 牛氣沖天'] = $$.bulls;
			};
			$$.resort = service.debounce(() => {
				const INVESTED = 10000000000;
				$$.stareds = $$.stareds.sort((a, b) => (Date.parse(b.trade?.entryDate || 0) + (b.trade?.invest ? INVESTED : 0)) - (Date.parse(a.trade?.entryDate || 0) + (a.trade?.invest ? INVESTED : 0)));
				$$.openeds = $$.openeds.sort((a, b) => Date.parse(b.trade?.entryDate || 0) - Date.parse(a.trade?.entryDate || 0));
				service.trades({ shadow: true }, (trades) => {
					trades.forEach(trade => {
						if (trade.exitDate && trade.remain == 0) return; // 交易已經完成
						const stock = $$.stocks.find(s => s.code == trade.logs[0].code);
						if (!stock) return;
						stock.shadow = trade;
						$$.shadow(stock);
					});
				});
			}, 1.5 * SEC);
			$$.checked = function(stock) {
				$$.$emit('stockChecked', stock);
			};
			$$.$on('testLoaded', (_, test) => {
				if (!test.code || !test.trades) return;
				const stock = $$.stocks.find(s => s.code == test.code);
				stock.alerts = test.alerts;
				stock.winRate = test.winRate;
				stock.profitRate = test.profitRate;
				stock.expectation = test.expectation;
				const previousInvest = stock.trade && stock.trade.invest; // 保留既有 invest，避免 ng-if 閃跳
				const realTrades = (stock.trades || []).filter(t => t.entryDate);
				const realOpen = realTrades.find(t => t.remain); // 真實持倉（remain 且無 exitDate → 可交易）
				const twoWeeksAgo = new Date().addDays(-14);
				const realRecent = realOpen ? null : realTrades.find(t => t.exitDate && (new Date(t.exitDate).isToday() || new Date(t.exitDate).isAfter(twoWeeksAgo))); // 真實近期出場
				stock.trade = realOpen || realRecent; // 優先：實際 Trade（持倉 → 近期出場）→ 後備：回測
				if (stock.trade) {
					stock.trade.source = 'real';
					if (stock.trade.exitDate) stock.trade.exitDate = new Date(stock.trade.exitDate);
					stock.trade.invest = previousInvest;
					$$.invest(stock);
				}
				else {
					stock.trade = test.trades[test.trades.length - 1]; // 取最後一筆（不 pop，避免突變快取陣列）
					if (stock.trade) {
						stock.trade.source = 'backtest';
						stock.trade.entryDate = new Date(stock.trade.entryDate);
					}
				}
				const stocks = $$.stareds.concat($$.openeds, $$.todays, $$.closeds, $$.bulls);
				const isOpen = stock.trade && (stock.trade.source == 'real' ? !stock.trade.exitDate : stock.trade.status == 'open'); // 真實持倉與回測 open 皆可進，但標來源
				if (isOpen && !stocks.find(s => s.code == test.code)) $$.openeds.push(stock);
				if (stock.trade && stock.trade.source == 'real' && stock.trade.exitDate) { // 今日/近兩週：只放真實出場
					stock.trade.rsiHot = stock.trade.exitReason?.includes('過熱');
					if (!stocks.find(s => s.code == test.code) && stock.trade.exitDate.isToday()) $$.todays.push(stock);
					if (!stocks.find(s => s.code == test.code) && !stock.trade.exitDate.isToday() && stock.trade.exitDate.isAfter(twoWeeksAgo)) $$.closeds.push(stock);
				}
				if (stock.financial && stock.financial.bullscore == '🐮🐮🐮') {
					if (!$$.stareds.concat($$.openeds, $$.todays, $$.closeds).find(s => s.code == stock.code)) $$.bulls.push(stock);
				}
				$$.resort();
			});
			$$.$on('inited', (_, user, totalCapital) => {
				$$.invested.totalCapital = totalCapital;
				$$.showStareds(user);
				service.strategies((strategies) => {
					const params = user.settings.params || {};
					$$.entryStrategy = { name: strategies.entryStrategies.find(s => s.key == params.entryStrategy).name, reentry: params.reentry, weekly: params.weekly };
					const strategyBase = $$.strategyNames[$$.entryStrategy.name] || $$.entryStrategy.name || '';
					$$.strategyName = strategyBase + ($$.entryStrategy.weekly && !strategyBase.includes('週線') ? ' 週線' : '');
					$$.exitStrategy = { name: params.exitStrategy.map(strategy => strategies.exitStrategies.find(s => s.key == strategy).name).join('＆') };
					if ($$.exitStrategy.name.includes('動態止盈止損')) {
						$$.exitStrategy.dynamicStop = true;
						$$.exitStrategy.stopLossPct = params.stopLossPct * 100;
						$$.exitStrategy.takeProfitPct = params.takeProfitPct * 100;
					}
					[$$.entryStrategy, $$.exitStrategy].filter(s => s.name.includes('ADX')).forEach(s => {
						s.adxRate = params.adxRate * 100;
						s.drawdownRate = params.drawdownRate * 100;
						s.raiseRate = params.raiseRate * 100;
					});
				});
			});
			$$.$on('notesLoaded', (_, notes) => {
				$$.notes = notes;
			});
			$$.$on('logsLoaded', (_, logs) => {
				$$.logs = logs;
				$timeout(service.logs.bind(service), 30 * SEC);
			});
			$$.$on('stocksLoaded', (_, stocks) => {
				// 保留動態狀態，避免整批換新造成 re-render 與 realtime/trade/勾選遺失
				const oldByCode = new Map(($$.stocks || []).map(s => [s.code, s]));
				['realtime', 'trade', 'checked', '_strategyOpen', '_strategiesLoaded', '_strategies', 'winRate', 'profitRate', 'expectation'].forEach(key => {
					stocks.forEach(stock => {
						const old = oldByCode.get(stock.code);
						if (old && old[key] !== undefined) stock[key] = old[key];
					});
				});
				// 清單區塊改指向同一批物件，realtime 等更新才會同步到目前投資區
				const byCode = new Map(stocks.map(s => [s.code, s]));
				['stareds', 'openeds', 'todays', 'closeds', 'bulls'].forEach(key => {
					if (!$$[key].length) return;
					const mapped = $$[key].map(s => byCode.get(s.code) || s);
					$$[key].length = 0;
					$$[key].push(...mapped);
				});
				$$.stocks = stocks;
				if (!$$.stareds.length) $$.showStareds($$.user);
			});
			service.notes(location.pathname);
			service.logs();
			$timeout(() => {
				if (!$$.stareds.length) service.stocks();
			}, 750);
		},
		stock: function($$, $params, $timeout, service) {
			$$.tests = [];
			$$.tradePanelOpen = true;
			$$.strategyComparison = {
				period: '2020/01 ~ 2026/06',
				current: { name: 'MACD 週線', winRate: '53.9%', profitFactor: 3.98, afterTaxPerTrade: '+51.06' },
				loaded: false,
				loading: false,
				list: [],
				load: function() {
					if ($$.strategyComparison.loaded || $$.strategyComparison.loading) return;
					$$.strategyComparison.loading = true;
					setTimeout(function() {
						$$.strategyComparison.list = [
							{ rank: 1, strategy: 'MACD 週線', total: 245, rawProfit: 12921, afterTaxProfit: 12492, costRatio: '3.3%', winRate: '53.9%', profitFactor: 3.98, afterTaxPerTrade: '+51.06', moneyStock: '—' },
							{ rank: 2, strategy: 'ADX 週線', total: 138, rawProfit: 5698, afterTaxProfit: 5457, costRatio: '4.2%', winRate: '60.1%', profitFactor: 2.80, afterTaxPerTrade: '+39.50', moneyStock: '—' },
							{ rank: 3, strategy: 'ADX+MACD 週線', total: 220, rawProfit: 9025, afterTaxProfit: 8640, costRatio: '4.3%', winRate: '54.1%', profitFactor: 3.31, afterTaxPerTrade: '+39.30', moneyStock: '—' },
							{ rank: 4, strategy: 'MA 交叉週線', total: 366, rawProfit: 12153, afterTaxProfit: 11513, costRatio: '5.3%', winRate: '48.4%', profitFactor: 3.01, afterTaxPerTrade: '+31.43', moneyStock: '—' },
							{ rank: 5, strategy: '週線趨勢', total: 116, rawProfit: 2958, afterTaxProfit: 2755, costRatio: '6.9%', winRate: '48.3%', profitFactor: 4.14, afterTaxPerTrade: '+23.75', moneyStock: '13/23' },
							{ rank: 6, strategy: '二日突破週線', total: 695, rawProfit: 16018, afterTaxProfit: 14802, costRatio: '7.6%', winRate: '35.1%', profitFactor: 2.59, afterTaxPerTrade: '+21.30', moneyStock: '28/29' },
							{ rank: 7, strategy: '布林通道週線', total: 55, rawProfit: 498, afterTaxProfit: 402, costRatio: '19.3%', winRate: '41.8%', profitFactor: 2.16, afterTaxPerTrade: '+7.31', moneyStock: '13/21' }
						];
						$$.strategyComparison.loading = false;
						$$.strategyComparison.loaded = true;
						if (!$$.$$phase) $$.$apply();
					}, 600);
				},
				reload: function() {
					$$.strategyComparison.loaded = false;
					$$.strategyComparison.load();
				},
				select: function(s) {
					console.log('[strategyComparison] select', s.strategy);
				}
			};
			$$.$on('maChanged', (_, ma) => {
				$$.backtest(ma);
			});
			$$.star = function() {
				service.star($$.stock.code, (user) => {
					$$.stock.stared = user.settings.stared.find(s => s == $$.stock.code);
				});
			};
			$$.edit = function(note) {
				$$.$emit('noteEditing', note);
			};
			$$.backtest = function(ma) {
				if (!$$.tests.find(t => t.ma == ma)) {
					const params = {
						code: $$.stock.code,
						defaultMa: ma
					};
					service.backtest(params, (result) => {
						$$.tests.push(result);
						$$.chart.addMa(ma);
						//if (!$$.stock.trade) $$.invest.simulate(result.trades.findLast(t => t.entryDate));
					});
				}
			};
			$$.sync = function() {
				service.sync($$.stock.code, () => location.reload());
			};
			$$.invest = {
				simulate: function(trade) {
					if (!trade) return;
					trade.ma = trade.ma || $$.stock.defaultMa;
					trade.invest = new AdxInvest($$.stock.dailies, trade.ma).start(trade);
					console.log(trade.invest);
				},
				done: function(trades) {
					$$.stock.done = $$.stock.done || [];
					trades.forEach(trade => {
						const invest = new AdxInvest($$.stock.dailies, trade.ma).start(trade);
						$$.stock.done.push(invest);
					});
				},
				edit: function(log) {
					if (log.date && !log.id) return;
					this.log = log || {};
					this.log.date = this.log.date || new Date();
					this.log.amount = this.log.amount || 1000;
					this.log.price = this.log.price || $$.stock.dailies[$$.stock.dailies.length - 1].close;
					$.blockUI({
						message: $('#invest-form'),
						onOverlayClick: $.unblockUI
					});
				},
				save: function() {
					this.log.code = $$.stock.code;
					this.log.ma = $$.stock.defaultMa;
					this.log.date = new Date(this.log.date.toJSON().slice(0, 10));
					service.trade(this.log, (trade) => {
						$$.stock.trade = trade;
						$$.invest.simulate(trade);
						this.log = {};
						$.unblockUI();
					});
				},
				destroy: function() {
					if (confirm(`確認要刪除這筆 ${this.log.act}？`)) {
						this.log.destroy = true;
						service.trade(this.log, (trade) => {
							$$.stock.trade = trade;
							$$.invest.simulate(trade);
							$.unblockUI();
						});
					}
				}
			};
			$$.dividend = {
				edit: function(trade) {
					if (trade.date && !trade.id) return;
					this.trade = trade || {};
					this.trade.date = new Date(this.trade.date || new Date());
					this.trade.price = this.trade.price || 0;
					this.trade.amount = this.trade.amount || 0;
					$.blockUI({
						message: $('#dividend-form'),
						onOverlayClick: $.unblockUI
					});
				},
				save: function() {
					this.trade.stockCode = $$.stock.code;
					this.trade.payment = this.trade.price * this.trade.amount;
					service.dividend(this.trade, (trade) => {
						console.log(trade);
						$.unblockUI();
					});
				},
				destroy: function() {
					if (confirm(`確認要刪除這筆股利紀錄？`)) {
						this.trade.amount = 0;
						$$.dividend.save();
					}
				}
			};
			$$.jump = function(trade) {
				const now = new Date().getTime();
				const entryTime = Date.parse(trade.entryDate);
				const exitTime = (trade.exitDate ? Date.parse(trade.exitDate) : now) + EIGHT_HOURS * 2;
				const duration = trade.duration ? parseInt(trade.duration) : parseInt((now - entryTime) / (ONE_DAY * 2));
				$$.chart.get().xAxis[0].setExtremes(
					entryTime - duration * ONE_DAY, // 起始時間
					entryTime + duration * ONE_DAY * 2 // 結束時間
				);
				$$.chart.get().setTitle({
					text: `${trade.entryDate} ➜ ${trade.exitDate ? trade.exitDate : ''}`
				});
				const subtitle = `${trade.entryPrice} 買進` + (trade.exitDate ? `，${trade.exitPrice} 賣出 ➜ ${trade.profit}` : '');
				$$.chart.get().setSubtitle({
					text: subtitle
				});
				$('html, body').animate({
					scrollTop: $(document).height()
				}, SEC);
				$$.chart.get().xAxis[0].addPlotBand({
					from: entryTime,
					to: exitTime,
					color: '#ffe6e699',
					id: 'trade-band-' + entryTime,
				});
			};
			$$.allBand = function(test) {
				test.trades.forEach(trade => {
					const entryTime = Date.parse(trade.entryDate);
					const exitTime = (trade.exitDate ? Date.parse(trade.exitDate) : new Date()) + EIGHT_HOURS * 2;
					$$.chart.get().xAxis[0].addPlotBand({
						from: entryTime,
						to: exitTime,
						color: '#ffe6e699',
						id: 'trade-band-' + entryTime,
					});
				});
			};
			$$.checkList = {
				blank: function() {
					service.checkList('blank', (blankList) => {
						$$.blankList = blankList;
						$timeout(() => {
							$.blockUI({
								css: {
									top: '50px'
								},
								message: $('#stock-check-list'),
								onOverlayClick: $.unblockUI
							});
						}, 150);
					});
				}
			};
			$$.chartAxis = {
				//{ id: 'KDJ', visible: false, url: 'https://t.ly/01Kec' }
				//{ id: 'CCI', visible: false, url: 'https://t.ly/G4dSi' }
				all: [{
					id: 'MACD',
					visible: false,
					url: 'https://t.ly/PPRaC'
				}, {
					id: 'ADX',
					visible: false,
					url: 'https://t.ly/sgcOP'
				}, {
					id: 'Bollinger',
					visible: false,
					url: 'https://t.ly/aDzD9'
				}, {
					id: '週',
					visible: true
				},
				/* {
					id: 'CCI',
					visible: false,
					url: 'https://t.ly/G4dSi'
				}, {
					id: 'LSR',
					visible: false
				}, {
					id: 'SAR',
					visible: false,
					url: 'https://t.ly/viY8S'
				}, {
					id: 'RSI',
					visible: false,
					url: 'https://t.ly/GHeUp'
				}, {
					id: '20MA',
					visible: false
				}, {
					id: '60MA',
					visible: false
				}, {
					id: '120MA',
					visible: false
				}, {
					id: '200MA',
					visible: false
				}*/],
				toggle: function() {
					$$.chart.draw($$.chartAxis.all).addMa($$.stock.defaultMa);
				}
			};
			$$.dailies = function() {
				service.dailies($$.stock, (dailies) => {
					if (!dailies.length) return;
					$$.stock.dailies = dailies;
					$$.chart = new StockChart('stock-chart', dailies).draw($$.chartAxis.all);
					$$.backtest($$.stock.defaultMa);
					if ($$.stock.trades) {
						$$.stock.trade = $$.stock.trades.find(t => t.entryDate && !t.exitDate);
						if ($$.stock.trade) {
						$$.invest.simulate($$.stock.trade);
						$$.calcTriggers();
					}
						$$.invest.done($$.stock.trades.filter(t => t.exitDate));
						$$.dividends = $$.stock.trades.filter(t => t.type == 'dividend');
					}
					$$.realtime();
					service.trades({ code: $$.stock.code, shadow: true }, trades => {
						$$.stock.shadow = $$.stock.shadow || [];
						trades.forEach(trade => {
							const invest = new AdxInvest(dailies, trade.ma).start(trade);
							$$.stock.shadow.push(invest);
						});
					});
				});
			};
			$$.calcTriggers = function() {
				const dailies = $$.stock.dailies;
				const trade = $$.stock.trade;
				if (!dailies || !trade || !trade.invest) return;
				const adxRate = $$.params?.adxRate || 0.1;
				const drawdownRate = $$.params?.drawdownRate || 0.2;
				$$.stock.trigger = {};
				if (trade.invest.totalInvested) {
					$$.stock.trigger.sell = AdxInvest.findTriggerPrice(dailies, 'sell', trade.invest, {
						adxRate, drawdownRate, entryDate: trade.entryDate
					});
				} else {
					$$.stock.trigger.buy = AdxInvest.findTriggerPrice(dailies, 'buy', null, {
						adxRate
					});
				}
			};
			$$.realtime = function() {
				service.realtime($$.stock.code, realtimes => {
					$$.stock.realtime = realtimes[0];
					$$.chart.update($$.stock.realtime);
					$timeout($$.realtime, 30 * SEC);
				});
			};
			service.stock($params.code, (stock) => {
				$$.stock = stock;
				$$.stock.defaultMa = $params.ma || stock.defaultMa;
				if ($$.user) {
					const stareds = ($$.user.settings || {
						stared: []
					}).stared;
					$$.stock.stared = stareds.find(s => s == stock.code);
				}
				$$.dailies();
				$$.$emit('stockLoaded', stock.code);
			});
			$$.$on('notesLoaded', (_, notes) => {
				$$.notes = notes;
			});
			service.notes(location.pathname);
		},
		simulate: function($$, $location, $params, $interval, service) {
			if (!$params.codes) return $location.path('/');
			const today = new Date();
			const twoYearsAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
			$$.strategyChange = function() {
				$$.tigerChecked = $$.params.entryStrategy.includes('Tiger') || $$.exitStrategies.find(s => s.key.includes('Tiger') && s.checked);
				$$.dynamicExitChecked = $$.exitStrategies.find(s => s.key == 'DynamicStopExit').checked;
				$$.maCrossChecked = $$.params.entryStrategy.includes('MaCross') || $$.exitStrategies.find(s => s.key.includes('MaCross') && s.checked);
				$$.adxChecked = $$.params.entryStrategy.includes('Adx') || $$.exitStrategies.find(s => s.key.includes('Adx') && s.checked);
			};
			$$.saveParams = function() {
				delete $$.params.dynamic; // 動態 MA，回測專用不儲存
				delete $$.params.usingTigerMa; // 金唬 MA，回測專用不儲存
				$$.params.exitStrategy = $$.exitStrategies.filter(s => s.checked).map(s => s.key);
				service.saveParams($$.params, (result) => {
					$.growlUI('', result.success ? `參數儲存成功` : `參數儲存失敗`);
				});
			};
			$$.start = function() {
				$$.params.codes = $$.testers.filter(s => s.checked).map(s => s.code).join('&');
				$$.params.exitStrategy = $$.exitStrategies.filter(s => s.checked).map(s => s.key);
				if (!$$.params.entryStrategy || !$$.params.exitStrategy.length) return $.growlUI('', `請選擇入場策略和出場策略`);
				$$.simulating = '投資模擬回測中...';
				$$.simulated = null;
				const codes = $$.stocks.filter(s => s.checked).map(s => s.code);
				service.simulate(codes, $$.money, $$.params, (simulated) => {
					$$.simulated = simulated.data;
					$$.simulated.csv = simulated.csv;
					//console.log(simulated.data);
					const pres = {};
					$$.simulated.events.forEach(event => {
						if (event.type == 'buy') {
							event.entryDate = new Date(event.date);
							event.entryPrice = event.price;
							event.entryReason = event.reason;
							pres[event.code] = event;
						}
						else if (event.type == 'sell') {
							const pre = pres[event.code];
							event.entryDate = pre.entryDate;
							event.exitDate = new Date(event.date);
							event.entryPrice = pre.entryPrice;
							event.exitPrice = event.price;
							event.duration = (event.exitDate - pre.entryDate) / ONE_DAY;
							//event.profitRate = (event.exitPrice - event.entryPrice) / event.entryPrice;
							event.exitReason = event.reason.replace('\n', '<br/>');
						}
						else if (event.type == 'hold') {
							event.entryDate = new Date(event.date);
							event.entryPrice = event.price;
							event.entryReason = event.reason;
							event.profit = event.unrealizedProfit;
							event.profitRate = (event.lastClose - event.price) / event.price;
						}
					});
					$interval.cancel($$.start.timer);
					$$.simulating = '';
				});
				$$.start.timer = $interval(() => {
					if ($$.simulating) $$.simulating += '.';
				}, 300);
			};
			$$.open = function(event) {
				window.open(`/stock/${event.code}/${event.ma}`, `_stock/${event.code}/${event.ma}`);
			};
			$$.$watchGroup(['params.adxRate', 'params.drawdownRate', 'params.raiseRate', 'params.takeProfitPct', 'params.stopLossPct', 'params.dynamicStopPct', 'params.partialProfitPct', 'params.partialProfitRatio', 'params.maxHoldPeriod'], (data) => {
				if (!data.find(d => d)) return;
				$$.adxRate = (($$.params.adxRate || 0) * 100).toFixed() + '%';
				$$.drawdownRate = (($$.params.drawdownRate || 0) * 100).toFixed() + '%';
				$$.raiseRate = (($$.params.raiseRate || 0) * 100).toFixed() + '%';
				$$.takeProfitPct = ($$.params.takeProfitPct || 0 * 100).toFixed() + '%';
				$$.stopLossPct = ($$.params.stopLossPct || 0 * 100).toFixed() + '%';
				$$.dynamicStopPct = ($$.params.dynamicStopPct || 0 * 100).toFixed() + '%';
				$$.partialProfitPct = ($$.params.partialProfitPct || 0 * 100).toFixed() + '%';
				$$.partialProfitRatio = ($$.params.partialProfitRatio * 100).toFixed() + '%';
				$$.maxHoldPeriod = ($$.params.maxHoldPeriod).toFixed() + ' 天';
			});
			$$.$watch('maCrossChecked', (checked) => {
				if (!checked) return;
				$$.params.ma1 = $$.params.ma1 || 5;
				$$.params.ma2 = $$.params.ma2 || 20;
				$$.params.ma3 = $$.params.ma3 || 60;
				$$.params.rsiThreshold = $$.params.rsiThreshold || 80;
			});
			$$.$on('stocksLoaded', (_, stocks) => {
				$$.testers = [];
				if ($params.codes == '我的關注') {
					const stareds = $$.user.settings.stared;
					$params.codes = $$.stocks.filter(s => stareds.find(ss => ss == s.code)).map(s => s.code).join('&');
				}
				$params.codes.split('&').forEach(code => {
					stocks.find(s => s.code == code).checked = true;
					$$.testers.push(stocks.find(s => s.code == code));
				});
			});
			$$.$on('inited', (_, user, totalCapital) => {
				$$.money = totalCapital;
				service.strategies((strategies) => {
					const params = user.settings.params || {};
					$$.entryStrategies = strategies.entryStrategies;
					$$.exitStrategies = strategies.exitStrategies;
					$$.params = params;
					$$.params.entryDate = twoYearsAgo;
					$$.params.exitDate = today;
					$$.params.exitStrategy.forEach(strategy => {
						$$.exitStrategies.find(s => s.key == strategy).checked = true;
					});
					$$.params.takeProfitPct = $$.params.takeProfitPct || 0.1;
					$$.params.stopLossPct = $$.params.stopLossPct || 0.05;
					$$.params.dynamicStopPct = $$.params.dynamicStopPct || 0;
					$$.params.partialProfitPct = $$.params.partialProfitPct || 0;
					$$.params.partialProfitRatio = $$.params.partialProfitRatio || 0;
					$$.params.maxHoldPeriod = $$.params.maxHoldPeriod || 0;
					$$.strategyChange();
				});
			});
		},
	};

	app.controller('indexCtrl', ['$scope', '$location', '$timeout', 'service', controllers.index]);
	app.controller('homeCtrl', ['$scope', '$location', '$timeout', 'service', controllers.home]);
	app.controller('stockCtrl', ['$scope', '$routeParams', '$timeout', 'service', controllers.stock]);
	app.controller('simulateCtrl', ['$scope', '$location', '$routeParams', '$interval', 'service', controllers.simulate]);
	///////////////////////////////////////////////////////////////////////////////
})(window, jQuery, angular);