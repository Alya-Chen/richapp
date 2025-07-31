import test from 'node:test';
import assert from 'node:assert/strict';
import '../static/js/lang.js';
import { Macd, Kdj, ExitAlert } from '../static/js/macd-kdj.js';

// 1. Macd.calculateEMA returns correct values

test('Macd.calculateEMA returns expected values', () => {
  const macd = new Macd([]);
  const result = macd.calculateEMA([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(result, [null, null, 2, 3, 4]);
});

// 2. Macd.detectCrossovers marks golden and dead correctly

test('Macd.detectCrossovers marks golden and dead correctly', () => {
  const macd = new Macd([]);
  const diffArray = [
    { diff: -1, dea: 0 },
    { diff: 1, dea: 0.5 },
    { diff: 0.3, dea: 0.5 }
  ];
  macd.detectCrossovers(diffArray);
  assert.strictEqual(diffArray[1].golden, true);
  assert.strictEqual(diffArray[2].dead, true);
});

// 3. Kdj.calculate produces expected K, D, J values for period 3

test('Kdj.calculate outputs expected k, d, and j', () => {
  const data = [
    { high: 100, low: 0, close: 20 },
    { high: 100, low: 0, close: 30 },
    { high: 100, low: 0, close: 50 },
    { high: 100, low: 0, close: 80 },
    { high: 100, low: 0, close: 40 }
  ];
  const kdj = new Kdj(data, { period: 3, k: 3, d: 3 });
  const res = kdj.calculate();
  assert.strictEqual(res[2].k, 50);
  assert.strictEqual(res[2].d, 50);
  assert.strictEqual(res[2].j, 50);
  assert.ok(Math.abs(res[3].k - 60) < 1e-12);
  assert.ok(Math.abs(res[3].d - 53.333333333333336) < 1e-12);
  assert.ok(Math.abs(res[3].j - 73.33333333333333) < 1e-12);
  assert.ok(Math.abs(res[4].k - 53.333333333333336) < 1e-12);
  assert.ok(Math.abs(res[4].d - 53.333333333333336) < 1e-12);
  assert.ok(Math.abs(res[4].j - 53.333333333333336) < 1e-12);
});

// 4. Kdj.detectCrossovers flags dead when k drops below 90 from above

test('Kdj.detectCrossovers flags dead crossover', () => {
  const kdj = new Kdj([]);
  const arr = [{ k: 95 }, { k: 85 }];
  kdj.detectCrossovers(arr);
  assert.strictEqual(arr[1].dead, true);
});

// 5. ExitAlert.calcATR computes ATR for small dataset

test('ExitAlert.calcATR computes correct ATR', () => {
  const data = [
    { high: 10, low: 5, close: 7 },
    { high: 11, low: 6, close: 10 },
    { high: 12, low: 8, close: 9 },
    { high: 15, low: 10, close: 14 }
  ];
  const exit = new ExitAlert(data);
  const atr = exit.calcATR(data, 3);
  assert.strictEqual(atr, 5);
});

