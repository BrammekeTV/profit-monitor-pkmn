import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TAB_NAME,
  TYPE_BUY,
  TYPE_SELL,
  addTab,
  appendTrade,
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
  normalizeGradingValue,
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
