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
  assert.deepEqual(state.trades, []);

  const repaired = ensureAppState({
    tabs: state.tabs,
    activeTabId: 'missing-tab',
  });

  assert.equal(repaired.activeTabId, state.tabs[0].id);
  assert.deepEqual(repaired.trades, []);
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
  assert.equal(normalizeGradingValue('BGS', '9.5'), '9.5');
  assert.equal(normalizeGradingValue('TAG', '9.5'), '');
  assert.equal(getGradeLabel('CGC', '10'), 'Pristine');
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

test('trades are stored separately and support CRUD plus analytics', () => {
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

  assert.equal(state.trades.length, 1);
  assert.equal(state.trades[0].totalGiven, 120);
  assert.equal(state.trades[0].totalReceived, 125);
  assert.equal(state.trades[0].difference, 5);
  assert.equal(state.trades[0].roi, 4.17);
  assert.equal(state.trades[0].givenItems[0].gradingCompany, 'PSA');
  assert.equal(state.trades[0].givenItems[0].gradingValue, '10');
  assert.equal(state.trades[0].givenItems[0].gradingLabel, 'Gem Mint');
  assert.equal(state.trades[0].receivedItems[0].gradingCompany, 'TAG');
  assert.equal(state.trades[0].receivedItems[0].gradingValue, '9');
  assert.equal(state.trades[0].receivedItems[0].gradingLabel, '9');

  state = updateTrade(state, state.trades[0].id, {
    ...state.trades[0],
    receivedItems: [{ cardName: 'Umbreon VMAX', quantity: 1, value: 130 }],
  });

  assert.equal(state.trades[0].difference, 10);
  assert.equal(state.trades[0].roi, 8.33);

  const analytics = computeTradeAnalytics(state.trades);
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

  const series = computeTradePerformanceSeries(state.trades);
  assert.deepEqual(series, [{
    id: state.trades[0].id,
    date: '2026-09-21',
    difference: 10,
    cumulativeDifference: 10,
  }]);

  state = deleteTrade(state, state.trades[0].id);
  assert.equal(state.trades.length, 0);
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

  assert.equal(next.trades.length, 3);
  assert.deepEqual(next.trades.map(trade => trade.id), [1, 2, 3]);
  assert.equal(next.trades[1].givenItems[0].gradingCompany, 'PSA');
  assert.equal(next.trades[1].givenItems[0].gradingLabel, 'Gem Mint');
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

  assert.equal(state.trades[0].givenCashAmount, 15);
  assert.equal(state.trades[0].receivedCashAmount, 5);
  assert.equal(state.trades[0].totalGiven, 15);
  assert.equal(state.trades[0].totalReceived, 45);
  assert.equal(state.trades[0].difference, 30);
  assert.equal(state.trades[0].roi, 200);

  state = updateTrade(state, state.trades[0].id, {
    ...state.trades[0],
    receivedCashAmount: 12.5,
    receivedItems: [{ cardName: 'Mew ex', quantity: 1, value: 40 }],
  });

  assert.equal(state.trades[0].totalReceived, 52.5);
  assert.equal(state.trades[0].difference, 37.5);
  assert.equal(state.trades[0].roi, 250);
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

  assert.equal(state.trades[0].givenItems[0].gradingCompany, 'PSA');
  assert.equal(state.trades[0].givenItems[0].gradingLabel, 'Gem Mint');
  assert.equal(state.trades[0].receivedItems[0].gradingCompany, 'TAG');
  assert.equal(state.trades[0].receivedItems[0].gradingValue, '10');
  assert.equal(state.trades[0].receivedItems[0].gradingLabel, '10');
  assert.equal(state.trades[0].givenCashAmount, 7.5);
  assert.equal(state.trades[0].receivedCashAmount, 2.5);
  assert.equal(state.trades[0].totalGiven, 106.5);
  assert.equal(state.trades[0].totalReceived, 112.5);
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

  assert.equal(state.trades[0].givenCashAmount, 0);
  assert.equal(state.trades[0].receivedCashAmount, 0);
  assert.equal(state.trades[0].totalGiven, 0);
  assert.equal(state.trades[0].totalReceived, 110);
  assert.equal(state.trades[0].difference, 110);
  assert.equal(state.trades[0].roi, 0);
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

test('deleting a tab keeps the trades', () => {
  let state = ensureAppState(null, { defaultTabId: 'tab-1' });
  state = addTab(state, 'Second', { id: 'tab-2' }).state;
  state = appendTrade(state, {
    givenItems: [{ cardName: 'Moltres (PPS9 PFL 014)', value: 10 }],
    receivedItems: [{ cardName: 'Zapdos (PPS9 PFL 015)', value: 12 }],
  });
  assert.equal(state.trades.length, 1);

  const afterDelete = deleteTab(state, 'tab-2');
  assert.equal(afterDelete.trades.length, 1);
  assert.equal(afterDelete.tabs.length, 1);

  const afterDeletingLastTab = deleteTab(afterDelete, 'tab-1', { defaultTabId: 'fresh' });
  assert.equal(afterDeletingLastTab.trades.length, 1);
  assert.equal(afterDeletingLastTab.activeTabId, 'fresh');
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
  assert.deepEqual(state.trades.map(t => t.id).sort(), [1, 2]);
  const txnIds = state.tabs.flatMap(tab => tab.transactions.map(t => t.id));
  assert.equal(new Set(txnIds).size, txnIds.length);
  assert.deepEqual(state.tabs.map(tab => tab.transactions.length), [2, 1]);
});
