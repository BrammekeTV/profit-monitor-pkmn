# profit-monitor-pkmn

A profit tracker for Pokémon TCG trading. Use it straight from GitHub Pages (data in your browser), or self-host it with Docker so the data lives on your own server.

**Self-hosting on Unraid / Docker:** see [UNRAID.md](UNRAID.md).

**[→ Open the app](https://brammeketv.github.io/profit-monitor-pkmn/)**

## Features

- View all buy/sell transactions with a live profit/loss summary
- Work in multiple tabs/workspaces, each with its own transaction list
- Filter by type (Verkocht / Gekocht) and search by description
- Sort columns in both transaction and profit tables
- Collapse/expand transaction and profit sections for a cleaner overview
- Add new transactions — saved on your server (Docker) or in browser localStorage (GitHub Pages)
- Archived tabs live behind the small archive icon next to the title. The pop-up lists them, and opens a read-only preview of each one with every view (Transacties, Winst per kaart, Analyse, Trades, Trades – Analyse), plus restore and delete
- Mark cards as graded with company-specific grade options (PSA/BGS/CGC/TAG); graded rows get a subtle gold accent and a company | grade badge
- **Gegradeerd** filter next to the type filters (with count), plus per-company chips; search also matches grades like "psa 10" or "gem mint"
- Delete individual transactions
- Track realized profit per card name with FIFO matching on buy/sell quantities
- Search the **Winst per kaart** table and view each card's profit margin
- View transactions containing the word "Bulk" in a separate table
- Profit visualizations: top-card profit chart and monthly net-result trend
- Analyse dashboard with KPI widgets including current-month performance and average per-card profit margin
- Trade registratie met duidelijke **IK GEEF / IK ONTVANG** invoer, live verschil/ROI, en bewerken/verwijderen
- Aparte tab **Trades - Analyse** met trade-statistieken en performancegrafiek
- Sold transactions with `#123456789` in the description show Cardmarket order links
- **Import from `.xlsm` / `.xlsx`** — reads your existing spreadsheet client-side and merges the data into the active tab; rows that already exist there are skipped, so re-importing the same file is safe
- **Card images** are found automatically, from three sources in turn: [TCGdex](https://tcgdex.dev) (English + Japanese), the pokemontcg.io image library (McDonald's and older sets), and Limitless TCG (newest promos such as MEP, Japanese sets). An image is only used once it has actually loaded, and the found card's name must match the description (this is how 30th Celebration and its Classic Collection, which share numbers, are told apart). Classic Collection reprints written as `Raikou (30C VIV 50)` (with the original set's code before the number) are looked up by name in the Classic Collection set. `CardName (SETCODE NUMBER)` fetches that exact card. Prize Pack codes (`PPS9 PFL 068`) use the real set, and `30C` cards whose description contains "Classic" come from the 30th Celebration Classic Collection. With only a name, a unique match is used directly. When several cards fit, the row shows **Kies kaartafbeelding (n)**. The picker searches by name or by set code + number (`M1L 087`, so Japanese cards can be found), and takes your own image link or upload. Hand-picked choices trigger a monthly reminder to send them to Claude (`CARD_IMAGES` in `profit-monitor-core.mjs`)
- **Finishes on card images:** Prize Pack cards get the Play! Pokémon stamp in its real place (bottom right of the artwork on Pokémon, top right on Trainer cards). A Prize Pack `(Holo Version)` gets a cosmos holo pattern on the artwork and the border. `(Reverse Holo)` gets an animated holo shine outside the artwork, and `(Holo)` a shine on the artwork. The card type (Pokémon/Trainer) is looked up automatically and can be switched in the image viewer. Variants share one image choice
- Which set a code means comes from `data/card-sets.json`. Regenerate it after new sets come out with `node scripts/build-card-sets.mjs <tcgdex cards-database> <pokemon-tcg-data>` (see the script for the clone commands)
- **Photos on transactions** (e.g. sealed product or accessories): add them in the form with **+ Foto**, by pasting, or by dragging them in. They show after the description and open full size on click. They are scaled down before saving. On the server they are stored in `/data/images`; without a server they are kept in the browser, which only has room for a few dozen

## Data storage

**Self-hosted (Docker):** `server.mjs` serves the app and stores the workspace as `profit-monitor.json` in `DATA_DIR` (`/data` in the container), with one backup per day in `backups/`. The browser loads and saves it through `GET/PUT /api/state`; each save carries the revision it was based on, so a stale device gets a conflict prompt instead of silently overwriting newer data. Setup: [UNRAID.md](UNRAID.md).

**GitHub Pages / plain file:** with no server API available, all data is stored in your browser's `localStorage` under the key `profit-monitor-pkmn`.

The browser app now stores a workspace object:

```json
{
  "tabs": [
    {
      "id": "tab-...",
      "name": "Default",
      "createdAt": "2026-07-26T16:00:00.000Z",
      "transactions": []
    }
  ],
  "activeTabId": "tab-...",
  "trades": []
}
```

Existing users with the original single transaction array are migrated automatically into a default tab on first load. Use the **JSON exporteren** button to download a full workspace backup, and import that JSON later to restore every tab.

Trades blijven volledig gescheiden van transacties: ze tellen alleen mee in **Trades** en **Trades - Analyse**, niet in omzet/winst van de bestaande verkoopanalyse.

### Profit matching

The **Winst per kaart** table groups transactions by normalized `cardName` (`trim()` + case-insensitive) plus grading (company + grade), so raw copies, a PSA 9 and a PSA 10 of the same card each have their own row, and matches sold quantities against earlier buys using FIFO (first in, first out). Partial sales allocate only the sold quantity from the oldest open buy lots, so remaining inventory stays available for later sales.
Profit margin is calculated as realized profit divided by the cost allocated to sold cards. The average margin is the arithmetic mean across cards with a matched purchase cost; transactions whose description contains the word "Bulk" are listed separately and excluded from per-card margins.

### Cardmarket order links

For sold transactions, any description token in the form `#1289784654` is converted into a Cardmarket order link:

`https://www.cardmarket.com/en/Pokemon/Orders/1289784654`

> **Note:** Card image lookups contact external services: the [Pokémon TCG API](https://pokemontcg.io) (when using the Flask server) and [Cardmarket](https://www.cardmarket.com) as a fallback for cards not listed in that API. Only the card name, set code, and number are sent — no personal or transaction data.

### Grading company logos

Logo files live in `assets/grading/` (`psa.svg`, `bgs.svg`, `cgc.svg`, `tag.png`; either `.svg` or `.png` works per company). To replace one, drop in a new file with the same name. The app picks them up automatically and shows them in the grading badge; without a file it shows the company name as text. Light-coloured logos work best on the dark theme.

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