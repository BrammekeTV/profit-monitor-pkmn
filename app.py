import os
import re

import openpyxl
import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Reused session for all outbound card-image lookups (connection pooling).
_http = requests.Session()
_http.headers["User-Agent"] = "profit-monitor-pkmn/1.0"

XLSM_PATH = os.path.join(os.path.dirname(__file__), "example", "Verdiensten.xlsm")

# ------------------------------------------------------------------
# XLSM helpers
# ------------------------------------------------------------------

def load_transactions():
    wb = openpyxl.load_workbook(XLSM_PATH, keep_vba=True)
    ws = wb["Gegevens"]
    transactions = []
    for row_idx, row in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        if not row or len(row) < 3:
            continue
        type_, amount, description = row[0], row[1], row[2]
        if type_ not in ("Gekocht", "Verkocht") or amount is None:
            continue
        transactions.append(
            {
                "id": row_idx,
                "type": type_,
                "amount": round(float(amount), 2),
                "description": description or "",
            }
        )
    return transactions


def append_transaction(type_: str, amount: float, description: str) -> int:
    wb = openpyxl.load_workbook(XLSM_PATH, keep_vba=True)
    ws = wb["Gegevens"]
    # Enforce sign convention for both types
    amount = abs(amount) if type_ == "Verkocht" else -abs(amount)
    # Find first completely empty row starting from row 3 (rows 1-2 are headers)
    next_row = max(3, ws.max_row + 1)
    for r in range(3, ws.max_row + 2):
        if ws.cell(r, 1).value is None and ws.cell(r, 2).value is None:
            next_row = r
            break
    ws.cell(next_row, 1).value = type_
    ws.cell(next_row, 2).value = round(amount, 2)
    ws.cell(next_row, 3).value = description
    wb.save(XLSM_PATH)
    return next_row


# ------------------------------------------------------------------
# Card name parsing
# ------------------------------------------------------------------

# Pattern matches lines like "Gyarados Lv.52 (STF 19)" or "Turtwig (MEP 040)".
# [^(]+ prevents backtracking over parentheses (avoids ReDoS).
# Single literal space before the parenthesised block avoids polynomial backtracking.
_CARD_PATTERN = re.compile(
    r"^([^(]+) \(([A-Z0-9]+) (\d+[A-Za-z]*)\)$"
)

# Maximum line length fed into the regex to prevent ReDoS on crafted input.
_MAX_CARD_LINE_LEN = 200


def parse_card_lines(description: str) -> list[dict]:
    """
    Parse Pokémon card references from a multi-line description string.

    Each line is expected to follow the format::

        CardName [optional-suffix] (SETCODE NUMBER)

    For example::

        Gyarados Lv.52 (STF 19)
        Turtwig (MEP 040)
        Flareon [4] Lv.55 (RR 60)

    Returns a list of dicts with keys ``name``, ``set``, and ``number``.
    Lines that do not match the pattern are silently skipped.
    """
    cards = []
    for line in description.strip().split("\n"):
        line = line.strip()
        # Truncate pathologically long lines before matching to prevent ReDoS.
        m = _CARD_PATTERN.match(line[:_MAX_CARD_LINE_LEN])
        if not m:
            continue
        raw_name = m.group(1).strip()
        set_code = m.group(2)
        number = m.group(3)
        # Strip optional suffixes from the card name:
        name = re.sub(r" Lv\.\d+$", "", raw_name)      # level indicator, e.g. "Lv.52"
        name = re.sub(r" \[[^\]]{0,20}\]$", "", name)   # bracketed tag, e.g. "[C]" or "[4]"
        # δ Delta Species suffix — use string split to avoid backtracking:
        if " δ" in name:
            name = name[: name.index(" δ")]
        name = name.strip()
        if name:
            cards.append({"name": name, "set": set_code, "number": number})
    return cards


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/transactions")
def api_transactions():
    return jsonify(load_transactions())


@app.route("/api/summary")
def api_summary():
    txns = load_transactions()
    total_sold = sum(t["amount"] for t in txns if t["type"] == "Verkocht")
    total_bought = sum(t["amount"] for t in txns if t["type"] == "Gekocht")
    profit = total_sold + total_bought
    return jsonify(
        {
            "total_sold": round(total_sold, 2),
            "total_bought": round(total_bought, 2),
            "profit": round(profit, 2),
            "count": len(txns),
        }
    )


@app.route("/api/add", methods=["POST"])
def api_add():
    data = request.get_json(silent=True) or {}
    type_ = data.get("type", "")
    description = (data.get("description") or "").strip()
    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid amount"}), 400

    if type_ not in ("Gekocht", "Verkocht"):
        return jsonify({"error": "Type must be Gekocht or Verkocht"}), 400
    if amount <= 0:
        return jsonify({"error": "Amount must be a positive number"}), 400

    row = append_transaction(type_, amount, description)
    return jsonify({"success": True, "row": row})


@app.route("/api/card-images")
def api_card_images():
    """
    Accepts ?description=... and returns a list of card image URLs.
    Uses pokemontcg.io (free, open) and adds a Cardmarket search link per card.
    """
    description = request.args.get("description", "")
    cards = parse_card_lines(description)
    if not cards:
        return jsonify([])

    results = []

    for card in cards:
        entry = {
            "name": card["name"],
            "set": card["set"],
            "number": card["number"],
            "image": None,
            "cardmarket_url": (
                f"https://www.cardmarket.com/en/Pokemon/Products/Search"
                f"?searchString={requests.utils.quote(card['name'])}"
            ),
        }
        try:
            q = f'name:"{card["name"]}" number:{card["number"]}'
            resp = _http.get(
                "https://api.pokemontcg.io/v2/cards",
                params={"q": q, "pageSize": 10},
                timeout=6,
            )
            if resp.ok:
                data = resp.json().get("data", [])
                # Prefer matching set code (ptcgoCode)
                matched = next(
                    (
                        c
                        for c in data
                        if c.get("set", {}).get("ptcgoCode", "").upper()
                        == card["set"].upper()
                    ),
                    None,
                )
                hit = matched or (data[0] if data else None)
                if hit:
                    entry["image"] = hit.get("images", {}).get("small")
        except Exception:
            pass
        results.append(entry)

    return jsonify(results)


if __name__ == "__main__":
    app.run(debug=False)
