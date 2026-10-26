# profit-monitor-pkmn

A static profit tracker for Pokémon TCG trading that runs entirely in the browser — no server required.

**[→ Open the app](https://brammeketv.github.io/profit-monitor-pkmn/)**

## Features

- View all buy/sell transactions with a live profit/loss summary
- Work in multiple tabs/workspaces, each with its own transaction list
- Filter by type (Verkocht / Gekocht) and search by description
- Sort columns in both transaction and profit tables
- Collapse/expand transaction and profit sections for a cleaner overview
- Add new transactions — saved to browser localStorage
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
- Pokémon card image lookup: descriptions in the format `CardName (SETCODE NUMBER)` show images from the [Pokémon TCG API](https://pokemontcg.io), with links to Cardmarket

## Data storage

All transaction data is stored in your browser's `localStorage` under the key `profit-monitor-pkmn`.

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