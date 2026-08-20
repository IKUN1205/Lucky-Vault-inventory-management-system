# -*- coding: utf-8 -*-
"""Open the buy-record page and photograph the "% of market" readout.

Gary 2026-08-13: "我们每次推系统 我们都要自己打开截图看看有没有用验证". That rule
paid for itself the day it was made — the singles comps page passed 23
assertions and the screenshot showed two real defects the assertions could not
see.

Serves the built app with `vite preview`, signs in by seeding the same
localStorage key the app uses, and fulfils /api/market-prices from the REAL
published feed (the serverless route only exists on Vercel; it is tested
separately against the same upstream in scratchpad/api_market_prices_test.mjs).

    python scratchpad/shot_purchased_items.py
"""
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = pathlib.Path(r"c:\Users\Gary\Desktop\LV Agents\inventory-sync\data\_supabase_keys.json")
FEED = pathlib.Path(r"c:\Users\Gary\Desktop\LV Agents\slab-inventory\data\kaitori_board\market_prices.json")
OUT = ROOT / "scratchpad" / "shots"
PORT = 4173


def gary():
    k = json.load(open(KEYS, encoding="utf-8"))
    url, key = k["urls"][0], k["anon_key_network"]
    req = urllib.request.Request(
        url + "/rest/v1/" + quote("users?select=*&name=eq.Gary", safe="?&=.,*()-"),
        headers={"apikey": key, "Authorization": "Bearer " + key})
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not rows:
        raise SystemExit("no Gary row")
    return rows[0]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    user = gary()
    feed = json.load(open(FEED, encoding="utf-8"))
    print("feed: %d products, %d priced" % (feed["count"], feed["priced"]))

    srv = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"],
                           cwd=str(ROOT), shell=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = "http://localhost:%d" % PORT
        for _ in range(60):
            try:
                urllib.request.urlopen(base, timeout=2)
                break
            except Exception:
                time.sleep(1)
        else:
            raise SystemExit("vite preview never came up")

        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            ctx = b.new_context(viewport={"width": 1280, "height": 1000})

            # The serverless route is not running under `vite preview`; serve
            # the real payload it would return.
            ctx.route("**/api/market-prices", lambda route: route.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"generated_at": feed["generated_at"],
                                 "count": feed["count"], "priced": feed["priced"],
                                 "prices": feed["prices"]})))

            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))

            pg.goto(base, wait_until="domcontentloaded")
            pg.evaluate("u => localStorage.setItem('luckyvault_user', JSON.stringify(u))", user)
            pg.goto(base + "/purchased-items", wait_until="networkidle")
            pg.wait_for_timeout(2500)
            pg.screenshot(path=str(OUT / "01_loaded.png"), full_page=True)
            print("01 loaded  title=%r" % pg.title())

            # Pick a product, then type a cost. Both of the day's real buys.
            for shot, query, option, qty, cost, label in [
                ("02_op11_550", "A Fist of Divine Speed Booster Box",
                 "[EN] OP-11 A Fist of Divine Speed", "6", "550",
                 "OP-11 @ $550 -> expect 85%"),
                ("03_op11_579", "A Fist of Divine Speed Booster Box",
                 "[EN] OP-11 A Fist of Divine Speed", "12", "579.17",
                 "OP-11 @ $579.17 -> expect 90%"),
                ("04_bag", "Storm Emeralda (In Bag)",
                 "Storm Emeralda (In Bag)", "5", "93.80",
                 "trash bag -> expect NO percent"),
                ("05_blister", "OP-13 Carrying On His Will Blister",
                 "[EN] OP-13 Carrying On His Will", "100", "18.25",
                 "OP-13 blister @ $18.25 -> expect 97%, pinned (no caveat)"),
                ("06_overpay", "A Fist of Divine Speed Booster Box",
                 "[EN] OP-11 A Fist of Divine Speed", "2", "900",
                 "deliberate overpay -> expect 140%, above market"),
            ]:
                pg.goto(base + "/purchased-items", wait_until="networkidle")
                pg.wait_for_timeout(1800)
                try:
                    pick_product(pg, query, option)
                    set_field(pg, "Qty", qty)
                    set_cost(pg, cost)
                    pg.wait_for_timeout(700)
                    pg.screenshot(path=str(OUT / (shot + ".png")), full_page=True)
                    print("%-14s %s" % (shot, label))
                    print("    readout: %s" % readout(pg))
                except Exception as ex:
                    pg.screenshot(path=str(OUT / (shot + "_FAILED.png")), full_page=True)
                    print("%-14s FAILED: %s" % (shot, str(ex)[:160]))

            if errs:
                print("\nconsole errors:")
                for e in errs[:10]:
                    print("  " + e[:160])
            else:
                print("\nno console errors")
            b.close()
    finally:
        srv.terminate()
    print("\nshots in %s" % OUT)


def pick_product(pg, query, option_text):
    # The option row is several spans ("One Piece | [EN] OP-11 ... | Booster
    # Box | EN"), so match the one span that names the product and click it.
    box = pg.locator("input[placeholder*='Search'], input[placeholder*='product']").first
    box.click()
    box.fill(query)
    pg.wait_for_timeout(1100)
    pg.get_by_text(option_text, exact=True).first.click(timeout=8000)


def set_field(pg, label, value):
    pg.locator("input[type='number']").first.fill(value)


def set_cost(pg, value):
    pg.locator("input[type='number']").nth(1).fill(value)


def readout(pg):
    # The warning state is a chip (span), not a bare paragraph, so scrape both
    # — a scraper that silently stops seeing the loudest state is worse than no
    # scraper, because the run still prints a tidy line.
    txt = [t.strip() for t in pg.locator("p.text-\\[11px\\]").all_inner_texts()]
    txt += [t.strip() for t in pg.locator("span.text-\\[11px\\]").all_inner_texts()]
    return " | ".join(t for t in txt if t)


if __name__ == "__main__":
    main()
