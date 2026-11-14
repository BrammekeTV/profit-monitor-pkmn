// Card image lookup. Runs in the browser; tried in this order:
//   1. TCGdex (https://tcgdex.dev): free, no key, English + Japanese sets.
//   2. The pokemontcg.io image library (images.pokemontcg.io), for cards
//      TCGdex lists without an image (McDonald's, older sets).
//   3. Limitless TCG's card images, which use the official set codes
//      (newest promos such as MEP, Japanese sets).
// Which set a code like "PFL", "MCD21" or "M1L" means comes from
// data/card-sets.json (built by scripts/build-card-sets.mjs).
//
// resolve(cardName) answers with one of:
//   { status: 'found', match }            exactly one card fits → used automatically
//   { status: 'ambiguous', candidates }   several fit → the user picks one
//   { status: 'none' }                    nothing found
//   { status: 'error' }                   unreachable (try again later)
// A match / candidate: { id, name, localId, setId, setName, image, lang, source }
// where image is a base URL; cardImageUrl() turns it into a small or large image.

import { parseCardReference } from './profit-monitor-core.mjs';

export const TCGDEX_API = 'https://api.tcgdex.net/v2';
export const POKEMONTCG_IMAGES = 'https://images.pokemontcg.io';
export const LIMITLESS_IMAGES = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com';
const SET_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 60;
const CACHE_PREFIX = 'profit-monitor-cardimg:';

// Small (thumbnail) or large (viewer) image for a stored base URL.
export function cardImageUrl(image, quality = 'low') {
  if (!image) return '';
  const large = quality === 'high';
  if (image.startsWith('https://assets.tcgdex.net/')) return `${image}/${large ? 'high' : 'low'}.webp`;
  if (image.startsWith(`${POKEMONTCG_IMAGES}/`) && !/\.\w+$/.test(image)) return `${image}${large ? '_hires' : ''}.png`;
  if (image.startsWith(`${LIMITLESS_IMAGES}/`) && !/\.\w+$/.test(image)) return `${image}_${large ? 'LG' : 'SM'}.png`;
  return image;
}

function simplify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

// "014" → ["014", "14"], "7" → ["7", "007"], "TG05" → ["TG05"]
export function numberVariants(number = '') {
  const value = String(number).trim();
  if (!value) return [];
  const variants = [value];
  if (/^\d+$/.test(value)) {
    const plain = String(Number.parseInt(value, 10));
    variants.push(plain, plain.padStart(3, '0'));
  }
  return [...new Set(variants)];
}

export function sameCardNumber(left, right) {
  const a = String(left ?? '').trim().toLowerCase();
  const b = String(right ?? '').trim().toLowerCase();
  if (!a || !b) return false;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) === Number(b);
  return a.replace(/^([a-z]*)0+(\d)/, '$1$2') === b.replace(/^([a-z]*)0+(\d)/, '$1$2');
}

// Does a found card's name fit the name in the description? Loose on
// purpose: "Mudkip Lv.7" fits "Mudkip", "Sharpedo EX" fits "Sharpedo-EX".
export function namesMatch(wanted, found) {
  const a = simplify(wanted);
  const b = simplify(found);
  if (!a || !b) return true;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// Which sets a code means: by official code, TCGdex id, a known alias
// (EC1 → E1) or the set name. A code can mean several sets (30C is both
// 30th Celebration and its Classic Collection); the card name decides later.
export function findSets(table, setCode, { setName = '' } = {}) {
  const alias = table?.aliases?.[setCode] || '';
  const codes = [simplify(setCode), simplify(alias)].filter(Boolean);
  const name = simplify(setName);
  const match = sets => {
    if (!codes.length && !name) return [];
    const byCode = sets.filter(set => codes.includes(simplify(set.code)) || codes.includes(simplify(set.id)));
    if (byCode.length) return byCode;
    return name ? sets.filter(set => simplify(set.name) === name) : [];
  };
  const tcgdex = (table?.tcgdex || []).filter(set => set.cards !== 0);
  return {
    en: match(tcgdex.filter(set => set.lang === 'en')),
    asia: match(tcgdex.filter(set => set.lang !== 'en')),
    pokemontcg: match(table?.pokemontcg || []),
    alias,
  };
}

function browserProbe(url, timeoutMs = 8000) {
  return new Promise(resolve => {
    if (typeof Image === 'undefined') { resolve(false); return; }
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 1); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

export function createCardImageResolver({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = null,
  now = () => Date.now(),
  concurrency = 2,
  probeImage = browserProbe,
  loadSetTable = () => fetchImpl('data/card-sets.json').then(response => (response.ok ? response.json() : null)),
} = {}) {
  const memory = new Map();
  const inflight = new Map();
  const setNames = new Map(); // `${lang}:${id}` → name, from TCGdex
  let setTablePromise = null;
  let active = 0;
  const queue = [];

  function cacheGet(key, ttl) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = storage?.getItem(CACHE_PREFIX + key);
      if (!raw) return undefined;
      const { at, value } = JSON.parse(raw);
      if (now() - at > ttl) return undefined;
      memory.set(key, value);
      return value;
    } catch {
      return undefined;
    }
  }

  function cacheSet(key, value) {
    memory.set(key, value);
    try { storage?.setItem(CACHE_PREFIX + key, JSON.stringify({ at: now(), value })); } catch { /* storage full: memory only */ }
  }

  // Limits parallel lookups so a long history doesn't flood the sources.
  function schedule(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      task().then(resolve, reject).finally(() => { active -= 1; pump(); });
    }
  }

  function setTable() {
    if (!setTablePromise) {
      setTablePromise = Promise.resolve()
        .then(loadSetTable)
        .then(table => {
          for (const set of table?.tcgdex || []) setNames.set(`${set.lang}:${set.id}`, set.name);
          return table || { tcgdex: [], pokemontcg: [] };
        })
        .catch(() => ({ tcgdex: [], pokemontcg: [] }));
    }
    return setTablePromise;
  }

  async function getJson(path) {
    const response = await fetchImpl(`${TCGDEX_API}${path}`, { headers: { Accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TCGdex ${response.status}`);
    return response.json();
  }

  function toCandidate(card, lang, setIdHint = '', { allowNoImage = false } = {}) {
    if (!card?.id || (!card.image && !allowNoImage)) return null;
    const setId = card.set?.id || setIdHint || String(card.id).replace(/-[^-]+$/, '');
    return {
      ...(card.category ? { category: card.category } : {}),
      id: String(card.id),
      name: String(card.name ?? ''),
      localId: String(card.localId ?? ''),
      setId,
      setName: card.set?.name || setNames.get(`${lang}:${setId}`) || '',
      image: String(card.image || ''),
      lang,
      source: 'tcgdex',
    };
  }

  // The card as TCGdex knows it, image or not (image: '' when it has none).
  async function fetchTcgdexCard(lang, setId, number) {
    for (const variant of numberVariants(number)) {
      const card = await getJson(`/${lang}/cards/${encodeURIComponent(`${setId}-${variant}`)}`);
      if (card) return toCandidate(card, lang, setId, { allowNoImage: true });
    }
    return null;
  }

  // TCGdex sometimes lists an image that isn't there (many Japanese sets):
  // only use it when it actually loads.
  async function tcgdexImageLoads(card) {
    return Boolean(card?.image) && probeImage(cardImageUrl(card.image));
  }

  // Pokémon or Trainer, for cards from sources that don't say (by name, via TCGdex).
  const categories = new Map();
  async function categoryFor(name) {
    const key = simplify(name);
    if (!key) return '';
    if (categories.has(key)) return categories.get(key);
    const cached = cacheGet(`category:${key}`, LOOKUP_TTL_MS * 10);
    if (cached !== undefined) { categories.set(key, cached); return cached; }
    const promise = (async () => {
      const briefs = await getJson(`/en/cards?name=${encodeURIComponent(`eq:${name}`)}&pagination:itemsPerPage=5`);
      const first = Array.isArray(briefs) ? briefs[0] : null;
      if (!first?.id) return '';
      const card = await getJson(`/en/cards/${encodeURIComponent(first.id)}`);
      return card?.category || '';
    })().then(category => { cacheSet(`category:${key}`, category); return category; }, () => '');
    categories.set(key, promise);
    return promise;
  }

  async function searchByName(lang, name, { exact = true } = {}) {
    const filter = exact ? `eq:${name}` : name;
    const cards = await getJson(`/${lang}/cards?name=${encodeURIComponent(filter)}&pagination:itemsPerPage=250`);
    if (!Array.isArray(cards)) return [];
    await setTable();
    return cards.map(card => toCandidate(card, lang)).filter(Boolean);
  }

  // All cards of one TCGdex set (used to browse Japanese sets in the picker).
  async function browseSet(lang, setId) {
    const set = await getJson(`/${lang}/sets/${encodeURIComponent(setId)}`);
    const cards = Array.isArray(set?.cards) ? set.cards : [];
    return cards.map(card => toCandidate({ ...card, set: { id: setId, name: set.name } }, lang, setId)).filter(Boolean);
  }

  function pokemontcgNameFits(table, set, number, name) {
    const names = table?.numberedNames?.[set.id];
    if (!names) return null; // unknown: can't tell
    const found = names[String(Number(number))] ?? names[number];
    return found ? namesMatch(name, found) : false;
  }

  // Images that exist as files only: build the address, check that it loads.
  async function fallbackImage({ name, setCode, number }, sets, table, { skipSetNames = [] } = {}) {
    const plain = /^\d+$/.test(number) ? String(Number(number)) : number;
    // pokemontcg.io: sets whose names we know first, then the others.
    const ordered = [...sets.pokemontcg].sort((a, b) => (table?.numberedNames?.[b.id] ? 1 : 0) - (table?.numberedNames?.[a.id] ? 1 : 0));
    for (const set of ordered) {
      const fits = pokemontcgNameFits(table, set, plain, name);
      if (fits === false) continue;
      if (fits === null && skipSetNames.includes(simplify(set.name))) continue;
      const base = `${POKEMONTCG_IMAGES}/${set.id}/${encodeURIComponent(plain)}`;
      if (await probeImage(cardImageUrl(base))) {
        return { id: `${set.id}-${plain}`, name, localId: plain, setId: set.id, setName: set.name, image: base, lang: 'en', source: 'pokemontcg' };
      }
    }

    // Limitless: English sets live under tpci/ with 3-digit numbers, Japanese
    // ones under tpc/ with plain numbers. Japanese codes have lowercase
    // letters (sm9b, m1L) or are only known as Asian sets.
    const isJapanese = /[a-z]/.test(setCode) || (sets.asia.length > 0 && !sets.en.length && !sets.pokemontcg.length);
    const english = { dir: 'tpci', suffix: 'EN', codes: [setCode.toUpperCase()], numbers: [/^\d+$/.test(number) ? plain.padStart(3, '0') : number.toUpperCase()] };
    const japanese = {
      dir: 'tpc',
      suffix: 'JP',
      codes: [setCode, sets.alias, ...sets.asia.map(set => set.id)].filter(Boolean).flatMap(code => [code, code.toUpperCase(), code.replace(/-/g, '')]),
      numbers: [plain, /^\d+$/.test(number) ? plain.padStart(3, '0') : number],
    };
    const attempts = [];
    for (const source of isJapanese ? [japanese, english] : [english, japanese]) {
      for (const code of [...new Set(source.codes)]) {
        for (const nr of [...new Set(source.numbers)]) {
          attempts.push({ source, code, nr });
        }
      }
    }
    for (const { source, code, nr } of attempts.slice(0, 14)) {
      const base = `${LIMITLESS_IMAGES}/${source.dir}/${code}/${code}_${nr}_R_${source.suffix}`;
      if (await probeImage(cardImageUrl(base))) {
        const isJp = source.suffix === 'JP';
        const setName = (isJp ? sets.asia[0]?.name : sets.en[0]?.name || sets.pokemontcg[0]?.name) || code;
        return { id: `${code}-${nr}`, name, localId: nr, setId: code, setName, image: base, lang: isJp ? 'ja' : 'en', source: 'limitless' };
      }
    }
    return null;
  }

  // Classic Collection reprint ("Raikou (30C VIV 50)"): look for the name in
  // the Classic Collection set; the number is the one from the original set.
  async function classicCard({ name, setCode, number }, table) {
    const code = simplify(setCode);
    const isClassic = set => /classic/i.test(set.name) && simplify(set.code).startsWith(code);
    const results = [];
    for (const set of (table?.tcgdex || []).filter(set => set.lang === 'en' && set.cards !== 0 && isClassic(set))) {
      const cards = await browseSet('en', set.id).catch(() => []);
      const exact = cards.filter(card => simplify(card.name) === simplify(name));
      for (const card of exact.length ? exact : cards.filter(card => namesMatch(name, card.name))) {
        if (await tcgdexImageLoads(card)) results.push(card);
      }
    }
    if (results.length) return results;
    for (const set of (table?.pokemontcg || []).filter(isClassic)) {
      if (!pokemontcgNameFits(table, set, String(Number(number) || number), name)) continue;
      const plain = /^\d+$/.test(number) ? String(Number(number)) : number;
      const base = `${POKEMONTCG_IMAGES}/${set.id}/${encodeURIComponent(plain)}`;
      if (await probeImage(cardImageUrl(base))) {
        return [{ id: `${set.id}-${plain}`, name, localId: plain, setId: set.id, setName: set.name, image: base, lang: 'en', source: 'pokemontcg' }];
      }
    }
    return [];
  }

  // Exact card for a set code + number, from whichever source has it.
  async function exactCard(reference, table, sets) {
    const { name, number } = reference;
    const accepted = [];
    const rejected = [];
    const skipSetNames = [];
    for (const set of [...sets.en, ...sets.asia]) {
      const card = await fetchTcgdexCard(set.lang, set.id, number);
      if (!card) continue;
      // Japanese/Chinese names can't be compared with the description.
      if (set.lang === 'en' && name && !namesMatch(name, card.name)) {
        rejected.push(card);
        skipSetNames.push(simplify(set.name));
        continue;
      }
      if (await tcgdexImageLoads(card)) accepted.push(card);
    }
    if (accepted.length) return accepted;
    const fallback = await fallbackImage(reference, sets, table, { skipSetNames });
    if (fallback) {
      if (!fallback.category && name) fallback.category = await categoryFor(name) || undefined;
      return [fallback];
    }
    return rejected.filter(card => card.image);
  }

  async function lookup(cardName, { setName = '' } = {}) {
    const reference = parseCardReference(cardName);
    const { name, setCode, number } = reference;
    if (!name && !setCode) return { status: 'none' };
    const table = await setTable();
    const sets = setCode ? findSets(table, setCode, { setName }) : { en: [], asia: [], pokemontcg: [], alias: '' };

    if (reference.originalSet) {
      const hits = await classicCard(reference, table);
      if (hits.length === 1) return { status: 'found', match: hits[0] };
      if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
      return { status: 'none' };
    }

    // 1. Set code + number: that exact card, from whichever source has it.
    if (setCode && number) {
      const hits = await exactCard(reference, table, sets);
      if (hits.length === 1) return { status: 'found', match: hits[0] };
      if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
    }

    // 2. Search by name, narrowed down by set and number when known.
    if (!name) return { status: 'none' };
    let candidates = await searchByName('en', name);
    if (!candidates.length) {
      candidates = (await searchByName('en', name, { exact: false })).filter(card => simplify(card.name) === simplify(name));
    }
    if (!candidates.length && /[^\x00-\x7f]/.test(name)) candidates = await searchByName('ja', name);
    if (sets.asia.length && !sets.en.length) return { status: 'none' }; // a Japanese set: an English card with that name would be wrong

    const setIds = sets.en.map(set => set.id);
    const inSet = setIds.length ? candidates.filter(card => setIds.includes(card.setId)) : [];
    const pool = inSet.length ? inSet : candidates;
    const withNumber = number ? pool.filter(card => sameCardNumber(card.localId, number)) : [];
    const narrowed = withNumber.length ? withNumber : pool;

    if (narrowed.length === 1 && (inSet.length || withNumber.length || candidates.length === 1)) {
      return { status: 'found', match: narrowed[0] };
    }
    if (narrowed.length) return { status: 'ambiguous', candidates: narrowed.slice(0, MAX_CANDIDATES) };
    return { status: 'none' };
  }

  async function resolve(cardName, options = {}) {
    const key = `lookup:${String(cardName).trim().toLowerCase()}|${simplify(options.setName)}`;
    const cached = cacheGet(key, LOOKUP_TTL_MS);
    if (cached) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const promise = schedule(() => lookup(cardName, options))
      .then(result => { cacheSet(key, result); return result; })
      .catch(() => ({ status: 'error' }))
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  // Picker search. "M1L", "M1L 087" or "PFL 14" look in that set (any
  // language, so Japanese cards can be found without their Japanese name);
  // anything else searches card names.
  async function search(query, { lang = 'en', name = '' } = {}) {
    const text = String(query ?? '').trim();
    if (text.length < 2) return [];
    return schedule(async () => {
      const table = await setTable();
      const parts = text.split(/\s+/);
      const [first, second] = parts;
      // "30C VIV 50": a Classic Collection reprint.
      if (parts.length === 3 && /^[A-Za-z]/.test(second) && /\d/.test(parts[2])) {
        const hits = await classicCard({ name, setCode: first, number: parts[2] }, table);
        if (hits.length) return hits;
      }
      const sets = findSets(table, first);
      const looksLikeCode = /\d|^[A-Z0-9-]+$/.test(first) && (!second || /\d/.test(second)) && parts.length <= 2;
      const known = [...sets.en, ...sets.asia];
      if (looksLikeCode && (known.length || second)) {
        const exact = second ? await exactCard({ name, setCode: first, number: second }, table, sets) : [];
        const browseList = lang === 'en' ? [...sets.en, ...sets.asia] : [...sets.asia, ...sets.en];
        const browsed = [];
        for (const set of browseList.slice(0, 2)) browsed.push(...await browseSet(set.lang, set.id).catch(() => []));
        const rest = browsed.filter(card => !exact.some(hit => hit.id === card.id));
        const results = [...exact, ...rest];
        if (results.length) return results;
      }
      const byName = await searchByName(lang === 'ja' ? 'ja' : 'en', text, { exact: false });
      return byName.slice(0, MAX_CANDIDATES * 2);
    });
  }

  function forget(cardName) {
    const prefix = `lookup:${String(cardName).trim().toLowerCase()}|`;
    for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
    try {
      for (let i = (storage?.length ?? 0) - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (key?.startsWith(CACHE_PREFIX + prefix)) storage.removeItem(key);
      }
    } catch { /* ignore */ }
  }

  return { resolve, search, categoryFor, forget };
}
