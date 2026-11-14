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
import { cardImageUrl, createCardImageResolver, findSets, numberVariants, sameCardNumber } from '../card-images.mjs';
import { getCardFinish } from '../profit-monitor-core.mjs';

const SERVER_IMG = 'img-0f8fad5b-d9cb-469f-a165-70867728950e.webp';

test('parseCardReference splits name, set code and number', () => {
  assert.deepEqual(parseCardReference('Charizard ex (OBF 125)'), { name: 'Charizard ex', setCode: 'OBF', number: '125' });
  assert.deepEqual(parseCardReference('Moltres (PPS9 PFL 014)'), { name: 'Moltres', setCode: 'PFL', number: '014', prizePack: 'PPS9' });
  assert.deepEqual(parseCardReference('Toxtricity (PPS9 PFL 068) (Holo Version)'), { name: 'Toxtricity', setCode: 'PFL', number: '068', prizePack: 'PPS9' });
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

const TABLE = {
  tcgdex: [
    { lang: 'en', id: 'sv03', code: 'OBF', name: 'Obsidian Flames' },
    { lang: 'en', id: 'sv03.5', code: 'MEW', name: '151' },
    { lang: 'en', id: 'me02', code: 'PFL', name: 'Phantasmal Flames' },
    { lang: 'en', id: 'mep', code: 'MEP', name: 'MEP Black Star Promos' },
    { lang: 'en', id: '2021swsh', code: 'MCD21', name: "McDonald's Collection 2021" },
    { lang: 'en', id: '30th', code: '30C', name: '30th Celebration' },
    { lang: 'en', id: '30th-c', code: '30C', name: '30th Classic Collection' },
    { lang: 'en', id: 'ecard2', code: 'AQ', name: 'Aquapolis' },
    { lang: 'ja', id: 'M1L', code: '', name: 'メガブレイブ' },
  ],
  pokemontcg: [
    { id: 'mcd21', code: 'MCD21', name: "McDonald's Collection 2021" },
    { id: 'ecard2', code: 'AQ', name: 'Aquapolis' },
  ],
};

// A tiny fake TCGdex plus a fake "does this image load" check.
function fakeSources() {
  const calls = [];
  const cards = {
    'en/sv03-125': { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03/125', set: { id: 'sv03', name: 'Obsidian Flames' } },
    'en/me02-068': { id: 'me02-068', localId: '068', name: 'Toxtricity', image: 'https://assets.tcgdex.net/en/me/me02/068', set: { id: 'me02', name: 'Phantasmal Flames' } },
    'en/30th-154': { id: '30th-154', localId: '154', name: 'Gengar ex', image: 'https://assets.tcgdex.net/en/me/30th/154', set: { id: '30th', name: '30th Celebration' } },
    'en/30th-c-005': { id: '30th-c-005', localId: '005', name: 'Charizard', image: 'https://assets.tcgdex.net/en/me/30th-c/005', set: { id: '30th-c', name: '30th Classic Collection' } },
    // Known to TCGdex, but without an image yet:
    'en/2021swsh-25': { id: '2021swsh-25', localId: '25', name: 'Pikachu', set: { id: '2021swsh' } },
    'en/mep-063': { id: 'mep-063', localId: '063', name: 'Quaxly', set: { id: 'mep' } },
    'ja/M1L-087': { id: 'M1L-087', localId: '087', name: 'メガサーナイトex', image: 'https://assets.tcgdex.net/ja/M/M1L/087', set: { id: 'M1L', name: 'メガブレイブ' } },
  };
  const byName = {
    'Charizard ex': [
      { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03/125' },
      { id: 'sv03.5-6', localId: '6', name: 'Charizard ex', image: 'https://assets.tcgdex.net/en/sv/sv03.5/6' },
    ],
    'Mew ex': [{ id: 'sv03.5-151', localId: '151', name: 'Mew ex', image: 'https://assets.tcgdex.net/en/sv/sv03.5/151' }],
  };
  const sets = {
    'ja/M1L': { id: 'M1L', name: 'メガブレイブ', cards: [
      { id: 'M1L-001', localId: '001', name: 'フシギダネ', image: 'https://assets.tcgdex.net/ja/M/M1L/001' },
      { id: 'M1L-087', localId: '087', name: 'メガサーナイトex', image: 'https://assets.tcgdex.net/ja/M/M1L/087' },
    ] },
  };
  const fetchImpl = async url => {
    calls.push(url);
    const u = new URL(url);
    const [, , lang, kind, id] = u.pathname.split('/');
    const json = body => ({ ok: true, status: 200, json: async () => body });
    const missing = { ok: false, status: 404, json: async () => ({}) };
    if (kind === 'sets' && id) return sets[`${lang}/${decodeURIComponent(id)}`] ? json(sets[`${lang}/${decodeURIComponent(id)}`]) : missing;
    if (kind === 'cards' && id) {
      const card = cards[`${lang}/${decodeURIComponent(id)}`];
      return card ? json(card) : missing;
    }
    if (kind === 'cards') {
      const name = u.searchParams.get('name') || '';
      const exact = name.startsWith('eq:');
      const query = exact ? name.slice(3) : name;
      return json(lang === 'en' ? Object.entries(byName)
        .filter(([key]) => (exact ? key === query : key.toLowerCase().includes(query.toLowerCase())))
        .flatMap(([, value]) => value) : []);
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const loadable = new Set([
    'https://images.pokemontcg.io/mcd21/25.png',
    'https://images.pokemontcg.io/ecard2/74.png',
    'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_113_R_EN_SM.png',
    'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_063_R_EN_SM.png',
    'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/CLV/CLV_001_R_EN_SM.png',
  ]);
  const probes = [];
  const probeImage = async url => { probes.push(url); return loadable.has(url); };
  return { fetchImpl, calls, probeImage, probes };
}

function memoryStorage() {
  const store = new Map();
  return { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), key: i => [...store.keys()][i], get length() { return store.size; } };
}

test('findSets: codes, names, and the 30C classic collection', () => {
  assert.deepEqual(findSets(TABLE, 'MCD21').pokemontcg.map(set => set.id), ['mcd21']);
  assert.deepEqual(findSets(TABLE, 'm1L').ja.map(set => set.id), ['M1L']);
  assert.deepEqual(findSets(TABLE, '30C', { cardText: 'Gengar ex (30C 154)' }).en.map(set => set.id), ['30th']);
  assert.deepEqual(findSets(TABLE, '30C', { cardText: 'Charizard (30C 5) Classic Collection' }).en.map(set => set.id), ['30th-c']);
  assert.deepEqual(findSets(TABLE, 'MEP', { setName: 'Mega Evolution Black Star Promos' }).en.map(set => set.id), ['mep']);
});

test('resolver: every source, Prize Pack, Japanese sets, ambiguity, caching', async () => {
  const { fetchImpl, calls, probeImage, probes } = fakeSources();
  const storage = memoryStorage();
  const resolver = createCardImageResolver({ fetchImpl, storage, probeImage, loadSetTable: async () => TABLE });

  const exact = await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(exact.status, 'found');
  assert.equal(exact.match.id, 'sv03-125');

  const prizePack = await resolver.resolve('Toxtricity (PPS9 PFL 068) (Holo Version)');
  assert.equal(prizePack.match.id, 'me02-068');

  const japanese = await resolver.resolve('Mega Gardevoir ex (m1L 087)', { setName: 'Mega Brave' });
  assert.equal(japanese.match.lang, 'ja');

  const celebration = await resolver.resolve('Gengar ex (30C 154)');
  assert.equal(celebration.match.id, '30th-154');

  // TCGdex knows the card but has no image: pokemontcg.io's image is used.
  const mcdonalds = await resolver.resolve('Pikachu (MCD21 25)', { setName: "McDonald's Collection 2021" });
  assert.equal(mcdonalds.match.source, 'pokemontcg');
  assert.equal(cardImageUrl(mcdonalds.match.image), 'https://images.pokemontcg.io/mcd21/25.png');
  assert.equal(cardImageUrl(mcdonalds.match.image, 'high'), 'https://images.pokemontcg.io/mcd21/25_hires.png');

  assert.equal((await resolver.resolve('Drowzee (AQ 74)', { setName: 'Aquapolis' })).match.source, 'pokemontcg');

  // Newest promos: only Limitless has them.
  const quaxly = await resolver.resolve('Quaxly (MEP 063)', { setName: 'Mega Evolution Black Star Promos' });
  assert.equal(quaxly.match.source, 'limitless');
  const enamorus = await resolver.resolve('Enamorus (MEP 113)', { setName: 'Mega Evolution Black Star Promos' });
  assert.equal(cardImageUrl(enamorus.match.image, 'high'), 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/MEP/MEP_113_R_EN_LG.png');

  // A code that is in no table (Pokémon TCG Classic) still tries Limitless.
  assert.equal((await resolver.resolve('Venusaur (CLV 1)')).match.source, 'limitless');
  assert.ok(probes.length > 0);

  const ambiguous = await resolver.resolve('Charizard ex');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates[1].setName, '151');

  assert.equal((await resolver.resolve('Mew ex')).status, 'found');
  assert.equal((await resolver.resolve('Nonexistent card')).status, 'none');

  const before = calls.length;
  await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(calls.length, before, 'second lookup comes from the cache');
  const again = createCardImageResolver({ fetchImpl, storage, probeImage, loadSetTable: async () => TABLE });
  await again.resolve('Charizard ex');
  assert.equal(calls.length, before, 'a new page reuses the saved cache');

  // Picker: set code + number browses a set (Japanese cards findable), names search.
  const browse = await resolver.search('M1L 087');
  assert.equal(browse[0].id, 'M1L-087');
  assert.equal(browse.length, 2);
  assert.equal((await resolver.search('MEP 113'))[0].source, 'limitless');
  assert.equal((await resolver.search('chari')).length, 2);
});

test('finishes: Prize Pack stamp, reverse holo and holo', () => {
  assert.deepEqual(getCardFinish('Moltres (PPS9 PFL 014)'), { reverseHolo: false, holo: false, prizePack: true });
  assert.deepEqual(getCardFinish('Mudkip Lv.7 (GE 80) (Reverse Holo)'), { reverseHolo: true, holo: false, prizePack: false });
  assert.deepEqual(getCardFinish('Toxtricity (PPS9 PFL 068) (Holo Version)'), { reverseHolo: false, holo: true, prizePack: true });
  // Variants share one image choice.
  assert.equal(cardImageKey('Mudkip Lv.7 (GE 80) (Reverse Holo)'), cardImageKey('Mudkip Lv.7 (GE 80)'));
});

test('resolver reports errors without caching them', async () => {
  let fail = true;
  const resolver = createCardImageResolver({
    loadSetTable: async () => TABLE,
    probeImage: async () => false,
    fetchImpl: async () => {
      if (fail) throw new Error('offline');
      return { ok: true, status: 200, json: async () => [] };
    },
  });
  assert.equal((await resolver.resolve('Pikachu')).status, 'error');
  fail = false;
  assert.equal((await resolver.resolve('Pikachu')).status, 'none');
});

test('own images: any https link or upload for hand-picked, never for automatic', () => {
  let state = ensureAppState(null);
  state = setCardImage(state, 'Venusaur (CLV 1)', { id: 'eigen', image: 'https://example.com/venusaur.jpg' }, 'user');
  assert.equal(getCardImage(state, 'Venusaur (CLV 1)').image, 'https://example.com/venusaur.jpg');
  state = setCardImage(state, 'Lugia (CLV 2)', { id: 'eigen', image: SERVER_IMG }, 'user');
  assert.equal(getCardImage(state, 'Lugia (CLV 2)').image, SERVER_IMG);
  assert.equal(addAutoCardImages(state, { X: { id: 'x', image: 'https://example.com/x.jpg' } }), state);
  assert.equal(setCardImage(state, 'Y', { id: 'y', image: 'javascript:alert(1)' }, 'user').cardImages.y, undefined);
  assert.match(formatCardPicksForExport(getCustomCardPicks(state)), /lugia \(clv 2\) = eigen upload/);
});
