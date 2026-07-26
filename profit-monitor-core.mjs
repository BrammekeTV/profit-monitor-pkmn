export const STORAGE_KEY = 'profit-monitor-pkmn';
export const DEFAULT_TAB_NAME = 'Default';
export const TYPE_SELL = 'Verkocht';
export const TYPE_BUY = 'Gekocht';

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function todayISO(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString().slice(0, 10);
}

export function normalizeDate(value, fallback = todayISO()) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
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
  const match = line.match(/^(.*?)\s+\([A-Z0-9]+\s+\d+[A-Za-z]*\)$/);
  return match ? match[1].trim() : '';
}

export function normalizeAmount(type, amount) {
  const value = Math.abs(Number(amount) || 0);
  return roundMoney(type === TYPE_BUY ? -value : value);
}

export function normalizeTransaction(transaction = {}, options = {}) {
  const type = transaction.type === TYPE_BUY ? TYPE_BUY : TYPE_SELL;
  const description = String(transaction.description ?? '').trim();
  const cardName = normalizeTabName(transaction.cardName) || inferCardName(description);

  return {
    id: transaction.id ?? null,
    type,
    amount: normalizeAmount(type, transaction.amount),
    description,
    cardName,
    quantity: normalizeQuantity(transaction.quantity),
    date: normalizeDate(transaction.date, todayISO(options.now)),
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
    transactions: Array.isArray(options.transactions)
      ? options.transactions.map(txn => normalizeTransaction(txn, { now: options.now }))
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

function normalizeTabs(rawTabs, options = {}) {
  const tabs = [];
  const usedNames = new Set();
  let nextId = 1;

  for (const rawTab of Array.isArray(rawTabs) ? rawTabs : []) {
    const fallbackName = `Tab ${tabs.length + 1}`;
    const tab = createTab(rawTab?.name || fallbackName, {
      id: rawTab?.id ?? makeId('tab'),
      createdAt: rawTab?.createdAt,
      now: options.now,
      transactions: Array.isArray(rawTab?.transactions) ? rawTab.transactions : [],
    });

    tab.name = uniquifyTabName(tab.name || fallbackName, usedNames);
    tab.transactions = tab.transactions.map(transaction => {
      const id = Number.isInteger(transaction.id) ? transaction.id : nextId;
      nextId = Math.max(nextId, id + 1);
      return { ...transaction, id };
    });

    tabs.push(tab);
  }

  return { tabs, nextTransactionId: nextId };
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
    return { tabs: [defaultTab], activeTabId: defaultTab.id };
  }

  const activeTabId = tabs.some(tab => tab.id === parsed?.activeTabId)
    ? parsed.activeTabId
    : tabs[0].id;

  return { tabs, activeTabId };
}

export function getActiveTab(state) {
  return state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0];
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
  if (!state.tabs.some(tab => tab.id === tabId)) return ensureAppState(state);
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
      tabs: [defaultTab],
      activeTabId: defaultTab.id,
    };
  }

  const fallbackTab = remainingTabs[Math.min(index, remainingTabs.length - 1)];
  const activeTabId = state.activeTabId === tabId ? fallbackTab.id : (
    remainingTabs.some(tab => tab.id === state.activeTabId) ? state.activeTabId : remainingTabs[0].id
  );

  return {
    tabs: remainingTabs,
    activeTabId,
  };
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

export function clearAllData(options = {}) {
  return ensureAppState(null, options);
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

function resolveTransactionCardName(transaction) {
  return normalizeTabName(transaction.cardName) || inferCardName(transaction.description);
}

export function computeProfitByCard(transactions) {
  const groups = new Map();

  transactions.forEach((transaction, index) => {
    const normalized = normalizeTransaction(transaction);
    const cardName = resolveTransactionCardName(normalized);
    if (!cardName) return;

    const key = normalizeCardKey(cardName);
    if (!groups.has(key)) {
      groups.set(key, { cardName, records: [] });
    }

    const group = groups.get(key);
    group.records.push({ ...normalized, cardName, index });
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

    rows.push({
      cardName: group.cardName,
      boughtQty,
      soldQty,
      boughtValue: roundMoney(boughtValue),
      soldValue: roundMoney(soldValue),
      allocatedBuyCost: roundMoney(allocatedBuyCost),
      realizedProfit: roundMoney(soldValue - allocatedBuyCost),
      remainingQty,
      remainingCost,
    });
  });

  return rows.sort((left, right) => left.cardName.localeCompare(right.cardName, 'nl', { sensitivity: 'base' }));
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
  if (transaction.type !== TYPE_SELL) return [];
  return extractCardmarketOrderIds(transaction.description).map(id => ({
    id,
    url: buildCardmarketOrderUrl(id),
  }));
}
