export const STORAGE_KEY = 'profit-monitor-pkmn';
export const DEFAULT_TAB_NAME = 'Default';
export const TYPE_SELL = 'Verkocht';
export const TYPE_BUY = 'Gekocht';
export const TRADE_SIDE_GIVEN = 'givenItems';
export const TRADE_SIDE_RECEIVED = 'receivedItems';
export const GRADING_COMPANY_OPTIONS = ['PSA', 'BGS', 'CGC', 'TAG'];
// Official grading scales, top grade first.
//   value: what is stored on a transaction (unique per company)
//   grade: the number printed on the slab
//   label: the grade name
// CGC and TAG both have two kinds of 10 (Pristine and Gem Mint) and Beckett
// has Black Label and Pristine 10s, so those special 10s get their own value.
// Sources: taggrading.com/pages/scale, psacard.com/gradingstandards,
// beckett.com/grading#scale, cgcgrading.com/grading-scales
function scale(entries) {
  return Object.freeze(entries.map(([value, label, grade = value]) => Object.freeze({ value, grade, label })));
}

export const GRADING_SCALE_BY_COMPANY = Object.freeze({
  PSA: scale([
    ['10', 'Gem Mint'],
    ['9', 'Mint'],
    ['8.5', 'NM-MT'],
    ['8', 'NM-MT'],
    ['7.5', 'Near Mint'],
    ['7', 'Near Mint'],
    ['6.5', 'EX-MT'],
    ['6', 'EX-MT'],
    ['5.5', 'Excellent'],
    ['5', 'Excellent'],
    ['4.5', 'VG-EX'],
    ['4', 'VG-EX'],
    ['3.5', 'Very Good'],
    ['3', 'Very Good'],
    ['2.5', 'Good'],
    ['2', 'Good'],
    ['1.5', 'Fair'],
    ['1', 'Poor'],
  ]),
  BGS: scale([
    ['10-black', 'Black Label Pristine', '10'],
    ['10', 'Pristine'],
    ['9.5', 'Gem Mint'],
    ['9', 'Mint'],
    ['8.5', 'NM-MT+'],
    ['8', 'NM-MT'],
    ['7.5', 'NM+'],
    ['7', 'NM'],
    ['6.5', 'EX-MT+'],
    ['6', 'EX-MT'],
    ['5.5', 'EX+'],
    ['5', 'EX'],
    ['4.5', 'VG-EX+'],
    ['4', 'VG-EX'],
    ['3.5', 'VG+'],
    ['3', 'VG'],
    ['2.5', 'Good+'],
    ['2', 'Good'],
    ['1.5', 'Fair'],
    ['1', 'Poor'],
  ]),
  CGC: scale([
    ['10-pristine', 'Pristine', '10'],
    ['10', 'Gem Mint'],
    ['9.5', 'Mint+'],
    ['9', 'Mint'],
    ['8.5', 'NM/Mint+'],
    ['8', 'NM/Mint'],
    ['7.5', 'Near Mint+'],
    ['7', 'Near Mint'],
    ['6.5', 'Ex/NM+'],
    ['6', 'Ex/NM'],
    ['5.5', 'Excellent+'],
    ['5', 'Excellent'],
    ['4.5', 'VG/Ex+'],
    ['4', 'VG/Ex'],
    ['3.5', 'Very Good+'],
    ['3', 'Very Good'],
    ['2.5', 'Good+'],
    ['2', 'Good'],
    ['1.5', 'Fair'],
    ['1', 'Poor'],
  ]),
  TAG: scale([
    ['10-pristine', 'Pristine', '10'],
    ['10', 'Gem Mint'],
    ['9', 'Mint'],
    ['8.5', 'NM MT+'],
    ['8', 'NM MT'],
    ['7.5', 'NM+'],
    ['7', 'NM'],
    ['6.5', 'EX MT+'],
    ['6', 'EX MT'],
    ['5.5', 'EX+'],
    ['5', 'EX'],
    ['4.5', 'VG EX+'],
    ['4', 'VG EX'],
    ['3.5', 'VG+'],
    ['3', 'VG'],
    ['2.5', 'Good+'],
    ['2', 'Good'],
    ['1.5', 'Fair'],
    ['1', 'Poor'],
  ]),
});

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Formats a Date as YYYY-MM-DD using the *local* calendar date (not UTC),
// so a sale entered at 00:30 in Amsterdam is stored under that same day.
export function localDateISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return localDateISO(date);
}

function buildValidDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject impossible dates like 2026-02-31.
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

// Excel stores dates as serial day numbers counted from 1899-12-30.
// Only values in this range (≈1927–2173) are treated as dates.
const EXCEL_SERIAL_MIN = 10000;
const EXCEL_SERIAL_MAX = 99999;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function excelSerialToISO(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value) || value < EXCEL_SERIAL_MIN || value > EXCEL_SERIAL_MAX) return null;
  const date = new Date(EXCEL_EPOCH_MS + Math.floor(value) * 86400000);
  return date.toISOString().slice(0, 10);
}

export function normalizeDate(value, fallback = todayISO()) {
  if (typeof value === 'number') {
    return excelSerialToISO(value) ?? fallback;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : localDateISO(value);
  }
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  // Excel serial number stored as text, e.g. "46022" or "46022.5"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return excelSerialToISO(trimmed) ?? fallback;
  }

  // ISO: 2026-10-26 (optionally followed by a time part)
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
  if (iso) return buildValidDate(iso[1], iso[2], iso[3]) ?? fallback;

  // Dutch/European: 26-10-2026, 26/10/2026, 26.10.2026 (day first)
  const european = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (european) return buildValidDate(european[3], european[2], european[1]) ?? fallback;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? fallback : localDateISO(parsed);
}

export function normalizeQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function normalizeTabName(name) {
  return String(name ?? '').trim();
}

export function normalizeCardKey(cardName) {
  return normalizeTabName(cardName).toLocaleLowerCase();
}

export function inferCardName(description = '') {
  const lines = String(description)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return '';

  const line = lines[0].replace(/\s+#\d+\s*$/g, '').trim();
  // Strip optional quantity prefix like "2 x", "2x", "2 X"
  const stripped = line.replace(/^\d+\s*[xX×]\s*/, '');
  return stripped.trim();
}

export function inferQuantity(description = '') {
  const lines = String(description)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) return null;

  const match = lines[0].match(/^(\d+)\s*[xX×]\s*/);
  if (!match) return null;
  const qty = Number.parseInt(match[1], 10);
  return Number.isFinite(qty) && qty > 0 ? qty : null;
}

export function normalizeAmount(type, amount) {
  const value = Math.abs(Number(amount) || 0);
  return roundMoney(type === TYPE_BUY ? -value : value);
}

export function normalizeGradingCompany(value) {
  const company = String(value ?? '').trim().toUpperCase();
  return GRADING_COMPANY_OPTIONS.includes(company) ? company : '';
}

export function getGradingScale(company) {
  const normalizedCompany = normalizeGradingCompany(company);
  return GRADING_SCALE_BY_COMPANY[normalizedCompany] ?? [];
}

export function normalizeGradingValue(company, value) {
  const gradingValue = String(value ?? '').trim();
  if (!gradingValue) return '';
  const allowed = getGradingScale(company);
  return allowed.some(option => option.value === gradingValue) ? gradingValue : '';
}

// The number printed on the slab for a stored value ("10-pristine" -> "10").
export function getGradeNumber(company, value) {
  const normalizedValue = normalizeGradingValue(company, value);
  if (!normalizedValue) return '';
  const option = getGradingScale(company).find(item => item.value === normalizedValue);
  return option?.grade ?? normalizedValue;
}

// Human-readable grade, e.g. "PSA 10 · Gem Mint" or "CGC 10 · Pristine".
export function formatGrade(company, value) {
  const grade = getGradeNumber(company, value);
  if (!grade) return '';
  const label = getGradeLabel(company, value);
  return `${normalizeGradingCompany(company)} ${grade}${label ? ` · ${label}` : ''}`;
}

export function getGradeLabel(company, value) {
  const normalizedValue = normalizeGradingValue(company, value);
  if (!normalizedValue) return '';
  const option = getGradingScale(company).find(item => item.value === normalizedValue);
  return option?.label ?? '';
}

export function normalizeTransaction(transaction = {}, options = {}) {
  const type = transaction.type === TYPE_BUY ? TYPE_BUY : TYPE_SELL;
  const description = String(transaction.description ?? '').trim();
  // Only auto-infer card name when cardName is absent (null/undefined).
  // An explicitly empty string means "no card name" (user chose not to associate one).
  const cardName = transaction.cardName != null
    ? normalizeTabName(transaction.cardName)
    : inferCardName(description);
  const gradingCompany = normalizeGradingCompany(transaction.gradingCompany);
  const gradingValue = normalizeGradingValue(gradingCompany, transaction.gradingValue);

  return {
    id: transaction.id ?? null,
    type,
    amount: normalizeAmount(type, transaction.amount),
    description,
    cardName,
    quantity: normalizeQuantity(transaction.quantity),
    date: normalizeDate(transaction.date, todayISO(options.now)),
    gradingCompany,
    gradingValue,
    gradingLabel: getGradeLabel(gradingCompany, gradingValue),
  };
}

export function normalizeTradeItem(item = {}) {
  const gradingCompany = normalizeGradingCompany(item.gradingCompany);
  const gradingValue = normalizeGradingValue(gradingCompany, item.gradingValue);
  return {
    cardName: normalizeTabName(item.cardName),
    quantity: normalizeQuantity(item.quantity),
    value: roundMoney(Math.abs(Number(item.value) || 0)),
    gradingCompany,
    gradingValue,
    gradingLabel: getGradeLabel(gradingCompany, gradingValue),
  };
}

export function computeTradeSideTotal(items = []) {
  return roundMoney(items.reduce((sum, item) => (
    sum + (normalizeQuantity(item.quantity) * roundMoney(Math.abs(Number(item.value) || 0)))
  ), 0));
}

export function normalizeTradeCashAmount(value) {
  const amount = Number(value) || 0;
  return amount > 0 ? roundMoney(amount) : 0;
}

export function parseTradeCashAmountInput(value) {
  const normalizedValue = String(value ?? '').trim().replace(/\s+/g, '');
  let normalizedNumber = normalizedValue;

  if (normalizedValue.includes('.') && normalizedValue.includes(',')) {
    normalizedNumber = normalizedValue.lastIndexOf(',') > normalizedValue.lastIndexOf('.')
      ? normalizedValue.replace(/\./g, '').replace(',', '.')
      : normalizedValue.replace(/,/g, '');
  } else if ((normalizedValue.match(/,/g) || []).length > 1) {
    normalizedNumber = normalizedValue.replace(/,/g, '');
  } else if (normalizedValue.includes(',')) {
    const [whole = '', decimal = ''] = normalizedValue.split(',');
    normalizedNumber = decimal.length === 3 ? `${whole}${decimal}` : normalizedValue.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalizedNumber);
  return normalizeTradeCashAmount(Number.isFinite(parsed) ? parsed : 0);
}

export function resolveTradeDraftCashAmount(amount, rawInput = null) {
  return rawInput !== null
    ? parseTradeCashAmountInput(rawInput)
    : normalizeTradeCashAmount(amount);
}

function normalizeTradeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeTradeItem)
    .filter(item => item.cardName && item.value > 0);
}

export function normalizeTrade(trade = {}, options = {}) {
  const givenItems = normalizeTradeItems(trade.givenItems);
  const receivedItems = normalizeTradeItems(trade.receivedItems);
  const givenCashAmount = normalizeTradeCashAmount(trade.givenCashAmount);
  const receivedCashAmount = normalizeTradeCashAmount(trade.receivedCashAmount);
  const totalGiven = roundMoney(computeTradeSideTotal(givenItems) + givenCashAmount);
  const totalReceived = roundMoney(computeTradeSideTotal(receivedItems) + receivedCashAmount);
  const difference = roundMoney(totalReceived - totalGiven);
  const roi = totalGiven > 0 ? roundMoney((difference / totalGiven) * 100) : 0;

  return {
    id: trade.id ?? null,
    date: normalizeDate(trade.date, todayISO(options.now)),
    note: String(trade.note ?? '').trim(),
    givenItems,
    receivedItems,
    givenCashAmount,
    receivedCashAmount,
    totalGiven,
    totalReceived,
    difference,
    roi,
  };
}

export function makeId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTab(name = DEFAULT_TAB_NAME, options = {}) {
  return {
    id: options.id ?? makeId('tab'),
    name: normalizeTabName(name) || DEFAULT_TAB_NAME,
    createdAt: options.createdAt ?? new Date(options.now ?? Date.now()).toISOString(),
    archived: Boolean(options.archived),
    transactions: Array.isArray(options.transactions)
      ? options.transactions.map(txn => normalizeTransaction(txn, { now: options.now }))
      : [],
    trades: Array.isArray(options.trades)
      ? options.trades.map(trade => normalizeTrade(trade, { now: options.now }))
      : [],
  };
}

function uniquifyTabName(name, usedNames) {
  const baseName = normalizeTabName(name) || DEFAULT_TAB_NAME;
  let uniqueName = baseName;
  let counter = 2;

  while (usedNames.has(normalizeCardKey(uniqueName))) {
    uniqueName = `${baseName} (${counter})`;
    counter += 1;
  }

  usedNames.add(normalizeCardKey(uniqueName));
  return uniqueName;
}

// Gives every item a unique positive integer id. Existing unique ids are kept;
// missing, invalid or duplicate ids get a fresh id after the current maximum.
export function assignUniqueIds(items, startAfter = 0) {
  const list = Array.isArray(items) ? items : [];
  const used = new Set();
  let maxId = startAfter;
  for (const item of list) {
    if (Number.isInteger(item?.id) && item.id > 0) maxId = Math.max(maxId, item.id);
  }
  return list.map(item => {
    let id = item?.id;
    if (!Number.isInteger(id) || id <= 0 || used.has(id)) {
      maxId += 1;
      id = maxId;
    }
    used.add(id);
    return { ...item, id };
  });
}

function normalizeTabs(rawTabs, options = {}) {
  const tabs = [];
  const usedNames = new Set();

  for (const rawTab of Array.isArray(rawTabs) ? rawTabs : []) {
    const fallbackName = `Tab ${tabs.length + 1}`;
    const tab = createTab(rawTab?.name || fallbackName, {
      id: rawTab?.id ?? makeId('tab'),
      createdAt: rawTab?.createdAt,
      now: options.now,
      archived: rawTab?.archived,
      transactions: Array.isArray(rawTab?.transactions) ? rawTab.transactions : [],
      trades: Array.isArray(rawTab?.trades) ? rawTab.trades : [],
    });

    tab.name = uniquifyTabName(tab.name || fallbackName, usedNames);
    tab.trades = assignUniqueIds(tab.trades);
    tabs.push(tab);
  }

  // Transaction ids are unique across all tabs, because edit/delete look them up by id.
  const flat = tabs.flatMap((tab, tabIndex) => tab.transactions.map(txn => ({ txn, tabIndex })));
  const withIds = assignUniqueIds(flat.map(entry => entry.txn));
  tabs.forEach(tab => { tab.transactions = []; });
  withIds.forEach((txn, index) => { tabs[flat[index].tabIndex].transactions.push(txn); });

  return { tabs };
}

export function ensureAppState(rawState, options = {}) {
  let parsed = rawState;

  if (typeof rawState === 'string') {
    try {
      parsed = rawState ? JSON.parse(rawState) : null;
    } catch {
      parsed = null;
    }
  }

  if (Array.isArray(parsed)) {
    const defaultTab = createTab(DEFAULT_TAB_NAME, {
      id: options.defaultTabId,
      now: options.now,
      transactions: parsed,
    });
    return {
      tabs: [{ ...defaultTab, transactions: defaultTab.transactions.map((txn, index) => ({ ...txn, id: index + 1 })) }],
      activeTabId: defaultTab.id,
      trades: [],
    };
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.transactions) && !Array.isArray(parsed.tabs)) {
    return ensureAppState(parsed.transactions, options);
  }

  const { tabs } = normalizeTabs(parsed?.tabs, options);

  if (!tabs.length) {
    const defaultTab = createTab(DEFAULT_TAB_NAME, {
      id: options.defaultTabId,
      now: options.now,
    });
    return { tabs: [defaultTab], activeTabId: defaultTab.id, trades: [] };
  }

  const firstAvailableTab = tabs.find(tab => !tab.archived) || tabs[0];
  const activeTabId = tabs.some(tab => tab.id === parsed?.activeTabId && !tab.archived)
    ? parsed.activeTabId
    : firstAvailableTab.id;

  const trades = assignUniqueIds((Array.isArray(parsed?.trades) ? parsed.trades : [])
    .map(trade => normalizeTrade(trade, options)));

  return { tabs, activeTabId, trades };
}

export function getActiveTab(state) {
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId && !tab.archived);
  if (activeTab) return activeTab;
  return state.tabs.find(tab => !tab.archived) || state.tabs[0];
}

export function getActiveTransactions(state) {
  return getActiveTab(state)?.transactions ?? [];
}

export function nextTransactionId(state) {
  return state.tabs.reduce((maxId, tab) => {
    const tabMax = tab.transactions.reduce((currentMax, transaction) => (
      Number.isInteger(transaction.id) ? Math.max(currentMax, transaction.id) : currentMax
    ), 0);
    return Math.max(maxId, tabMax);
  }, 0) + 1;
}

export function validateTabName(state, name, excludeTabId = null) {
  const trimmedName = normalizeTabName(name);
  if (!trimmedName) {
    return { valid: false, error: 'Voer een tabnaam in.' };
  }

  const duplicate = state.tabs.some(tab => (
    tab.id !== excludeTabId && normalizeCardKey(tab.name) === normalizeCardKey(trimmedName)
  ));

  if (duplicate) {
    return { valid: false, error: 'Er bestaat al een tab met deze naam.' };
  }

  return { valid: true, name: trimmedName };
}

export function setActiveTab(state, tabId) {
  if (!state.tabs.some(tab => tab.id === tabId && !tab.archived)) return ensureAppState(state);
  return { ...state, activeTabId: tabId };
}

export function addTab(state, name, options = {}) {
  const validation = validateTabName(state, name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const tab = createTab(validation.name, {
    id: options.id,
    createdAt: options.createdAt,
    now: options.now,
  });

  return {
    state: {
      ...state,
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    },
    tab,
  };
}

export function renameTab(state, tabId, nextName) {
  const validation = validateTabName(state, nextName, tabId);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === tabId ? { ...tab, name: validation.name } : tab
    )),
  };
}

export function deleteTab(state, tabId, options = {}) {
  const index = state.tabs.findIndex(tab => tab.id === tabId);
  if (index === -1) return ensureAppState(state, options);

  const remainingTabs = state.tabs.filter(tab => tab.id !== tabId);

  if (!remainingTabs.length) {
    const defaultTab = createTab(DEFAULT_TAB_NAME, {
      id: options.defaultTabId,
      now: options.now,
    });
    return {
      ...state,
      tabs: [defaultTab],
      activeTabId: defaultTab.id,
    };
  }

  const fallbackTab = remainingTabs[Math.min(index, remainingTabs.length - 1)];
  const activeTabId = state.activeTabId === tabId ? fallbackTab.id : (
    remainingTabs.some(tab => tab.id === state.activeTabId) ? state.activeTabId : remainingTabs[0].id
  );

  return {
    ...state,
    tabs: remainingTabs,
    activeTabId,
  };
}

export function archiveTab(state, tabId) {
  const tab = state.tabs.find(entry => entry.id === tabId);
  if (!tab || tab.archived) return ensureAppState(state);

  const nextState = {
    ...state,
    tabs: state.tabs.map(entry => (
      entry.id === tabId ? { ...entry, archived: true } : entry
    )),
  };
  return ensureAppState(nextState);
}

export function restoreTab(state, tabId) {
  const tab = state.tabs.find(entry => entry.id === tabId);
  if (!tab || !tab.archived) return ensureAppState(state);

  return ensureAppState({
    ...state,
    tabs: state.tabs.map(entry => (
      entry.id === tabId ? { ...entry, archived: false } : entry
    )),
  });
}

export function replaceActiveTabTransactions(state, transactions, options = {}) {
  const activeTab = getActiveTab(state);
  const normalizedTransactions = transactions.map((transaction, index) => {
    const normalized = normalizeTransaction(transaction, { now: options.now });
    return {
      ...normalized,
      id: Number.isInteger(transaction.id) ? transaction.id : nextTransactionId(state) + index,
    };
  });

  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === activeTab.id ? { ...tab, transactions: normalizedTransactions } : tab
    )),
  };
}

export function appendTransaction(state, transaction, options = {}) {
  const activeTab = getActiveTab(state);
  const normalized = normalizeTransaction(transaction, { now: options.now });
  const nextId = nextTransactionId(state);

  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === activeTab.id
        ? { ...tab, transactions: [...tab.transactions, { ...normalized, id: nextId }] }
        : tab
    )),
  };
}

export function appendTransactions(state, transactions, options = {}) {
  let nextId = nextTransactionId(state);
  const additions = transactions.map(transaction => {
    const normalized = normalizeTransaction(transaction, { now: options.now });
    const withId = { ...normalized, id: nextId };
    nextId += 1;
    return withId;
  });

  const activeTab = getActiveTab(state);
  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === activeTab.id
        ? { ...tab, transactions: [...tab.transactions, ...additions] }
        : tab
    )),
  };
}

export function deleteTransaction(state, transactionId) {
  const activeTab = getActiveTab(state);

  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === activeTab.id
        ? { ...tab, transactions: tab.transactions.filter(transaction => transaction.id !== transactionId) }
        : tab
    )),
  };
}

export function updateTransaction(state, transactionId, transaction, options = {}) {
  const activeTab = getActiveTab(state);
  const normalized = normalizeTransaction(transaction, { now: options.now });

  return {
    ...state,
    tabs: state.tabs.map(tab => (
      tab.id === activeTab.id
        ? {
            ...tab,
            transactions: tab.transactions.map(txn =>
              txn.id === transactionId ? { ...normalized, id: transactionId } : txn
            ),
          }
        : tab
    )),
  };
}

export function clearAllData(options = {}) {
  return ensureAppState(null, options);
}

export function getTrades(state) {
  return Array.isArray(state?.trades) ? state.trades : [];
}

export function nextTradeId(state) {
  return getTrades(state).reduce((maxId, trade) => (
    Number.isInteger(trade.id) ? Math.max(maxId, trade.id) : maxId
  ), 0) + 1;
}

export function appendTrade(state, trade, options = {}) {
  const normalized = normalizeTrade(trade, { now: options.now });
  const id = nextTradeId(state);
  return {
    ...state,
    trades: [...getTrades(state), { ...normalized, id }],
  };
}

export function appendTrades(state, trades, options = {}) {
  let id = nextTradeId(state);
  const additions = (Array.isArray(trades) ? trades : []).map(trade => {
    const normalized = normalizeTrade(trade, { now: options.now });
    const withId = { ...normalized, id };
    id += 1;
    return withId;
  });

  if (!additions.length) return state;
  return {
    ...state,
    trades: [...getTrades(state), ...additions],
  };
}

export function updateTrade(state, tradeId, trade, options = {}) {
  const normalized = normalizeTrade(trade, { now: options.now });
  return {
    ...state,
    trades: getTrades(state).map(entry => (
      entry.id === tradeId ? { ...normalized, id: tradeId } : entry
    )),
  };
}

export function deleteTrade(state, tradeId) {
  return {
    ...state,
    trades: getTrades(state).filter(trade => trade.id !== tradeId),
  };
}

export function computeTradeAnalytics(trades = []) {
  const normalizedTrades = (Array.isArray(trades) ? trades : []).map(trade => normalizeTrade(trade));
  const totalTrades = normalizedTrades.length;
  const totalGiven = roundMoney(normalizedTrades.reduce((sum, trade) => sum + trade.totalGiven, 0));
  const totalReceived = roundMoney(normalizedTrades.reduce((sum, trade) => sum + trade.totalReceived, 0));
  const totalDifference = roundMoney(totalReceived - totalGiven);
  const averageDifference = totalTrades ? roundMoney(totalDifference / totalTrades) : 0;
  const averageRoi = totalTrades
    ? roundMoney(normalizedTrades.reduce((sum, trade) => sum + trade.roi, 0) / totalTrades)
    : 0;
  const positiveTrades = normalizedTrades.filter(trade => trade.difference > 0).length;
  const negativeTrades = normalizedTrades.filter(trade => trade.difference < 0).length;

  return {
    totalTrades,
    totalGiven,
    totalReceived,
    totalDifference,
    averageDifference,
    averageRoi,
    positiveTrades,
    negativeTrades,
  };
}

export function computeTradePerformanceSeries(trades = []) {
  const normalizedTrades = (Array.isArray(trades) ? trades : [])
    .map(trade => normalizeTrade(trade))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.id - right.id;
    });

  let cumulativeDifference = 0;
  return normalizedTrades.map(trade => {
    cumulativeDifference = roundMoney(cumulativeDifference + trade.difference);
    return {
      id: trade.id,
      date: trade.date,
      difference: trade.difference,
      cumulativeDifference,
    };
  });
}

export function computeSummary(transactions) {
  const totalSold = roundMoney(transactions
    .filter(transaction => transaction.type === TYPE_SELL)
    .reduce((sum, transaction) => sum + transaction.amount, 0));
  const totalBought = roundMoney(transactions
    .filter(transaction => transaction.type === TYPE_BUY)
    .reduce((sum, transaction) => sum + transaction.amount, 0));

  return {
    totalSold,
    totalBought,
    profit: roundMoney(totalSold + totalBought),
    count: transactions.length,
  };
}

function compareTransactionsForFifo(left, right) {
  if (left.date !== right.date) return left.date.localeCompare(right.date);
  return left.index - right.index;
}

// Parse a multi-line description into per-card entries with proportional amounts.
// Returns null if description is single-line (no splitting needed).
export function splitMultiLineDescription(description, amount) {
  const lines = String(description).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length <= 1) return null;

  const parsedLines = lines.map(line => {
    const match = line.match(/^(\d+)\s*[xX×]\s*/);
    const qty = match ? Number.parseInt(match[1], 10) : 1;
    const cardName = line.replace(/^\d+\s*[xX×]\s*/, '').replace(/\s+#\d+\s*$/g, '').trim();
    return { cardName, qty };
  }).filter(entry => entry.cardName);

  if (!parsedLines.length) return null;

  const totalQty = parsedLines.reduce((sum, entry) => sum + entry.qty, 0);
  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? -1 : 1;

  return parsedLines.map(entry => ({
    cardName: entry.cardName,
    quantity: entry.qty,
    amount: roundMoney(sign * absAmount * entry.qty / totalQty),
    description: entry.cardName,
  }));
}

export function computeProfitByCard(transactions) {
  const groups = new Map();

  // Graded copies are a different product than raw copies (and a PSA 10 differs
  // from a PSA 9), so each card + grading combination gets its own FIFO pool.
  function addRecord(record) {
    const gradingCompany = record.gradingCompany || '';
    const gradingValue = gradingCompany ? (record.gradingValue || '') : '';
    const key = `${normalizeCardKey(record.cardName)}|${gradingCompany}|${gradingValue}`;
    if (!groups.has(key)) {
      groups.set(key, { cardName: record.cardName, gradingCompany, gradingValue, records: [] });
    }
    groups.get(key).records.push(record);
  }

  transactions.forEach((transaction, index) => {
    const normalized = normalizeTransaction(transaction);
    const hasExplicitCardName = transaction.cardName !== null && transaction.cardName !== undefined;
    const cardName = hasExplicitCardName
      ? normalizeTabName(transaction.cardName)
      : inferCardName(normalized.description);

    if (cardName) {
      // Has an explicit (or single-line-inferred) card name
      addRecord({ ...normalized, cardName, index });
      return;
    }

    // cardName was explicitly set to '' by the user (no card association).
    // Do not try to extract virtual per-card records in this case.
    if (hasExplicitCardName) return;

    // cardName is '': no explicit card name was stored.
    // For backward compatibility, try splitting a multi-line description into
    // per-card virtual records (handles entries imported or added before the
    // per-line splitting was introduced).
    const split = splitMultiLineDescription(normalized.description, normalized.amount);
    if (!split) return;

    for (const part of split) {
      addRecord({
        ...normalized,
        cardName: part.cardName,
        quantity: part.quantity,
        amount: part.amount,
        description: part.description,
        index,
      });
    }
  });

  const rows = [];

  groups.forEach(group => {
    const inventory = [];
    let boughtQty = 0;
    let boughtValue = 0;
    let soldQty = 0;
    let soldValue = 0;
    let allocatedBuyCost = 0;

    const ordered = group.records.slice().sort(compareTransactionsForFifo);

    for (const transaction of ordered) {
      const quantity = normalizeQuantity(transaction.quantity);
      const absoluteAmount = Math.abs(transaction.amount);

      if (transaction.type === TYPE_BUY) {
        boughtQty += quantity;
        boughtValue = roundMoney(boughtValue + absoluteAmount);
        inventory.push({
          quantity,
          unitCost: absoluteAmount / quantity,
        });
        continue;
      }

      soldQty += quantity;
      soldValue = roundMoney(soldValue + absoluteAmount);
      let remainingToMatch = quantity;

      while (remainingToMatch > 0 && inventory.length) {
        const lot = inventory[0];
        const matchedQuantity = Math.min(remainingToMatch, lot.quantity);
        allocatedBuyCost = roundMoney(allocatedBuyCost + (matchedQuantity * lot.unitCost));
        lot.quantity -= matchedQuantity;
        remainingToMatch -= matchedQuantity;

        if (lot.quantity === 0) {
          inventory.shift();
        }
      }
    }

    const remainingQty = inventory.reduce((sum, lot) => sum + lot.quantity, 0);
    const remainingCost = roundMoney(inventory.reduce((sum, lot) => sum + (lot.quantity * lot.unitCost), 0));

    const gradeNumber = getGradeNumber(group.gradingCompany, group.gradingValue);
    const isSpecialTen = gradeNumber && gradeNumber !== group.gradingValue;
    const gradeText = group.gradingCompany && gradeNumber
      ? `${group.gradingCompany} ${gradeNumber}${isSpecialTen ? ` ${getGradeLabel(group.gradingCompany, group.gradingValue)}` : ''}`
      : '';
    rows.push({
      cardName: group.cardName,
      gradingCompany: group.gradingCompany,
      gradingValue: group.gradingValue,
      displayName: gradeText ? `${group.cardName} [${gradeText}]` : group.cardName,
      boughtQty,
      soldQty,
      boughtValue: roundMoney(boughtValue),
      soldValue: roundMoney(soldValue),
      allocatedBuyCost: roundMoney(allocatedBuyCost),
      realizedProfit: roundMoney(soldValue - allocatedBuyCost),
      profitMargin: allocatedBuyCost > 0
        ? roundMoney(((soldValue - allocatedBuyCost) / allocatedBuyCost) * 100)
        : null,
      remainingQty,
      remainingCost,
    });
  });

  return rows.sort((left, right) => left.displayName.localeCompare(right.displayName, 'nl', { sensitivity: 'base' }));
}

// Fields that identify "the same" transaction when re-importing a spreadsheet.
// The date is only compared when the imported row actually had a date; rows
// without one get today's date on import, which would differ on every re-import.
function importSignature(transaction, includeDate) {
  const t = normalizeTransaction(transaction);
  return [
    t.type,
    t.amount.toFixed(2),
    t.description.toLocaleLowerCase(),
    normalizeCardKey(t.cardName),
    t.quantity,
    includeDate ? t.date : '',
  ].join('\u0001');
}

// Splits incoming rows into new ones and ones already present in `existing`.
// Each existing row can absorb at most one incoming row, so a file that
// legitimately contains two identical rows still imports both the first time.
// Incoming rows may set `importHasDate: false` to skip the date comparison.
export function filterDuplicateTransactions(existing = [], incoming = []) {
  const pools = { dated: new Map(), undated: new Map() };
  const take = (map, key) => {
    const count = map.get(key) || 0;
    if (!count) return false;
    map.set(key, count - 1);
    return true;
  };
  const existingList = Array.isArray(existing) ? existing : [];
  for (const transaction of existingList) {
    const dated = importSignature(transaction, true);
    const undated = importSignature(transaction, false);
    pools.dated.set(dated, (pools.dated.get(dated) || 0) + 1);
    pools.undated.set(undated, (pools.undated.get(undated) || 0) + 1);
  }

  const added = [];
  let skipped = 0;
  for (const transaction of Array.isArray(incoming) ? incoming : []) {
    const hasDate = transaction?.importHasDate !== false;
    const dated = importSignature(transaction, true);
    const undated = importSignature(transaction, false);
    const isDuplicate = hasDate
      ? take(pools.dated, dated) && (take(pools.undated, undated) || true)
      : take(pools.undated, undated);
    if (isDuplicate) {
      skipped += 1;
    } else {
      added.push(transaction);
    }
  }

  return { added, skipped };
}

export function isBulkTransaction(transaction) {
  return /\bbulk\b/i.test(String(transaction?.description ?? ''));
}

export function computeAverageCardProfitMargin(transactions) {
  const margins = computeProfitByCard(transactions.filter(transaction => !isBulkTransaction(transaction)))
    .map(row => row.profitMargin)
    .filter(Number.isFinite);

  return margins.length
    ? roundMoney(margins.reduce((sum, margin) => sum + margin, 0) / margins.length)
    : null;
}

export function extractCardmarketOrderIds(description = '') {
  const ids = [];
  const seen = new Set();

  for (const match of String(description).matchAll(/#(\d+)/g)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

export function buildCardmarketOrderUrl(orderId) {
  return `https://www.cardmarket.com/en/Pokemon/Orders/${orderId}`;
}

export function getCardmarketOrderLinks(transaction) {
  if (transaction.type !== TYPE_SELL && transaction.type !== TYPE_BUY) return [];
  return extractCardmarketOrderIds(transaction.description).map(id => ({
    id,
    url: buildCardmarketOrderUrl(id),
  }));
}

export function computeCardmarketSurplus(transactions) {
  const filtered = transactions.filter(t =>
    String(t.description ?? '').includes('Overschot Cardmarket')
  );
  const totalSold = roundMoney(filtered
    .filter(t => t.type === TYPE_SELL)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0));
  const totalBought = roundMoney(filtered
    .filter(t => t.type === TYPE_BUY)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0));
  return {
    totalSold,
    totalBought,
    net: roundMoney(totalSold - totalBought),
    count: filtered.length,
  };
}
