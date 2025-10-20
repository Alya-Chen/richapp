import {
	Sequelize,
	DataTypes,
	Op
} from 'sequelize';

// 初始化數據庫連接
const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: './stock-sqlite.db',
	logging: false // 關閉原始SQL日志
});

// 定義數據模型
const Base = {
	save: async function(dao, entity) {
		const loaded = !entity.id ? null : await dao.findOne({
			where: {
				id: entity.id
			}
		});
		if (loaded) {
			loaded.set(entity);
			return await loaded.save();
		} else {
			entity = await dao.create(entity);
			return await entity.save();
		}
	},
	del: async function(dao, id) {
		return await dao.destroy({ where: { id } });
	}
};

const User = sequelize.define('User', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '用戶名稱'
	},
	settings: {
		type: DataTypes.JSON,
		allowNull: true,
		comment: '偏好設定'
	}
}, {
	indexes: [{
		unique: true,
		fields: ['name'] // 複合唯一索引
	}],
	timestamps: false // 不使用Sequelize自帶時間戳
});

User.save = async function(user) {
	return Base.save(User, user);
};

const Note = sequelize.define('Note', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	owner: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '擁有者'
	},
	title: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '標題'
	},
	content: {
		type: DataTypes.STRING,
		allowNull: true,
		comment: '內容'
	},
	date: {
		type: DataTypes.DATE,
		defaultValue: DataTypes.NOW,
		comment: '建立時間'
	}
}, {
	timestamps: false // 不使用Sequelize自帶時間戳
});

Note.save = async function(note) {
	return Base.save(Note, note);
};

Note.del = async function(id) {
	return Base.del(Note, id);
};

Note.findByOwner = async function(owner) {
	return Note.findAll({
		where: {
			owner
		},
		order: [
			['date', 'DESC']
		]
	});
};

const Stock = sequelize.define('Stock', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	code: {
		type: DataTypes.STRING(10),
		allowNull: false,
		comment: '股票代號'
	},
	country: {
		type: DataTypes.STRING(10),
		allowNull: false,
		defaultValue: 'tw',
		comment: '國別代號'
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '股票名稱'
	},
	defaultMa: {
		type: DataTypes.INTEGER,
		allowNull: true,
		comment: '金唬男 MA 值'
	},
	tigerMa: {
		type: DataTypes.STRING(10),
		defaultValue: 16,
		comment: '預設 MA 值'
	},
	otc: {
		type: DataTypes.BOOLEAN,
		defaultValue: false,
		comment: '上櫃股票'
	},
	financial: {
		type: DataTypes.JSON,
		allowNull: true,
		comment: '財報資料'
	}
}, {
	indexes: [{
		unique: true,
		fields: ['code'] // 複合唯一索引
	}],
	timestamps: false // 不使用Sequelize自帶時間戳
});

Stock.findByCode = async function(code) {
	return Stock.findOne({
		where: {
			code
		}
	});
};

Stock.save = async function(stock) {
	return Base.save(Stock, stock);
};

Stock.trades = async function(where) {
	where = Object.assign({}, where);
	const trades = await StockTrade.findAll({
		where,
		order: [
			['id', 'ASC']
		]
	});
	const result = [];
	trades.forEach(t => {
		let trade = { logs: [] };
		if (t.act == '買入') {
			trade.entryDate = t.date;
			trade.ma = t.ma;
			result.push(trade);
		}
		if (t.act == '賣出') {
			trade = result.findLast(t => !t.exitDate);
			trade.exitDate = t.date;
		}
		trade.logs.push(t.toJSON());
	});
	return result;
};

const StockTrade = sequelize.define('StockTrade', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	code: {
		type: DataTypes.STRING(10),
		allowNull: false,
		comment: '股票代號'
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false,
		comment: '使用者流水號'
	},
	shadow: {
		type: DataTypes.BOOLEAN,
		defaultValue: false,
		comment: '是否為影子使用者'
	},
	act: {
		type: DataTypes.STRING(5),
		allowNull: false,
		comment: '買進賣出'
	},
	ma: {
		type: DataTypes.INTEGER,
		allowNull: true,
		comment: 'MA 值'
	},
	date: {
		type: DataTypes.DATEONLY,
		allowNull: false,
		comment: '交易日期'
	},
	price: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '交易價'
	},
	tax: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '交易價'
	},
	amount: {
		type: DataTypes.INTEGER,
		allowNull: false,
		comment: '買賣股數'
	},
	remain: {
		type: DataTypes.INTEGER,
		defaultValue: 0,
		comment: '剩餘股數'
	}
}, {
	indexes: [{
		unique: false,
		fields: ['userId']
	}, {
		unique: false,
		fields: ['code']
	}, {
		unique: false,
		fields: ['date']
	}],
	timestamps: false // 不使用Sequelize自帶時間戳
});

StockTrade.save = async function(trade) {
	// 股票買進：證券手續費＝股票買進股價 × 股數 × 0.1425%
	// 未滿新臺幣20元按新臺幣20元計收
	if (trade.act == '買入') {
		trade.remain = trade.amount;
		trade.tax = trade.amount * trade.price * 0.001425;
		trade.tax = Math.max(trade.tax, 20).scale(2);
	}
	// 證券手續費＋證券交易稅＝（股票賣出股價 × 股數 × 0.1425%）＋（股票賣出股價 × 股數 × 0.3%）
	if (trade.act == '賣出') {
		trade.tax = (trade.amount * trade.price * 0.004425).scale(2);
	}
	return Base.save(StockTrade, trade);
};

StockTrade.del = async function(id) {
	return Base.del(StockTrade, id);
};

const StockDaily = sequelize.define('StockDaily', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	code: {
		type: DataTypes.STRING(10),
		allowNull: false,
		comment: '股票代號'
	},
	date: {
		type: DataTypes.DATEONLY,
		allowNull: false,
		comment: '交易日期'
	},
	open: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '開盤價'
	},
	high: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '最高價'
	},
	low: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '最低價'
	},
	close: {
		type: DataTypes.FLOAT,
		allowNull: false,
		comment: '收盤價'
	},
	volume: {
		type: DataTypes.INTEGER,
		allowNull: false,
		comment: '成交量'
	},
	diff: {
		type: DataTypes.FLOAT,
		comment: '漲跌價差'
	}
}, {
	indexes: [{
		unique: true,
		fields: ['code', 'date'] // 複合唯一索引
	}, {
		unique: false,
		fields: ['code']
	}, {
		unique: false,
		fields: ['date']
	}],
	timestamps: false // 不使用Sequelize自帶時間戳
});

// 批量保存股票數據
StockDaily.saveAll = async function(code, data) {
	try {
		const records = data.map(item => ({
			code,
			open: item.open || 0,
			...item
		}));

		// 使用 bulkCreate 的 updateOnDuplicate 功能
		const result = await StockDaily.bulkCreate(records, {
			updateOnDuplicate: ['open', 'high', 'low', 'close', 'volume', 'diff'],
			conflictFields: ['code', 'date']
		});

		console.log(`成功寫入/更新 ${result.length} 條股票交易記錄`);
		return result;
	} catch (error) {
		console.error('保存股票交易記錄失敗：', error.message);
		throw error;
	}
};

StockDaily.save = async function(daily) {
	const loaded = await StockDaily.query(daily.code, daily.date, daily.date);
	if (loaded.length) {
		loaded[0].set(daily);
		return await loaded[0].save();
	} else {
		try {
			daily = await StockDaily.create(daily);
			return await daily.save();
		} catch (error) {
			console.error(daily);
			console.error('保存 StockDaily 失敗:', error.message);
		}
	}
};

StockDaily.query = async function(code, startDate, endDate) {
	return StockDaily.findAll({
		where: {
			code,
			date: {
				[Op.between]: [startDate, endDate]
			}
		},
		order: [
			['date', 'ASC']
		]
	});
};

StockDaily.last = async function(code) {
	if (code) {
		return StockDaily.findOne({
			where: {
				code
			},
			order: [
				['date', 'DESC']
			]
		});
	}
	else {
		const latest = await StockDaily.findAll({
			attributes: ['code', [sequelize.fn('MAX', sequelize.col('date')), 'max_date']],
			group: ['code'],
			raw: true
		});
		// 將結果轉成條件
		const conditions = latest.map(item => ({
			code: item.code,
			date: item.max_date
		}));
		return await StockDaily.findAll({
			where: {
				[Op.or]: conditions
			}
		});
	}
};

const Backtest = sequelize.define('Backtest', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	code: {
		type: DataTypes.STRING(10),
		allowNull: false,
		comment: '股票代號'
	},
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false,
		comment: '使用者流水號'
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '股票名稱'
	},
	ma: {
		type: DataTypes.INTEGER,
		defaultValue: 16,
		comment: '測試的 MA 值'
	},
	params: {
		type: DataTypes.JSON,
		allowNull: false,
		comment: '測試參數'
	},
	startDate: {
		type: DataTypes.DATEONLY,
		allowNull: false,
		comment: '起始日期'
	},
	endDate: {
		type: DataTypes.DATEONLY,
		allowNull: false,
		comment: '結束日期'
	},
	profit: {
		type: DataTypes.FLOAT,
		comment: '利潤'
	},
	profitRate: {
		type: DataTypes.FLOAT,
		comment: '利潤率'
	},
	result: {
		type: DataTypes.JSON,
		allowNull: true,
		comment: '測試結果'
	},
	opened: {
		type: DataTypes.BOOLEAN,
		defaultValue: false,
		comment: '是否有執行中的交易'
	},
	lastModified: {
		type: DataTypes.DATE,
		defaultValue: DataTypes.NOW,
		comment: '修改時間'
	}
}, {
	indexes: [{
		unique: true,
		fields: ['code', 'userId'] // 複合唯一索引
	}],
	timestamps: false // 不使用Sequelize自帶時間戳
});

Backtest.save = async function(test) {
	return Base.save(Backtest, test);
};

const Log = sequelize.define('Log', {
	id: {
		type: DataTypes.INTEGER,
		autoIncrement: true,
		primaryKey: true,
	},
	level: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '等級'
	},
	msg: {
		type: DataTypes.STRING,
		allowNull: false,
		comment: '訊息'
	},
	date: {
		type: DataTypes.DATE,
		defaultValue: DataTypes.NOW,
		comment: '建立時間'
	}
}, {
	timestamps: false // 不使用Sequelize自帶時間戳
});

Log.info = async function(msg) {
	msg = `[${new Date().toLocaleString()}] ${msg}`;
	console.log(msg);
	return Base.save(Log, { level: 'info', msg });
};

Log.error = async function(msg) {
	msg = `[${new Date().toLocaleString()}] ${msg}`;
	console.error(msg);
	return Base.save(Log, { level: 'error', msg });
};

Log.last = async function(limit) {
	return Log.findAll({
		limit: limit || 10,
		order: [
			['date', 'DESC']
		]
	});
};

// 初始化數據庫
async function initDb() {
	try {
		await sequelize.authenticate();
		await sequelize.sync({
			force: false
		}); // true會重置表結構
		console.log('數據庫連接成功');
		return true;
	} catch (error) {
		console.error('數據庫初始化失敗:', error.message);
		return false;
	}
}

//StockTrade,
export {
	User,
	Stock,
	StockDaily,
	StockTrade,
	Backtest,
	Note,
	Log,
	initDb
};