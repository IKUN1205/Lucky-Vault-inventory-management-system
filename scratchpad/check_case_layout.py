# -*- coding: utf-8 -*-
"""Measure, do not eyeball: is the count input still fully on screen at 390px?

08-21's bug was exactly this — the table was wider than the phone, so focusing
an input scrolled the container right and the product name left the screen. The
counter could see "Booster Box / 205" and not which row it belonged to. This
change adds a CASE chip inside the name cell, which competes for the same
horizontal space, so the measurement has to be redone rather than assumed.

Compares a CASE row against a plain row in the same table.
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
PORT = 4176

k = json.load(open(KEYS, encoding="utf-8"))
req = urllib.request.Request(
    k["urls"][0] + "/rest/v1/" + quote("users?select=*&name=eq.Gary", safe="?&=.,*()-"),
    headers={"apikey": k["anon_key_network"], "Authorization": "Bearer " + k["anon_key_network"]})
user = json.loads(urllib.request.urlopen(req, timeout=30).read())[0]

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
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        for w in (390, 360):
            ctx = b.new_context(viewport={"width": w, "height": 860})
            pg = ctx.new_page()
            pg.goto(base, wait_until="domcontentloaded")
            pg.evaluate("u => localStorage.setItem('luckyvault_user', JSON.stringify(u))", user)
            pg.goto(base + "/stream-counts", wait_until="networkidle")
            pg.wait_for_timeout(2000)
            pg.locator("select").first.select_option(label="Master Inventory")
            pg.wait_for_timeout(600)
            s = pg.locator("select")
            for i in range(s.count()):
                if s.nth(i).get_attribute("name") == "counted_by_id":
                    s.nth(i).select_option(index=1)
            pg.get_by_role("button", name="Start Count").click()
            pg.wait_for_timeout(5000)

            print("\n=== viewport %dpx ===" % w)
            res = pg.evaluate("""(w) => {
              const out = []
              for (const tr of document.querySelectorAll('tbody tr')) {
                const inp = tr.querySelector('input[type=number]')
                if (!inp) continue
                const isCase = !!Array.from(tr.querySelectorAll('span'))
                  .find(s => s.textContent.trim() === 'CASE')
                const r = inp.getBoundingClientRect()
                const name = (tr.querySelector('td:nth-child(1), td:nth-child(2)') || {}).innerText || ''
                out.push({ isCase, right: Math.round(r.right), left: Math.round(r.left),
                           offscreen: r.right > w + 0.5,
                           name: name.split('\\n')[0].slice(0, 40) })
              }
              return out
            }""", w)
            cases = [r for r in res if r["isCase"]]
            plain = [r for r in res if not r["isCase"]]
            print("   rows with an input: %d (case %d / plain %d)"
                  % (len(res), len(cases), len(plain)))
            for label, group in (("CASE ", cases), ("plain", plain[:3])):
                for r in group:
                    print("   %s  input right edge %4dpx  %s   %s"
                          % (label, r["right"],
                             "🔴 OFF SCREEN" if r["offscreen"] else "on screen ok",
                             r["name"]))
            off = [r for r in res if r["offscreen"]]
            print("   ---> %d of %d inputs off screen" % (len(off), len(res)))
            ovf = pg.evaluate("() => document.documentElement.scrollWidth - "
                              "document.documentElement.clientWidth")
            print("   page horizontal overflow: %dpx" % ovf)
            # focus a case input: 08-21's bug only appeared on focus
            if cases:
                pg.evaluate("""() => {
                  const tr = Array.from(document.querySelectorAll('tbody tr'))
                    .find(t => Array.from(t.querySelectorAll('span'))
                      .some(s => s.textContent.trim() === 'CASE'))
                  tr && tr.querySelector('input[type=number]').focus()
                }""")
                pg.wait_for_timeout(500)
                after = pg.evaluate("""() => {
                  const tr = Array.from(document.querySelectorAll('tbody tr'))
                    .find(t => Array.from(t.querySelectorAll('span'))
                      .some(s => s.textContent.trim() === 'CASE'))
                  const cell = tr.querySelector('td:nth-child(1), td:nth-child(2)')
                  const r = cell.getBoundingClientRect()
                  return { left: Math.round(r.left), visible: r.left > -5 }
                }""")
                print("   after focusing the CASE input, name cell left edge %dpx  %s"
                      % (after["left"], "still visible ✅" if after["visible"]
                         else "🔴 scrolled off"))
            ctx.close()
        b.close()
finally:
    subprocess.call("taskkill /F /T /PID %d" % srv.pid, shell=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
