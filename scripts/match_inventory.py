#!/usr/bin/env python3
"""
Fuzzy-match inventory CSV rows against DB products.
Outputs match_report.csv with classification:
  HIGH    - confident auto-import
  MEDIUM  - one candidate but needs sanity check
  LOW     - multiple candidates, user picks
  ZERO    - no candidate (skip or new product)
"""
import csv, json, re, sys, os
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_DIR = os.path.join(ROOT, "inventory_csvs")

# Sheet file -> location info
SHEETS = [
    ("master.csv",            "Master Inventory",                "1f68249f-7708-400c-80f7-e75bde85b556"),
    ("packheads.csv",         "Stream Room - TikTok Packheads",  "c995d0a6-262c-477f-af65-6329b3516c5a"),
    ("rocket.csv",            "Stream Room - TikTok RocketsHQ",  "eeff0769-9131-4467-9d0a-020b37edc102"),
    ("ebay_luckyvault.csv",   "Stream Room - eBay LuckyVaultUS", "12293f16-a21a-4a9a-b503-3e6e74dddb81"),
    ("ebay_slabbiepatty.csv", "Stream Room - eBay SlabbiePatty", "04b32948-7920-46f6-bfa1-1b0d48cc71de"),
]

# Load DB products
products = json.load(open(os.path.join(CSV_DIR, "products.json")))
print(f"Loaded {len(products)} DB products", file=sys.stderr)

# ---- normalization helpers ----

NOISE_WORDS = {
    'sealed', 'no', 'seal', 'pc', 'jp', 'japan', 'japanese', 'eng', 'english',
    'chinese', 'cn', 'box', 'packs', 'pack', 'etb', 'sleeved', 'booster',
    'bundle', 'deck', 'collection', 'the', 'a', 'an', 'of', 'and',
    's', 'v', 'sv',
}

def normalize(s):
    s = (s or '').lower()
    # common typo fix
    s = s.replace('primsatic', 'prismatic')
    # remove punctuation
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def tokens(s):
    return [t for t in normalize(s).split() if t and t not in NOISE_WORDS and len(t) > 1]

def category_from_sheet(sheet_cat):
    """Extract brand+language hint from sheet's Category column."""
    c = (sheet_cat or '').lower()
    brand, lang = None, None
    if 'one piece' in c:
        brand = 'One Piece'
    elif 'pokemon' in c or 'pokémon' in c:
        brand = 'Pokemon'
    elif 'yu' in c and 'gi' in c:
        brand = None  # not in DB
    if 'eng' in c or 'english' in c:
        lang = 'EN'
    elif 'jp' in c or 'japan' in c:
        lang = 'JP'
    elif 'chinese' in c or 'cn' in c:
        lang = 'CN'
    return brand, lang

def language_from_name(name):
    n = (name or '').lower()
    if re.search(r'\b(jp|japan|japanese)\b', n): return 'JP'
    if re.search(r'\b(cn|chinese)\b', n): return 'EN'  # CN handled by Category usually
    if re.search(r'\b(eng|english)\b', n): return 'EN'
    return None

def product_type_from_sheet(sheet_type):
    """Map sheet Type column to (db.type, db.category_hint)."""
    t = (sheet_type or '').lower().strip()
    if t in ('pack', 'packs') or 'pack' in t and 'sleeved' in t:
        return ('Pack', 'Booster Pack')
    if 'pack' in t:
        return ('Pack', 'Booster Pack')
    if t == 'etb':
        return ('Sealed', 'ETB')
    if t == 'deck':
        return ('Sealed', None)  # could be Deck or Starter Deck
    if 'booster box' in t or t == 'box':
        return ('Sealed', 'Booster Box')
    if 'bundle' in t:
        return ('Sealed', 'Booster Bundle')
    if 'case' in t or 'display' in t:
        return ('Sealed', None)
    if t == 'other':
        return ('Sealed', None)
    return ('Sealed', None)

# ---- scoring ----

def score(sheet_name, sheet_brand, sheet_lang, sheet_db_type, sheet_cat_hint, prod):
    """Return 0..100 match score against a DB product."""
    s = 0
    # Brand must match if known (+30 points)
    if sheet_brand:
        if prod['brand'] == sheet_brand:
            s += 30
        else:
            return 0  # hard fail
    # Language match (+20 if both known and equal)
    if sheet_lang:
        if prod['language'] == sheet_lang:
            s += 20
        else:
            s -= 15  # penalty but not a hard fail
    # Type match (+15)
    if sheet_db_type and prod['type'] == sheet_db_type:
        s += 15
    elif sheet_db_type and prod['type'] != sheet_db_type:
        s -= 10
    # Category hint match (+15)
    if sheet_cat_hint and prod['category'] == sheet_cat_hint:
        s += 15
    # Token overlap on name (up to 40)
    sheet_toks = set(tokens(sheet_name))
    prod_toks = set(tokens(prod['name']))
    if sheet_toks and prod_toks:
        overlap = sheet_toks & prod_toks
        ratio = len(overlap) / max(len(sheet_toks), 1)
        s += int(ratio * 40)
    # Fuzzy ratio of normalized strings (up to 20)
    fz = SequenceMatcher(None, normalize(sheet_name), normalize(prod['name'])).ratio()
    s += int(fz * 20)
    return s

# ---- main loop ----

report_rows = []
stats = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0, 'ZERO': 0, 'SKIP_BRAND': 0, 'SKIP_QTY0': 0}

for fname, loc_name, loc_id in SHEETS:
    path = os.path.join(CSV_DIR, fname)
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            sheet_prod = (row.get('Product') or '').strip()
            sheet_cat  = (row.get('Category') or '').strip()
            sheet_type = (row.get('Type') or '').strip()
            try:
                qty = int(float(row.get('Quantity') or 0))
            except:
                qty = 0
            if not sheet_prod:
                continue
            if qty <= 0:
                stats['SKIP_QTY0'] += 1
                continue
            brand, lang_from_cat = category_from_sheet(sheet_cat)
            lang = lang_from_cat or language_from_name(sheet_prod) or 'EN'
            db_type, cat_hint = product_type_from_sheet(sheet_type)

            if brand is None:
                # unknown brand (Yu-Gi-Oh, DBZ, Nikke, etc.) — skip with note
                stats['SKIP_BRAND'] += 1
                report_rows.append({
                    'location': loc_name, 'sheet_product': sheet_prod, 'sheet_cat': sheet_cat,
                    'sheet_type': sheet_type, 'qty': qty, 'class': 'ZERO',
                    'reason': f'Unknown brand from category="{sheet_cat}" — not in DB',
                    'best_match': '', 'product_id': '', 'score': 0, 'alt1': '', 'alt2': '',
                })
                continue

            # Score all products
            scored = []
            for p in products:
                sc = score(sheet_prod, brand, lang, db_type, cat_hint, p)
                if sc > 0:
                    scored.append((sc, p))
            scored.sort(key=lambda x: -x[0])

            top = scored[0] if scored else None
            second = scored[1] if len(scored) > 1 else None
            third = scored[2] if len(scored) > 2 else None

            best_score = top[0] if top else 0
            second_score = second[0] if second else 0
            gap = best_score - second_score

            if not top or best_score < 35:
                cls = 'ZERO'
                stats['ZERO'] += 1
            elif best_score >= 75 and gap >= 15:
                cls = 'HIGH'
                stats['HIGH'] += 1
            elif best_score >= 60:
                cls = 'MEDIUM'
                stats['MEDIUM'] += 1
            else:
                cls = 'LOW'
                stats['LOW'] += 1

            def fmt(p):
                return f"{p['brand']} | {p['name']} | {p['language']}"

            report_rows.append({
                'location': loc_name,
                'sheet_product': sheet_prod,
                'sheet_cat': sheet_cat,
                'sheet_type': sheet_type,
                'qty': qty,
                'class': cls,
                'reason': '',
                'best_match': fmt(top[1]) if top else '',
                'product_id': top[1]['id'] if top else '',
                'score': best_score,
                'alt1': f"{fmt(second[1])} ({second_score})" if second else '',
                'alt2': f"{fmt(third[1])} ({third[0]})" if third else '',
            })

# ---- write report ----

out_csv = os.path.join(CSV_DIR, "match_report.csv")
with open(out_csv, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=[
        'location','sheet_product','sheet_cat','sheet_type','qty','class',
        'reason','best_match','product_id','score','alt1','alt2',
    ])
    w.writeheader()
    w.writerows(report_rows)

# ---- summary ----
print(f"\nReport: {out_csv}")
print(f"Total rows considered: {len(report_rows)}")
for k, v in stats.items():
    print(f"  {k}: {v}")
