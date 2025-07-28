Date.prototype.isSameDay = function(other) {
	return this.toDateString() == new Date(other).toDateString();
};

Date.prototype.isToday = function() {
	return this.toDateString() == new Date().toDateString();
};

Date.prototype.addDays = function(days) {
	this.setDate(this.getDate() + days);
	return this;
};

Date.prototype.isAfter = function(other) {
	return this.getTime() > new Date(other).getTime();
};

Date.prototype.isHoliday = function() {
	return [0, 6].find(d => d == this.getDay());
};

Date.prototype.isAfterTrading = function() {
	return this.getHours() < 8 || this.getHours() > 13;
};

Number.prototype.scale = function(digits) {
	return parseFloat(this.toFixed(digits || 2));
};