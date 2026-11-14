import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addAutoCardImages,
  cardImageKey,
  clearCardImage,
  ensureAppState,
  formatCardPicksForExport,
  getCardImage,
  getCustomCardPicks,
  isCardPicksReminderDue,
  normalizeTransaction,
  normalizeTransactionImages,
  parseCardReference,
  setCardImage,
  snoozeCardPicksReminder,
} from '../profit-monitor-core.mjs';
import { createCardImageResolver, numberVariants, sameCardNumber } from '../card-images.mjs';

const SERVER_IMG = 'img-0f8fad5b-d9cb-469f-a165-70867728950e.webp';

test('parseCardReference splits name, set code and number', () => {
  assert.deepEqual(parseCardReference('Charizard ex (OBF 125)'), { name: 'Charizard ex', setCode: 'OBF', number: '125' });
  assert.deepEqual(parseCardReference('Moltres (PPS9 PFL 014)'), { name: 'Moltres', setCode: 'PPS9', number: '014' });
  assert.deepEqual(parseCardReference('Umbreon VMAX (EVS 215/203) #123456789'), { name: 'Umbreon VMAX', setCode: 'EVS', number: '215' });
  assert.deepEqual(parseCardReference('Pikachu (Reverse Holo)'), { name: 'Pikachu', setCode: '', number: '' });
  assert.deepEqual(parseCardReference('Mega Gardevoir ex'), { name: 'Mega Gardevoir ex', setCode: '', number: '' });
});

test('transaction images survive normalization and reloads; junk is dropped', () => {
  const txn = normalizeTransaction({ type: 'Gekocht', amount: 10, description: 'Booster box', images: [SERVER_IMG, 'javascript:alert(1)', 'data:image/webp;base64,AAAA', SERVER_IMG] });
  assert.deepEqual(txn.images, [SERVER_IMG, 'data:image/webp;base64,AAAA']);
  assert.equal('images' in normalizeTransaction({ type: 'Gekocht', amount: 1, description: 'x' }), false);

  const state = ensureAppState({ tabs: [{ id: 't', name: 'Main', transactions: [{ id: 1, type: 'Gekocht', amount: -10, description: 'Box', images: [SERVER_IMG] }] }], activeTabId: 't' });
  assert.deepEqual(ensureAppState(JSON.parse(JSON.stringify(state))).tabs[0].transactions[0].images, [SERVER_IMG]);
  assert.equal(normalizeTransactionImages(Array(20).fill(0).map((_, i) => `data:image/png;base64,A${i}`)).length, 12);
});

test('card image choices: auto, user pick, none, reset and monthly reminder', () => {
  const card = { id: 'sv03-125', image: 'https://assets.tcgdex.net/en/sv/sv03/125', name: 'Charizard ex', setName: 'Obsidian Flames' };
  const now = new Date('2026-11-15T12:00:00');
  let state = ensureAppState(null);

  state = addAutoCardImages(state, { 'Charizard ex (OBF 125)': card, 'Bad': { id: 'x', image: 'https://evil.example/x' } });
  assert.equal(getCardImage(state, 'charizard ex  (obf 125)').source, 'auto');
  assert.equal(getCardImage(state, 'Bad'), null);
  assert.deepEqual(getCustomCardPicks(state), {});
  assert.equal(state.cardPicksReminderAt, undefined);

  state = setCardImage(state, 'Pikachu (SVP 101)', { ...card, id: 'svp-101', image: 'https://assets.tcgdex.net/en/sv/svp/101' }, 'user', { now });
  assert.equal(state.cardPicksReminderAt, '2026-12-15');
  assert.equal(isCardPicksReminderDue(state, now), false);
  assert.equal(isCardPicksReminderDue(state, new Date('2026-12-15T09:00:00')), true);
  assert.equal(snoozeCardPicksReminder(state, 30, new Date('2026-12-15T09:00:00')).cardPicksReminderAt, '2027-01-14');

  // An automatic match never overrides a hand-picked one.
  state = addAutoCardImages(state, { 'Pikachu (SVP 101)': card });
  assert.equal(getCardImage(state, 'Pikachu (SVP 101)').id, 'svp-101');

  state = setCardImage(state, 'Booster Bundle', null, 'none');
  assert.equal(getCardImage(state, 'Booster Bundle').source, 'none');
  assert.equal(formatCardPicksForExport(getCustomCardPicks(state)),
    'booster bundle = geen afbeelding\npikachu (svp 101) = svp-101 | https://assets.tcgdex.net/en/sv/svp/101 | Obsidian Flames');

  // Saved and loaded again (server / JSON export) keeps everything.
  const reloaded = ensureAppState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded.cardImages, state.cardImages);
  assert.equal(reloaded.cardPicksReminderAt, '2026-12-15');

  state = clearCardImage(clearCardImage(state, 'Pikachu (SVP 101)'), 'Booster Bundle');
  assert.equal(state.cardPicksReminderAt, undefined);
  assert.equal(cardImageKey('  A  B '), 'a b');
});

test('number helpers', () => {
  assert.deepEqual(numberVariants('014'), ['014', '14']);
  assert.deepEqual(numberVariants('7'), ['7', '007']);
  assert.deepEqual(numberVariants('TG05'), ['TG05']);
  assert.ok(sameCardNumber('014', '14'));
  assert.ok(sameCardNumber('TG05', 'tg5'));
  assert.ok(!sameCardNumber('125', '126'));
});

// A tiny fake TCGdex.
function fakeTcgdex() {
  const calls = [];
  const sets = {
    en: [{ id: 'sv03', name: 'Obsidian Flames' }, { id: 'svp', name: 'SV Black Star Promos' }, { id: 'sv03.5', name: '151' }],
    ja: [{ id: 'M1L', name: 'メガブレイブ' }],
  };
  const cards = {
    'en/sv03-125': { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03/125', set: { id: 'sv03', name: 'Obsidian Flames' } },
    'ja/M1L-087': { id: 'M1L-087', localId: '087', name: 'メガサーナイトex', image: 'https://assets.tcgdex.net/ja/M/M1L/087', set: { id: 'M1L', name: 'メガブレイブ' } },
  };
  const byName = {
    'Charizard ex': [
      { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03/125' },
      { id: 'sv03.5-6', localId: '6', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03.5/6' },
    ],
    'Mew ex': [{ id: 'sv03.5-151', localId: '151', name: 'Mew ex', image: 'https://assets.tcgdex.net/en/sv/sv03.5/151' }],
  };
  const fetchImpl = async url => {
    calls.push(url);
    const u = new URL(url);
    const [, , lang, kind, id] = u.pathname.split('/');
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (kind === 'sets') return json(sets[lang]);
    if (kind === 'cards' && id) {
      const card = cards[`${lang}/${decodeURIComponent(id)}`];
      return card ? json(card) : { ok: false, status: 404, json: async () => ({}) };
    }
    if (kind === 'cards') {
      const name = u.searchParams.get('name') || '';
      const exact = name.startsWith('eq:');
      const query = exact ? name.slice(3) : name;
      const list = lang === 'en' ? Object.entries(byName)
        .filter(([key]) => (exact ? key === query : key.toLowerCase().includes(query.toLowerCase())))
        .flatMap(([, value]) => value) : [];
      return json(list);
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

test('resolver: exact card by set code + number, Japanese sets, ambiguity, caching', async () => {
  const { fetchImpl, calls } = fakeTcgdex();
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), key: i => [...store.keys()][i], get length() { return store.size; } };
  const resolver = createCardImageResolver({ fetchImpl, storage });

  const exact = await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(exact.status, 'found');
  assert.equal(exact.match.id, 'sv03-125');
  assert.equal(exact.match.setName, 'Obsidian Flames');

  const japanese = await resolver.resolve('Mega Gardevoir ex (m1L 087)', { setName: 'Mega Brave' });
  assert.equal(japanese.status, 'found');
  assert.equal(japanese.match.lang, 'ja');

  const ambiguous = await resolver.resolve('Charizard ex');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.candidates[1].setName, '151');

  // A number narrows a name search down to one card.
  const byNumber = await resolver.resolve('Charizard ex (XYZ 6)');
  assert.equal(byNumber.status, 'found');
  assert.equal(byNumber.match.id, 'sv03.5-6');

  assert.equal((await resolver.resolve('Mew ex')).status, 'found');
  assert.equal((await resolver.resolve('Nonexistent card')).status, 'none');

  const before = calls.length;
  await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(calls.length, before, 'second lookup comes from the cache');

  // A fresh resolver reuses the persisted cache too.
  const again = createCardImageResolver({ fetchImpl, storage });
  await again.resolve('Charizard ex');
  assert.equal(calls.length, before);

  assert.equal((await resolver.search('chari')).length, 2);
});

test('resolver reports errors without caching them', async () => {
  let fail = true;
  const resolver = createCardImageResolver({
    fetchImpl: async () => {
      if (fail) throw new Error('offline');
      return { ok: true, status: 200, json: async () => [] };
    },
  });
  assert.equal((await resolver.resolve('Pikachu')).status, 'error');
  fail = false;
  assert.equal((await resolver.resolve('Pikachu')).status, 'none');
});
