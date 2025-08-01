import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import yahooFinance from 'yahoo-finance2';
import { Crawler } from '../stock-crawler.js';

// 1. Crawler.fetchMeta uses correct codes and returns first quote

test('Crawler.fetchMeta returns first quote for numeric stock code', async () => {
  const crawler = new Crawler({ code: '1234', otc: false, country: 'tw' });
  let receivedCodes;
  yahooFinance.quote = async codes => {
    receivedCodes = codes;
    return [{ symbol: '1234.TW' }, { symbol: '1234.TWO' }];
  };
  const quote = await crawler.fetchMeta();
  assert.deepStrictEqual(receivedCodes, ['1234.TW', '1234.TWO']);
  assert.deepStrictEqual(quote, { symbol: '1234.TW' });
});

// 2. convertToUST converts only when market is us_market

test('convertToUST adjusts date only for us_market', () => {
  const crawler = new Crawler({ code: 'AAPL', otc: false, country: 'us' });
  const date = new Date('2024-01-01T12:00:00Z');
  const same = crawler.convertToUST('tw_market', date);
  assert.strictEqual(same.getTime(), date.getTime());
  const converted = crawler.convertToUST('us_market', date);
  const expected = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  assert.strictEqual(converted.getTime(), expected.getTime());
});

// 3. fetchTw parses daily data correctly

test('fetchTw parses API response into structured data', async () => {
  const crawler = new Crawler({ code: '1234', otc: false, country: 'tw' });
  axios.get = async () => ({
    data: {
      stat: 'OK',
      total: 2,
      data: [
        ['113/01/02', '10,000', '1,000', '100', '110', '90', '105', '+5', '1'],
        ['113/01/03', '20,000', '2,000', '105', '115', '95', '110', '+5', '2']
      ]
    }
  });
  const result = await crawler.fetchTw('20240101');
  assert.strictEqual(result.stockNo, '1234');
  assert.strictEqual(result.data.length, 2);
  assert.strictEqual(result.data[0].open, 100);
  assert.strictEqual(result.data[1].close, 110);
  assert.ok(result.dateRange.start instanceof Date);
  assert.ok(result.dateRange.end instanceof Date);
});

