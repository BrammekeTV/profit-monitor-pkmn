import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TAB_NAME,
  TYPE_BUY,
  TYPE_SELL,
  addTab,
  appendTrade,
  computeCardmarketSurplus,
  computeProfitByCard,
  deleteTab,
  deleteTrade,
  ensureAppState,
  computeTradeMonthlyData,
  computeTradeSummary,
  extractCardmarketOrderIds,
  getGradeLabel,
  getGradingScale,
  getTrades,
  getActiveTab,
  getCardmarketOrderLinks,
  normalizeGradingValue,
  normalizeTrade,
  normalizeTransaction,
  setActiveTab,
  updateTrade,
  validateTabName,
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

  const repaired = ensureAppState({
    tabs: state.tabs,
    activeTabId: 'missing-tab',
  });

  assert.equal(repaired.activeTabId, state.tabs[0].id);
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
    boughtQty: 14,
    soldQty: 8,
    boughtValue: 140,
    soldValue: 125,
    allocatedBuyCost: 80,
    realizedProfit: 45,
    remainingQty: 6,
    remainingCost: 60,
  });
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

test('trade normalization calculates totals, difference and ROI', () => {
  const trade = normalizeTrade({
    date: '2026-09-01',
    givenItems: [
      { cardName: 'Charizard ex', quantity: 1, unitValue: 80 },
      { cardName: 'Pikachu', quantity: 2, unitValue: 20 },
    ],
    receivedItems: [
      { cardName: 'Umbreon VMAX', quantity: 1, unitValue: 125 },
    ],
  });

  assert.equal(trade.totalGiven, 120);
  assert.equal(trade.totalReceived, 125);
  assert.equal(trade.difference, 5);
  assert.equal(trade.roi, 4.17);

  const zeroGiven = normalizeTrade({
    date: '2026-09-02',
    givenItems: [{ cardName: 'Gift', quantity: 1, unitValue: 0 }],
    receivedItems: [{ cardName: 'Trade return', quantity: 1, unitValue: 10 }],
  });
  assert.equal(zeroGiven.roi, 100);
});

test('trade CRUD keeps trades separate from sales transactions', () => {
  let state = ensureAppState([
    { id: 1, type: TYPE_SELL, amount: 100, description: 'Sale' },
  ]);
  assert.equal(getTrades(state).length, 0);

  state = appendTrade(state, {
    date: '2026-09-10',
    givenItems: [{ cardName: 'A', quantity: 1, unitValue: 10 }],
    receivedItems: [{ cardName: 'B', quantity: 1, unitValue: 15 }],
  });

  assert.equal(getTrades(state).length, 1);
  assert.equal(state.tabs[0].transactions.length, 1);

  const created = getTrades(state)[0];
  state = updateTrade(state, created.id, {
    ...created,
    receivedItems: [{ cardName: 'B', quantity: 1, unitValue: 20 }],
  });
  assert.equal(getTrades(state)[0].totalReceived, 20);
  assert.equal(state.tabs[0].transactions.length, 1);

  state = deleteTrade(state, created.id);
  assert.equal(getTrades(state).length, 0);
  assert.equal(state.tabs[0].transactions.length, 1);

  assert.throws(() => updateTrade(state, 9999, created), /Trade niet gevonden/);
  assert.throws(() => deleteTrade(state, 9999), /Trade niet gevonden/);
});

test('trade summary and monthly analytics are aggregated correctly', () => {
  const trades = [
    normalizeTrade({
      date: '2026-08-01',
      givenItems: [{ cardName: 'A', quantity: 1, unitValue: 100 }],
      receivedItems: [{ cardName: 'B', quantity: 1, unitValue: 120 }],
    }),
    normalizeTrade({
      date: '2026-08-14',
      givenItems: [{ cardName: 'C', quantity: 1, unitValue: 90 }],
      receivedItems: [{ cardName: 'D', quantity: 1, unitValue: 80 }],
    }),
    normalizeTrade({
      date: '2026-09-02',
      givenItems: [{ cardName: 'E', quantity: 2, unitValue: 20 }],
      receivedItems: [{ cardName: 'F', quantity: 1, unitValue: 50 }],
    }),
  ];

  const summary = computeTradeSummary(trades);
  assert.equal(summary.count, 3);
  assert.equal(summary.totalGiven, 230);
  assert.equal(summary.totalReceived, 250);
  assert.equal(summary.totalDifference, 20);
  assert.equal(summary.averageDifference, 6.67);
  assert.equal(summary.weightedRoi, 8.7);
  assert.equal(summary.totalTradeValue, 480);
  assert.equal(summary.averageTradeValue, 160);
  assert.equal(summary.positiveCount, 2);
  assert.equal(summary.negativeCount, 1);
  assert.equal(summary.neutralCount, 0);
  assert.equal(summary.bestTrade.difference, 20);
  assert.equal(summary.worstTrade.difference, -10);

  const monthly = computeTradeMonthlyData(trades);
  assert.equal(monthly.length, 2);
  assert.deepEqual(monthly.map(item => item.month), ['2026-08', '2026-09']);
  assert.equal(monthly[0].count, 2);
  assert.equal(monthly[0].totalDifference, 10);
  assert.equal(monthly[0].weightedRoi, 5.26);
  assert.equal(monthly[1].totalDifference, 10);
  assert.equal(monthly[1].weightedRoi, 25);
});

test('trade monthly analytics follows normalized trade dates', () => {
  const monthly = computeTradeMonthlyData([
    normalizeTrade({
      date: 'not-a-date',
      givenItems: [{ cardName: 'A', quantity: 1, unitValue: 10 }],
      receivedItems: [{ cardName: 'B', quantity: 1, unitValue: 15 }],
    }, { now: '2026-12-31' }),
    normalizeTrade({
      date: '2026-13-40',
      givenItems: [{ cardName: 'X', quantity: 1, unitValue: 10 }],
      receivedItems: [{ cardName: 'Y', quantity: 1, unitValue: 20 }],
    }, { now: '2026-12-31' }),
    {
      date: '2026-10-02',
      givenItems: [{ cardName: 'E', quantity: 1, unitValue: 30 }],
      receivedItems: [{ cardName: 'F', quantity: 1, unitValue: 40 }],
    },
  ]);

  assert.equal(monthly.length, 2);
  assert.equal(monthly[0].month, '2026-10');
  assert.equal(monthly[0].count, 1);
  assert.equal(monthly[1].month, '2026-12');
  assert.equal(monthly[1].count, 2);
});

test('trade ROI uses 100% fallback when given value is zero and received is positive', () => {
  const trades = [
    normalizeTrade({
      date: '2026-11-01',
      givenItems: [{ cardName: 'Gift', quantity: 1, unitValue: 0 }],
      receivedItems: [{ cardName: 'Card', quantity: 1, unitValue: 25 }],
    }),
  ];

  const summary = computeTradeSummary(trades);
  assert.equal(summary.weightedRoi, 100);

  const monthly = computeTradeMonthlyData(trades);
  assert.equal(monthly.length, 1);
  assert.equal(monthly[0].weightedRoi, 100);
});
