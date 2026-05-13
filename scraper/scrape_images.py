#!/usr/bin/env python3
"""
scrape_images.py — GitHub Actions scraper
Reads data/cards.json, resolves missing cardmarket image IDs,
and writes results to data/image-lookup.json.

Run from the repository root:
    python scraper/scrape_images.py
"""

import json
import re
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Set abbreviation → Cardmarket full set slug
# ---------------------------------------------------------------------------
SET_SLUGS = {
    # EX-era (Ruby & Sapphire through Power Keepers)
    "RS":  "EX-Ruby-and-Sapphire",
    "SS":  "EX-Sandstorm",
    "DR":  "EX-Dragon",
    "MA":  "EX-Team-Magma-vs-Team-Aqua",
    "HL":  "EX-Hidden-Legends",
    "FR":  "EX-FireRed-and-LeafGreen",
    "TRR": "EX-Team-Rocket-Returns",
    "DE":  "EX-Deoxys",
    "EM":  "EX-Emerald",
    "UF":  "EX-Unseen-Forces",
    "DS":  "EX-Delta-Species",
    "LM":  "EX-Legend-Maker",
    "HP":  "EX-Holon-Phantoms",
    "CG":  "EX-Crystal-Guardians",
    "DF":  "EX-Dragon-Frontiers",
    "PK":  "EX-Power-Keepers",
    # Diamond & Pearl era
    "DP":  "Diamond-and-Pearl",
    "MT":  "Mysterious-Treasures",
    "SW":  "Secret-Wonders",
    "GE":  "Great-Encounters",
    "MD":  "Majestic-Dawn",
    "LA":  "Legends-Awakened",
    "SF":  "Stormfront",
    # Platinum era
    "PL":  "Platinum",
    "RR":  "Rising-Rivals",
    "SV":  "Supreme-Victors",
    "AR":  "Arceus",
    # HeartGold & SoulSilver era
    "HS":  "HeartGold-and-SoulSilver",
    "UL":  "Unleashed",
    "UD":  "Undaunted",
    "TM":  "Triumphant",
    # Call of Legends / older sets
    "CL":  "Call-of-Legends",
    "BS":  "Base-Set",
    "JU":  "Jungle",
    "FO":  "Fossil",
    "B2":  "Base-Set-2",
    "TR":  "Team-Rocket",
    "G1":  "Gym-Heroes",
    "G2":  "Gym-Challenge",
    "N1":  "Neo-Genesis",
    "N2":  "Neo-Discovery",
    "N3":  "Neo-Revelation",
    "N4":  "Neo-Destiny",
    "LC":  "Legendary-Collection",
    "EX":  "Expedition-Base-Set",
    "AQ":  "Aquapolis",
    "SK":  "Skyridge",
    # Black & White era
    "BLW": "Black-and-White",
    "EPO": "Emerging-Powers",
    "NVI": "Noble-Victories",
    "NXD": "Next-Destinies",
    "DEX": "Dark-Explorers",
    "BCR": "Boundaries-Crossed",
    "PLS": "Plasma-Storm",
    "PLF": "Plasma-Freeze",
    "PLB": "Plasma-Blast",
    "LTR": "Legendary-Treasures",
    # XY era
    "XY":  "XY",
    "FLF": "Flashfire",
    "FFI": "Furious-Fists",
    "PHF": "Phantom-Forces",
    "PRC": "Primal-Clash",
    "DCR": "Double-Crisis",
    "ROS": "Roaring-Skies",
    "AOR": "Ancient-Origins",
    "BKT": "BREAKthrough",
    "BKP": "BREAKpoint",
    "FCO": "Fates-Collide",
    "STS": "Steam-Siege",
    "EVO": "Evolutions",
    # Sun & Moon era
    "SUM": "Sun-and-Moon",
    "SM":  "Sun-and-Moon",
    "GRI": "Guardians-Rising",
    "BUS": "Burning-Shadows",
    "SLG": "Shining-Legends",
    "CIN": "Crimson-Invasion",
    "UPR": "Ultra-Prism",
    "FLI": "Forbidden-Light",
    "CES": "Celestial-Storm",
    "DRM": "Dragon-Majesty",
    "LOT": "Lost-Thunder",
    "TEU": "Team-Up",
    "DET": "Detective-Pikachu",
    "UNB": "Unbroken-Bonds",
    "UNM": "Unified-Minds",
    "HIF": "Hidden-Fates",
    "CEC": "Cosmic-Eclipse",
    # Sword & Shield era
    "SSH": "Sword-and-Shield",
    "RCL": "Rebel-Clash",
    "DAA": "Darkness-Ablaze",
    "CPA": "Champions-Path",
    "VIV": "Vivid-Voltage",
    "BST": "Battle-Styles",
    "CRE": "Chilling-Reign",
    "EVS": "Evolving-Skies",
    "CEL": "Celebrations",
    "FST": "Fusion-Strike",
    "BRS": "Brilliant-Stars",
    "ASR": "Astral-Radiance",
    "PGO": "Pokemon-GO",
    "LOR": "Lost-Origin",
    "SIT": "Silver-Tempest",
    "CRZ": "Crown-Zenith",
    # Scarlet & Violet era
    "SVI": "Scarlet-and-Violet",
    "PAL": "Paldea-Evolved",
    "OBF": "Obsidian-Flames",
    "MEW": "151",
    "PAR": "Paradox-Rift",
    "PAF": "Paldean-Fates",
    "TEF": "Temporal-Forces",
    "TWM": "Twilight-Masquerade",
    "SFA": "Shrouded-Fable",
    "SCR": "Stellar-Crown",
    "SSP": "Surging-Sparks",
    "PRE": "Prismatic-Evolutions",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

CARD_LINE_RE = re.compile(r"^(.*?)\s*\(([A-Z0-9]+)\s+(\d+[A-Za-z]*)\)\s*$")
IMAGE_ID_RE  = re.compile(
    r"product-images\.s3\.cardmarket\.com/51/[A-Z0-9]+/(\d+)/\1\.jpg"
)


def parse_card_line(line: str):
    """Return (set_abbr, card_num, card_name) or None."""
    m = CARD_LINE_RE.match(line.strip())
    if not m:
        return None
    card_name, set_abbr, card_num = m.group(1).strip(), m.group(2), m.group(3)
    return set_abbr, card_num, card_name


def slugify_card_name(name: str) -> str:
    """Strip non-ASCII, replace spaces/underscores with hyphens, collapse repeats."""
    # Remove characters that are not ASCII letters, digits, spaces or hyphens
    cleaned = re.sub(r"[^\x00-\x7F]", "", name)          # strip non-ASCII (δ etc.)
    cleaned = re.sub(r"[^A-Za-z0-9 \-]", "", cleaned)    # keep only safe chars
    cleaned = re.sub(r"[\s_]+", "-", cleaned.strip())     # spaces → hyphens
    cleaned = re.sub(r"-{2,}", "-", cleaned)              # collapse double hyphens
    return cleaned


def build_card_slug(card_name: str, set_abbr: str, card_num: str) -> str:
    return f"{slugify_card_name(card_name)}-{set_abbr}{card_num}"


def fetch_card_id(set_abbr: str, card_num: str, card_name: str) -> int | None:
    set_slug = SET_SLUGS.get(set_abbr)
    if not set_slug:
        print(f"  [SKIP] Unknown set abbreviation: {set_abbr}")
        return None

    card_slug = build_card_slug(card_name, set_abbr, card_num)
    url = (
        f"https://www.cardmarket.com/en/Pokemon/Products/Singles"
        f"/{set_slug}/{card_slug}"
    )
    print(f"  Fetching: {url}")

    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; profit-monitor-bot/1.0)"},
            timeout=20,
        )
    except requests.RequestException as exc:
        print(f"  [ERROR] Request failed: {exc}")
        return None

    if resp.status_code != 200:
        print(f"  [WARN] HTTP {resp.status_code} for {url}")
        return None

    m = IMAGE_ID_RE.search(resp.text)
    if not m:
        print(f"  [WARN] Image ID not found in page HTML")
        return None

    return int(m.group(1))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    repo_root = Path(__file__).parent.parent
    cards_path  = repo_root / "data" / "cards.json"
    lookup_path = repo_root / "data" / "image-lookup.json"

    # Load cards
    try:
        cards = json.loads(cards_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"[ERROR] Cannot read cards.json: {exc}")
        return

    # Load existing lookup (create if missing)
    if lookup_path.exists():
        try:
            lookup: dict = json.loads(lookup_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            lookup = {}
    else:
        lookup = {}

    updated = False

    for txn in cards:
        description = txn.get("description", "")
        if not description:
            continue

        for line in description.splitlines():
            line = line.strip()
            parsed = parse_card_line(line)
            if not parsed:
                continue

            set_abbr, card_num, card_name = parsed
            # Strip trailing letters from number for the key (e.g. "71a" → "71")
            key = f"{set_abbr}-{card_num}"

            if key in lookup:
                print(f"  [CACHED] {key}")
                continue

            print(f"Resolving {key}: {card_name!r}")
            card_id = fetch_card_id(set_abbr, card_num, card_name)

            if card_id is not None:
                lookup[key] = card_id
                updated = True
                print(f"  -> {card_id}")
            else:
                print(f"  -> could not resolve")

            # Be polite — brief pause between requests
            time.sleep(1.5)

    if updated:
        lookup_path.write_text(
            json.dumps(lookup, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"\nWrote {lookup_path}")
    else:
        print("\nNo new cards to resolve — image-lookup.json unchanged.")


if __name__ == "__main__":
    main()
