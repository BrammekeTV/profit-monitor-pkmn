// Builds data/card-sets.json: which set in TCGdex and in the pokemontcg.io
// image library belongs to each set code ("PFL", "MCD21", "M1L", …).
//
//   git clone --depth 1 https://github.com/tcgdex/cards-database /tmp/tcgdex
//   git clone --depth 1 https://github.com/PokemonTCG/pokemon-tcg-data /tmp/ptcg
//   node scripts/build-card-sets.mjs /tmp/tcgdex /tmp/ptcg
import fs from 'node:fs';
import path from 'node:path';

const [tcgdexDir, ptcgDir] = process.argv.slice(2);
if (!tcgdexDir || !ptcgDir) {
  console.error('usage: node scripts/build-card-sets.mjs <tcgdex cards-database> <pokemon-tcg-data>');
  process.exit(1);
}

const unescape = value => value.replace(/\\(.)/g, '$1');
const tcgdex = [];
for (const [root, lang] of [['data', 'en'], ['data-asia', 'ja']]) {
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
          tcgdex.push({
            lang,
            id,
            code: abbreviations.match(/official:\s*["']([^"']+)["']/)?.[1] || '',
            name: unescape(names.match(/\ben:\s*"((?:[^"\\]|\\.)*)"/)?.[1] || names.match(/\bja:\s*"((?:[^"\\]|\\.)*)"/)?.[1] || ''),
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

const out = { generated: new Date().toISOString().slice(0, 10), tcgdex, pokemontcg };
fs.writeFileSync(new URL('../data/card-sets.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`tcgdex: ${tcgdex.length} sets, pokemontcg: ${pokemontcg.length} sets`);
