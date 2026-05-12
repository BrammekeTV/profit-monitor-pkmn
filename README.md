# profit-monitor-pkmn

A static profit tracker for Pokémon TCG trading that runs entirely in the browser — no server required.

**[→ Open the app](https://brammeketv.github.io/profit-monitor-pkmn/)**

## Features

- View all buy/sell transactions with a live profit/loss summary
- Filter by type (Verkocht / Gekocht) and search by description
- Add new transactions — saved to browser localStorage
- Delete individual transactions
- **Import from `.xlsm` / `.xlsx`** — reads your existing spreadsheet client-side and merges the data (duplicates skipped)
- Pokémon card image lookup: descriptions in the format `CardName (SETCODE NUMBER)` show images from the [Pokémon TCG API](https://pokemontcg.io), with links to Cardmarket

## Data storage

All data is stored in your browser's `localStorage` under the key `profit-monitor-pkmn`. Nothing is sent to any server. Use the **JSON exporteren** button to download a backup, and re-import the JSON file later if needed (import also accepts JSON files).

## Import format (.xlsm / .xlsx)

The importer reads the sheet named **Gegevens** (falls back to sheet 1), starting at row 3:

| Column A | Column B | Column C |
|----------|----------|----------|
| `Gekocht` or `Verkocht` | Amount (€, sign inferred from type) | Description |

Card descriptions can span multiple lines, one card per line:
```
Gyarados Lv.52 (STF 19)
Psyduck Lv.19 (PL 87)
```

## GitHub Pages setup

1. Go to **Settings → Pages** in this repository.
2. Under *Source*, select **GitHub Actions**.
3. Push to `main` — the workflow in `.github/workflows/pages.yml` deploys automatically.

## Local Flask version

A server-side Flask version (which writes back to the `.xlsm` file) is also in this repo:

```bash
pip install -r requirements.txt
python app.py
# open http://localhost:5000
```