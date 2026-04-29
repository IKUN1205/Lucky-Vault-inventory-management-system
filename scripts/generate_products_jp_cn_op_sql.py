#!/usr/bin/env python3
"""
Generate INSERT SQL for the remaining 3 sheet tabs:
  - POKEMONJP (gid=0)            — Pokemon JP + CN mixed
  - Sheet6   (gid=698669455)     — Pokemon JP duplicates of POKEMONJP (with ' Japanese' suffix)
  - OnePiece (gid=799475548)     — One Piece EN + JP mixed

Strategy:
  - Names preserved verbatim (after stripping ' Japanese' from Sheet6)
  - Language per-row from sheet's Language column
  - Skip empty rows
  - Pack-count defaults adjusted per brand+language (Pokemon JP: 30, One Piece: 24, etc.)
"""

import re
import sys

POKEMONJP_CSV = """Black Bolt Booster Box,Japanese
Black Bolt Deluxe Box,Japanese
Black Bolt Deluxe Pack,Japanese
Clay Burst Booster Box,Japanese
Crimson Haze Booster Box,Japanese
Cyber Judge Booster Packs,Japanese
Dark Fantasma Enhanced Expansion Box,Japanese
Dream League Booster Box,Japanese
Eevee Heroes Booster Box,Japanese
Electric Breaker Booster Box,Japanese
Future Flash Booster Box,Japanese
Incandescent Arcana Booster Box,Japanese
Inferno X Booster Box,Japanese
Mega Brave Booster Box,Japanese
Mega Dreams Booster Box,Japanese
Mega Symphonia Booster Box,Japanese
Nully Zero Booster Box,Japanese
Night Wanderer Booster Box,Japanese
Paradigm Trigger Box,Japanese
Paradise Dragon Booster Box,Japanese
Heat Wave Arena Box,Japanese
Raging Surf Booster Box,Japanese
Ruler Of The Black Flame Booster Box,Japanese
Wild Force Booster Box,Japanese
Scarlet ex Booster Box,Japanese
Shiny Star V Box,Japanese
Shiny Treasure Booster Box,Japanese
Snow Hazard Booster Box,Japanese
Special Box Pokemon Center Fukuoka,Japanese
Special Box Pokemon Center Hiroshima,Japanese
Special Box Pokemon Center Tohoku,Japanese
SV Stellar Miracle Booster Box,Japanese
sv10 The Glory of Team Rocket Box,Japanese
Cyber Judge Booster Box sv5M,Japanese
SV9 Battle Partners Booster Box,Japanese
Terastal Festival Japanese Booster Box,Japanese
Time Gazer Booster Box,Japanese
Transformation Mask Booster Box,Japanese
Triplet Beat Booster Box,Japanese
Violet ex Booster Box,Japanese
Vstar Universe Booster Box,Japanese
White Flare Booster Box,Japanese
White Flare Deluxe Box,Japanese
Pokemon 151 Chinese Booster Box,Chinese
Gem 3 Booster Box,Chinese
151 Coin Set,Chinese
151 Gathering Slim Booster Box Sealed,Chinese
151C Surprise Slim Booster Box,Chinese
Chinese Gem Vol.3 Booster Box,Chinese
Chinese Pokemon Gem Vol.2 Box,Chinese
CSV5C Black Crystal Blaze Chino Booster Box,Chinese
CSV5C Dark Crystal Blaze Jumbo Booster Box Fat,Chinese"""
# Note: skipping the stray "Celebrations Booster Pack,English" (already in EN tab) and CN duplicate "Gem 3 Booster Box"

# Sheet6 contents — same as POKEMONJP-JP entries with " Japanese" suffix.
# We'll strip the suffix and let ON CONFLICT handle dedup (everything here is already in POKEMONJP).
SHEET6_CSV = """Mega Symphonia Booster Box Japanese,Japanese
Mega Dreams Booster Box Japanese,Japanese
Mega Brave Booster Box Japanese,Japanese
White Flare Booster Box Japanese,Japanese
White Flare Deluxe Box Japanese,Japanese
Black Bolt Booster Box Japanese,Japanese
Black Bolt Deluxe Box Japanese,Japanese
SV9 Battle Partners Booster Box Japanese,Japanese
sv10 The Glory of Team Rocket Box Japanese,Japanese
Heat Wave Arena Box Japanese,Japanese
Terastal Festival Japanese Booster Box Japanese,Japanese
SV Stellar Miracle Booster Box Japanese,Japanese
Paradise Dragon Booster Box Japanese,Japanese
Night Wanderer Booster Box Japanese,Japanese
Transformation Mask Booster Box Japanese,Japanese
Cyber Judge Booster Box sv5M Japanese,Japanese
Wild Force Booster Box Japanese,Japanese
Crimson Haze Booster Box Japanese,Japanese
Shiny Treasure Booster Box Japanese,Japanese
Future Flash Booster Box Japanese,Japanese
Nully Zero Booster Box Japanese,Japanese
Raging Surf Booster Box Japanese,Japanese
Ruler Of The Black Flame Booster Box Japanese,Japanese
Triplet Beat Booster Box Japanese,Japanese
Snow Hazard Booster Box Japanese,Japanese
Clay Burst Booster Box Japanese,Japanese
Scarlet ex Booster Box Japanese,Japanese
Violet ex Booster Box Japanese,Japanese
Vstar Universe Booster Box Japanese,Japanese
Paradigm Trigger Box Japanese,Japanese
Incandescent Arcana Booster Box Japanese,Japanese
Electric Breaker Booster Box Japanese,Japanese
Dark Fantasma Enhanced Expansion Box Japanese,Japanese
Time Gazer Booster Box Japanese,Japanese
Eevee Heroes Booster Box Japanese,Japanese
Dream League Booster Box Japanese,Japanese
Inferno X Booster Box Japanese,Japanese
Shiny Star V Box Japanese,Japanese
Special Box Pokemon Center Fukuoka Japanese,Japanese
Special Box Pokemon Center Hiroshima Japanese,Japanese
Special Box Pokemon Center Tohoku Japanese,Japanese"""

ONEPIECE_CSV = """OP-09 ENG Booster Box,English
OP-13 ENG Booster Box,English
EB-03 ENG Booster Box,English
PRB-01 ENG Booster Box,English
A Fist of Divine Speed - Booster Box OP-11,English
EB-04 ENG Booster Box,English
OP-10 Royal Blood Booster Box,English
OP 01 Japanese Booster Box,Japanese
OP 03 Japanese Booster Box,Japanese
OP 04 Japanese Booster Box,Japanese
OP 05 Japanese Booster Box,Japanese
OP 07 Japanese Booster Box,Japanese
OP 08 Japanese Booster Box,Japanese
OP 09 Japanese Booster Box,Japanese
OP 10 Japanese Booster Box,Japanese
OP 11 Japanese Booster Box,Japanese
OP 12 Japanese Booster Box,Japanese
OP 13 Japanese Booster Box,Japanese
OP 14 Japanese Booster Box,Japanese
OP 15 Japanese Booster Box,Japanese
EB 01 Japanese Booster Box,Japanese
EB 02 Japanese Booster Box,Japanese
EB 03 Japanese Booster Box,Japanese
EB 04 Japanese Booster Box,Japanese
EB 05 Japanese Booster Box,Japanese
PRB 02 Japanese Booster Box,Japanese
OP 08 English Booster Pack,English
OP 09 English Booster Box,English
OP 10 English Booster Pack,English
OP 11 English Sleeved Booster Pack,English
OP 13 English Booster Box,English
OP 14 English Booster Box,English
OP 14 English Sleeved Booster Pack,English
OP 14 English Booster Pack,English
OP 15 English Booster Box,English
EB 03 English Booster Box,English
PRB 01 English Booster Box,English
Legacy of the Master Booster Box OP12,English
OP-07 500 Years in the Future Booster Box,English"""
# Note: Skipped duplicates within sheet (OP-09 ENG appeared twice)

LANG_MAP = {"English": "EN", "Japanese": "JP", "Chinese": "CN"}

def get_packs(brand, language, category):
    """Return packs_per_box for (brand, language, category). None = leave NULL/non-breakable."""
    # One Piece: standard 24 packs/box (both EN and JP)
    if brand == "One Piece":
        if category == "Booster Box":
            return 24
        return None  # other OP categories — let user fill in later

    # Pokemon
    if brand == "Pokemon":
        if language == "JP":
            if category == "Booster Box":
                return 30        # JP standard SV-era: 30 packs
            if category == "Special Box":
                return None      # Pokemon Center special boxes — varies, leave for user
            if category == "Other":
                return None
            return None
        if language == "CN":
            if category == "Booster Box":
                return 30        # CN typically follows JP format
            if category == "Special Box":
                return None
            return None
    return None

# Classification rules — checked in order, first match wins.
# (regex_pattern, category, type)
# breakable = True if category implies a sealed openable product
RULES = [
    # Pokemon JP-specific large boxes
    (r"\bDeluxe Box\b",                       "Special Box",    "Sealed"),
    (r"\bDeluxe Pack\b",                      "Booster Pack",   "Pack"),     # JP Deluxe Pack = jumbo single pack
    (r"\bEnhanced Expansion Box\b",           "Booster Box",    "Sealed"),
    (r"\bV Box\b",                            "Special Box",    "Sealed"),   # Shiny Star V Box etc.
    (r"\bRoyal Blood Booster Box\b",          "Booster Box",    "Sealed"),
    (r"\bSpecial Box\b",                      "Special Box",    "Sealed"),
    (r"\bBooster Box\b",                      "Booster Box",    "Sealed"),
    (r"\bBooster Bundle\b",                   "Booster Bundle", "Sealed"),
    # ETB
    (r"\bElite Trainer Box\b",                "ETB",            "Sealed"),
    # Build & Battle
    (r"\bBuild & Battle Box\b",               "Build & Battle", "Sealed"),
    # Sleeved Booster Pack
    (r"\bSleeved Booster Pack\b",             "Booster Pack",   "Pack"),
    # Booster Pack(s)
    (r"\bBooster Packs?\b",                   "Booster Pack",   "Pack"),
    # Pokemon JP/CN: "Box" alone after a name (e.g., "Paradigm Trigger Box", "151 Coin Set", "Chinese Pokemon Gem Vol.2 Box")
    (r"\bCoin Set\b",                         "Special",        "Sealed"),
    (r"\bSlim Booster Box\b",                 "Booster Box",    "Sealed"),  # CN Slim variants
    (r"\bJumbo Booster Box\b",                "Booster Box",    "Sealed"),
    (r"\bBox\b",                              "Special Box",    "Sealed"),  # catch-all "X Box"
]

def classify(name):
    for pattern, category, ptype in RULES:
        if re.search(pattern, name, flags=re.IGNORECASE):
            return category, ptype
    return None

def is_breakable(category, ptype):
    # Packs are not breakable
    if ptype == "Pack":
        return False
    # Sealed categories that are typically breakable into packs
    return category in {"Booster Box", "Booster Bundle", "ETB", "Build & Battle", "Blister Pack"}

def sql_escape(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def parse_csv(csv_text, brand, name_transform=None):
    """Parse CSV, return list of (name, language). Skip empty/invalid rows."""
    out = []
    for line in csv_text.strip().splitlines():
        # Split first comma only (in case future fields contain commas)
        parts = line.split(",", 1)
        if len(parts) < 2:
            continue
        name = re.sub(r"\s+", " ", parts[0]).strip()
        lang_raw = parts[1].strip()
        if not name or not lang_raw:
            continue
        if name_transform:
            name = name_transform(name)
        lang = LANG_MAP.get(lang_raw)
        if not lang:
            continue
        out.append((name, lang))
    return out

def generate_inserts(rows, brand, label):
    """Return (sql_string, stats_dict) for the given rows."""
    seen = set()
    products = []
    unmatched = []
    duplicates = []
    for name, lang in rows:
        result = classify(name)
        if not result:
            unmatched.append((name, lang))
            continue
        category, ptype = result
        breakable = is_breakable(category, ptype)
        ppb = get_packs(brand, lang, category) if breakable else None
        # If breakable but no default pack count, still mark non-breakable to skip required field
        if breakable and ppb is None:
            breakable = False

        key = (brand, ptype, category, name, lang)
        if key in seen:
            duplicates.append(name)
            continue
        seen.add(key)
        products.append({
            "brand": brand, "type": ptype, "category": category,
            "name": name, "language": lang,
            "breakable": breakable, "packs_per_box": ppb,
        })

    lines = []
    lines.append(f"-- ============================================")
    lines.append(f"-- {label}")
    lines.append(f"-- {len(products)} unique products generated")
    if duplicates:
        lines.append(f"-- {len(duplicates)} within-source duplicates skipped")
    if unmatched:
        lines.append(f"-- {len(unmatched)} unmatched rows skipped:")
        for n, l in unmatched:
            lines.append(f"--   [{l}] {n}")
    lines.append(f"-- ============================================")
    if not products:
        return "\n".join(lines) + "\n", {"count": 0, "unmatched": unmatched}
    lines.append("")
    lines.append("INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES")
    values = []
    for p in products:
        v = "(%s, %s, %s, %s, %s, %s, %s)" % (
            sql_escape(p["brand"]),
            sql_escape(p["type"]),
            sql_escape(p["category"]),
            sql_escape(p["name"]),
            sql_escape(p["language"]),
            "true" if p["breakable"] else "false",
            str(p["packs_per_box"]) if p["packs_per_box"] is not None else "NULL",
        )
        values.append(v)
    lines.append(",\n".join(values))
    lines.append("ON CONFLICT (brand, type, category, name, language) DO NOTHING;")
    return "\n".join(lines) + "\n", {"count": len(products), "unmatched": unmatched}

def strip_japanese_suffix(s):
    return re.sub(r"\s+Japanese\s*$", "", s, flags=re.IGNORECASE).strip()

def main():
    # Process each tab
    pjp_rows = parse_csv(POKEMONJP_CSV, "Pokemon")
    s6_rows  = parse_csv(SHEET6_CSV,    "Pokemon", name_transform=strip_japanese_suffix)
    op_rows  = parse_csv(ONEPIECE_CSV,  "One Piece")

    pjp_sql, pjp_stats = generate_inserts(pjp_rows, "Pokemon",   "Bulk Pokemon JP+CN import — sheet POKEMONJP (gid=0)")
    s6_sql,  s6_stats  = generate_inserts(s6_rows,  "Pokemon",   "Bulk Pokemon JP import — sheet Sheet6 (gid=698669455) — duplicates of POKEMONJP, ON CONFLICT will skip most")
    op_sql,  op_stats  = generate_inserts(op_rows,  "One Piece", "Bulk One Piece EN+JP import — sheet One Piece (gid=799475548)")

    out = sys.argv[1] if len(sys.argv) > 1 else "all"
    if out == "pjp":
        print(pjp_sql)
    elif out == "s6":
        print(s6_sql)
    elif out == "op":
        print(op_sql)
    else:
        print(pjp_sql)
        print(s6_sql)
        print(op_sql)

    # Print summary to stderr so it doesn't pollute the SQL output
    print(f"\n[STDERR] POKEMONJP: {pjp_stats['count']} unique, {len(pjp_stats['unmatched'])} unmatched", file=sys.stderr)
    print(f"[STDERR] Sheet6:    {s6_stats['count']} unique, {len(s6_stats['unmatched'])} unmatched", file=sys.stderr)
    print(f"[STDERR] OnePiece:  {op_stats['count']} unique, {len(op_stats['unmatched'])} unmatched", file=sys.stderr)

if __name__ == "__main__":
    main()
