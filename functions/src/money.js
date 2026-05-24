function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function paise(value) {
  return Math.round(money(value) * 100);
}

module.exports = {
  money,
  paise
};
