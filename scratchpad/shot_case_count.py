# -*- coding: utf-8 -*-
"""Screenshot the count sheet for a room that holds a CASE.

Ship-gate rule (Gary 2026-08-13): open the page and LOOK before pushing. That
rule has already paid twice — an amber warning on a gold page, and a phone
layout that scrolled the product name off screen.

Master Inventory is the room to look at: it holds the only three cases on hand,
including CASE · [JP] THE WORLD'S STRONGEST WARRIORS sitting directly beside
BOX · [JP] THE WORLD'S STRONGEST WARRIORS — the merge-prone shape.

Never submits a count. Stops at the blind sheet.

    python scratchpad/shot_case_count.py
"""
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = pathlib.Path(r"c:\Users\Gary\Desktop\LV Agents\inventory-sync\data\_supabase_keys.json")
OUT = ROOT / "scratchpad" / "shots"
PORT = 4174
ROOM = "Master Inventory"


def gary():
    k = json.load(open(KEYS, encoding="utf-8"))
    url, key = k["urls"][0], k["anon_key_network"]
    req = urllib.request.Request(
        url + "/rest/v1/" + quote("users?select=*&name=eq.Gary", safe="?&=.,*()-"),
        headers={"apikey": key, "Authorization": "Bearer " + key})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())[0]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    user = gary()
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
            for tag, vp in (("desktop", {"width": 1280, "height": 1100}),
                            ("phone", {"width": 390, "height": 860})):
                ctx = b.new_context(viewport=vp)
                pg = ctx.new_page()
                errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))

                pg.goto(base, wait_until="domcontentloaded")
                pg.evaluate("u => localStorage.setItem('luckyvault_user', JSON.stringify(u))", user)
                pg.goto(base + "/stream-counts", wait_until="networkidle")
                pg.wait_for_timeout(2500)

                pg.locator("select").first.select_option(label=ROOM)
                pg.wait_for_timeout(800)
                sels = pg.locator("select")
                for i in range(sels.count()):
                    if sels.nth(i).get_attribute("name") == "counted_by_id":
                        sels.nth(i).select_option(index=1)
                pg.get_by_role("button", name="Start Count").click()
                pg.wait_for_timeout(5000)

                body = pg.inner_text("body")
                print("\n=== %s (%dx%d) ===" % (tag, vp["width"], vp["height"]))
                m = re.search(r"(\d+) products", body)
                print("   sheet loaded, %s products in the first family" % (m.group(1) if m else "?"))
                print("   'CASE' chip present     :", "CASE" in body)
                print("   'Case · 12 boxes' shown :", "Case · 12 boxes" in body)
                print("   carton instruction shown:",
                      "Count SEALED CARTONS" in body)
                print("   category still says 'Booster Box' on the case row:",
                      bool(re.search(r"CASE[^\n]*\n[^\n]*Booster Box", body)))

                # horizontal overflow is the phone failure mode that hid product
                # names behind the input on 08-21
                ovf = pg.evaluate("() => document.documentElement.scrollWidth - "
                                  "document.documentElement.clientWidth")
                print("   horizontal overflow    :", ovf, "px")

                # scroll the case row into view so the shot actually shows it
                try:
                    row = pg.locator("tr", has_text="THE WORLD").first
                    row.scroll_into_view_if_needed()
                    pg.wait_for_timeout(400)
                except Exception as e:
                    print("   (could not scroll to the case row: %s)" % str(e)[:60])
                pg.screenshot(path=str(OUT / ("case_%s.png" % tag)), full_page=False)
                print("   console errors         :", errs[:4] if errs else "none")
                ctx.close()
            b.close()
    finally:
        subprocess.call("taskkill /F /T /PID %d" % srv.pid, shell=True,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
