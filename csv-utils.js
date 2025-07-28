import * as fs from 'fs';

import {
	parse
} from 'csv-parse/sync';
import {
	stringify
} from 'csv-stringify';

function load(filePath) {
	// 读取原始 CSV 数据
	const rawData = fs.readFileSync(filePath, 'utf-8');

	// 配置解析选项
	const parserOptions = {
		columns: true,
		relax_quotes: true,
		skip_empty_lines: true
	};

	// 解析并转换数据结构
	try {
		const rows = parse(rawData, parserOptions);
		return rows.map(row => ({
			date: new Date(row['﻿\"日期\"']),
			open: parseFloat(row.開市.replace(',', '')),
			high: parseFloat(row.高.replace(',', '')),
			low: parseFloat(row.低.replace(',', '')),
			close: parseFloat(row.收市.replace(',', '')),
			volume: parseFloat(row.成交量.replace('M', ''))
		})).reverse();
	} catch (error) {
		console.error('CSV 解析错误:', error);
		//process.exit(1);
	}
}

function writeFile(filePath, data) {
	stringify(data, {
		header: true
	}, function(err, output) {
		fs.writeFileSync(filePath, output);
	});
}

export {
	load,
	writeFile
};

// 使用示例
//const data = load('data/0050.csv');
//console.log('已加载数据条目:', data.slice(0, 20));