import os

import openpyxl
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

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


if __name__ == "__main__":
    app.run(debug=False)
