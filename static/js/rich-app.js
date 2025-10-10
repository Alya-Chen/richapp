(function(window, $, angular) {
	'use strict';

	const SEC = 1000;
	const EIGHT_HOURS = 8 * 3600 * SEC;
	const ONE_DAY = 3 * EIGHT_HOURS;
	const TOTAL_CAPITAL = 555022;

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
			this.$http.get('/sync/' + code).then((res) => {
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
		trade(stock, callback) {
			stock.trade.logs = stock.trade.logs.filter(l => l.id);
			this.$http.post(`/stock/${stock.code}/trade`, stock.trade).then((res) => {
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
				const stocks = res.data;
				stocks.forEach(stock => this.backtest(stock));
				if (callback) callback(stocks);
				this.$timeout(() => { this.$root.$broadcast('stocksLoaded', stocks) }, 175);
			});
		}
		users(callback, userId) {
			const url = '/users' + (userId ? '/' + userId : '');
			this.$http.get(url).then((res) => {
				const users = res.data.users;
				this.user = users.find(u => u.id == res.data.user.id);
				callback(users, this.user);
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
		trades(callback) {
			this.$http.get('/trades').then((res) => {
				res.data = (res.data || []).flat();
				const comparer = (a, b) => Date.parse(b.entryDate) - Date.parse(a.entryDate);
				const running = res.data.filter(t => t.entryDate && !t.exitDate).sort(comparer);
				const exited = res.data.filter(t => t.entryDate && t.exitDate).sort(comparer);
				const dividend = res.data.filter(t => t.type == 'dividend').sort(comparer);
				if (callback) callback(running.concat(exited).concat(dividend));
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
			return (parseFloat(input) * 100).scale(2);
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
			$$.home = function() {
				$location.url('/');
			};
			$$.change = function() {
				$location.url('/stock/' + $$.stock.code);
			};
			$$.switch = function() {
				service.users((_, user) => $$.$broadcast('userSwitched', user), $$.user.id);
			};
			$$.changeMa = function() {
				$$.$broadcast('maChanged', $$.stock.defaultMa);
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
						const code = url.split('/').pop();
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
			$$.$on('userSwitched', () => {
				service.stocks((stocks) => {
					$$.stocks = stocks;
				});
			});
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
			service.users((users, user) => {
				$$.users = users;
				$$.user = user;
				$timeout(() => $$.$broadcast('userSwitched', user), 150);
			});
		},
		home: function($$, $location, $timeout, service) {
			$$.blocks = {};
			$$.stareds = [];
			$$.openeds = [];
			$$.todays = [];
			$$.closeds = [];
			$$.bulls = [];
			$$.invested = {  // 已經購買的股票紀錄
				date: new Date(),
				totalCapital: TOTAL_CAPITAL,
				cost: 0,
				stocks: []
			};
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
					stock.trade.invest = new RsiInvest(dailies, stock.defaultMa).start(stock.trade);
					if (!$$.invested.stocks.find(i => i.code == stock.code)) {
						$$.invested.stocks.push({ code: stock.code, invest: stock.trade.invest });
						// 尚未被模擬賣出
						if (stock.trade.invest.totalInvested) return $$.invested.cost += stock.trade.invest.avgCost * stock.trade.invest.totalInvested;
						$$.invested.cost += stock.trade.logs.filter(l => l.act == '買入').reduce((sum, l) => sum + (l.price * l.amount), 0);
					}
				});
			};
			$$.calculate = function(stock, test) {
				const metrics = function(trades, type) {
					const wins = trades.filter(t => t.profit > 0); // 有獲利的交易數
					const profit = trades.reduce((sum, t) => sum + (t.profit > 0 ? t.profit : 0), 0);
					const loss = trades.reduce((sum, t) => sum + (t.profit < 0 ? t.profit : 0), 0);
					return {
						name: stock.name,
						type,
						length: trades.length,
                        profit: (profit + loss).scale(2),
                        pnl: (profit / Math.abs(loss || 1)).scale(2), // 盈虧比：總獲利金額除以總虧損金額
                        profitRate: (trades.reduce((sum, t) => sum + t.profitRate, 0)).scale(2),
                        winRate: (wins.length / trades.length).scale(2),
					};
				}
				const result = { re: [], first: [] };
				test.trades.forEach(trade => {
					if (trade.reentry) result.re.push(trade);
					else result.first.push(trade);
				});
				console.log(metrics(result.first, '首衝'));
				console.log(metrics(result.re, '回場'));
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
				stock.trade = (stock.trades || []).find(t => t.entryDate && !t.exitDate);
				if (stock.trade) {
					$$.invest(stock);
				}
				else {
					stock.trade = test.trades.pop();
					if (stock.trade) stock.trade.entryDate = new Date(stock.trade.entryDate);
				}
				const stocks = $$.stareds.concat($$.openeds, $$.todays, $$.closeds, $$.bulls);
				const twoWeeksAgo = new Date().addDays(-14);
				if (stock.trade && stock.trade.status == 'open' && !stocks.find(s => s.code == test.code)) $$.openeds.push(stock);
				if (stock.trade && stock.trade.exitDate) {
					stock.trade.exitDate = new Date(stock.trade.exitDate);
					stock.trade.rsiHot = stock.trade.exitReason.includes('過熱');
					if (!stocks.find(s => s.code == test.code) && stock.trade.exitDate.isToday()) $$.todays.push(stock);
					if (!stocks.find(s => s.code == test.code) && !stock.trade.exitDate.isToday() && stock.trade.exitDate.isAfter(twoWeeksAgo)) $$.closeds.push(stock);
				}
				if (stock.financial && stock.financial.bullscore == '🐮🐮🐮') {
					if (!$$.stareds.concat($$.openeds, $$.todays, $$.closeds).find(s => s.code == stock.code)) $$.bulls.push(stock);
				}
				$$.resort();
				//if ($$.stareds.find(s => s.code == test.code)) $$.calculate(stock, test);
			});
			$$.$on('userSwitched', (_, user) => {
				$$.showStareds(user);
				service.strategies((strategies) => {
					service.getParams((params) => {
						$$.entryStrategy = strategies.entryStrategies.find(s => s.key == params.entryStrategy).name;
						$$.exitStrategy = params.exitStrategy.map(strategy => strategies.exitStrategies.find(s => s.key == strategy).name).join('＆');
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
						if (!$$.stock.trade) $$.invest.simulate(result.trades.findLast(t => t.entryDate));
					});
				}
			};
			$$.invest = {
				simulate: function(trade) {
					return;
					if (!trade) return;
					trade.ma = trade.ma || $$.stock.defaultMa;
					trade.invest = new RsiInvest($$.stock.dailies, trade.ma).start(trade);
					console.log(trade.invest);
				},
				done: function(trades) {
					$$.stock.done = $$.stock.done || [];
					trades.forEach(trade => {
						const invest = new RsiInvest($$.stock.dailies, trade.ma).start(trade);
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
					this.log.id = this.log.id || new Date().getTime();
					this.log.date = new Date(this.log.date.toJSON().slice(0, 10));
					this.log.day = null;
					$$.stock.trade = $$.stock.trade || { logs: [] };
					const log = $$.stock.trade.logs.find(l => l.id == this.log.id);
					if (!log) $$.stock.trade.logs.push(this.log);
					else Object.assign(log, this.log);
					service.trade($$.stock, (trade) => {
						$$.stock.trade = trade;
						$$.invest.simulate(trade);
						this.log = {};
						$.unblockUI();
					});
				},
				destroy: function() {
					if (confirm(`確認要刪除這筆 ${this.log.act}？`)) {
						$$.stock.trade.logs = $$.stock.trade.logs.filter(t => t.id != this.log.id);
						service.trade($$.stock, (trade) => {
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
					color: '#ffe6e6',
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
						color: '#ffe6e6',
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
					id: 'CCI',
					visible: false,
					url: 'https://t.ly/G4dSi'
				}, {
					id: 'Bollinger',
					visible: false,
					url: 'https://t.ly/aDzD9'
				},
				/*{
					id: 'RSI',
					visible: false,
					url: 'https://t.ly/GHeUp'
				}, {
					id: 'LSR',
					visible: false
				},*/ {
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
				}],
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
						if ($$.stock.trade) $$.invest.simulate($$.stock.trade);
						$$.invest.done($$.stock.trades.filter(t => t.exitDate));
						$$.dividends = $$.stock.trades.filter(t => t.type == 'dividend');
					}
					$$.realtime();
				});
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
			$$.money = TOTAL_CAPITAL;
			$$.entryStrategyCheck = function() {
				$$.tigerChecked = $$.params.entryStrategy.includes('Tiger') || $$.exitStrategies.find(s => s.key.includes('Tiger') && s.checked);
			};
			$$.exitStrategyCheck = function() {
				$$.entryStrategyCheck();
				$$.dynamicExitChecked = $$.exitStrategies.find(s => s.key == 'DynamicStopExit').checked;
			};
			$$.saveParams = function() {
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
							event.profitRate = (event.exitPrice - event.entryPrice) / event.entryPrice;
							event.exitReason = event.reason.replace('\n', '<br/>');
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
			$$.$watchGroup(['params.takeProfitPct', 'params.stopLossPct', 'params.dynamicStopPct'], (data) => {
				if (!data.find(d => d)) return;
				$$.takeProfitPct = ($$.params.takeProfitPct * 100).toFixed() + '%';
				$$.stopLossPct = ($$.params.stopLossPct * 100).toFixed() + '%';
				$$.dynamicStopPct = ($$.params.dynamicStopPct * 100).toFixed() + '%';
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
			service.strategies((strategies) => {
				$$.entryStrategies = strategies.entryStrategies;
				$$.exitStrategies = strategies.exitStrategies;
				service.getParams((params) => {
					$$.params = params;
					$$.params.entryDate = twoYearsAgo;
					$$.params.exitDate = today;
					$$.params.exitStrategy.forEach(strategy => {
						$$.exitStrategies.find(s => s.key == strategy).checked = true;
					});
					$$.params.takeProfitPct = $$.params.takeProfitPct || 0.05;
					$$.params.stopLossPct = $$.params.stopLossPct || 0.03;
					$$.params.dynamicStopPct = $$.params.dynamicStopPct || 0;
					$$.exitStrategyCheck();
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