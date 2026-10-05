#!/usr/bin/env python3
"""Open every product link in site/data.js and record which ones to drop.

Usage: python3 scripts/check_links.py   (then run scripts/build_data.py again)

A link fails when:
  - the page does not load (error, 404, 410, ...),
  - it redirects away from the product (to the home page, a category,
    a search page or a different product),
  - the page says the product is sold, sold out or out of stock.

It also reads the price shown on each product page.

Results go to data/link_check.json as {link: {"ok": bool, "reason": str, "price": float|None}}.
build_data.py leaves out every link with "ok": false. Links that could not
be reached at all are recorded as "unreachable" and also left out, so run
this from a network that can open the store sites.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data.js"
OUT = ROOT / "data" / "link_check.json"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

SOLD_PATTERNS = [
    r'"availability"\s*:\s*"(?:https?://schema\.org/)?(?:OutOfStock|SoldOut|Discontinued)"',
    r'itemprop="availability"[^>]+(?:OutOfStock|SoldOut)',
    r'property="product:availability"\s+content="(?:out of stock|oos)"',
    r'class="[^"]*\bout-of-stock\b',
    r'\bsold[\s-]?out\b',
    r'\bout of stock\b',
]
SOLD_IN_TITLE = re.compile(r"\bsold\b", re.I)
# Path pieces that mean we landed on a listing page instead of a product.
NOT_PRODUCT_PATH = re.compile(r"/(product-category|collections/[^/]+/?$|category|search|shop/?$)|[?&](s|q|search)=", re.I)


def page_title(html):
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


PRICE_PATTERNS = [
    r'"price"\s*:\s*"?([\d.,]+)"?',                                    # JSON-LD offers
    r'property="(?:product:price:amount|og:price:amount)"\s+content="([\d.,]+)"',
    r'itemprop="price"\s+content="([\d.,]+)"',
    r'woocommerce-Price-amount[^>]*>\s*<bdi>\s*(?:<span[^>]*>[^<]*</span>)?\s*([\d.,]+)',
    r'class="[^"]*price[^"]*"[^>]*>\s*\$\s*([\d.,]+)',
]


def find_price(html):
    """Price in USD as shown on the product page, or None."""
    for pat in PRICE_PATTERNS:
        for m in re.finditer(pat, html, re.I):
            try:
                v = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            if 50 <= v <= 20000:  # a laptop price, not a rating or an id
                return v
    return None


def check(link):
    try:
        req = urllib.request.Request(link, headers={"User-Agent": UA, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            final = resp.geturl()
            html = resp.read(1_500_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"HTTP {e.code}"}
    except Exception as e:  # DNS, timeout, blocked proxy, TLS
        return {"ok": False, "reason": f"unreachable: {type(e).__name__}"}

    want, got = urlparse(link), urlparse(final)
    if got.netloc.replace("www.", "") != want.netloc.replace("www.", ""):
        return {"ok": False, "reason": f"redirected to another site: {final}"}
    if got.path.strip("/") == "":
        return {"ok": False, "reason": "redirected to the home page"}
    if got.path.rstrip("/").lower() != want.path.rstrip("/").lower():
        if NOT_PRODUCT_PATH.search(final):
            return {"ok": False, "reason": f"redirected to a listing page: {final}"}
        return {"ok": False, "reason": f"redirected to a different page: {final}"}
    if NOT_PRODUCT_PATH.search(final):
        return {"ok": False, "reason": "not a product page"}

    title = page_title(html)
    if SOLD_IN_TITLE.search(title):
        return {"ok": False, "reason": f"title says sold: {title}"}
    low = html.lower()
    for pat in SOLD_PATTERNS:
        if re.search(pat, html if "availability" in pat else low, re.I):
            # Shared "out of stock" text in menus/filters is common; trust it only
            # when the page has no in-stock signal.
            if pat.startswith(r"\b") and re.search(r'InStock"|in stock</|add to cart', html, re.I):
                continue
            return {"ok": False, "reason": "sold / out of stock"}
    return {"ok": True, "reason": "product page, available", "price": find_price(html)}


def main():
    data = json.loads(DATA.read_text(encoding="utf-8").split("=", 1)[1].rstrip().rstrip(";"))
    links = sorted({p["link"] for p in data["products"] if p.get("link")})
    print(f"Checking {len(links)} links...", file=sys.stderr)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(zip(links, pool.map(check, links)))
    if all(v["reason"].startswith("unreachable") for v in results.values()):
        sys.exit("No store site could be reached; nothing written. Run this from a network that can open them.")
    # Keep earlier failures: those links are no longer in data.js, so they are not rechecked.
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        results = {**{k: v for k, v in old.items() if not v["ok"]}, **results}
    OUT.write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    checked = {k: results[k] for k in links}
    bad = {k: v for k, v in checked.items() if not v["ok"]}
    unreachable = sum(1 for v in bad.values() if v["reason"].startswith("unreachable"))
    print(f"{len(links) - len(bad)} ok, {len(bad)} to drop ({unreachable} unreachable). Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
