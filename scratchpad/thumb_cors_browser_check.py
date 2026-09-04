# -*- coding: utf-8 -*-
"""Does the browser actually get the product-image map now?

The 2026-08-20 entry says lv-slabs.luckyvault.us sends no
Access-Control-Allow-Origin, so useProductImages resolves to {} and no page
shows a thumbnail. curl now shows a per-origin ACAO, but curl is not a browser
and the 08-20 finding was made with headless Chromium for exactly that reason.
So repeat it the same way.

The page is served from http://localhost:5173 -- one of the two origins the
host allowlists -- and runs the same fetch() useProductImages runs. It also
loads one of the returned URLs as an <img>, because an <img> is NOT subject to
CORS and a host can perfectly well allow the JSON while hotlink-blocking the
pictures.

    python thumb_cors_browser_check.py
"""
import asyncio
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 5173
FEED = "https://lv-slabs.luckyvault.us/kaitori/product_images.json"

PAGE = """<!doctype html><meta charset=utf-8><title>thumb check</title>
<body><p id=out>running…</p></body>"""


def serve():
    os.makedirs(os.path.join(HERE, "_thumbcheck"), exist_ok=True)
    with open(os.path.join(HERE, "_thumbcheck", "index.html"), "w", encoding="utf-8") as f:
        f.write(PAGE)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler,
                                directory=os.path.join(HERE, "_thumbcheck"))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def main():
    from playwright.async_api import async_playwright
    httpd = serve()
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            page = await br.new_page()
            errs = []
            page.on("console", lambda m: errs.append("%s: %s" % (m.type, m.text))
                    if m.type == "error" else None)
            await page.goto("http://localhost:%d/index.html" % PORT)
            print("page origin:", await page.evaluate("location.origin"))

            res = await page.evaluate("""async (url) => {
              try {
                const r = await fetch(url);
                if (!r.ok) return { ok:false, why:'HTTP ' + r.status };
                const m = await r.json();
                const keys = Object.keys(m);
                return { ok:true, count:keys.length, sample:m[keys[0]], key:keys[0] };
              } catch (e) { return { ok:false, why:String(e) }; }
            }""", FEED)
            print()
            print("fetch() of the image map from a browser:")
            if res.get("ok"):
                print("   OK -- %d entries. This is the call the 08-20 entry says is"
                      " blocked." % res["count"])
                print("   sample: %s -> %s" % (res["key"], str(res["sample"])[:78]))
            else:
                print("   BLOCKED -- %s" % res.get("why"))

            if res.get("ok"):
                shown = await page.evaluate("""async (src) => {
                  return await new Promise(done => {
                    const i = new Image();
                    i.onload  = () => done({ ok:true,  w:i.naturalWidth, h:i.naturalHeight });
                    i.onerror = () => done({ ok:false });
                    i.src = src;
                    setTimeout(() => done({ ok:false, why:'timeout' }), 15000);
                  });
                }""", res["sample"])
                print()
                print("rendering one of those URLs as <img> (no CORS involved):")
                print("   %s" % ("OK -- %dx%d pixels decoded" % (shown["w"], shown["h"])
                                 if shown.get("ok") else
                                 "FAILED -- %s" % shown.get("why", "onerror")))

            if errs:
                print()
                print("console errors:", errs[:5])
            await br.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
