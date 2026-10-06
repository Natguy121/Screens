#!/usr/bin/env python3
"""Open every product link in site/data.js and record which ones to drop.

Usage: python3 scripts/check_links.py   (then run scripts/build_data.py again)

A link fails when:
  - the page does not load (error, 404, 410, ...),
  - it redirects to the home page, a category or search page, or a different
    laptop (a redirect to the same laptop at a new address is kept, with the
    new address recorded as "final"),
  - the product's own stock status (schema.org data, or the store's stock
    line) says out of stock / sold out, or its title says sold.

It also reads the price shown on each product page.

Results go to data/link_check.json as {link: {"ok": bool, "reason": str, "price": float|None, "final": str}}.
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

SOLD_IN_TITLE = re.compile(r"\bsold\b|sold[\s-]?out|out of stock", re.I)
# Path pieces that mean we landed on a listing page instead of a product.
NOT_PRODUCT_PATH = re.compile(r"/(product-category|collections/[^/]+/?$|category|search|shop/?$)|[?&](s|q|search)=", re.I)


def page_title(html):
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def model_tokens(path):
    """Model-number-like pieces of a URL slug, e.g. x1504va, 83dr000gus, 21kja093ed."""
    slug = path.rstrip("/").rsplit("/", 1)[-1].lower()
    return {t for t in re.split(r"[-_.]", slug) if len(t) >= 4 and re.search(r"\d", t) and re.search(r"[a-z]", t)}


def same_product(want_path, got_path):
    """True when a redirect lands on the same laptop under a new address."""
    a, b = want_path.rstrip("/").rsplit("/", 1)[-1].lower(), got_path.rstrip("/").rsplit("/", 1)[-1].lower()
    if a == b or re.fullmatch(re.escape(a) + r"-\d", b) or re.fullmatch(re.escape(b) + r"-\d", a):
        return True  # identical slug, or WordPress's "-2" copy of it
    ta, tb = model_tokens(want_path), model_tokens(got_path)
    shared = ta & tb
    return len(shared) >= 2 or any(len(t) >= 7 for t in shared)


def product_offer(html):
    """(availability, price) from the page's main schema.org Product, or (None, None)."""
    info = product_info(html)
    return info["avail"], info["price"]


def product_info(html):
    """Main schema.org Product on the page: name, description, availability, price, currency."""
    out = {"name": "", "description": "", "avail": None, "price": None, "currency": None}
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.I | re.S):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        stack = [data]
        while stack:
            node = stack.pop(0)
            if isinstance(node, list):
                stack.extend(node)
                continue
            if not isinstance(node, dict):
                continue
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if "Product" in types or "ProductGroup" in types:
                out["name"] = str(node.get("name") or "")
                out["description"] = re.sub(r"<[^>]+>", " ", str(node.get("description") or ""))[:2000]
                offers = node.get("offers") or (node.get("hasVariant") or [{}])[0].get("offers") if isinstance(node.get("hasVariant"), list) else node.get("offers")
                offers = offers[0] if isinstance(offers, list) and offers else offers
                if not isinstance(offers, dict):
                    return out
                if isinstance(offers, dict):
                    avail = str(offers.get("availability") or "")
                    out["currency"] = offers.get("priceCurrency")
                    price = offers.get("price") or offers.get("lowPrice")
                    if price is None and isinstance(offers.get("priceSpecification"), (dict, list)):
                        spec = offers["priceSpecification"]
                        spec = spec[0] if isinstance(spec, list) and spec else spec
                        price = spec.get("price") if isinstance(spec, dict) else None
                    try:
                        price = float(str(price).replace(",", "")) if price not in (None, "") else None
                    except ValueError:
                        price = None
                    out.update(avail=avail or None, price=price)
                    return out
            stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
    return out


def clean_text(fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment)).replace("&amp;", "&").replace("&#8243;", '"').strip()


def product_names(html, info=None):
    """Every place the page shows the product's name: tab title, all headings, og:title,
    the structured-data name and the last breadcrumb item."""
    info = info or product_info(html)
    names = [page_title(html), info["name"]]
    names += [clean_text(h) for h in re.findall(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)]
    names += re.findall(r'property="og:title"\s+content="([^"]*)"', html, re.I)
    crumb = re.search(r'class="[^"]*breadcrumb[^"]*"[^>]*>(.*?)</(?:nav|div|ol|ul)>', html, re.I | re.S)
    if crumb:
        parts = [p for p in re.split(r"\s*[/›»>]\s*", clean_text(crumb.group(1))) if p]
        if parts:
            names.append(parts[-1])
    return [n for n in names if n]


def sold_reason(html, info=None):
    """Why the page's product is not for sale, or None if it is."""
    info = info or product_info(html)
    for n in product_names(html, info):
        if SOLD_IN_TITLE.search(n):
            return f"marked sold: {n[:120]}"
    avail = info["avail"] or ""
    if re.search(r"OutOfStock|SoldOut|Discontinued|PreOrder|PreSale", avail, re.I):
        return f"out of stock ({avail.rsplit('/', 1)[-1]})"
    if not avail and re.search(r'<p class="stock out-of-stock|<button[^>]*name="add"[^>]*disabled', html, re.I):
        return "out of stock (stock line)"
    return None


def fallback_price(html):
    for pat in (r'property="(?:product:price:amount|og:price:amount)"\s+content="([\d.,]+)"',
                r'<p class="price">.*?woocommerce-Price-amount[^>]*>\s*<bdi>\s*(?:<span[^>]*>[^<]*</span>)?\s*([\d.,]+)'):
        m = re.search(pat, html, re.I | re.S)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                pass
    return None


def check(link):
    try:
        req = urllib.request.Request(link, headers={"User-Agent": UA, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            final = resp.geturl()
            html = resp.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"HTTP {e.code}"}
    except Exception as e:  # DNS, timeout, blocked proxy, TLS
        return {"ok": False, "reason": f"unreachable: {type(e).__name__}"}

    want, got = urlparse(link), urlparse(final)
    result = {}
    if got.netloc.replace("www.", "") != want.netloc.replace("www.", ""):
        return {"ok": False, "reason": f"redirected to another site: {final}"}
    if got.path.strip("/") == "":
        return {"ok": False, "reason": "redirected to the home page"}
    if NOT_PRODUCT_PATH.search(final):
        return {"ok": False, "reason": f"redirected to a listing page: {final}"}
    if got.path.rstrip("/").lower() != want.path.rstrip("/").lower():
        if not same_product(want.path, got.path):
            return {"ok": False, "reason": f"redirected to a different product: {final}"}
        result["final"] = final  # same laptop, new address

    info = product_info(html)
    why = sold_reason(html, info)
    if why:
        return {"ok": False, "reason": why}
    price = info["price"] if info["price"] is not None else fallback_price(html)
    if price is not None and not (50 <= price <= 20000):
        price = None
    avail = info["avail"]
    reason = f"available ({avail.rsplit('/', 1)[-1]})" if avail else "product page (no stock data; assumed available)"
    result.update(ok=True, reason=reason, price=price)
    return result


def main():
    to_check = ROOT / "data" / "links_to_check.txt"
    if to_check.exists():  # written by build_data.py: every candidate, including ones not shown yet
        links = sorted({l.strip() for l in to_check.read_text(encoding="utf-8").splitlines() if l.strip()})
    else:
        data = json.loads(DATA.read_text(encoding="utf-8").split("=", 1)[1].rstrip().rstrip(";"))
        links = sorted({p["link"] for p in data["products"] if p.get("link")})
    print(f"Checking {len(links)} links...", file=sys.stderr)
    results = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, (link, res) in enumerate(zip(links, pool.map(check, links)), 1):
            results[link] = res
            if i % 25 == 0 or i == len(links):
                print(f"  {i}/{len(links)} checked", file=sys.stderr)
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
