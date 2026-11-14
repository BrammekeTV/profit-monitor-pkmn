// Builds data/card-sets.json: which set in TCGdex and in the pokemontcg.io
// image library belongs to each set code ("PFL", "MCD21", "M1L", …).
//
//   git clone --depth 1 https://github.com/tcgdex/cards-database /tmp/tcgdex
//   git clone --depth 1 https://github.com/PokemonTCG/pokemon-tcg-data /tmp/ptcg   (sets/ and cards/en/ are used)
//   node scripts/build-card-sets.mjs /tmp/tcgdex /tmp/ptcg
import fs from 'node:fs';
import path from 'node:path';

const [tcgdexDir, ptcgDir] = process.argv.slice(2);
if (!tcgdexDir || !ptcgDir) {
  console.error('usage: node scripts/build-card-sets.mjs <tcgdex cards-database> <pokemon-tcg-data>');
  process.exit(1);
}

const unescape = value => value.replace(/\\(.)/g, '$1');
// Codes people use that differ from TCGdex's set ids.
const ALIASES = {
  EC1: 'E1',      // Base Expansion Pack (Japanese e-Card)
  XY5t: 'XY5b',   // Tidal Storm
  XY5g: 'XY5a',   // Gaia Volcano
};
// Languages TCGdex serves for Asian sets, in order of preference.
const ASIA_LANGS = ['ja', 'zh-tw', 'zh-cn', 'ko', 'th', 'id'];
const nameIn = (block, lang) => block.match(new RegExp(`['"]?\\b${lang}['"]?\\s*:\\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`))?.[2];
const tcgdex = [];
for (const [root, defaultLang] of [['data', 'en'], ['data-asia', 'ja']]) {
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const setFile = path.join(dir, `${entry.name}.ts`);
      if (dir !== path.join(tcgdexDir, root) && fs.existsSync(setFile)) {
        const text = fs.readFileSync(setFile, 'utf8');
        const id = text.match(/\bid:\s*["']([^"']+)["']/)?.[1];
        if (id) {
          const names = text.match(/\bname:\s*{([^}]*)}/s)?.[1] || '';
          const abbreviations = text.match(/abbreviations?:\s*{([^}]*)}/s)?.[1] || '';
          const nameLangs = [...names.matchAll(/['"]?([a-z]{2}(?:-[a-z]{2})?)['"]?\s*:/g)].map(match => match[1]);
          const lang = defaultLang === 'en' ? 'en' : (ASIA_LANGS.find(code => nameLangs.includes(code)) || 'ja');
          const cardDir = path.join(dir, entry.name);
          const cards = fs.existsSync(cardDir) ? fs.readdirSync(cardDir).filter(file => file.endsWith('.ts')).length : 0;
          tcgdex.push({
            lang,
            cards,
            id,
            code: abbreviations.match(/official:\s*["']([^"']+)["']/)?.[1] || '',
            name: unescape(nameIn(names, 'en') || nameIn(names, lang) || ''),
          });
        }
      }
      walk(path.join(dir, entry.name));
    }
  };
  walk(path.join(tcgdexDir, root));
}

const pokemontcg = JSON.parse(fs.readFileSync(path.join(ptcgDir, 'sets', 'en.json'), 'utf8')).map(set => ({
  id: set.id,
  // McDonald's sets have no code in this data; they are known as MCDyy.
  code: set.ptcgoCode || (/^mcd(\d{2})$/.exec(set.id) ? `MCD${set.id.slice(3)}` : ''),
  name: set.name,
}));

// Classic Collections keep the original card numbers, which clash with the
// main set's numbers; their names let the app tell the two apart.
const numberedNames = {};
for (const setId of ['me55c', 'cel25c']) {
  const file = path.join(ptcgDir, 'cards', 'en', `${setId}.json`);
  if (!fs.existsSync(file)) continue;
  numberedNames[setId] = Object.fromEntries(JSON.parse(fs.readFileSync(file, 'utf8')).map(card => [card.number, card.name]));
}

const out = { generated: new Date().toISOString().slice(0, 10), aliases: ALIASES, tcgdex, pokemontcg, numberedNames };
fs.writeFileSync(new URL('../data/card-sets.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`tcgdex: ${tcgdex.length} sets, pokemontcg: ${pokemontcg.length} sets`);
