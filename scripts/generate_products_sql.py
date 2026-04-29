#!/usr/bin/env python3
"""
Parse the products from the Google Sheet (English Pokemon tab, gid=490656257)
and generate INSERT SQL matching the app's schema.

Strategy: keep the sheet `name` VERBATIM (so user's mental model stays intact),
and classify category/type/breakable/packs_per_box from keyword matching.

Schema:
  brand, type ('Sealed'|'Pack'), category (PRODUCT_TYPES), name, language, breakable, packs_per_box
Unique key: (brand, type, category, name, language)
"""

import re

# Names from sheet (gid=490656257). Light cleanup applied:
# - collapse double spaces
# - lowercase->Title case fixes for set names that were inconsistent
NAMES = """Perfect Order Booster Pack
Perfect Order Booster Bundle
Ascended Heroes Booster Pack
Phantasmal Flames Booster Pack
Phantasmal Flames Booster Bundle
Mega Evolution Booster Pack
Mega Evolution Sleeved Booster Pack
Mega Evolution Booster Bundle
White Flare Booster Pack
White Flare Booster Bundle
Black Bolt Booster Pack
Black Bolt Booster Bundle
Destined Rivals Booster Pack
Destined Rivals Sleeved Booster Pack
Destined Rivals Booster Bundle
Journey Together Booster Pack
Journey Together Sleeved Booster Pack
Journey Together 3 Pack Blister
Journey Together Booster Bundle
Surging Sparks Booster Pack
Surging Sparks Sleeved Booster Pack
Surging Sparks Booster Bundle
Prismatic Evolutions Booster Pack
Prismatic Evolutions 2-Pack Blister
SV Prismatic Evolutions Booster Bundle
Stellar Crown Booster Pack
Stellar Crown Booster Bundle
Twilight Masquerade Booster Pack
Twilight Masquerade Sleeved Booster Pack
Paldean Fates Booster Pack
Paldean Fates Booster Bundle
Temporal Forces Booster Pack
Temporal Forces Sleeved Booster Pack
Temporal Forces 3 Pack Blister
Temporal Forces Booster Bundle
Paradox Rift Booster Pack
Paradox Rift Sleeved Booster Pack
Pokemon 151 Booster Pack
SV 151 Booster Bundle
Obsidian Flames Sleeved Booster Pack
Obsidian Flames Booster Bundle
Paldea Evolved Blister Pack
Crown Zenith Booster Pack
Crown Zenith Booster Bundle
Lost Origin Sleeved Booster Pack
Astral Radiance Booster Pack
Astral Radiance Sleeved Booster Pack
Brilliant Stars Booster Pack
Brilliant Stars Single Pack Blister
Fusion Strike Sleeved Booster Pack
Chilling Reign Booster Pack
Chilling Reign Single Pack Blister
Battle Styles Booster Pack
Vivid Voltage Booster Pack
Vivid Voltage Sleeved Booster Pack
Rebel Clash Sleeved Booster Pack
Sword & Shield Booster Pack
Celebrations Booster Pack
Sun & Moon Booster Pack
Perfect Order Booster Box
Perfect Order Elite Trainer Box
Perfect Order Build & Battle Box
Phantasmal Flames Booster Box
Phantasmal Flames Build & Battle Box
Mega Evolution Enhanced Booster Box
Mega Evolution Enhanced Booster Display Box w/ promo
Mega Evolution Elite Trainer Box
Mega Evolution Pokemon Center Elite Trainer Box [Mega Gardevoir]
Mega Evolution Pokemon Center Elite Trainer Box [Mega Lucario]
White Flare Elite Trainer Box
Black Bolt Elite Trainer Box
Destined Rivals Booster Box
Destined Rivals Elite Trainer Box
Journey Together Enhanced Booster Box
Journey Together Elite Trainer Box
Surging Sparks Booster Box
Surging Sparks Elite Trainer Box
Surging Sparks Pokemon Center Elite Trainer Box
Prismatic Evolutions Elite Trainer Box
Stellar Crown Booster Box
Shrouded Fable Elite Trainer Box
Shrouded Fable Pokemon Center Elite Trainer Box
Twilight Masquerade Booster Box
Twilight Masquerade Elite Trainer Box
Paldean Fates Pokemon Center Elite Trainer Box
Temporal Forces Booster Box
Temporal Forces Elite Trainer Box
Paradox Rift Booster Box
151 Elite Trainer Box
Obsidian Flames Booster Box
Obsidian Flames Pokemon Center Elite Trainer Box
Paldea Evolved Booster Box
Paldea Evolved Elite Trainer Box
Scarlet & Violet Booster Box
Scarlet & Violet Elite Trainer Box
Crown Zenith Elite Trainer Box
Silver Tempest Booster Box
Silver Tempest Elite Trainer Box
Lost Origin Booster Box
Lost Origin Pokemon Center Elite Trainer Box
Astral Radiance Booster Box
Astral Radiance Elite Trainer Box
Astral Radiance Pokemon Center Elite Trainer Box
Brilliant Stars Booster Box
Brilliant Stars Elite Trainer Box
Brilliant Stars Pokemon Center Elite Trainer Box
Evolving Skies Elite Trainer Box
Chilling Reign Booster Box
Chilling Reign Elite Trainer Box
Battle Styles Booster Box
Vivid Voltage Elite Trainer Box
Darkness Ablaze Booster Box
Sword & Shield Elite Trainer Box
Shining Fates Elite Trainer Box
Celebrations Elite Trainer Box
Celebrations Pokemon Center Elite Trainer Box
Pokemon GO Booster Box
Phantasmal Flames UPC
White Flare Binder Collection
Black Bolt Binder Collection
Unova Mini Tin
Unova Victini Illustration Collection
Unova Poster Collection
Prismatic Evolutions Super Premium Collection
Prismatic Evolutions Accessory Pouch Special Collection
Prismatic Evolutions Surprise Box
Shrouded Fable Mini Tin
Paldean Fates Tech Sticker Collection
151 Ultra-Premium Collection
Costco Pokemon Scarlet & Violet 151 Mini Tin 5-pack
Pokemon 151 Tin
151 Poster Collection
Pikachu VMAX Premium Collection - Crown Zenith
Crown Zenith Premium Figure Collection
Charizard Ultra-Premium Collection
Celebrations Ultra-Premium Collection
Celebrations Special Collection [Pikachu V]
Celebrations Premium Playmat Collection [Pikachu V]
Forces of Nature GX Premium Box
Blastoise VMAX Premium Collection
Cynthia's Garchomp ex Premium Collection
Venusaur VMAX Premium Collection
Lucario VSTAR Special Collection
Blooming Waters Premium Collection
Pokemon Lillie Premium Tournament Collection 4-Box
Pokemon TCG Holiday Calendar 2025
Team Rocket's Mewtwo ex Box"""

# Classification rules — checked in ORDER, first match wins.
# Each: (regex, category, type, breakable, packs_per_box)
# Notes on packs_per_box guesses (Pokemon EN modern era):
#   Booster Box: 36 packs
#   Booster Bundle: 6 packs
#   ETB: 9 packs
#   Build & Battle Box: 4 packs
#   Standard Tin: 4 packs (3-4 typical)
#   Mini Tin: 2 packs
#   UPC / Ultra-Premium: 16-18 packs (using 18)
#   Premium Collection: 5-7 packs (using 6)
#   Blister N-pack: N packs
RULES = [
    # Most specific first
    (r"\bMini Tin\b.*\b5-pack\b",                "Tin",                       "Sealed", True,  10),
    (r"\bMini Tin\b",                            "Tin",                       "Sealed", True,  2),
    (r"\bPokemon Center Elite Trainer Box\b",    "ETB",                       "Sealed", True,  9),
    (r"\bElite Trainer Box\b",                   "ETB",                       "Sealed", True,  9),
    (r"\bBuild & Battle Box\b",                  "Build & Battle",            "Sealed", True,  4),
    (r"\bBooster Bundle\b",                      "Booster Bundle",            "Sealed", True,  6),
    (r"\bEnhanced Booster Display Box\b",        "Booster Box",               "Sealed", True,  18),
    (r"\bEnhanced Booster Box\b",                "Booster Box",               "Sealed", True,  14),
    (r"\bBooster Box\b",                         "Booster Box",               "Sealed", True,  36),
    (r"\bSleeved Booster Pack\b",                "Booster Pack",              "Pack",   False, None),
    (r"\b3 Pack Blister\b",                      "Blister Pack",              "Sealed", True,  3),
    (r"\b2-Pack Blister\b",                      "Blister Pack",              "Sealed", True,  2),
    (r"\bSingle Pack Blister\b",                 "Blister Pack",              "Sealed", True,  1),
    (r"\bBlister Pack\b",                        "Blister Pack",              "Sealed", True,  1),
    (r"\bBooster Pack\b",                        "Booster Pack",              "Pack",   False, None),
    (r"\bUltra-Premium Collection\b",            "Ultra-Premium Collection",  "Sealed", True,  18),
    (r"\bUPC\b",                                 "UPC",                       "Sealed", True,  18),
    (r"\bSuper Premium Collection\b",            "Premium Collection",        "Sealed", True,  8),
    (r"\bPremium Figure Collection\b",           "Figure Collection",         "Sealed", True,  6),
    (r"\bPremium Tournament Collection\b",       "Collection",                "Sealed", False, None),
    (r"\bGX Premium Box\b",                      "Premium Collection",        "Sealed", True,  7),
    (r"\bPremium Playmat Collection\b",          "Premium Collection",        "Sealed", True,  4),
    (r"\bPremium Collection\b",                  "Premium Collection",        "Sealed", True,  6),
    (r"\bAccessory Pouch Special Collection\b",  "Special",                   "Sealed", True,  4),
    (r"\bSpecial Collection\b",                  "Special",                   "Sealed", True,  4),
    (r"\bBinder Collection\b",                   "Collection",                "Sealed", False, None),
    (r"\bPoster Collection\b",                   "Collection",                "Sealed", False, None),
    (r"\bTech Sticker Collection\b",             "Collection",                "Sealed", False, None),
    (r"\bIllustration Collection\b",             "Collection",                "Sealed", False, None),
    (r"\bSurprise Box\b",                        "Special Box",               "Sealed", False, None),
    (r"\bex Box\b",                              "Special Box",               "Sealed", False, None),
    (r"\bHoliday Calendar\b",                    "Other",                     "Sealed", False, None),
    (r"\bTin\b",                                 "Tin",                       "Sealed", True,  4),
    (r"\bCollection\b",                          "Collection",                "Sealed", False, None),  # catch-all for "X Collection"
]

def classify(name):
    for pattern, category, ptype, breakable, ppb in RULES:
        if re.search(pattern, name, flags=re.IGNORECASE):
            return category, ptype, breakable, ppb
    return None

def sql_escape(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def main():
    rows = []
    unmatched = []
    seen = set()
    duplicates = []

    for line in NAMES.strip().splitlines():
        name = re.sub(r"\s+", " ", line).strip()
        if not name:
            continue
        result = classify(name)
        if not result:
            unmatched.append(name)
            continue
        category, ptype, breakable, ppb = result

        key = ("Pokemon", ptype, category, name, "EN")
        if key in seen:
            duplicates.append(name)
            continue
        seen.add(key)

        rows.append({
            "brand": "Pokemon",
            "type": ptype,
            "category": category,
            "name": name,
            "language": "EN",
            "breakable": breakable,
            "packs_per_box": ppb,
        })

    print("-- ============================================")
    print("-- Bulk product import — Pokemon English")
    print("-- Source: Google Sheet gid=490656257")
    print(f"-- {len(rows)} unique products generated")
    if duplicates:
        print(f"-- {len(duplicates)} duplicate names skipped within source: {duplicates}")
    if unmatched:
        print(f"-- WARNING: {len(unmatched)} unmatched rows (skipped, need manual handling):")
        for u in unmatched:
            print(f"--   {u}")
    print("-- ============================================")
    print()
    print("INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box) VALUES")
    values = []
    for r in rows:
        v = "(%s, %s, %s, %s, %s, %s, %s)" % (
            sql_escape(r["brand"]),
            sql_escape(r["type"]),
            sql_escape(r["category"]),
            sql_escape(r["name"]),
            sql_escape(r["language"]),
            "true" if r["breakable"] else "false",
            str(r["packs_per_box"]) if r["packs_per_box"] is not None else "NULL",
        )
        values.append(v)
    print(",\n".join(values))
    print("ON CONFLICT (brand, type, category, name, language) DO NOTHING;")

if __name__ == "__main__":
    main()
