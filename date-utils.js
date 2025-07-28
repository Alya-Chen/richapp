// 轉換民國年日期格式 (例: 112/01/01 → 2023-01-01)
function convertTwDate(twDateStr) {
	const [year, month, day] = twDateStr.split('/');
	const gregorianYear = parseInt(year) + 1911;
	return new Date(`${gregorianYear}-${month}-${day}`);
}

// 驗證日期格式 (YYYYMMDD)
function isValid(dateStr) {
	return /^\d{8}$/.test(dateStr) && !isNaN(new Date(dateStr.slice(0, 4), dateStr.slice(4, 6) - 1, dateStr.slice(6, 8)));
}

export {
	convertTwDate,
	isValid
};