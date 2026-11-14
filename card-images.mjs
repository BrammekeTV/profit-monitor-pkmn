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

// Which sets a code means. Several sets can share a code (30C is both
// "30th Celebration" and its "Classic Collection"): the word "classic" in
// the card text picks between them.
export function findSets(table, setCode, { setName = '', cardText = '' } = {}) {
  const code = simplify(setCode);
  const name = simplify(setName);
  const pick = list => {
    if (list.length < 2) return list;
    const classic = list.filter(set => /classic/i.test(set.name));
    if (!classic.length || classic.length === list.length) return list;
    return /classic/i.test(cardText) ? classic : list.filter(set => !/classic/i.test(set.name));
  };
  const match = sets => {
    if (!code && !name) return [];
    const byCode = sets.filter(set => code && (simplify(set.code) === code || simplify(set.id) === code));
    if (byCode.length) return pick(byCode);
    return name ? pick(sets.filter(set => simplify(set.name) === name)) : [];
  };
  const tcgdex = table?.tcgdex || [];
  return {
    en: match(tcgdex.filter(set => set.lang === 'en')),
    ja: match(tcgdex.filter(set => set.lang === 'ja')),
    pokemontcg: match(table?.pokemontcg || []),
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

  function toCandidate(card, lang, setIdHint = '') {
    if (!card?.id || !card.image) return null;
    const setId = card.set?.id || setIdHint || String(card.id).replace(/-[^-]+$/, '');
    return {
      id: String(card.id),
      name: String(card.name ?? ''),
      localId: String(card.localId ?? ''),
      setId,
      setName: card.set?.name || setNames.get(`${lang}:${setId}`) || '',
      image: String(card.image),
      lang,
      source: 'tcgdex',
    };
  }

  async function fetchTcgdexCard(lang, setId, number) {
    for (const variant of numberVariants(number)) {
      const card = await getJson(`/${lang}/cards/${encodeURIComponent(`${setId}-${variant}`)}`);
      if (card) return toCandidate(card, lang, setId);
    }
    return null;
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

  function limitlessCode(code) {
    return String(code).toUpperCase();
  }

  function limitlessNumber(number) {
    return /^\d+$/.test(number) ? String(Number(number)).padStart(3, '0') : String(number).toUpperCase();
  }

  // Images that exist as files only: build the address, check that it loads.
  async function fallbackImage({ name, setCode, number }, sets) {
    for (const set of sets.pokemontcg) {
      const plain = /^\d+$/.test(number) ? String(Number(number)) : number;
      const base = `${POKEMONTCG_IMAGES}/${set.id}/${encodeURIComponent(plain)}`;
      if (await probeImage(cardImageUrl(base))) {
        return { id: `${set.id}-${plain}`, name, localId: plain, setId: set.id, setName: set.name, image: base, lang: 'en', source: 'pokemontcg' };
      }
    }
    const japanese = sets.ja.length > 0 && !sets.en.length && !sets.pokemontcg.length;
    const codes = japanese ? sets.ja.map(set => set.id) : [setCode];
    for (const code of [...new Set(codes.map(limitlessCode))]) {
      const nr = limitlessNumber(number);
      const base = japanese
        ? `${LIMITLESS_IMAGES}/tpc/${code}/${code}_${nr}_R_JP`
        : `${LIMITLESS_IMAGES}/tpci/${code}/${code}_${nr}_R_EN`;
      if (await probeImage(cardImageUrl(base))) {
        const setName = (japanese ? sets.ja[0]?.name : sets.en[0]?.name || sets.pokemontcg[0]?.name) || code;
        return { id: `${code}-${nr}`, name, localId: nr, setId: code, setName, image: base, lang: japanese ? 'ja' : 'en', source: 'limitless' };
      }
    }
    return null;
  }

  async function lookup(cardName, { setName = '' } = {}) {
    const reference = parseCardReference(cardName);
    const { name, setCode, number } = reference;
    if (!name && !setCode) return { status: 'none' };
    const table = await setTable();
    const sets = setCode ? findSets(table, setCode, { setName, cardText: cardName }) : { en: [], ja: [], pokemontcg: [] };

    // 1. Set code + number: that exact card, from whichever source has it.
    if (setCode && number) {
      const hits = [];
      for (const [lang, list] of [['en', sets.en], ['ja', sets.ja]]) {
        for (const set of list) {
          const card = await fetchTcgdexCard(lang, set.id, number);
          if (card) hits.push(card);
        }
      }
      if (hits.length === 1) return { status: 'found', match: hits[0] };
      if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
      const fallback = await fallbackImage(reference, sets);
      if (fallback) return { status: 'found', match: fallback };
    }

    // 2. Search by name, narrowed down by set and number when known.
    if (!name) return { status: 'none' };
    let candidates = await searchByName('en', name);
    if (!candidates.length) {
      candidates = (await searchByName('en', name, { exact: false })).filter(card => simplify(card.name) === simplify(name));
    }
    if (!candidates.length && /[^\x00-\x7f]/.test(name)) candidates = await searchByName('ja', name);

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

  // Picker search. "M1L", "M1L 087" or "PFL 14" browse that set (any language,
  // so Japanese cards can be found without knowing their Japanese name);
  // anything else searches card names.
  async function search(query, { lang = 'en' } = {}) {
    const text = String(query ?? '').trim();
    if (text.length < 2) return [];
    return schedule(async () => {
      const table = await setTable();
      const [first, second] = text.split(/\s+/);
      const sets = findSets(table, first);
      const browseList = lang === 'ja' ? [...sets.ja, ...sets.en] : [...sets.en, ...sets.ja];
      if (browseList.length && (!second || /\d/.test(second)) && text.split(/\s+/).length <= 2) {
        const results = [];
        for (const set of browseList.slice(0, 2)) {
          results.push(...await browseSet(set.lang, set.id).catch(() => []));
        }
        if (second) {
          const exact = results.filter(card => sameCardNumber(card.localId, second));
          if (!exact.length) {
            const fallback = await fallbackImage({ name: text, setCode: first, number: second }, sets);
            if (fallback) return [fallback, ...results];
          }
          return [...exact, ...results.filter(card => !exact.includes(card))];
        }
        if (results.length) return results;
      }
      const byName = await searchByName(lang, text, { exact: false });
      return byName.slice(0, MAX_CANDIDATES * 2);
    });
  }

  // Exact card for "CODE NUMBER" from any source (used by the picker).
  async function lookupCode(setCode, number, cardText = '') {
    const table = await setTable();
    const sets = findSets(table, setCode, { cardText });
    const hits = [];
    for (const [lang, list] of [['en', sets.en], ['ja', sets.ja]]) {
      for (const set of list) {
        const card = await fetchTcgdexCard(lang, set.id, number).catch(() => null);
        if (card) hits.push(card);
      }
    }
    if (hits.length) return hits;
    const fallback = await fallbackImage({ name: cardText, setCode, number }, sets);
    return fallback ? [fallback] : [];
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

  return { resolve, search, lookupCode, forget };
}
