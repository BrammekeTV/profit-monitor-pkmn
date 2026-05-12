# profit-monitor-pkmn

A web-based profit tracker for Pokémon TCG trading. Data is stored in `example/Verdiensten.xlsm`.

## Features

- View all buy/sell transactions with live profit summary
- Filter and search transactions
- Add new buys or sales — saved back to the `.xlsm` file
- Pokémon card image lookup: descriptions in the format `CardName (SETCODE NUMBER)` automatically show card images fetched from the [Pokémon TCG API](https://pokemontcg.io), with links to Cardmarket

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Open [http://localhost:5000](http://localhost:5000).

## Data format (xlsm)

Sheet **Gegevens**, starting at row 3:

| Column A | Column B | Column C |
|----------|----------|----------|
| `Gekocht` or `Verkocht` | Amount (€, negative for buys) | Description |

Card descriptions can span multiple lines, one card per line, using the format:
```
Gyarados Lv.52 (STF 19)
Psyduck Lv.19 (PL 87)
```