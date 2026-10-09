#!/usr/bin/env python3
"""Find laptop ads on OLX Lebanon and link each one directly.

Usage: python scripts/crawl_olx.py            (continues where it stopped)
       python scripts/crawl_olx.py --fresh    (start over)

It reads the OLX laptop search pages, opens each ad (slowly, one at a time,
so OLX is not flooded) and keeps it only when:
  - the ad still opens (removed ads are dropped),
  - the title names a processor and it is a laptop (bags, chargers, parts,
    desktops and tablets are skipped),
  - it is not marked sold.
Only the ad title, specs, price, condition and link are saved; seller
names and phone numbers are never stored.

Writes data/more_stores_olx.csv and adds every ad it opened to
data/link_check.json. Progress is saved every 20 ads to data/olx_progress.json.
Run scripts/build_data.py next (or upload the two data files).
"""
import csv
import json
import os
import re
import sys
import time
import urllib.error
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crawl_stores as c  # noqa: E402
from check_links import SOLD_IN_TITLE, product_info  # noqa: E402

ROOT = c.ROOT
OUT_CSV = ROOT / "data" / "more_stores_olx.csv"
PROGRESS = ROOT / "data" / "olx_progress.json"
LINK_CHECK = c.LINK_CHECK
BASE = "https://www.olx.com.lb"
SEARCHES = [BASE + "/electronics-home-appliances/q-laptop/", BASE + "/electronics-home-appliances/q-macbook/",
            BASE + "/electronics-home-appliances/q-gaming-laptop/"]
MAX_PAGES = 60
PAUSE = 1.5  # seconds between requests


def get(url):
    time.sleep(PAUSE)
    return c.fetch(url, 30)


def ad_links(html):
    return {urljoin(BASE, u.split("?")[0]) for u in re.findall(r'href="(/ad/[^"]+?-ID\d+\.html)', html)}


def text_of(html, pat):
    m = re.search(pat, html, re.I | re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""


def inspect(url):
    try:
        final, html = get(url)
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"HTTP {e.code}"}, None
    except Exception as e:
        return {"ok": False, "reason": f"unreachable: {type(e).__name__}"}, None
    if "/ad/" not in urlparse(final).path:
        return {"ok": False, "reason": "ad removed (redirected)"}, None
    info = product_info(html)
    name = info["name"] or text_of(html, r'property="og:title"\s+content="([^"]*)"') or text_of(html, r"<h1[^>]*>(.*?)</h1>")
    name = re.sub(r"\s*\|\s*OLX.*$", "", name.replace("&amp;", "&").replace("&quot;", '"')).strip()
    desc = info["description"] or text_of(html, r'property="og:description"\s+content="([^"]*)"')
    if SOLD_IN_TITLE.search(name):
        return {"ok": False, "reason": f"marked sold: {name[:80]}"}, None
    if not name or c.NOT_LAPTOP.search(name) or re.search(r"\btablet\b|\bipad\b|\bphone\b", name, re.I):
        return {"ok": False, "reason": "not a laptop"}, None
    if not c.cpu_of(f"{name} {desc[:400]}"):
        return {"ok": False, "reason": "not a laptop"}, None
    if not (c.LAPTOP_WORDS.search(name) or c.LAPTOP_WORDS.search(desc[:300]) or c.screen_of(name)):
        return {"ok": False, "reason": "not a laptop"}, None
    price = info["price"]
    if price is None or (info["currency"] and str(info["currency"]).upper() != "USD"):
        m = re.search(r"USD\s*([\d,]{2,7})", html)
        price = float(m.group(1).replace(",", "")) if m else None
    if price is not None and not (50 <= price <= 20000):
        price = None
    cond = text_of(html, r">\s*Condition\s*<.*?>\s*(New|Used|Like new|Open box)\s*<")
    condition = {"used": "Used", "like new": "Used"}.get(cond.lower(), c.condition_of(name) if not cond else cond.title())
    text = f"{name} {desc[:800]}"
    brand = c.brand_of(name)
    row = {
        "store": "OLX", "brand": brand, "model": c.short_model(name, brand),
        "cpu": c.cpu_of(text) or "", "gpu": c.gpu_of(text), "ram": c.ram_of(text) or "",
        "storage": c.storage_of(text) or "", "screen": c.screen_of(name) or c.screen_of(desc[:300]) or "",
        "price": f"{price:g}" if price else "", "condition": condition,
        "link": final.split("?")[0], "link_is_product": "1",
    }
    return {"ok": True, "reason": "ad open", "price": price}, row


def load():
    if PROGRESS.exists() and "--fresh" not in sys.argv:
        try:
            return json.loads(PROGRESS.read_text(encoding="utf-8"))
        except ValueError:
            pass
    return {"ads": {}, "pages_done": []}


def save(prog):
    tmp = PROGRESS.with_suffix(".tmp")
    tmp.write_text(json.dumps(prog, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, PROGRESS)
    rows = [r["row"] for r in prog["ads"].values() if r.get("row")]
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=c.FIELDS)
        w.writeheader()
        w.writerows(rows)
    checks = json.loads(LINK_CHECK.read_text(encoding="utf-8")) if LINK_CHECK.exists() else {}
    for url, r in prog["ads"].items():
        if r["status"]["reason"] != "not a laptop":
            checks[url] = r["status"]
    LINK_CHECK.write_text(json.dumps(checks, indent=1, ensure_ascii=False), encoding="utf-8")
    return len(rows)


def main():
    prog = load()
    found = set(prog["ads"]) | set(prog.get("queue", []))
    print("Reading OLX search pages...", flush=True)
    for search in SEARCHES:
        for page in range(1, MAX_PAGES + 1):
            url = search if page == 1 else f"{search}?page={page}"
            if url in prog["pages_done"]:
                continue
            try:
                _, html = get(url)
            except Exception as e:
                print(f"  stopped at {url} ({type(e).__name__})", flush=True)
                break
            links = ad_links(html)
            new = links - found
            found |= links
            prog["pages_done"].append(url)
            print(f"  page {page}: {len(links)} ads ({len(new)} new), {len(found)} total", flush=True)
            if not new:
                break
    prog["queue"] = sorted(found - set(prog["ads"]))
    todo = prog["queue"]
    print(f"Opening {len(todo)} ads (about {len(todo) * PAUSE / 60:.0f} minutes)...", flush=True)
    for i, url in enumerate(todo, 1):
        try:
            status, row = inspect(url)
        except Exception as e:  # an odd page must never stop the crawl
            status, row = {"ok": False, "reason": f"could not read page: {type(e).__name__}"}, None
        prog["ads"][url] = {"status": status, "row": row}
        if status["reason"].startswith("HTTP 429"):
            print("  OLX asked to slow down; waiting 60 seconds...", flush=True)
            time.sleep(60)
        if i % 20 == 0 or i == len(todo):
            kept = save(prog)
            print(f"  {i}/{len(todo)} opened, {kept} laptop ads kept (saved)", flush=True)
    prog["queue"] = []
    kept = save(prog)
    print(f"\nDone: {kept} OLX laptop ads in {OUT_CSV.relative_to(ROOT)}. Upload that file and {LINK_CHECK.relative_to(ROOT)}.")
    try:
        input("Press Enter to close.")
    except EOFError:
        pass


if __name__ == "__main__":
    main()
