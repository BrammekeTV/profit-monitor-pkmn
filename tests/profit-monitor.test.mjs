import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TAB_NAME,
  TYPE_BUY,
  TYPE_SELL,
  addTab,
  appendTrades,
  appendTrade,
  archiveTab,
  computeAverageCardProfitMargin,
  computeTradeAnalytics,
  computeTradePerformanceSeries,
  computeCardmarketSurplus,
  computeProfitByCard,
  deleteTrade,
  deleteTab,
  ensureAppState,
  extractCardmarketOrderIds,
  getGradeLabel,
  getGradingScale,
  getActiveTab,
  getTrades,
  moveTab,
  getCardmarketOrderLinks,
  isBulkTransaction,
  normalizeGradingValue,
  parseTradeCashAmountInput,
  resolveTradeDraftCashAmount,
  normalizeTradeCashAmount,
  normalizeTrade,
  normalizeTransaction,
  setActiveTab,
  restoreTab,
  updateTrade,
  validateTabName,
  normalizeDate,
  todayISO,
  excelSerialToISO,
  filterDuplicateTransactions,
  assignUniqueIds,
  getGradeNumber,
  formatGrade,
  extractSetCode,
  getSetName,
  computeSetSales,
  setCustomSetName,
  isSetNamesReminderDue,
  snoozeSetNamesReminder,
  formatSetNamesForExport,
} from '../profit-monitor-core.mjs';

test('legacy data migrates into a default tab and repairs invalid active tabs', () => {
  const state = ensureAppState([
    { id: 4, type: TYPE_BUY, amount: 12.5, description: 'Pikachu (MEP 001)' },
  ], {
    defaultTabId: 'default-tab',
    now: '2026-07-01T00:00:00Z',
  });

  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].name, DEFAULT_TAB_NAME);
  assert.equal(state.activeTabId, 'default-tab');
  assert.equal(state.tabs[0].transactions[0].amount, -12.5);
  assert.equal(state.tabs[0].transactions[0].quantity, 1);
  assert.deepEqual(getTrades(state), []);
  assert.equal('trades' in state, false);

  const repaired = ensureAppState({
    tabs: state.tabs,
    activeTabId: 'missing-tab',
  });

  assert.equal(repaired.activeTabId, state.tabs[0].id);
  assert.deepEqual(getTrades(repaired), []);
});

test('tabs can be created, switched, deleted, and recreated when the last tab is removed', () => {
  const baseState = ensureAppState(null, {
    defaultTabId: 'default-tab',
    now: '2026-07-01T00:00:00Z',
  });

  assert.equal(validateTabName(baseState, '').valid, false);

  const withSecondTab = addTab(baseState, 'Sales', {
    id: 'sales-tab',
    now: '2026-07-02T00:00:00Z',
  }).state;

  assert.equal(withSecondTab.activeTabId, 'sales-tab');
  assert.equal(validateTabName(withSecondTab, 'sales').valid, false);

  const switched = setActiveTab(withSecondTab, 'default-tab');
  assert.equal(getActiveTab(switched).id, 'default-tab');

  const withoutDefault = deleteTab(switched, 'default-tab');
  assert.equal(withoutDefault.tabs.length, 1);
  assert.equal(withoutDefault.activeTabId, 'sales-tab');

  const recreated = deleteTab(withoutDefault, 'sales-tab', {
    defaultTabId: 'new-default',
    now: '2026-07-03T00:00:00Z',
  });

  assert.equal(recreated.tabs.length, 1);
  assert.equal(recreated.tabs[0].name, DEFAULT_TAB_NAME);
  assert.equal(recreated.activeTabId, 'new-default');
});

test('tabs can be archived and restored while preserving tab data', () => {
  const state = ensureAppState({
    tabs: [
      {
        id: 'tab-a',
        name: 'Tab A',
        transactions: [{ type: TYPE_SELL, amount: 25, description: 'Sale A', date: '2026-09-01' }],
        trades: [{ id: 1, givenItems: [{ cardName: 'A', quantity: 1, value: 10 }], receivedItems: [{ cardName: 'B', quantity: 1, value: 15 }] }],
      },
      {
        id: 'tab-b',
        name: 'Tab B',
        transactions: [{ type: TYPE_BUY, amount: 10, description: 'Buy B', date: '2026-09-02' }],
      },
    ],
    activeTabId: 'tab-a',
    trades: [],
  }, {
    now: '2026-09-21T00:00:00Z',
  });

  const archived = archiveTab(state, 'tab-a');
  assert.equal(archived.tabs.find(tab => tab.id === 'tab-a').archived, true);
  assert.equal(archived.activeTabId, 'tab-b');
  assert.equal(archived.tabs.find(tab => tab.id === 'tab-a').transactions.length, 1);
  assert.equal(archived.tabs.find(tab => tab.id === 'tab-a').trades.length, 1);

  const restored = restoreTab(archived, 'tab-a');
  assert.equal(restored.tabs.find(tab => tab.id === 'tab-a').archived, false);

  const unchanged = setActiveTab(archived, 'tab-a');
  assert.equal(unchanged.activeTabId, 'tab-b');
});

test('profit per card uses FIFO matching and handles partial sales case-insensitively', () => {
  const rows = computeProfitByCard([
    { type: TYPE_BUY, cardName: ' Pikachu ', amount: 100, quantity: 10, date: '2026-01-01' },
    { type: TYPE_SELL, cardName: 'pikachu', amount: 45, quantity: 3, date: '2026-01-10' },
    { type: TYPE_BUY, cardName: 'Pikachu', amount: 40, quantity: 4, date: '2026-01-11' },
    { type: TYPE_SELL, cardName: 'PIKACHU', amount: 80, quantity: 5, date: '2026-01-12' },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    cardName: 'Pikachu',
    gradingCompany: '',
    gradingValue: '',
    displayName: 'Pikachu',
    boughtQty: 14,
    soldQty: 8,
    boughtValue: 140,
    soldValue: 125,
    allocatedBuyCost: 80,
    realizedProfit: 45,
    profitMargin: 56.25,
    remainingQty: 6,
    remainingCost: 60,
  });
});

test('average card profit margin averages matched cards and ignores Bulk entries', () => {
  const transactions = [
    { type: TYPE_BUY, cardName: 'Pikachu', amount: 100, date: '2026-01-01' },
    { type: TYPE_SELL, cardName: 'Pikachu', amount: 125, date: '2026-01-02' },
    { type: TYPE_BUY, cardName: 'Eevee', amount: 100, date: '2026-01-01' },
    { type: TYPE_SELL, cardName: 'Eevee', amount: 80, date: '2026-01-02' },
    { type: TYPE_SELL, cardName: 'Mew', amount: 50, date: '2026-01-02' },
    { type: TYPE_BUY, cardName: 'Bulk kaarten', amount: 10, description: 'Bulk kaarten', date: '2026-01-01' },
    { type: TYPE_SELL, cardName: 'Bulk kaarten', amount: 50, description: 'Bulk kaarten', date: '2026-01-02' },
  ];

  assert.equal(isBulkTransaction({ description: 'Verkoop BULK kaarten' }), true);
  assert.equal(isBulkTransaction({ description: 'Bulky sleeve' }), false);
  assert.equal(computeAverageCardProfitMargin(transactions), 2.5);
  assert.equal(computeAverageCardProfitMargin([]), null);
});

test('profit per card respects explicit no-card entries while keeping legacy multiline splitting', () => {
  const rows = computeProfitByCard([
    {
      type: TYPE_BUY,
      amount: 10,
      description: 'Toploader\nSleeve',
      cardName: '',
      quantity: 1,
      date: '2026-01-01',
    },
    {
      type: TYPE_BUY,
      amount: 10,
      description: 'Charmander\nBulbasaur',
      date: '2026-01-02',
    },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.cardName), ['Bulbasaur', 'Charmander']);
});

test('Cardmarket order ids and links are generated for both sold and bought transactions', () => {
  const description = 'Lot verkocht via Cardmarket #1289784654 en #1289784655, dubbele #1289784654';

  assert.deepEqual(extractCardmarketOrderIds(description), ['1289784654', '1289784655']);

  const expectedLinks = [
    {
      id: '1289784654',
      url: 'https://www.cardmarket.com/en/Pokemon/Orders/1289784654',
    },
    {
      id: '1289784655',
      url: 'https://www.cardmarket.com/en/Pokemon/Orders/1289784655',
    },
  ];

  assert.deepEqual(getCardmarketOrderLinks({ type: TYPE_SELL, description }), expectedLinks);
  assert.deepEqual(getCardmarketOrderLinks({ type: TYPE_BUY, description }), expectedLinks);
  assert.deepEqual(getCardmarketOrderLinks({ type: 'Other', description }), []);
});

test('computeCardmarketSurplus filters by "Overschot Cardmarket" in description', () => {
  const transactions = [
    { type: TYPE_SELL, amount: 50, description: 'Overschot Cardmarket mei 2026' },
    { type: TYPE_BUY, amount: -20, description: 'Overschot Cardmarket mei 2026' },
    { type: TYPE_SELL, amount: 30, description: 'Overschot Cardmarket april 2026' },
    { type: TYPE_SELL, amount: 100, description: 'Vinted verkoop' },
    { type: TYPE_BUY, amount: -10, description: 'Aankoop buiten Cardmarket' },
  ];

  const surplus = computeCardmarketSurplus(transactions);

  assert.equal(surplus.totalSold, 80);
  assert.equal(surplus.totalBought, 20);
  assert.equal(surplus.net, 60);
  assert.equal(surplus.count, 3);
});

test('computeCardmarketSurplus returns zero values when no matching transactions exist', () => {
  const surplus = computeCardmarketSurplus([
    { type: TYPE_SELL, amount: 100, description: 'Vinted' },
  ]);

  assert.equal(surplus.totalSold, 0);
  assert.equal(surplus.totalBought, 0);
  assert.equal(surplus.net, 0);
  assert.equal(surplus.count, 0);
});

test('grading normalization keeps only valid company-specific grades', () => {
  assert.equal(normalizeGradingValue('PSA', '9.5'), '');
  assert.equal(normalizeGradingValue('PSA', '8.5'), '8.5');
  assert.equal(normalizeGradingValue('BGS', '9.5'), '9.5');
  assert.equal(normalizeGradingValue('TAG', '9.5'), '');
  assert.equal(getGradeLabel('CGC', '10'), 'Gem Mint');
  assert.equal(getGradeLabel('CGC', '10-pristine'), 'Pristine');
  assert.equal(getGradingScale('TAG').map(option => option.value).includes('9.5'), false);

  const normalized = normalizeTransaction({
    type: TYPE_SELL,
    amount: 10,
    description: 'Pikachu',
    gradingCompany: 'bgs',
    gradingValue: '9.5',
  });

  assert.equal(normalized.gradingCompany, 'BGS');
  assert.equal(normalized.gradingValue, '9.5');
  assert.equal(normalized.gradingLabel, 'Gem Mint');
});

test('trades are stored on the active tab and support CRUD plus analytics', () => {
  let state = ensureAppState(null, {
    defaultTabId: 'default-tab',
    now: '2026-09-21T00:00:00Z',
  });

  state = appendTrade(state, {
    date: '2026-09-21',
    note: 'Eerste trade',
    givenItems: [
      { cardName: 'Charizard ex', quantity: 1, value: 80, gradingCompany: 'psa', gradingValue: '10' },
      { cardName: 'Pikachu', quantity: 2, value: 20 },
    ],
    receivedItems: [
      { cardName: 'Umbreon VMAX', quantity: 1, value: 125, gradingCompany: 'tag', gradingValue: '9' },
    ],
  });

  assert.equal(getTrades(state).length, 1);
  assert.equal(getTrades(state)[0].totalGiven, 120);
  assert.equal(getTrades(state)[0].totalReceived, 125);
  assert.equal(getTrades(state)[0].difference, 5);
  assert.equal(getTrades(state)[0].roi, 4.17);
  assert.equal(getTrades(state)[0].givenItems[0].gradingCompany, 'PSA');
  assert.equal(getTrades(state)[0].givenItems[0].gradingValue, '10');
  assert.equal(getTrades(state)[0].givenItems[0].gradingLabel, 'Gem Mint');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingCompany, 'TAG');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingValue, '9');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingLabel, 'Mint');

  state = updateTrade(state, getTrades(state)[0].id, {
    ...getTrades(state)[0],
    receivedItems: [{ cardName: 'Umbreon VMAX', quantity: 1, value: 130 }],
  });

  assert.equal(getTrades(state)[0].difference, 10);
  assert.equal(getTrades(state)[0].roi, 8.33);

  const analytics = computeTradeAnalytics(getTrades(state));
  assert.deepEqual(analytics, {
    totalTrades: 1,
    totalGiven: 120,
    totalReceived: 130,
    totalDifference: 10,
    averageDifference: 10,
    averageRoi: 8.33,
    positiveTrades: 1,
    negativeTrades: 0,
  });

  const series = computeTradePerformanceSeries(getTrades(state));
  assert.deepEqual(series, [{
    id: getTrades(state)[0].id,
    date: '2026-09-21',
    difference: 10,
    cumulativeDifference: 10,
  }]);

  state = deleteTrade(state, getTrades(state)[0].id);
  assert.equal(getTrades(state).length, 0);
  assert.equal(state.tabs.length, 1);
});

test('appendTrades appends and normalizes multiple trades with new ids', () => {
  const baseState = ensureAppState(null, {
    defaultTabId: 'default-tab',
    now: '2026-09-21T00:00:00Z',
  });
  const seeded = appendTrade(baseState, {
    date: '2026-09-20',
    givenItems: [{ cardName: 'Card A', quantity: 1, value: 10 }],
    receivedItems: [{ cardName: 'Card B', quantity: 1, value: 12 }],
  });

  const next = appendTrades(seeded, [
    {
      id: 999,
      date: '2026-09-22',
      givenItems: [{ cardName: 'Card C', quantity: 1, value: 20, gradingCompany: 'psa', gradingValue: '10' }],
      receivedItems: [{ cardName: 'Card D', quantity: 1, value: 30 }],
    },
    {
      date: '2026-09-23',
      givenItems: [{ cardName: 'Card E', quantity: 1, value: 5 }],
      receivedItems: [{ cardName: 'Card F', quantity: 1, value: 7 }],
    },
  ]);

  assert.equal(getTrades(next).length, 3);
  assert.deepEqual(getTrades(next).map(trade => trade.id), [1, 2, 3]);
  assert.equal(getTrades(next)[1].givenItems[0].gradingCompany, 'PSA');
  assert.equal(getTrades(next)[1].givenItems[0].gradingLabel, 'Gem Mint');
});

test('trades support loose cash amounts alongside or without card rows', () => {
  let state = ensureAppState(null, {
    defaultTabId: 'default-tab',
    now: '2026-09-21T00:00:00Z',
  });

  state = appendTrade(state, {
    date: '2026-09-22',
    givenCashAmount: 15,
    givenItems: [],
    receivedCashAmount: 5,
    receivedItems: [{ cardName: 'Mew ex', quantity: 1, value: 40 }],
  });

  assert.equal(getTrades(state)[0].givenCashAmount, 15);
  assert.equal(getTrades(state)[0].receivedCashAmount, 5);
  assert.equal(getTrades(state)[0].totalGiven, 15);
  assert.equal(getTrades(state)[0].totalReceived, 45);
  assert.equal(getTrades(state)[0].difference, 30);
  assert.equal(getTrades(state)[0].roi, 200);

  state = updateTrade(state, getTrades(state)[0].id, {
    ...getTrades(state)[0],
    receivedCashAmount: 12.5,
    receivedItems: [{ cardName: 'Mew ex', quantity: 1, value: 40 }],
  });

  assert.equal(getTrades(state)[0].totalReceived, 52.5);
  assert.equal(getTrades(state)[0].difference, 37.5);
  assert.equal(getTrades(state)[0].roi, 250);
});

test('persisted trades normalize graded item values on load', () => {
  const state = ensureAppState({
    tabs: [{
      id: 'default-tab',
      name: 'Default',
      createdAt: '2026-09-21T00:00:00Z',
      transactions: [],
    }],
    activeTabId: 'default-tab',
    trades: [{
      id: 1,
      date: '2026-09-21',
      givenCashAmount: 7.5,
      givenItems: [{ cardName: 'Mewtwo', quantity: 1, value: 99, gradingCompany: 'psa', gradingValue: '10' }],
      receivedCashAmount: 2.5,
      receivedItems: [{ cardName: 'Rayquaza', quantity: 1, value: 110, gradingCompany: 'tag', gradingValue: '10' }],
    }],
  }, {
    now: '2026-09-21T00:00:00Z',
  });

  assert.equal(getTrades(state)[0].givenItems[0].gradingCompany, 'PSA');
  assert.equal(getTrades(state)[0].givenItems[0].gradingLabel, 'Gem Mint');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingCompany, 'TAG');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingValue, '10');
  assert.equal(getTrades(state)[0].receivedItems[0].gradingLabel, 'Gem Mint');
  assert.equal(getTrades(state)[0].givenCashAmount, 7.5);
  assert.equal(getTrades(state)[0].receivedCashAmount, 2.5);
  assert.equal(getTrades(state)[0].totalGiven, 106.5);
  assert.equal(getTrades(state)[0].totalReceived, 112.5);
});

test('tabs keep persisted trade arrays for tab-import migration support', () => {
  const state = ensureAppState({
    tabs: [{
      id: 'tab-a',
      name: 'Tab A',
      transactions: [],
      trades: [{
        id: 40,
        date: '2026-09-24',
        givenItems: [{ cardName: 'Card G', quantity: 1, value: 50, gradingCompany: 'psa', gradingValue: '10' }],
        receivedItems: [{ cardName: 'Card H', quantity: 1, value: 55 }],
      }],
    }],
    activeTabId: 'tab-a',
    trades: [],
  });

  assert.equal(state.tabs[0].trades.length, 1);
  assert.equal(state.tabs[0].trades[0].id, 40);
  assert.equal(state.tabs[0].trades[0].givenItems[0].gradingCompany, 'PSA');
  assert.equal(state.tabs[0].trades[0].givenItems[0].gradingLabel, 'Gem Mint');
});

test('persisted trades normalize invalid or negative cash amounts', () => {
  const state = ensureAppState({
    tabs: [{
      id: 'default-tab',
      name: 'Default',
      createdAt: '2026-09-21T00:00:00Z',
      transactions: [],
    }],
    activeTabId: 'default-tab',
    trades: [{
      id: 1,
      date: '2026-09-21',
      givenCashAmount: '-12.5',
      givenItems: [],
      receivedCashAmount: 'abc',
      receivedItems: [{ cardName: 'Rayquaza', quantity: 1, value: 110 }],
    }],
  }, {
    now: '2026-09-21T00:00:00Z',
  });

  assert.equal(getTrades(state)[0].givenCashAmount, 0);
  assert.equal(getTrades(state)[0].receivedCashAmount, 0);
  assert.equal(getTrades(state)[0].totalGiven, 0);
  assert.equal(getTrades(state)[0].totalReceived, 110);
  assert.equal(getTrades(state)[0].difference, 110);
  assert.equal(getTrades(state)[0].roi, 0);
});

test('trade cash normalization keeps UI and persisted trade behavior aligned', () => {
  assert.equal(normalizeTradeCashAmount(-12.5), 0);
  assert.equal(normalizeTradeCashAmount('abc'), 0);
  assert.equal(parseTradeCashAmountInput('12,5'), 12.5);
  assert.equal(parseTradeCashAmountInput('1.234,56'), 1234.56);
  assert.equal(resolveTradeDraftCashAmount(7, '12,5'), 12.5);
  assert.equal(resolveTradeDraftCashAmount(7, '1.234,56'), 1234.56);
  assert.equal(resolveTradeDraftCashAmount(7, null), 7);
});

test('normalizeTrade removes empty default rows when no cash amount is present', () => {
  const trade = normalizeTrade({
    date: '2026-09-21',
    givenCashAmount: 0,
    givenItems: [{ cardName: '', quantity: 1, value: 0 }],
    receivedCashAmount: 0,
    receivedItems: [{ cardName: '', quantity: 1, value: 0 }],
  });

  assert.deepEqual(trade.givenItems, []);
  assert.deepEqual(trade.receivedItems, []);
  assert.equal(trade.givenCashAmount, 0);
  assert.equal(trade.receivedCashAmount, 0);
  assert.equal(trade.totalGiven, 0);
  assert.equal(trade.totalReceived, 0);
});

// ── Data-integrity fixes ──────────────────────────────────────────────

test('deleting a tab removes its own trades and keeps those of other tabs', () => {
  let state = ensureAppState(null, { defaultTabId: 'tab-1' });
  state = appendTrade(state, {
    givenItems: [{ cardName: 'Charmander (PPS9 PFL 011)', value: 1 }],
    receivedItems: [{ cardName: 'Psyduck (PPS9 ASC 039)', value: 1 }],
  });
  state = addTab(state, 'Second', { id: 'tab-2' }).state;
  state = appendTrade(state, {
    givenItems: [{ cardName: 'Moltres (PPS9 PFL 014)', value: 10 }],
    receivedItems: [{ cardName: 'Zapdos (PPS9 PFL 015)', value: 12 }],
  });
  assert.equal(getTrades(state).length, 1);

  const afterDelete = deleteTab(state, 'tab-2');
  assert.equal(afterDelete.tabs.length, 1);
  assert.equal(getTrades(afterDelete).length, 1);
  assert.equal(getTrades(afterDelete)[0].givenItems[0].cardName, 'Charmander (PPS9 PFL 011)');

  const afterDeletingLastTab = deleteTab(afterDelete, 'tab-1', { defaultTabId: 'fresh' });
  assert.equal(afterDeletingLastTab.activeTabId, 'fresh');
  assert.equal(getTrades(afterDeletingLastTab).length, 0);
});

test('re-importing the same rows is detected as duplicates', () => {
  const existing = [
    { id: 1, type: TYPE_SELL, amount: 12.5, description: 'Moltres (PPS9 PFL 014) #1289784654', date: '2026-10-01' },
    { id: 2, type: TYPE_BUY, amount: -5, description: 'Bulk', date: '2026-10-02' },
  ];
  const incoming = [
    { type: TYPE_SELL, amount: 12.5, description: 'Moltres (PPS9 PFL 014) #1289784654', date: '2026-10-01' },
    { type: TYPE_BUY, amount: 5, description: 'bulk', date: '2026-10-02' },
    { type: TYPE_SELL, amount: 3, description: 'Nieuwe verkoop', date: '2026-10-03' },
  ];
  const { added, skipped } = filterDuplicateTransactions(existing, incoming);
  assert.equal(skipped, 2);
  assert.deepEqual(added.map(t => t.description), ['Nieuwe verkoop']);
});

test('identical rows in one file are all imported the first time, but only once', () => {
  const row = { type: TYPE_SELL, amount: 1, description: 'Bulk', date: '2026-10-01' };
  const first = filterDuplicateTransactions([], [row, row]);
  assert.equal(first.added.length, 2);

  const existing = first.added.map((t, i) => ({ ...t, id: i + 1 }));
  const second = filterDuplicateTransactions(existing, [row, row, row]);
  assert.equal(second.skipped, 2);
  assert.equal(second.added.length, 1);
});

test('rows without a date in the file ignore the date when checking duplicates', () => {
  const existing = [{ id: 1, type: TYPE_SELL, amount: 7, description: 'Vinted', date: '2026-09-01' }];
  const incoming = [{ type: TYPE_SELL, amount: 7, description: 'Vinted', date: '2026-10-26', importHasDate: false }];
  assert.equal(filterDuplicateTransactions(existing, incoming).skipped, 1);

  const dated = [{ type: TYPE_SELL, amount: 7, description: 'Vinted', date: '2026-10-26' }];
  assert.equal(filterDuplicateTransactions(existing, dated).skipped, 0);
});

test('Excel serial dates and Dutch date formats are parsed correctly', () => {
  assert.equal(excelSerialToISO(46022), '2025-12-31');
  assert.equal(normalizeDate('46022', 'FALLBACK'), '2025-12-31');
  assert.equal(normalizeDate('46022.75', 'FALLBACK'), '2025-12-31');
  assert.equal(normalizeDate(46022, 'FALLBACK'), '2025-12-31');
  assert.equal(normalizeDate('05-03-2026', 'FALLBACK'), '2026-03-05');
  assert.equal(normalizeDate('5/3/2026', 'FALLBACK'), '2026-03-05');
  assert.equal(normalizeDate('26.10.2026', 'FALLBACK'), '2026-10-26');
  assert.equal(normalizeDate('2026-10-26', 'FALLBACK'), '2026-10-26');
  assert.equal(normalizeDate('2026-10-26T23:30:00', 'FALLBACK'), '2026-10-26');
  assert.equal(normalizeDate('31-02-2026', 'FALLBACK'), 'FALLBACK');
  assert.equal(normalizeDate('12', 'FALLBACK'), 'FALLBACK');
  assert.equal(normalizeDate('onzin', 'FALLBACK'), 'FALLBACK');
});

test('today uses the local calendar date, not UTC', () => {
  const justAfterMidnight = new Date(2026, 9, 27, 0, 30);
  assert.equal(todayISO(justAfterMidnight), '2026-10-27');
  const firstOfMonth = new Date(2026, 9, 1);
  assert.equal(todayISO(firstOfMonth), '2026-10-01');
});

test('graded and raw copies of a card are matched separately', () => {
  const rows = computeProfitByCard([
    { type: TYPE_BUY, cardName: 'Charizard', amount: 10, date: '2026-01-01' },
    { type: TYPE_BUY, cardName: 'Charizard', amount: 300, gradingCompany: 'PSA', gradingValue: '10', date: '2026-01-02' },
    { type: TYPE_SELL, cardName: 'charizard', amount: 400, gradingCompany: 'PSA', gradingValue: '10', date: '2026-02-01' },
    { type: TYPE_BUY, cardName: 'Charizard', amount: 150, gradingCompany: 'PSA', gradingValue: '9', date: '2026-01-03' },
  ]);

  const byName = Object.fromEntries(rows.map(row => [row.displayName, row]));
  assert.deepEqual(Object.keys(byName).sort(), ['Charizard', 'Charizard [PSA 10]', 'Charizard [PSA 9]']);
  assert.equal(byName['Charizard [PSA 10]'].realizedProfit, 100);
  assert.equal(byName['Charizard'].remainingQty, 1);
  assert.equal(byName['Charizard'].realizedProfit, 0);
  assert.equal(byName['Charizard [PSA 9]'].remainingCost, 150);
});

test('missing or duplicate ids are replaced with unique ones on load', () => {
  assert.deepEqual(assignUniqueIds([{}, { id: 1 }, { id: 1 }, { id: 'x' }]).map(t => t.id), [2, 1, 3, 4]);

  const state = ensureAppState({
    tabs: [
      { id: 'a', name: 'A', transactions: [{ id: 1, type: TYPE_SELL, amount: 1 }, { type: TYPE_SELL, amount: 2 }] },
      { id: 'b', name: 'B', transactions: [{ id: 1, type: TYPE_SELL, amount: 3 }] },
    ],
    activeTabId: 'a',
    trades: [{}, { id: 1 }],
  });
  assert.deepEqual(getTrades(state).map(t => t.id).sort(), [1, 2]);
  const txnIds = state.tabs.flatMap(tab => tab.transactions.map(t => t.id));
  assert.equal(new Set(txnIds).size, txnIds.length);
  assert.deepEqual(state.tabs.map(tab => tab.transactions.length), [2, 1]);
});

test('grading scales follow the official company scales', () => {
  const values = company => getGradingScale(company).map(option => option.value);
  // PSA: whole grades plus half grades 1.5–8.5, no 9.5
  assert.deepEqual(values('PSA'), ['10', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1']);
  // TAG: Pristine and Gem Mint 10, no 9.5, halves down to 1.5
  assert.equal(values('TAG').includes('9.5'), false);
  assert.equal(values('TAG').length, 19);
  assert.equal(values('CGC').length, 20);
  assert.equal(values('BGS').length, 20);

  assert.equal(formatGrade('TAG', '8.5'), 'TAG 8.5 · NM MT+');
  assert.equal(formatGrade('TAG', '10-pristine'), 'TAG 10 · Pristine');
  assert.equal(formatGrade('CGC', '9.5'), 'CGC 9.5 · Mint+');
  assert.equal(formatGrade('BGS', '10-black'), 'BGS 10 · Black Label Pristine');
  assert.equal(formatGrade('PSA', '1.5'), 'PSA 1.5 · Fair');
  assert.equal(getGradeNumber('CGC', '10-pristine'), '10');
  assert.equal(getGradeNumber('CGC', 'nonsense'), '');
});

test('existing stored grades stay valid after the scale update', () => {
  const previouslyStored = {
    PSA: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
    BGS: ['10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1'],
    CGC: ['10', '9.5', '9', '8.5', '8', '7', '6', '5', '4', '3', '2', '1'],
    TAG: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  };
  for (const [company, grades] of Object.entries(previouslyStored)) {
    for (const grade of grades) {
      assert.equal(normalizeGradingValue(company, grade), grade, `${company} ${grade}`);
    }
  }
});

test('Pristine and Gem Mint 10s are separate rows in profit per card', () => {
  const rows = computeProfitByCard([
    { type: TYPE_BUY, cardName: 'Mew ex (MEW 151)', amount: 100, gradingCompany: 'CGC', gradingValue: '10', date: '2026-01-01' },
    { type: TYPE_BUY, cardName: 'Mew ex (MEW 151)', amount: 250, gradingCompany: 'CGC', gradingValue: '10-pristine', date: '2026-01-02' },
  ]);
  assert.deepEqual(rows.map(row => row.displayName).sort(), ['Mew ex (MEW 151) [CGC 10 Pristine]', 'Mew ex (MEW 151) [CGC 10]']);
});

test('shared trades from older versions move into the first open tab', () => {
  const state = ensureAppState({
    tabs: [
      { id: 'tab-archived', name: 'Oud', archived: true, transactions: [] },
      { id: 'tab-main', name: 'Main', transactions: [] },
      { id: 'tab-event', name: 'Beurs', transactions: [] },
    ],
    activeTabId: 'tab-event',
    trades: [
      { id: 1, date: '2026-09-27', givenItems: [{ cardName: 'A', quantity: 1, value: 10 }], receivedItems: [{ cardName: 'B', quantity: 1, value: 12 }] },
      { id: 2, date: '2026-09-27', givenItems: [{ cardName: 'C', quantity: 1, value: 6 }], receivedItems: [{ cardName: 'D', quantity: 1, value: 5 }] },
    ],
  });

  assert.equal('trades' in state, false);
  assert.deepEqual(state.tabs.find(tab => tab.id === 'tab-main').trades.map(trade => trade.id), [1, 2]);
  assert.equal(state.tabs.find(tab => tab.id === 'tab-event').trades.length, 0);
  assert.equal(state.tabs.find(tab => tab.id === 'tab-archived').trades.length, 0);

  // Loading the migrated state again changes nothing.
  const reloaded = ensureAppState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded.tabs.map(tab => tab.trades.length), [0, 2, 0]);
});

test('trades are kept per tab and ids stay unique across tabs', () => {
  let state = ensureAppState({
    tabs: [
      { id: 'tab-a', name: 'A', transactions: [], trades: [{ id: 3, givenItems: [{ cardName: 'X', quantity: 1, value: 1 }], receivedItems: [] }] },
      { id: 'tab-b', name: 'B', transactions: [], trades: [{ id: 3, givenItems: [{ cardName: 'Y', quantity: 1, value: 1 }], receivedItems: [] }] },
    ],
    activeTabId: 'tab-b',
  });

  const ids = state.tabs.flatMap(tab => tab.trades.map(trade => trade.id));
  assert.equal(new Set(ids).size, ids.length);

  state = appendTrade(state, { date: '2026-10-01', givenItems: [{ cardName: 'Z', quantity: 1, value: 2 }], receivedItems: [] });
  assert.equal(getTrades(state).length, 2);
  assert.equal(state.tabs.find(tab => tab.id === 'tab-a').trades.length, 1);
  assert.equal(getTrades(state).at(-1).id, Math.max(...ids) + 1);

  const tradeInA = state.tabs.find(tab => tab.id === 'tab-a').trades[0];
  const afterForeignDelete = deleteTrade(state, tradeInA.id);
  assert.equal(afterForeignDelete.tabs.find(tab => tab.id === 'tab-a').trades.length, 1);

  state = setActiveTab(state, 'tab-a');
  assert.deepEqual(getTrades(state).map(trade => trade.givenItems[0].cardName), ['X']);
});

test('tabs can be moved to a new position', () => {
  const state = ensureAppState({
    tabs: [
      { id: 'a', name: 'A', transactions: [] },
      { id: 'b', name: 'B', transactions: [] },
      { id: 'x', name: 'X', archived: true, transactions: [] },
      { id: 'c', name: 'C', transactions: [] },
    ],
    activeTabId: 'b',
  });

  const order = next => next.tabs.map(tab => tab.id).join('');
  assert.equal(order(moveTab(state, 'c', 0)), 'cabx');
  assert.equal(order(moveTab(state, 'a', 2)), 'bcax');
  assert.equal(order(moveTab(state, 'a', 99)), 'bcax');
  assert.equal(order(moveTab(state, 'b', -5)), 'bacx');
  assert.equal(moveTab(state, 'b', 1), state);
  assert.equal(moveTab(state, 'x', 0), state);
  assert.equal(moveTab(state, 'c', 0).activeTabId, 'b');
});

test('extractSetCode takes the first code after an opening bracket', () => {
  assert.equal(extractSetCode('Gengar ex (30C 154)'), '30C');
  assert.equal(extractSetCode('Sleep! (TR 79)'), 'TR');
  assert.equal(extractSetCode('Mega Sableye & Tyranitar GX (UNM 126)'), 'UNM');
  assert.equal(extractSetCode('Gengar (xPOR 050)'), 'xPOR');
  assert.equal(extractSetCode('Moltres (PPS9 PFL 014)'), 'PPS9');
  assert.equal(extractSetCode("Lt. Surge's Bargain (m1L 090) (Korean)"), 'm1L');
  assert.equal(extractSetCode('Ancient Mew (PR)'), 'PR');
  assert.equal(extractSetCode('Pikachu (Holo Version)'), '');
  assert.equal(extractSetCode('Booster bundle'), '');
});

test('getSetName handles Prize Pack Series, Additionals and unknown codes', () => {
  assert.equal(getSetName('POR'), 'Perfect Order');
  assert.equal(getSetName('xPOR'), 'Perfect Order: Additionals');
  assert.equal(getSetName('PPS9'), 'Play! Pokémon Prize Pack Series Nine');
  assert.equal(getSetName('PPS10'), 'Play! Pokémon Prize Pack Series Ten');
  assert.equal(getSetName('MCD18'), "McDonald's Collection 2018");
  assert.equal(getSetName('XY'), 'XY');
  assert.equal(getSetName('sv7a'), 'Paradise Dragona');
  assert.equal(getSetName('xm1L'), 'Mega Brave: Additionals');
  assert.equal(getSetName('ZZZ'), '');
  assert.equal(getSetName('xZZZ'), '');
});

test('computeSetSales groups sold cards per set, best revenue first', () => {
  const sets = computeSetSales([
    { type: 'Gekocht', amount: -10, cardName: 'Gengar (xPOR 050)', quantity: 2, date: '2026-01-01' },
    { type: 'Verkocht', amount: 15, cardName: 'Gengar (xPOR 050)', quantity: 1, date: '2026-01-02' },
    { type: 'Verkocht', amount: 40, cardName: 'Gengar ex (30C 154)', quantity: 1, date: '2026-01-02' },
    { type: 'Verkocht', amount: 5, cardName: 'Lycanroc (30C 138)', quantity: 2, date: '2026-01-03' },
    { type: 'Gekocht', amount: -50, cardName: 'Moltres (PPS9 PFL 014)', quantity: 1, date: '2026-01-03' },
    { type: 'Verkocht', amount: 20, description: 'Bulk (MEG 001)', cardName: 'Bulk (MEG 001)', quantity: 1, date: '2026-01-04' },
  ]);
  assert.deepEqual(sets.map(set => set.code), ['30C', 'xPOR']);
  assert.equal(sets[0].soldQty, 3);
  assert.equal(sets[0].cardCount, 2);
  assert.equal(sets[0].soldValue, 45);
  assert.equal(sets[0].profitMargin, null);
  assert.equal(sets[1].name, 'Perfect Order: Additionals');
  assert.equal(sets[1].realizedProfit, 10);
  assert.equal(sets[1].profitMargin, 200);
});

test('own set names override the built-in list and survive a reload', () => {
  const now = new Date('2026-11-09T12:00:00');
  let state = ensureAppState(null);
  state = setCustomSetName(state, 'DLX', 'Deluxe Thing', { now });
  state = setCustomSetName(state, 'POR', 'Perfect Order (eigen)', { now });
  state = setCustomSetName(state, 'bad code!', 'x', { now });
  assert.deepEqual(state.setNames, { DLX: 'Deluxe Thing', POR: 'Perfect Order (eigen)' });
  assert.equal(getSetName('DLX', state.setNames), 'Deluxe Thing');
  assert.equal(getSetName('xDLX', state.setNames), 'Deluxe Thing: Additionals');
  assert.equal(getSetName('POR', state.setNames), 'Perfect Order (eigen)');
  assert.equal(state.setNamesReminderAt, '2026-12-09');

  const reloaded = ensureAppState(JSON.stringify(state));
  assert.deepEqual(reloaded.setNames, state.setNames);
  assert.equal(reloaded.setNamesReminderAt, '2026-12-09');

  const sets = computeSetSales([{ type: 'Verkocht', amount: 5, cardName: 'Pikachu (DLX 001)', quantity: 1, date: '2026-01-01' }], state.setNames);
  assert.equal(sets[0].name, 'Deluxe Thing');
  assert.equal(sets[0].isCustom, true);

  // Empty name or the built-in name removes the own name again.
  state = setCustomSetName(state, 'POR', 'Perfect Order', { now });
  state = setCustomSetName(state, 'DLX', '  ', { now });
  assert.deepEqual(state.setNames, {});
  assert.equal(state.setNamesReminderAt, undefined);
});

test('names that are now built in are dropped on load', () => {
  const state = ensureAppState({ tabs: [], setNames: { PBL: 'Pitch Black', NEW: 'Brand New' }, setNamesReminderAt: '2026-12-01' });
  assert.deepEqual(state.setNames, { NEW: 'Brand New' });
});

test('set names reminder is due monthly and can be snoozed', () => {
  let state = setCustomSetName(ensureAppState(null), 'NEW', 'Brand New', { now: new Date('2026-11-09T12:00:00') });
  assert.equal(isSetNamesReminderDue(state, new Date('2026-12-08T12:00:00')), false);
  assert.equal(isSetNamesReminderDue(state, new Date('2026-12-09T12:00:00')), true);
  state = snoozeSetNamesReminder(state, 30, new Date('2026-12-09T12:00:00'));
  assert.equal(state.setNamesReminderAt, '2027-01-08');
  assert.equal(isSetNamesReminderDue(state, new Date('2026-12-20T12:00:00')), false);
  assert.equal(formatSetNamesForExport({ ZZ: 'Zed', AA: 'Ay' }), 'AA = Ay\nZZ = Zed');
});
