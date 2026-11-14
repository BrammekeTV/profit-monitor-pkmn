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
import { cardImageUrl, createCardImageResolver, findSets, namesMatch, numberVariants, sameCardNumber } from '../card-images.mjs';
import { getCardFinish, setCardImageCategory } from '../profit-monitor-core.mjs';

const SERVER_IMG = 'img-0f8fad5b-d9cb-469f-a165-70867728950e.webp';

test('parseCardReference splits name, set code and number', () => {
  assert.deepEqual(parseCardReference('Charizard ex (OBF 125)'), { name: 'Charizard ex', setCode: 'OBF', number: '125' });
  assert.deepEqual(parseCardReference('Moltres (PPS9 PFL 014)'), { name: 'Moltres', setCode: 'PFL', number: '014', prizePack: 'PPS9' });
  assert.deepEqual(parseCardReference('Toxtricity (PPS9 PFL 068) (Holo Version)'), { name: 'Toxtricity', setCode: 'PFL', number: '068', prizePack: 'PPS9' });
  assert.deepEqual(parseCardReference('Umbreon VMAX (EVS 215/203) #123456789'), { name: 'Umbreon VMAX', setCode: 'EVS', number: '215' });
  assert.deepEqual(parseCardReference('Pikachu (Reverse Holo)'), { name: 'Pikachu', setCode: '', number: '' });
  assert.deepEqual(parseCardReference('Raikou (30C VIV 50)'), { name: 'Raikou', setCode: '30C', number: '50', originalSet: 'VIV' });
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
  aliases: { EC1: 'E1', XY5t: 'XY5b' },
  tcgdex: [
    { lang: 'en', cards: 200, id: 'sv03', code: 'OBF', name: 'Obsidian Flames' },
    { lang: 'en', cards: 200, id: 'sv03.5', code: 'MEW', name: '151' },
    { lang: 'en', cards: 130, id: 'me02', code: 'PFL', name: 'Phantasmal Flames' },
    { lang: 'en', cards: 112, id: 'mep', code: 'MEP', name: 'MEP Black Star Promos' },
    { lang: 'en', cards: 25, id: '2021swsh', code: 'MCD21', name: "McDonald's Collection 2021" },
    { lang: 'en', cards: 161, id: '30th', code: '30C', name: '30th Celebration' },
    { lang: 'en', cards: 30, id: '30th-c', code: '30C', name: '30th Classic Collection' },
    { lang: 'en', cards: 186, id: 'ecard2', code: 'AQ', name: 'Aquapolis' },
    { lang: 'ja', cards: 92, id: 'M1L', code: '', name: 'メガブレイブ' },
    { lang: 'ja', cards: 69, id: 'SM9b', code: '', name: 'フルメタルウォール' },
    { lang: 'ja', cards: 128, id: 'E1', code: '', name: '基本拡張パック' },
    { lang: 'th', cards: 313, id: 'S-P', code: '', name: 'การ์ดโปรโม' },
  ],
  pokemontcg: [
    { id: 'mcd21', code: 'MCD21', name: "McDonald's Collection 2021" },
    { id: 'ecard2', code: 'AQ', name: 'Aquapolis' },
    { id: 'me55', code: '30C', name: '30th Celebration' },
    { id: 'me55c', code: '30C', name: '30th Celebration: Classic Collection' },
  ],
  numberedNames: { me55c: { 4: 'Charizard', 58: 'Pikachu' } },
};

const T = 'https://assets.tcgdex.net';
const L = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';

// A tiny fake TCGdex plus a fake "does this image load" check.
function fakeSources() {
  const calls = [];
  const card = (id, localId, name, image, set, category = 'Pokemon') => ({ id, localId, name, image, set, category });
  const cards = {
    'en/sv03-125': card('sv03-125', '125', 'Charizard ex', `${T}/en/sv/sv03/125`, { id: 'sv03', name: 'Obsidian Flames' }),
    'en/me02-068': card('me02-068', '068', 'Toxtricity', `${T}/en/me/me02/068`, { id: 'me02', name: 'Phantasmal Flames' }),
    'en/30th-154': card('30th-154', '154', 'Gengar ex', `${T}/en/me/30th/154`, { id: '30th', name: '30th Celebration' }),
    'en/30th-004': card('30th-004', '004', 'Bulbasaur', `${T}/en/me/30th/004`, { id: '30th', name: '30th Celebration' }),
    'en/30th-c-004': card('30th-c-004', '004', 'Blastoise', `${T}/en/me/30th-c/004`, { id: '30th-c', name: '30th Classic Collection' }),
    'en/2021swsh-25': card('2021swsh-25', '25', 'Pikachu', undefined, { id: '2021swsh' }),
    'en/mep-063': card('mep-063', '063', 'Quaxly', undefined, { id: 'mep' }),
    'ja/M1L-087': card('M1L-087', '087', 'メガサーナイトex', `${T}/ja/M/M1L/087`, { id: 'M1L', name: 'メガブレイブ' }),
    // Listed with an image address, but no file behind it:
    'ja/SM9b-010': card('SM9b-010', '010', 'カメックスGX', `${T}/ja/SM/SM9b/010`, { id: 'SM9b' }),
    'ja/E1-127': card('E1-127', '127', 'バンギラス', `${T}/ja/e/E1/127`, { id: 'E1' }),
    'en/swsh1-1': card('swsh1-1', '1', 'Core Memory', `${T}/en/me/me02/1`, { id: 'x' }, 'Trainer'),
  };
  const byName = {
    'Charizard ex': [
      { id: 'sv03-125', localId: '125', name: 'Charizard ex', image: `${T}/en/sv/sv03/125` },
      { id: 'sv03.5-6', localId: '6', name: 'Charizard ex', image: `${T}/en/sv/sv03.5/6` },
    ],
    'Mew ex': [{ id: 'sv03.5-151', localId: '151', name: 'Mew ex', image: `${T}/en/sv/sv03.5/151` }],
    'Core Memory': [{ id: 'swsh1-1', localId: '1', name: 'Core Memory', image: `${T}/en/me/me02/1` }],
    Quaxly: [{ id: 'sv1-52', localId: '52', name: 'Quaxly', image: `${T}/en/sv/sv1/52` }],
  };
  const sets = {
    'en/30th-c': { id: '30th-c', name: '30th Classic Collection', cards: [
      { id: '30th-c-001', localId: '001', name: 'Charizard', image: `${T}/en/me/30th-c/001` },
      { id: '30th-c-017', localId: '017', name: 'Raikou', image: `${T}/en/me/30th-c/017` },
    ] },
    'ja/M1L': { id: 'M1L', name: 'メガブレイブ', cards: [
      { id: 'M1L-001', localId: '001', name: 'フシギダネ', image: `${T}/ja/M/M1L/001` },
      { id: 'M1L-087', localId: '087', name: 'メガサーナイトex', image: `${T}/ja/M/M1L/087` },
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
      const found = cards[`${lang}/${decodeURIComponent(id)}`];
      return found ? json(found) : missing;
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
    ...Object.values(cards).filter(c => c.image && !/SM9b|E1\//.test(c.image)).map(c => `${c.image}/low.webp`),
    `${T}/en/sv/sv03.5/6/low.webp`,
    `${T}/en/me/30th-c/017/low.webp`,
    'https://images.pokemontcg.io/mcd21/25.png',
    'https://images.pokemontcg.io/ecard2/74.png',
    'https://images.pokemontcg.io/me55c/4.png',
    'https://images.pokemontcg.io/me55/4.png',
    `${L}/tpci/MEP/MEP_113_R_EN_SM.png`,
    `${L}/tpci/MEP/MEP_063_R_EN_SM.png`,
    `${L}/tpc/SM9b/SM9b_10_R_JP_SM.png`,
    `${L}/tpc/E1/E1_127_R_JP_SM.png`,
    `${L}/tpc/XY5t/XY5t_44_R_JP_SM.png`,
    `${L}/tpc/S-P/S-P_232_R_JP_SM.png`,
  ]);
  const probes = [];
  const probeImage = async url => { probes.push(url); return loadable.has(url); };
  return { fetchImpl, calls, probeImage, probes };
}

function memoryStorage() {
  const store = new Map();
  return { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k), key: i => [...store.keys()][i], get length() { return store.size; } };
}

function newResolver(sources, storage = memoryStorage()) {
  return createCardImageResolver({ fetchImpl: sources.fetchImpl, storage, probeImage: sources.probeImage, loadSetTable: async () => TABLE });
}

test('findSets: codes, aliases, names and Asian sets', () => {
  assert.deepEqual(findSets(TABLE, 'MCD21').pokemontcg.map(set => set.id), ['mcd21']);
  assert.deepEqual(findSets(TABLE, 'm1L').asia.map(set => set.id), ['M1L']);
  assert.deepEqual(findSets(TABLE, 'EC1').asia.map(set => set.id), ['E1']);
  assert.deepEqual(findSets(TABLE, 'S-P').asia.map(set => set.lang), ['th']);
  assert.deepEqual(findSets(TABLE, '30C').en.map(set => set.id), ['30th', '30th-c']);
  assert.deepEqual(findSets(TABLE, 'MEP', { setName: 'Mega Evolution Black Star Promos' }).en.map(set => set.id), ['mep']);
  assert.ok(namesMatch('Mudkip Lv.7', 'Mudkip'));
  assert.ok(namesMatch('Sharpedo EX', 'Sharpedo-EX'));
  assert.ok(!namesMatch('Charizard', 'Bulbasaur'));
});

test('resolver: the cards that were reported missing', async () => {
  const sources = fakeSources();
  const resolver = newResolver(sources);
  const found = async (name, setName) => (await resolver.resolve(name, { setName })).match;

  assert.equal((await found('Charizard ex (OBF 125)', 'Obsidian Flames')).id, 'sv03-125');
  assert.equal((await found('Toxtricity (PPS9 PFL 068) (Holo Version)')).id, 'me02-068');
  assert.equal((await found('Mega Gardevoir ex (m1L 087)')).lang, 'ja');
  assert.equal((await found('Gengar ex (30C 154)')).id, '30th-154');
  // Classic Collection keeps original numbers: 4 is Charizard there, Bulbasaur in the main set.
  const classic = await found('Charizard (30C 4)');
  assert.equal(cardImageUrl(classic.image), 'https://images.pokemontcg.io/me55c/4.png');
  assert.equal((await found('Blastoise (30C 004)')).id, '30th-c-004');

  // Classic Collection in the "(30C VIV 50)" format: by name in the Classic Collection set.
  assert.equal((await found('Raikou (30C VIV 50)')).id, '30th-c-017');
  assert.equal((await resolver.resolve('Zapdos (30C FO 15)')).status, 'none', 'never a main-set card instead');
  assert.equal((await resolver.search('30C VIV 50', { name: 'Raikou' }))[0].id, '30th-c-017');

  assert.equal((await found('Pikachu (MCD21 25)')).source, 'pokemontcg');
  assert.equal((await found('Drowzee (AQ 74)')).source, 'pokemontcg');
  assert.equal((await found('Quaxly (MEP 063)')).source, 'limitless');
  assert.equal(cardImageUrl((await found('Enamorus (MEP 113)')).image, 'high'), `${L}/tpci/MEP/MEP_113_R_EN_LG.png`);

  // Japanese: TCGdex lists an image that isn't there → Limitless (plain numbers).
  assert.equal(cardImageUrl((await found('Blastoise GX (sm9b 010)')).image), `${L}/tpc/SM9b/SM9b_10_R_JP_SM.png`);
  assert.equal((await found('Tyranitar (EC1 127)')).source, 'limitless');
  assert.equal((await found('Sharpedo EX (XY5t 044)')).source, 'limitless');
  assert.equal((await found('Piplup (S-P 232)')).source, 'limitless');

  // Not in any source: nothing, never an English card with the same name.
  assert.equal((await resolver.resolve('Cubone (CBB3C 04)')).status, 'none');
  assert.equal((await resolver.resolve('Scyther (CLV 006)')).status, 'none');

  const ambiguous = await resolver.resolve('Charizard ex');
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates[1].setName, '151');
  assert.equal((await resolver.resolve('Mew ex')).status, 'found');
  assert.equal((await resolver.resolve('Nonexistent card')).status, 'none');
});

test('resolver: card type, caching, picker search', async () => {
  const sources = fakeSources();
  const storage = memoryStorage();
  const resolver = newResolver(sources, storage);

  assert.equal((await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' })).match.category, 'Pokemon');
  assert.equal(await resolver.categoryFor('Core Memory'), 'Trainer');

  const before = sources.calls.length;
  await resolver.resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(sources.calls.length, before, 'second lookup comes from the cache');
  await newResolver(sources, storage).resolve('Charizard ex (OBF 125)', { setName: 'Obsidian Flames' });
  assert.equal(sources.calls.length, before, 'a new page reuses the saved cache');

  const browse = await resolver.search('M1L 087');
  assert.equal(browse[0].id, 'M1L-087');
  assert.equal((await resolver.search('MEP 113', { name: 'Enamorus' }))[0].source, 'limitless');
  assert.equal((await resolver.search('sm9b 010'))[0].source, 'limitless');
  assert.equal((await resolver.search('chari')).length, 2);
});

test('finishes: Prize Pack stamp, reverse holo, holo and cosmos', () => {
  assert.deepEqual(getCardFinish('Moltres (PPS9 PFL 014)'), { reverseHolo: false, holo: false, prizePack: true, cosmos: false });
  assert.deepEqual(getCardFinish('Mudkip Lv.7 (GE 80) (Reverse Holo)'), { reverseHolo: true, holo: false, prizePack: false, cosmos: false });
  assert.deepEqual(getCardFinish('Toxtricity (PPS9 PFL 068) (Holo Version)'), { reverseHolo: false, holo: true, prizePack: true, cosmos: true });
  assert.deepEqual(getCardFinish('Pikachu (SVI 063) (Holo)'), { reverseHolo: false, holo: true, prizePack: false, cosmos: false });
  // Variants share one image choice.
  assert.equal(cardImageKey('Mudkip Lv.7 (GE 80) (Reverse Holo)'), cardImageKey('Mudkip Lv.7 (GE 80)'));
});

test('card type is kept and can be changed without losing the image', () => {
  let state = setCardImage(ensureAppState(null), 'Core Memory (POR 070)', { id: 'x', image: `${T}/en/me/x/70`, category: 'Pokemon' }, 'user');
  state = setCardImageCategory(state, 'Core Memory (POR 070)', 'Trainer');
  const entry = getCardImage(state, 'Core Memory (POR 070)');
  assert.equal(entry.category, 'Trainer');
  assert.equal(entry.source, 'user');
  assert.equal(ensureAppState(JSON.parse(JSON.stringify(state))).cardImages['core memory (por 070)'].category, 'Trainer');
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
