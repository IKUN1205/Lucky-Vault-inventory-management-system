# -*- coding: utf-8 -*-
"""Crop straight to the CASE row and its BOX sibling, on phone and desktop.

The full-page shot lands at the top of a 115-row sheet, which shows nothing
about the row this change is for. This finds the two OP-17 rows and photographs
just them, side by side as a counter meets them.
"""
import json
import pathlib
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = pathlib.Path(r"c:\Users\Gary\Desktop\LV Agents\inventory-sync\data\_supabase_keys.json")
OUT = ROOT / "scratchpad" / "shots"
PORT = 4175


def gary():
    k = json.load(open(KEYS, encoding="utf-8"))
    url, key = k["urls"][0], k["anon_key_network"]
    req = urllib.request.Request(
        url + "/rest/v1/" + quote("users?select=*&name=eq.Gary", safe="?&=.,*()-"),
        headers={"apikey": key, "Authorization": "Bearer " + key})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())[0]


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
    user = gary()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        for tag, vp in (("desktop", {"width": 1280, "height": 900}),
                        ("phone", {"width": 390, "height": 860})):
            ctx = b.new_context(viewport=vp)
            pg = ctx.new_page()
            pg.goto(base, wait_until="domcontentloaded")
            pg.evaluate("u => localStorage.setItem('luckyvault_user', JSON.stringify(u))", user)
            pg.goto(base + "/stream-counts", wait_until="networkidle")
            pg.wait_for_timeout(2000)
            pg.locator("select").first.select_option(label="Master Inventory")
            pg.wait_for_timeout(600)
            sels = pg.locator("select")
            for i in range(sels.count()):
                if sels.nth(i).get_attribute("name") == "counted_by_id":
                    sels.nth(i).select_option(index=1)
            pg.get_by_role("button", name="Start Count").click()
            pg.wait_for_timeout(5000)

            rows = pg.locator("tr", has_text="STRONGEST WARRIORS")
            n = rows.count()
            print("\n=== %s === matched %d rows" % (tag, n))
            for i in range(n):
                print("   %s" % " | ".join(rows.nth(i).inner_text().split("\n"))[:120])
            if n:
                # Element screenshots, not page.screenshot(clip=...): clip is in
                # PAGE coordinates while bounding_box() is viewport-relative, so
                # mixing them photographs a different row than the one measured.
                for i in range(n):
                    rows.nth(i).scroll_into_view_if_needed()
                    pg.wait_for_timeout(300)
                    rows.nth(i).screenshot(path=str(OUT / ("caserow_%s_%d.png" % (tag, i))))
                print("   -> shots/caserow_%s_0..%d.png" % (tag, n - 1))
            ctx.close()
        b.close()
finally:
    subprocess.call("taskkill /F /T /PID %d" % srv.pid, shell=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
