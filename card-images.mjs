// Card image lookup through TCGdex (https://tcgdex.dev): free, no API key,
// English and Japanese sets. Runs in the browser.
//
// resolve(cardName) answers with one of:
//   { status: 'found', match }            exactly one card fits → used automatically
//   { status: 'ambiguous', candidates }   several fit → the user picks one
//   { status: 'none' }                    nothing found
//   { status: 'error' }                   TCGdex unreachable (try again later)
// A match / candidate looks like
//   { id, name, localId, setId, setName, image, lang }
// where image is the TCGdex asset base URL (append /low.webp or /high.webp).

import { parseCardReference } from './profit-monitor-core.mjs';

export const TCGDEX_API = 'https://api.tcgdex.net/v2';
const LANGS = ['en', 'ja'];
const SET_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 60;
const CACHE_PREFIX = 'profit-monitor-tcgdex:';

export function cardImageUrl(image, quality = 'low') {
  return image ? `${image}/${quality}.webp` : '';
}

function simplify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

// "014" → ["014", "14"], "14" → ["14", "014"], "TG05" → ["TG05"]
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

export function createCardImageResolver({ fetchImpl = globalThis.fetch?.bind(globalThis), storage = null, now = () => Date.now(), concurrency = 2 } = {}) {
  const memory = new Map();
  const setLists = new Map();
  const inflight = new Map();
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

  // Limits parallel requests so a long history doesn't flood TCGdex.
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

  async function getJson(path) {
    const response = await fetchImpl(`${TCGDEX_API}${path}`, { headers: { Accept: 'application/json' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`TCGdex ${response.status}`);
    return response.json();
  }

  async function getSets(lang) {
    if (setLists.has(lang)) return setLists.get(lang);
    const cached = cacheGet(`sets:${lang}`, SET_LIST_TTL_MS);
    if (cached) { setLists.set(lang, cached); return cached; }
    const sets = await getJson(`/${lang}/sets`);
    const list = Array.isArray(sets) ? sets.map(set => ({ id: String(set.id), name: String(set.name ?? '') })) : [];
    cacheSet(`sets:${lang}`, list);
    setLists.set(lang, list);
    return list;
  }

  function setNameFor(lang, setId) {
    return setLists.get(lang)?.find(set => set.id === setId)?.name || '';
  }

  // Which TCGdex set(s) a code from the description means: by id ("SVP" → svp,
  // "M1L" → M1L) or by the set's name from the app's set list.
  function matchSets(sets, setCode, setName) {
    const code = simplify(setCode);
    const name = simplify(setName);
    const byId = sets.filter(set => simplify(set.id) === code);
    if (byId.length) return byId;
    if (!name) return [];
    const exact = sets.filter(set => simplify(set.name) === name);
    if (exact.length) return exact;
    if (name.length < 3) return [];
    return sets.filter(set => {
      const other = simplify(set.name);
      return other.length >= 3 && (other.includes(name) || name.includes(other));
    });
  }

  function toCandidate(card, lang, setIdHint = '') {
    if (!card?.id || !card.image) return null;
    const setId = card.set?.id || setIdHint || String(card.id).replace(/-[^-]+$/, '');
    return {
      id: String(card.id),
      name: String(card.name ?? ''),
      localId: String(card.localId ?? ''),
      setId,
      setName: card.set?.name || setNameFor(lang, setId),
      image: String(card.image),
      lang,
    };
  }

  async function fetchCard(lang, setId, number) {
    for (const variant of numberVariants(number)) {
      const card = await getJson(`/${lang}/cards/${encodeURIComponent(`${setId}-${variant}`)}`);
      const candidate = toCandidate(card, lang, setId);
      if (candidate) return candidate;
    }
    return null;
  }

  async function searchByName(lang, name, { exact = true } = {}) {
    const filter = exact ? `eq:${name}` : name;
    const cards = await getJson(`/${lang}/cards?name=${encodeURIComponent(filter)}&pagination:itemsPerPage=250`);
    if (!Array.isArray(cards)) return [];
    if (!setLists.has(lang)) await getSets(lang).catch(() => []);
    return cards.map(card => toCandidate(card, lang)).filter(Boolean);
  }

  async function lookup(cardName, { setName = '' } = {}) {
    const { name, setCode, number } = parseCardReference(cardName);
    if (!name && !setCode) return { status: 'none' };

    // 1. Set code + number: ask for that exact card.
    let setIds = { en: [], ja: [] };
    if (setCode) {
      for (const lang of LANGS) {
        const sets = await getSets(lang).catch(() => []);
        setIds[lang] = matchSets(sets, setCode, lang === 'en' ? setName : '').map(set => set.id);
        if (number) {
          for (const setId of setIds[lang]) {
            const card = await fetchCard(lang, setId, number);
            if (card) return { status: 'found', match: card };
          }
        }
      }
    }

    // 2. Search by name, narrowed down by set and number when known.
    if (!name) return { status: 'none' };
    let candidates = await searchByName('en', name);
    if (!candidates.length) candidates = (await searchByName('en', name, { exact: false }))
      .filter(card => simplify(card.name) === simplify(name));
    if (!candidates.length && /[^\x00-\x7f]/.test(name)) candidates = await searchByName('ja', name);

    const inSet = setIds.en.length ? candidates.filter(card => setIds.en.includes(card.setId)) : [];
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

  // Free search for the picker. Name contains the query (TCGdex "laxist" filter).
  async function search(query, { lang = 'en' } = {}) {
    const text = String(query ?? '').trim();
    if (text.length < 2) return [];
    const results = await schedule(() => searchByName(lang, text, { exact: false }));
    return results.slice(0, MAX_CANDIDATES * 2);
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

  return { resolve, search, forget };
}
