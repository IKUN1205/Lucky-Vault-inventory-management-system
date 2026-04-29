#!/usr/bin/env python3
"""
Build final import SQL from inventory sheets + user mapping decisions.

Outputs:
  scripts/final_import/01_new_products.sql       — INSERT new products
  scripts/final_import/02_wipe_and_import.sql    — TRUNCATE + INSERT inventory
  scripts/final_import/REVIEW.md                  — human-readable preview
"""
import csv, json, os, re, sys
from collections import defaultdict
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(ROOT, "inventory_csvs")
OUT_DIR = os.path.join(ROOT, "final_import")
os.makedirs(OUT_DIR, exist_ok=True)

products = json.load(open(os.path.join(CSV_DIR, "products.json")))
locations_data = json.load(open(os.path.join(CSV_DIR, "locations.json")))

# ---- Build product lookup tables ----
def keyfn(brand, lang, name):
    return (brand, lang, re.sub(r'\s+', ' ', name).strip().lower())

product_by_key = {}
for p in products:
    k = keyfn(p['brand'], p['language'], p['name'])
    product_by_key[k] = p

def find_product(brand, lang, name):
    k = keyfn(brand, lang, name)
    p = product_by_key.get(k)
    if p:
        return p
    # try with category appended (e.g., "X" + "Booster Box" = "X Booster Box")
    return None

# ---- Build market price lookup ----
MP = {}  # key: normalized name → USD price

def add_mp(name, price, lang):
    if not price: return
    p = str(price).replace('$','').replace(',','').strip()
    try:
        v = float(p)
    except:
        return
    if v <= 0: return
    norm = re.sub(r'\s+', ' ', name).strip().lower()
    MP[(lang, norm)] = v

# Pokemon EN ref
for r in csv.DictReader(open(os.path.join(CSV_DIR, "ref_pokemon_en.csv"))):
    add_mp(r['Name'], r.get('Market Price'), 'EN')

# Pokemon JP ref (Sheet6)
for r in csv.DictReader(open(os.path.join(CSV_DIR, "ref_sheet6.csv"))):
    name = r['Name']
    # strip trailing " Japanese"
    name_clean = re.sub(r'\s+Japanese\s*$', '', name, flags=re.I).strip()
    mp = r.get('Market Price') or r.get('TCGplayer Price')
    add_mp(name_clean, mp, 'JP')
    add_mp(name, mp, 'JP')  # also try with Japanese suffix

# One Piece ref
for r in csv.DictReader(open(os.path.join(CSV_DIR, "ref_onepiece.csv"))):
    name = r['Name']
    lang = 'JP' if 'Japanese' in name else 'EN'
    mp = r.get('Market Price')
    # try multiple normalizations
    add_mp(name, mp, lang)
    # remove "Japanese"/"English"
    n2 = re.sub(r'\s+(Japanese|English)\s*', ' ', name).strip()
    add_mp(n2, mp, lang)

def get_mp(brand, lang, name, name_alt=None):
    """Try to find market price by name with several normalizations."""
    candidates = [name]
    if name_alt:
        candidates.append(name_alt)
    # add variations
    candidates.append(re.sub(r'\s*\([^)]+\)\s*', ' ', name).strip())
    for n in candidates:
        norm = re.sub(r'\s+', ' ', n).strip().lower()
        if (lang, norm) in MP:
            return MP[(lang, norm)]
    # fuzzy search
    best = None; best_score = 0
    for (l, k), v in MP.items():
        if l != lang: continue
        score = SequenceMatcher(None, k, name.lower()).ratio()
        if score > best_score:
            best_score = score; best = v
    if best_score > 0.85:
        return best
    return None

# ---- LOCATION map ----
LOC = {
    "Master Inventory":                "1f68249f-7708-400c-80f7-e75bde85b556",
    "Stream Room - TikTok Packheads":  "c995d0a6-262c-477f-af65-6329b3516c5a",
    "Stream Room - TikTok RocketsHQ":  "eeff0769-9131-4467-9d0a-020b37edc102",
    "Stream Room - eBay LuckyVaultUS": "12293f16-a21a-4a9a-b503-3e6e74dddb81",
    "Stream Room - eBay SlabbiePatty": "04b32948-7920-46f6-bfa1-1b0d48cc71de",
}

SHEETS = [
    ("master.csv",            "Master Inventory"),
    ("packheads.csv",         "Stream Room - TikTok Packheads"),
    ("rocket.csv",            "Stream Room - TikTok RocketsHQ"),
    ("ebay_luckyvault.csv",   "Stream Room - eBay LuckyVaultUS"),
    ("ebay_slabbiepatty.csv", "Stream Room - eBay SlabbiePatty"),
]

# ---- Manual mapping per user's decisions ----
# Key: (sheet_file, normalized_sheet_product, sheet_cat, sheet_type)
# Value: dict with either "existing":{brand,lang,name} OR "new":{brand,type,category,name,language,breakable,packs_per_box}

# Helper to define a NEW product spec
def NEW(brand, type_, category, name, language, breakable=False, packs=None):
    return {'new': {'brand': brand, 'type': type_, 'category': category, 'name': name,
                    'language': language, 'breakable': breakable, 'packs_per_box': packs}}

def USE(brand, lang, name):
    return {'existing': {'brand': brand, 'lang': lang, 'name': name}}

# ---- Default mapping rules (auto for HIGH bucket via lookup) ----
def auto_match(sheet_prod, sheet_cat, sheet_type):
    """Best-effort auto match using DB. Returns dict or None."""
    # parse brand+lang from category
    c = (sheet_cat or '').lower()
    brand = None; lang = None
    if 'one piece' in c: brand = 'One Piece'
    elif 'pokemon' in c or 'pokémon' in c: brand = 'Pokemon'
    if 'eng' in c or 'english' in c or c == 'pokemon': lang = 'EN'
    elif 'jp' in c or 'japan' in c: lang = 'JP'
    elif 'chinese' in c or 'cn' in c: lang = 'CN'
    if not brand or not lang:
        return None

    # parse type
    t = (sheet_type or '').lower().strip()
    db_type = 'Pack' if 'pack' in t else 'Sealed'

    # token search
    sp = re.sub(r"[^\w\s]", " ", sheet_prod.lower())
    sp_toks = set(t for t in sp.split() if len(t) > 1 and t not in {'jp','japan','japanese','eng','english','chinese','cn','sealed','no','seal'})

    best = None; best_score = 0
    for p in products:
        if p['brand'] != brand or p['language'] != lang: continue
        if p['type'] != db_type: continue
        pn = re.sub(r"[^\w\s]", " ", p['name'].lower())
        pn_toks = set(t for t in pn.split() if len(t) > 1)
        if not sp_toks: continue
        overlap = len(sp_toks & pn_toks)
        ratio = overlap / max(len(sp_toks), 1)
        fz = SequenceMatcher(None, sp, pn).ratio()
        score = ratio * 100 + fz * 30
        if score > best_score:
            best_score = score; best = p
    if best and best_score > 70:
        return USE(best['brand'], best['language'], best['name'])
    return None

# ---- Explicit user-mapped overrides ----
# Keyed by (sheet_file, sheet_product_normalized)
def k(sheet_file, sheet_product):
    return (sheet_file, sheet_product.strip().lower())

OVERRIDES = {}

def setmap(sheet_file, sheet_product, mapping):
    OVERRIDES[k(sheet_file, sheet_product)] = mapping

# ===== POKEMON EN MAPPINGS =====
setmap("master.csv", "Mega Evo ETB PC", USE('Pokemon','EN','Mega Evolutions 1 (PC) ETB'))
setmap("master.csv", "Primsatic Evo ETB", USE('Pokemon','EN','Prismatic Evolutions Elite Trainer Box'))
setmap("master.csv", "Perfect Order", USE('Pokemon','EN','Perfect Order Elite Trainer Box'))
setmap("master.csv", "Holiday Calendar 2025", USE('Pokemon','EN','Holiday Calendar 2025 Special'))
setmap("master.csv", "V Battle Decks", NEW('Pokemon','Sealed','Deck','V Battle Deck Deck','EN'))
setmap("master.csv", "EX Battle Decks", USE('Pokemon','EN','EX Battle Deck Deck'))

setmap("packheads.csv", "Prismatic Evolution Booster Pack", USE('Pokemon','EN','Prismatic Evolutions Booster Pack'))
# Gengar Gem 3 — language fix says CN, NEW
setmap("packheads.csv", "Gengar Gem 3", NEW('Pokemon','Sealed','Booster Box','Gengar Gem Vol.3 Booster Box','CN'))
# Dream League — language fix says JP, NEW
setmap("packheads.csv", "Dream League", NEW('Pokemon','Sealed','Booster Box','Dream League Booster Box','JP', packs=30))

setmap("rocket.csv", "Perfect Order", USE('Pokemon','EN','Perfect Order Elite Trainer Box'))
setmap("rocket.csv", "Prismatic Evolutions", USE('Pokemon','EN','Prismatic Evolutions Elite Trainer Box'))
setmap("rocket.csv", "Journey Together", USE('Pokemon','EN','Journey Together Booster Pack'))
setmap("rocket.csv", "Mega Evolution", USE('Pokemon','EN','Mega Evolution Booster Pack'))
setmap("rocket.csv", "Astral Radiance", USE('Pokemon','EN','Astral Radiance Booster Pack'))
setmap("rocket.csv", "Chilling Reign", USE('Pokemon','EN','Chilling Reign Elite Trainer Box'))
setmap("rocket.csv", "Scarlet Violet", USE('Pokemon','EN','Scarlet & Violet Elite Trainer Box'))
setmap("rocket.csv", "Legendary Collection", NEW('Pokemon','Pack','Booster Pack','Legendary Collection Booster Pack','EN'))
setmap("rocket.csv", "Prismatic SPC", USE('Pokemon','EN','Prismatic Evolutions Super Premium Collection'))
# HIGH override: Gem Vol 2 ≠ Gem Vol.4
setmap("rocket.csv", "Gem Vol 2", NEW('Pokemon','Sealed','Booster Box','Gem Vol.2 Booster Box','CN'))
# HIGH override: Paradox Rift ETB ≠ Paradox Rift Booster Box (DB has no ETB version yet — create)
setmap("rocket.csv", "Paradox Rift", NEW('Pokemon','Sealed','ETB','Paradox Rift Elite Trainer Box','EN'))
# HIGH bucket override: PoGo Special Set is NOT Detective Pikachu
setmap("master.csv", "PoGo Special Set JP", NEW('Pokemon','Sealed','Special Box','PoGo Special Set','JP'))
# HIGH bucket override: Dream League ≠ Mega Dream
setmap("rocket.csv", "Dream League", NEW('Pokemon','Sealed','Booster Box','Dream League Booster Box','JP', packs=30))

# eBay LuckyVault Pokemon EN rows that are actually JP / CN
setmap("ebay_luckyvault.csv", "Ninja Spinner Booster Box", NEW('Pokemon','Sealed','Booster Box','Ninja Spinner Booster Box','JP', packs=30))
setmap("ebay_luckyvault.csv", "chinese gem 2", NEW('Pokemon','Sealed','Booster Box','Gem Vol.2 Booster Box','CN'))
setmap("ebay_luckyvault.csv", "Ninja spinner", NEW('Pokemon','Pack','Booster Pack','Ninja Spinner Booster Pack','JP'))

# eBay SlabbiePatty Pokemon
setmap("ebay_slabbiepatty.csv", "Mega dream", USE('Pokemon','JP','Mega Dream Booster Box'))
setmap("ebay_slabbiepatty.csv", "Astral radiance", USE('Pokemon','EN','Astral Radiance Booster Pack'))
setmap("ebay_slabbiepatty.csv", "Evolving skies", NEW('Pokemon','Pack','Booster Pack','Evolving Skies Sleeved Booster Pack','EN'))
setmap("ebay_slabbiepatty.csv", "Ns Japanese Box", NEW('Pokemon','Sealed','Booster Box','Ninja Spinner Booster Box','JP', packs=30))
setmap("ebay_slabbiepatty.csv", "Prismatic evolution", USE('Pokemon','EN','Prismatic Evolutions Elite Trainer Box'))
setmap("ebay_slabbiepatty.csv", "Chinese obsidian flames", NEW('Pokemon','Sealed','Booster Box','Obsidian Flames Booster Box','CN'))
setmap("ebay_slabbiepatty.csv", "Chinese gem 2", NEW('Pokemon','Sealed','Booster Box','Gem Vol.2 Booster Box','CN'))
setmap("ebay_slabbiepatty.csv", "Perfect order", USE('Pokemon','EN','Perfect Order Elite Trainer Box'))

# ===== POKEMON JP MAPPINGS — All NEW per user =====
setmap("master.csv", "Mega Symphonia Booster Box JP", NEW('Pokemon','Sealed','Booster Box','Mega Symphonia Booster Box','JP', packs=30))
setmap("master.csv", "Ninja Spinner Sealed", NEW('Pokemon','Sealed','Booster Box','Ninja Spinner Booster Box','JP', packs=30))
setmap("master.csv", "Ninja Spinner No seal", NEW('Pokemon','Sealed','Booster Box','Ninja Spinner Booster Box (Open)','JP', packs=30))
setmap("master.csv", "Mystery Box Collection box JP", NEW('Pokemon','Sealed','Special Box','Mystery Box Collection','JP'))
setmap("master.csv", "PC Tohoku Special Box JP", NEW('Pokemon','Sealed','Special Box','Pokemon Center Tohoku Special Box','JP'))
setmap("master.csv", "PC 2019 Mewtwo Strikes Back Evo Movie Special JP", NEW('Pokemon','Sealed','Special Box','PC 2019 Mewtwo Strikes Back Evolution Movie Special Box','JP'))
setmap("master.csv", "PC Hiroshima Special Box JP", NEW('Pokemon','Sealed','Special Box','Pokemon Center Hiroshima Special Box','JP'))
setmap("master.csv", "S/V Starter Deck Ancient Koraidon EX JP", NEW('Pokemon','Sealed','Starter Deck','S/V Starter Deck Ancient Koraidon ex','JP'))
setmap("master.csv", "S/V Starter Deck Generations JP", NEW('Pokemon','Sealed','Starter Deck','S/V Starter Deck Generations','JP'))
setmap("master.csv", "Raihan Trainer Card Collection JP", NEW('Pokemon','Sealed','Collection','Raihan Trainer Card Collection','JP'))

# Ninja Spinner appears twice in rocket.csv: Box qty=2 + Packs qty=13. Disambiguate by type below.

# ===== POKEMON CN — All NEW =====
setmap("master.csv", "Black Crystal Blaze Jumbo", NEW('Pokemon','Sealed','Booster Box','Black Crystal Blaze Jumbo Booster Box','CN'))
setmap("master.csv", "Vivid Portrayals Indigo", NEW('Pokemon','Sealed','Booster Box','Vivid Portrayals Indigo Booster Box','CN'))
setmap("master.csv", "True Mystic", NEW('Pokemon','Sealed','Booster Box','True Mystic Booster Box','CN'))
setmap("rocket.csv", "Dark Crystal Blaze", NEW('Pokemon','Sealed','Booster Box','Dark Crystal Blaze Booster Box','CN'))

# Master had "Gem Pack Vol 2" in HIGH bucket but it matched wrong (Vol.4). Override:
setmap("master.csv", "Gem Pack Vol 2", NEW('Pokemon','Sealed','Booster Box','Gem Vol.2 Booster Box','CN'))

# ===== ONE PIECE — User: 新建; #6 OP-7 / #7 OP-6 already match. =====
setmap("master.csv", "EB-04 JP", NEW('One Piece','Sealed','Booster Box','EB-04 Memorial Collection Booster Box','JP', packs=24))
setmap("master.csv", "OP 15 JP", NEW('One Piece','Sealed','Booster Box','OP-15 Booster Box','JP', packs=24))
setmap("master.csv", "PRB-02", USE('One Piece','EN','PRB-02 The Best Vol. 2 Booster Box'))

setmap("packheads.csv", "EB-04 Japan", NEW('One Piece','Sealed','Booster Box','EB-04 Memorial Collection Booster Box','JP', packs=24))
setmap("packheads.csv", "OP-15 Japan", NEW('One Piece','Sealed','Booster Box','OP-15 Booster Box','JP', packs=24))
setmap("packheads.csv", "OP-PRB2 JP", NEW('One Piece','Sealed','Booster Box','PRB-02 The Best Vol. 2 Booster Box','JP', packs=24))
setmap("packheads.csv", "OP- 7 Japan", USE('One Piece','JP','OP-07 500 Years into the Future Booster Box'))
setmap("packheads.csv", "OP- 6 JP", USE('One Piece','JP','OP-06 Wings of the Captain Booster Box'))
setmap("packheads.csv", "EB-03 Japan", USE('One Piece','JP','EB-03 Heroines Edition Booster Box'))
setmap("packheads.csv", "OP-15 sleeved Packs  ENG", NEW('One Piece','Pack','Booster Pack','OP-15 Sleeved Booster Pack','EN'))

setmap("ebay_luckyvault.csv", "Op 15 double pack", NEW('One Piece','Sealed','Bundle Box','OP-15 Double Pack Set','EN'))

setmap("ebay_slabbiepatty.csv", "Eb03", NEW('One Piece','Pack','Booster Pack','EB-03 Heroines Edition Sleeved Booster Pack','EN'))
setmap("ebay_slabbiepatty.csv", "Op07", NEW('One Piece','Sealed','Booster Bundle','OP-07 500 Years into the Future Booster Bundle','EN'))
setmap("ebay_slabbiepatty.csv", "Eb04", NEW('One Piece','Sealed','Booster Bundle','EB-04 Memorial Collection Booster Bundle','EN'))

# ===== OTHER BRANDS — User-provided + sensible defaults =====
# User's 8 listed names + Big Into Energy
# Sheet → Product mapping:

# A. Big Into Energy (Master, Other/Other) — user's reference sheet has it
setmap("master.csv", "Big Into Energy", NEW('Other','Sealed','Booster Box','Big Into Energy Booster Box','EN'))

# YGO
setmap("master.csv", "Limit Over Collection The Rivals", NEW('Other','Sealed','Booster Box','Limit Over Collection The Rivals Booster Box','EN'))
setmap("master.csv", "Yu-Gi-Oh Rarity Collection Quarter Centers Edition", NEW('Other','Sealed','Booster Box','Rarity Collection Quarter Century Edition Booster Box','EN'))
setmap("packheads.csv", "Limit Over Collection Rivals", NEW('Other','Sealed','Booster Box','Limit Over Collection The Rivals Booster Box','EN'))
setmap("ebay_slabbiepatty.csv", "Limit over collection", NEW('Other','Sealed','Booster Box','Limit Over Collection Heroes Booster Box','EN'))
setmap("ebay_slabbiepatty.csv", "Ghost from the past", NEW('Other','Sealed','Booster Box','Ghost from the Past Booster Box','EN'))
setmap("ebay_slabbiepatty.csv", "Rarity collection", NEW('Other','Sealed','Booster Box','Rarity Collection Quarter Century Edition Booster Box','EN'))

# Weiss Schwarz
setmap("master.csv", "Nikke", NEW('Other','Sealed','Booster Box','NIKKE Goddess of Victory Booster Box (Weiss Schwarz)','EN'))
setmap("master.csv", "Hololive", NEW('Other','Sealed','Booster Box','hololive Production Booster Box (Weiss Schwarz)','EN'))
setmap("master.csv", "Eminence In shadow", NEW('Other','Sealed','Booster Box','The Eminence in Shadow Booster Box (Weiss Schwarz)','EN'))
setmap("packheads.csv", "The Eminence in Shadow", NEW('Other','Sealed','Booster Box','The Eminence in Shadow Booster Box (Weiss Schwarz)','EN'))
setmap("packheads.csv", "Fujimi Fantasia Bunk Vol 2", NEW('Other','Sealed','Booster Box','Fujimi Fantasia Bunko Vol.2 Booster Box (Weiss Schwarz)','EN'))
setmap("packheads.csv", "NIKKE", NEW('Other','Sealed','Booster Box','NIKKE Goddess of Victory Booster Box (Weiss Schwarz)','EN'))
setmap("packheads.csv", "Enchant Regalia", NEW('Other','Sealed','Booster Box','hololive Enchant Regalia Booster Box','EN'))
setmap("ebay_slabbiepatty.csv", "The Goddess of victory's", NEW('Other','Sealed','Booster Box','NIKKE Goddess of Victory Booster Box (Weiss Schwarz)','EN'))

# Union Arena / Nivel Arena (user's named SKUs)
setmap("packheads.csv", "UA NIKKE", NEW('Other','Sealed','Booster Box','NIKKE Union Arena Booster Box','EN'))
# packheads has another row "NIKKE" with category "Nivel Arena" (qty=2)
# We need to find that specific row and map separately
# Sheet has: "NIKKE" (Nivel Arena/Box) qty=2 AND another "NIKKE" (Weiss Schwarz/Box) qty=54
# Both have product == "NIKKE" — need to also key on category. Handled below.

# Gundam GD-03
setmap("packheads.csv", "GD-03 Steel Requiem Packs", NEW('Other','Pack','Booster Pack','Gundam GD-03 Steel Requiem Booster Pack','EN'))

# Riftbound LoL
setmap("packheads.csv", "League of Legends: Spirit Forge", NEW('Other','Sealed','Booster Box','Riftbound LoL Spirit Forge Booster Box','EN'))
setmap("packheads.csv", "League of Legends: Origins", NEW('Other','Sealed','Booster Box','Riftbound LoL Origins Booster Box','EN'))

# DBZ
setmap("ebay_slabbiepatty.csv", "Theme collection/ Histoy son of Goku", NEW('Other','Sealed','Booster Box','FB09 Dual Evolution Booster Box (Dragon Ball)','EN'))


# Rows where (sheet_file, sheet_product) collides — disambiguate by (sheet_cat, sheet_type)
# packheads has TWO "NIKKE" rows: (Nivel Arena/Box) qty=2 vs (Weiss Schwarz/Box) qty=54
# We split based on category in the row resolver below.
TRIPLE_OVERRIDES = {
    # (sheet_file, sheet_product_lower, sheet_cat_lower) -> mapping
    ("packheads.csv", "nikke", "nivel arena"): NEW('Other','Sealed','Booster Box','NIKKE Nivel Arena Booster Box','EN'),
    ("packheads.csv", "nikke", "weiss schwarz"): NEW('Other','Sealed','Booster Box','NIKKE Goddess of Victory Booster Box (Weiss Schwarz)','EN'),
}

# Type-based overrides — for sheets where same product name appears with different Type column
TYPE_OVERRIDES = {
    # (sheet_file, sheet_product_lower, sheet_type_lower) -> mapping
    ("rocket.csv", "ninja spinner", "box"):   NEW('Pokemon','Sealed','Booster Box','Ninja Spinner Booster Box','JP', packs=30),
    ("rocket.csv", "ninja spinner", "packs"): NEW('Pokemon','Pack','Booster Pack','Ninja Spinner Booster Pack','JP'),
}

def sql_str(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"

# ---- Process all rows ----
all_rows = []  # list of dicts: {location_id, brand, lang, name, qty, mp, cost, action}
new_products = {}  # key (brand,lang,name) -> spec

def resolve(sheet_file, row):
    sp = (row.get('Product') or '').strip()
    sc = (row.get('Category') or '').strip()
    st = (row.get('Type') or '').strip()
    spk = sp.lower().strip()
    # Type override (most specific)
    type_o = TYPE_OVERRIDES.get((sheet_file, spk, st.lower().strip()))
    if type_o: return type_o
    # Triple override (cat-based)
    triple = TRIPLE_OVERRIDES.get((sheet_file, spk, sc.lower().strip()))
    if triple: return triple
    # Direct override
    direct = OVERRIDES.get((sheet_file, spk))
    if direct: return direct
    # Auto-match
    return auto_match(sp, sc, st)

unresolved = []

for fname, loc_name in SHEETS:
    loc_id = LOC[loc_name]
    path = os.path.join(CSV_DIR, fname)
    for row in csv.DictReader(open(path)):
        sp = (row.get('Product') or '').strip()
        if not sp: continue
        try:
            qty = int(float(row.get('Quantity') or 0))
        except:
            qty = 0
        if qty <= 0: continue

        m = resolve(fname, row)
        if not m:
            unresolved.append({'sheet': fname, 'product': sp, 'cat': row.get('Category'), 'type': row.get('Type'), 'qty': qty, 'loc': loc_name})
            continue

        if 'existing' in m:
            spec = m['existing']
            p = product_by_key.get(keyfn(spec['brand'], spec['lang'], spec['name']))
            if not p:
                unresolved.append({'sheet': fname, 'product': sp, 'cat': row.get('Category'), 'type': row.get('Type'), 'qty': qty, 'loc': loc_name,
                                   'reason': f"USE() pointed at non-existent product: {spec}"})
                continue
            mp = get_mp(spec['brand'], spec['lang'], spec['name'])
            cost = round(mp * 0.80, 2) if mp else None
            all_rows.append({
                'location_id': loc_id, 'location_name': loc_name,
                'product_id_expr': f"'{p['id']}'",
                'product_label': f"[{p['brand']}/{p['language']}] {p['name']}",
                'sheet_label': sp,
                'qty': qty,
                'mp': mp, 'cost': cost,
                'action': 'EXISTING',
            })
        else:
            spec = m['new']
            key = (spec['brand'], spec['language'], spec['name'])
            new_products[key] = spec
            mp = get_mp(spec['brand'], spec['language'], spec['name'])
            cost = round(mp * 0.80, 2) if mp else None
            # placeholder — we'll resolve product_id via subquery in SQL
            pid_expr = f"(SELECT id FROM products WHERE brand={sql_str(spec['brand'])} AND language={sql_str(spec['language'])} AND name={sql_str(spec['name'])} LIMIT 1)"
            all_rows.append({
                'location_id': loc_id, 'location_name': loc_name,
                'product_id_expr': pid_expr,
                'product_label': f"[{spec['brand']}/{spec['language']}] {spec['name']} (NEW)",
                'sheet_label': sp,
                'qty': qty,
                'mp': mp, 'cost': cost,
                'action': 'NEW',
            })

# ---- Generate SQL ----

# 1) New products SQL
np_lines = ["-- New products SQL — created from inventory import",
            "-- Idempotent: ON CONFLICT (brand, type, category, name, language) DO NOTHING",
            ""]
for (brand, lang, name), spec in sorted(new_products.items()):
    breakable = 'true' if spec['breakable'] else 'false'
    packs = str(spec['packs_per_box']) if spec['packs_per_box'] is not None else 'NULL'
    np_lines.append(
        f"INSERT INTO products (brand, type, category, name, language, breakable, packs_per_box, active) VALUES "
        f"({sql_str(spec['brand'])}, {sql_str(spec['type'])}, {sql_str(spec['category'])}, {sql_str(spec['name'])}, "
        f"{sql_str(spec['language'])}, {breakable}, {packs}, true) "
        f"ON CONFLICT (brand, type, category, name, language) DO NOTHING;"
    )

with open(os.path.join(OUT_DIR, "01_new_products.sql"), "w") as f:
    f.write("\n".join(np_lines))

# 2) Wipe + import inventory SQL
inv_lines = [
    "-- ============================================",
    "-- WIPE + IMPORT real inventory",
    "-- Run AFTER 01_new_products.sql succeeds.",
    "-- ============================================",
    "",
    "BEGIN;",
    "",
    "-- Wipe transactional tables",
    "TRUNCATE TABLE",
    "  inventory, movements, stream_counts, stream_count_items,",
    "  box_breaks, acquisitions, receipts, shipments,",
    "  storefront_sales, platform_sales, business_expenses,",
    "  grading_submissions, high_value_items, high_value_movements",
    "RESTART IDENTITY CASCADE;",
    "",
    "-- Import inventory rows",
]
for r in all_rows:
    cost_expr = str(r['cost']) if r['cost'] is not None else 'NULL'
    inv_lines.append(
        f"INSERT INTO inventory (product_id, location_id, quantity, avg_cost_basis) VALUES ("
        f"{r['product_id_expr']}, '{r['location_id']}', {r['qty']}, {cost_expr}); "
        f"-- {r['location_name'][:25]}: {r['sheet_label'][:40]} → {r['product_label'][:60]} qty={r['qty']} cost={cost_expr}"
    )
inv_lines.append("")
inv_lines.append("COMMIT;")
inv_lines.append("")
inv_lines.append("-- Verify")
inv_lines.append("SELECT l.name AS location, COUNT(*) AS rows, SUM(quantity) AS total_units, SUM(quantity*COALESCE(avg_cost_basis,0)) AS total_cost FROM inventory i JOIN locations l ON l.id=i.location_id GROUP BY l.name ORDER BY l.name;")

with open(os.path.join(OUT_DIR, "02_wipe_and_import.sql"), "w") as f:
    f.write("\n".join(inv_lines))

# 3) REVIEW.md — human-readable preview
review = ["# Final Inventory Import — Review\n"]
review.append(f"- Total inventory rows to import: **{len(all_rows)}**")
review.append(f"- New products to create: **{len(new_products)}**")
review.append(f"- Unresolved rows: **{len(unresolved)}**")
review.append("")

review.append("## New products to be created\n")
review.append("| Brand | Lang | Name | Type | Category | MP | Cost (80%) |")
review.append("|---|---|---|---|---|---|---|")
for (brand, lang, name), spec in sorted(new_products.items()):
    mp = get_mp(brand, lang, name)
    cost = f"${round(mp*0.8, 2)}" if mp else "—"
    mp_str = f"${mp}" if mp else "—"
    review.append(f"| {brand} | {lang} | {name} | {spec['type']} | {spec['category']} | {mp_str} | {cost} |")

review.append("\n## Inventory rows by location\n")
by_loc = defaultdict(list)
for r in all_rows:
    by_loc[r['location_name']].append(r)
for loc, rows in sorted(by_loc.items()):
    review.append(f"\n### {loc} ({len(rows)} rows, total {sum(r['qty'] for r in rows)} units)\n")
    review.append("| Sheet | → Product | Qty | MP | Cost | Action |")
    review.append("|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda x: -x['qty']):
        mp = f"${r['mp']}" if r['mp'] else "—"
        cost = f"${r['cost']}" if r['cost'] is not None else "skip"
        review.append(f"| {r['sheet_label'][:35]} | {r['product_label'][:55]} | {r['qty']} | {mp} | {cost} | {r['action']} |")

if unresolved:
    review.append("\n## ⚠️ Unresolved rows (need user input)\n")
    for u in unresolved:
        review.append(f"- {u['loc']} | {u['product']} | {u['cat']}/{u['type']} | qty={u['qty']}")

with open(os.path.join(OUT_DIR, "REVIEW.md"), "w") as f:
    f.write("\n".join(review))

# Console summary
print(f"Generated: {OUT_DIR}/")
print(f"  01_new_products.sql       — {len(new_products)} INSERT statements")
print(f"  02_wipe_and_import.sql    — {len(all_rows)} inventory rows")
print(f"  REVIEW.md                  — full preview")
print()
print(f"Inventory rows by location:")
for loc, rows in sorted(by_loc.items()):
    qty = sum(r['qty'] for r in rows)
    cost_total = sum(r['qty']*r['cost'] for r in rows if r['cost'] is not None)
    print(f"  {loc:35} {len(rows):>3} rows  {qty:>5} units  ${cost_total:>10,.2f} cost")
print()
if unresolved:
    print(f"⚠️  {len(unresolved)} unresolved rows:")
    for u in unresolved:
        print(f"   - {u['loc']:30} | {u['product']:40} ({u.get('cat','')}/{u.get('type','')}) qty={u['qty']}")
