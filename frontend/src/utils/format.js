function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatNumber(value, maximumFractionDigits = 0) {
  return isNumber(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value) : '—';
}

export function formatPercent(value, maximumFractionDigits = 1) {
  return isNumber(value) ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits }).format(value) : '—';
}

export function formatScore(value, digits = 3) {
  return isNumber(value) ? value.toFixed(digits) : '—';
}

export function formatCurrency(value) {
  return isNumber(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : '—';
}
