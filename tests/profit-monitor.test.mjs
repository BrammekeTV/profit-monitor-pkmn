import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_TAB_NAME,
  TYPE_BUY,
  TYPE_SELL,
  addTab,
  computeProfitByCard,
  deleteTab,
  ensureAppState,
  extractCardmarketOrderIds,
  getActiveTab,
  getCardmarketOrderLinks,
  setActiveTab,
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

test('Cardmarket order ids and links are generated only for sold transactions', () => {
  const description = 'Lot verkocht via Cardmarket #1289784654 en #1289784655, dubbele #1289784654';

  assert.deepEqual(extractCardmarketOrderIds(description), ['1289784654', '1289784655']);
  assert.deepEqual(getCardmarketOrderLinks({
    type: TYPE_SELL,
    description,
  }), [
    {
      id: '1289784654',
      url: 'https://www.cardmarket.com/en/Pokemon/Orders/1289784654',
    },
    {
      id: '1289784655',
      url: 'https://www.cardmarket.com/en/Pokemon/Orders/1289784655',
    },
  ]);
  assert.deepEqual(getCardmarketOrderLinks({
    type: TYPE_BUY,
    description,
  }), []);
});
