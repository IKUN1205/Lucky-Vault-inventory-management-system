# -*- coding: utf-8 -*-
"""Screenshot walk of the count page with Front Store / Master selectable.

Ship-gate rule (Gary 2026-08-13): open the page and LOOK before pushing.
Never submits a count - stops at the blind count sheet.

    python scratchpad/shot_ledger_count.py
"""
import json, pathlib, subprocess, sys, time, urllib.request
from urllib.parse import quote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
KEYS = pathlib.Path(r"c:\Users\Gary\Desktop\LV Agents\inventory-sync\data\_supabase_keys.json")
OUT = ROOT / "scratchpad" / "shots"
PORT = 4173


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
            ctx = b.new_context(viewport={"width": 1280, "height": 1000})
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))

            pg.goto(base, wait_until="domcontentloaded")
            pg.evaluate("u => localStorage.setItem('luckyvault_user', JSON.stringify(u))", user)
            pg.goto(base + "/stream-counts", wait_until="networkidle")
            pg.wait_for_timeout(2500)

            # 1. room dropdown must now hold Front Store + Master Inventory
            opts = pg.eval_on_selector_all("select[name=location_id] option, select option",
                                           "els => els.map(e => e.textContent.trim())")
            print("room options:", [o for o in opts if o and 'Select' not in o][:12])
            ok_front = any(o == "Front Store" for o in opts)
            ok_master = any(o == "Master Inventory" for o in opts)
            print("Front Store in dropdown:", ok_front, "| Master in dropdown:", ok_master)
            pg.screenshot(path=str(OUT / "lc1_form.png"), full_page=True)

            # 2. select Front Store -> streamer field must disappear
            sel = pg.locator("select").first
            sel.select_option(label="Front Store")
            pg.wait_for_timeout(800)
            body = pg.inner_text("body")
            print("streamer field visible after Front Store:", "Streamer (sales go to)" in body)
            pg.screenshot(path=str(OUT / "lc2_front_selected.png"), full_page=True)

            # 3. pick counter, start count, look at the sheet - DO NOT SUBMIT
            selects = pg.locator("select")
            n = selects.count()
            for i in range(n):
                name = selects.nth(i).get_attribute("name")
                if name == "counted_by_id":
                    selects.nth(i).select_option(index=1)
            pg.get_by_role("button", name="Start Count").click()
            pg.wait_for_timeout(4000)
            body2 = pg.inner_text("body")
            print("count sheet header shows Front Store:", "Front Store" in body2)
            print("no 'Streamer:' byline on sheet:", "Streamer:" not in body2)
            import re
            m = re.search(r"(\d+) products", body2)
            print("products on sheet:", m.group(1) if m else "?")
            pg.screenshot(path=str(OUT / "lc3_sheet.png"), full_page=False)

            print("console errors:", errs[:6] if errs else "none")
            b.close()
    finally:
        subprocess.call("taskkill /F /T /PID %d" % srv.pid, shell=True,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
