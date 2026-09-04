# -*- coding: utf-8 -*-
"""Open the pick-sheet the way Frank will and look at it before sending.

House rule since 08-13: never ship a page without opening it. The page passed
every check I could write and that proves nothing about whether the images
actually render on a phone, whether anything overflows sideways, or whether the
instructions read as instructions.

Fetches the PUBLIC url, not the local file, so a hosting problem shows up here
rather than in Frank's hands.
"""
import asyncio
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
URL = "https://lv-slabs.luckyvault.us/kaitori/sku_image_check.html"
OUT = os.path.join(HERE, "variant_page")


async def main():
    from playwright.async_api import async_playwright
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for name, w, h in (("phone", 390, 844), ("desktop", 1280, 900)):
            pg = await br.new_page(viewport={"width": w, "height": h})
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            await pg.goto(URL, wait_until="networkidle", timeout=90000)
            await pg.wait_for_timeout(2500)

            over = await pg.evaluate(
                "() => document.documentElement.scrollWidth - "
                "document.documentElement.clientWidth")
            imgs = await pg.evaluate("""() => {
              const a = [...document.images];
              return {total: a.length,
                      broken: a.filter(i => i.complete && i.naturalWidth === 0).length,
                      loaded: a.filter(i => i.naturalWidth > 0).length};
            }""")
            print("%-8s %dx%d  horizontal overflow: %dpx   images %d/%d loaded, %d broken"
                  % (name, w, h, over, imgs["loaded"], imgs["total"], imgs["broken"]))
            if errs:
                print("         console errors: %s" % errs[:3])
            p = os.path.join(OUT, "%s.png" % name)
            await pg.screenshot(path=p, full_page=(name == "phone"))
            print("         -> %s" % p)
            await pg.close()
        await br.close()


if __name__ == "__main__":
    asyncio.run(main())
