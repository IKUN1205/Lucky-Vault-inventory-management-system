# -*- coding: utf-8 -*-
"""Check packs_per_box against what we actually paid. Read-only.

Gary 2026-08-18: "盒子的hit rate是比散包好的 所以价格高". That is a fact about the
market, which makes it a check we can run on ourselves: for any set where we
bought BOTH a box and loose packs, box_cost / packs_per_box must land above the
loose pack price. When it does not, packs_per_box is the only free variable.

A BAG (垃圾袋 / "(In Bag)" / "(Open)") gets a different rule, and getting this
wrong is worse than not checking. A bag is a box's packs with the box thrown
away: it should cost LESS per pack than a sealed box, and it lands right around
the loose pack price - Mega Symphonia is ¥215 against ¥220 and is CORRECT at 30.
Judged by the box rule it gets reported as an error, with a suggested "implied"
count of 29.3 sitting next to it, which is an invitation to change a right
answer into a wrong one. Bags are only flagged when they are off by a factor,
not by a few percent.

  python ppb_sanity.py
"""
import json, pathlib, re, sys, urllib.request
from urllib.parse import quote
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
K = json.loads(pathlib.Path(r"C:/Users/Gary/Desktop/LV Agents/inventory-sync/data/_supabase_keys.json").read_text(encoding="utf-8"))
BASE, KEY = K["urls"][0].rstrip("/"), K["anon_key_network"]

BAG_LOW = 0.5   # a bag below half the loose pack price is a pack-count error,
BAG_HIGH = 2.0  # above double it the count is too small. In between is normal.


def get(p):
    out, off = [], 0
    while True:
        r = urllib.request.Request(BASE + "/rest/v1/" + quote(p + "&limit=1000&offset=%d" % off, safe="?&=.,*()-"),
                                   headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
        with urllib.request.urlopen(r, timeout=90) as f:
            b = json.loads(f.read().decode())
        out += b
        if len(b) < 1000:
            return out
        off += 1000


prods = get("products?select=id,name,variant,packs_per_box,language,brand,type")
acq = get("acquisitions?select=product_id,quantity_purchased,cost,currency&deleted=is.false")
spend = {}
for a in acq:
    q = a.get("quantity_purchased") or 0
    c = a.get("cost")
    if not q or c is None or a.get("currency") != "JPY":
        continue
    d = spend.setdefault(a["product_id"], [0, 0.0])
    d[0] += q
    d[1] += float(c)


def base(name):
    """strip the variant suffix so every SKU of one set groups together"""
    n = re.sub(r"\s*\((in bag|open|unsealed|cut slice|case|other)\)\s*$", "", name, flags=re.I)
    n = re.sub(r"\s*(booster box|single pack|booster pack)\s*$", "", n, flags=re.I)
    n = re.sub(r"^\[(JP|EN)\]\s*", "", n)
    return re.sub(r"\s+", " ", n).strip().lower().replace(" ex", "")


fams = {}
for p in prods:
    if p.get("language") != "JP":
        continue
    fams.setdefault(base(p["name"]), []).append(p)

bad, checked = [], 0
for key, rows in sorted(fams.items()):
    packs = [p for p in rows if p.get("variant") == "single_pack" and p["id"] in spend]
    holders = [p for p in rows if p.get("variant") in (None, "sealed", "unsealed", "in_bag")
               and p.get("packs_per_box") and p["id"] in spend]
    if not packs or not holders:
        continue
    pq = sum(spend[p["id"]][0] for p in packs)
    pc = sum(spend[p["id"]][1] for p in packs)
    loose = pc / pq
    for h in holders:
        checked += 1
        q, c = spend[h["id"]]
        per_pack = (c / q) / h["packs_per_box"]
        ratio = per_pack / loose
        is_bag = h.get("variant") == "in_bag"
        if is_bag:
            hit = ratio < BAG_LOW or ratio > BAG_HIGH
            rule = "bag %.2fx (ok %.1f-%.1f)" % (ratio, BAG_LOW, BAG_HIGH)
        else:
            hit = per_pack < loose
            rule = "box %.2fx (must be >1)" % ratio
        if hit:
            bad.append((h, per_pack, loose, (c / q) / loose, rule))

# A clean run has to be distinguishable from a broken checker. Re-run the same
# rule against the values we KNOW were wrong this morning (Mega Dream recorded
# as 30 when its own sealed box and its prices both say 10) and against the one
# that was right (Mega Symphonia at 30). If the loosened bag rule stopped
# catching a 3x error, this fails loudly instead of printing a reassuring blank.
def _selftest():
    cases = [
        # (label, per_unit_cost, ppb, loose_price, is_bag, must_flag)
        ("Mega Dream bag @30 (was wrong)", 11898, 30, 1105, True, True),
        ("Mega Dream bag @10 (correct)", 11898, 10, 1105, True, False),
        ("Mega Symphonia bag @30 (correct)", 6452, 30, 220, True, False),
        ("sealed box priced under a loose pack", 3000, 30, 220, False, True),
    ]
    fails = []
    for label, cost, ppb, loose, is_bag, must in cases:
        ratio = (cost / ppb) / loose
        hit = (ratio < BAG_LOW or ratio > BAG_HIGH) if is_bag else (cost / ppb < loose)
        if hit != must:
            fails.append("%s: flagged=%s expected=%s (%.2fx)" % (label, hit, must, ratio))
    if fails:
        print("SELFTEST FAILED - this checker cannot be trusted:")
        for f in fails:
            print("  " + f)
        sys.exit(1)
    print("selftest: %d/%d - it still catches the errors we already know about" % (len(cases), len(cases)))
    print()


_selftest()

print("checked %d JP SKUs that have both a pack count and a loose-pack price we paid\n" % checked)
print("%-42s %-5s %8s %8s %8s  %s" % ("SKU", "ppb", "per-pack", "loose", "implied", "rule"))
for h, per, loose, implied, rule in sorted(bad, key=lambda x: x[1] / x[2]):
    print("%-42s %-5s %8.0f %8.0f %8.1f  %s"
          % (h["name"][:42], h["packs_per_box"], per, loose, implied, rule))
if not bad:
    print("  (none)")
print("\n'implied' = the pack count that would make the price make sense.")
print("A bag is EXPECTED to sit near the loose price - that is not an error.")
