# -*- coding: utf-8 -*-
"""One-time migration apply: seed the 'IOU (we owe)' payment method for the
We Owe payables page (see add_iou_payment_method_2026_07_24.sql — same effect,
via PostgREST because psql isn't set up on this machine). Idempotent."""
import json
import os
import sys
import urllib.request

sys.path.insert(0, r"C:\Users\Gary\Desktop\LV Agents\lv-finance")
import per_stream_pnl as P  # noqa: E402  (loads SUPABASE_URL/KEY from lv-finance env)

ENV = P.ENV
BASE = ENV["SUPABASE_URL"].rstrip("/") + "/rest/v1"
HDR = {"apikey": ENV["SUPABASE_KEY"], "Authorization": f"Bearer {ENV['SUPABASE_KEY']}",
       "Content-Type": "application/json", "Prefer": "return=representation"}

existing = P.sb("payment_methods?select=id,name&name=eq.IOU%20(we%20owe)")
if existing:
    print("already present:", existing[0]["id"])
    sys.exit(0)

req = urllib.request.Request(
    f"{BASE}/payment_methods", method="POST",
    # type is enum payment_type with no IOU member ("22P02"); nothing in the
    # codebase reads .type, so borrow 'Store Credit' — all logic keys off name.
    data=json.dumps({"name": "IOU (we owe)", "type": "Store Credit", "active": True}).encode(),
    headers=HDR)
try:
    row = json.loads(urllib.request.urlopen(req, timeout=30).read())
    print("created:", row[0]["id"], row[0]["name"], row[0]["type"])
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:500])
    sys.exit(1)
