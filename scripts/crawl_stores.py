#!/usr/bin/env python3
"""Find every in-stock laptop on Lebanese store websites.

Usage: python scripts/crawl_stores.py            (all stores)
       python scripts/crawl_stores.py m2 bassel  (only stores whose name contains these words)

For each store it reads the product list the store publishes for search engines
(its sitemap), opens every page that looks like a laptop, and keeps it only when:
  - the page is a product page that loads,
  - the product name lists a processor (so bags, chargers and parts are skipped),
  - it is a laptop (desktops, all-in-ones and mini PCs are skipped),
  - it is not sold, sold out, out of stock or pre-order.

Writes data/more_stores_crawl.csv (one row per laptop, with specs read from the
product name and description) and adds every page it opened to
data/link_check.json, so build_data.py can show them. Run scripts/build_data.py next.
The same laptop sold by different stores is kept once per store.
"""
import csv
import gzip
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_links import UA, fallback_price, product_info, sold_reason  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_CSV = ROOT / "data" / "more_stores_crawl.csv"
LINK_CHECK = ROOT / "data" / "link_check.json"

STORES = [
    ("PCandParts", "https://pcandparts.com"),
    ("Ayoub Computers", "https://ayoubcomputers.com"),
    ("Mediatech", "https://mediatechlb.com"),
    ("Mojitech", "https://mojitech.net"),
    ("Jak Computer", "https://jakcomputer.com"),
    ("961souq", "https://961souq.com"),
    ("DSLR Zone", "https://www.dslr-zone.com"),
    ("Laptops King", "https://laptopsking.com"),
    ("Mobileleb", "https://mobileleb.com"),
    ("Macrotronics", "https://www.macrotronics.net"),
    ("M2", "https://www.m2.com.lb"),
    ("Options Megastore", "https://optionsmegastore.com"),
    ("Techno Media Trade", "https://technomediatrade.com"),
    ("Bassel Computers", "https://www.basselcomputers.com"),
    ("GoMicroCity", "https://www.gomicrocity.com"),
]

LAPTOP_WORDS = re.compile(
    r"laptop|notebook|macbook|thinkpad|ideapad|legion|\bloq\b|vivobook|zenbook|\brog\b|\btuf\b|omen|victus|pavilion|"
    r"envy|spectre|elitebook|probook|omnibook|zbook|latitude|inspiron|vostro|\bxps\b|alienware|nitro|predator|aspire|"
    r"swift|travelmate|extensa|katana|cyborg|raider|stealth|vector|crosshair|sword|pulse|bravo|\bthin\b|modern|prestige|"
    r"creator|titan|aorus|\baero\b|gigabyte[- ]g[56]|yoga|thinkbook|galaxy[- ]book|surface[- ](laptop|pro|book|go)|"
    r"chromebook|\bgram\b|matebook|razer[- ]blade|dynabook|\bv1[457]\b|proart|expertbook|zephyrus|strix|flow", re.I)
NOT_LAPTOP = re.compile(
    r"desktop|\btower\b|all[- ]in[- ]one|\baio\b|mini[- ]?pc|\bnuc\b|ideacentre|thinkcentre|optiplex|monitor|"
    r"gaming[- ]pc\b|\bbarebone|motherboard|\bbag\b|backpack|sleeve|charger|adapter|battery|cooling[- ]pad|"
    r"replacement|compatible|screen[- ]protector|\bskin\b|keyboard[- ]cover|\bhinge\b|\bfan\b|\blcd\b", re.I)
CPU_HINT = re.compile(r"\bi[3579]\b|i[3579][- ]?\d{4}|ultra[- ]?[3579]|ryzen|core[- ]?[3579]\b|\bm[1-5]\b|snapdragon|"
                      r"celeron|pentium|\bn[12]00\b|i3[- ]n\d{3}|apple", re.I)


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(8_000_000)
        if resp.headers.get("Content-Encoding") == "gzip" or url.endswith(".gz"):
            data = gzip.decompress(data)
        return resp.geturl(), data.decode("utf-8", "replace")


# ---------- sitemaps ----------
def sitemap_urls(base):
    host = urlparse(base).netloc.replace("www.", "")
    start = []
    try:
        _, robots = fetch(base + "/robots.txt", 20)
        start += re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots)
    except Exception:
        pass
    start += [base + p for p in ("/sitemap.xml", "/sitemap_index.xml", "/product-sitemap.xml",
                                 "/wp-sitemap.xml", "/xmlsitemap.php", "/sitemap_products_1.xml")]
    seen, products, queue = set(), set(), list(dict.fromkeys(start))
    while queue and len(seen) < 300:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            _, xml = fetch(sm)
        except Exception:
            continue
        if "<loc" not in xml:
            continue
        locs = [l.strip().replace("&amp;", "&") for l in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>", xml, re.S)]
        if "<sitemapindex" in xml:
            kids = [l for l in locs if re.search(r"product", l, re.I)] or locs
            queue += [urljoin(sm, k) for k in kids]
            continue
        for l in locs:
            u = urljoin(sm, l)
            if urlparse(u).netloc.replace("www.", "") != host:
                continue
            if re.search(r"\.xml(\.gz)?$|sitemap", u, re.I):
                queue.append(u)
            else:
                products.add(u)
    return products


def looks_like_laptop_url(url):
    slug = urlparse(url).path.lower()
    if NOT_LAPTOP.search(slug.replace("-", " ")):
        return False
    return bool(LAPTOP_WORDS.search(slug.replace("-", " ")) or (CPU_HINT.search(slug.replace("-", " ")) and re.search(r"ssd|gb|ram", slug)))


# ---------- specs from the product name ----------
BRANDS = [("alienware", "Dell"), ("macbook", "Apple"), ("apple", "Apple"), ("lenovo", "Lenovo"), ("thinkpad", "Lenovo"),
          ("ideapad", "Lenovo"), ("legion", "Lenovo"), ("hp", "HP"), ("omen", "HP"), ("victus", "HP"), ("dell", "Dell"),
          ("asus", "ASUS"), ("acer", "Acer"), ("msi", "MSI"), ("gigabyte", "Gigabyte"), ("aorus", "Gigabyte"),
          ("microsoft", "Microsoft"), ("surface", "Microsoft"), ("samsung", "Samsung"), ("huawei", "Huawei"),
          ("razer", "Razer"), ("lg", "LG"), ("xiaomi", "Xiaomi"), ("infinix", "Infinix"), ("honor", "Honor"),
          ("chuwi", "Chuwi"), ("toshiba", "Toshiba"), ("dynabook", "Dynabook")]


def brand_of(name):
    low = name.lower()
    for word, brand in BRANDS:
        if re.search(rf"\b{word}\b", low):
            return brand
    return name.split()[0].title() if name.split() else "Other"


def cpu_of(t):
    pats = [
        (r"ryzen\s*ai\s*(max\+?)\s*(?:pro\s*)?(\d{3})?", lambda m: f"AMD Ryzen AI Max+ {m.group(2) or ''}"),
        (r"ryzen\s*ai\s*([3579])\s*(?:hx\s*|h\s*|pro\s*)?(\d{3})?", lambda m: f"AMD Ryzen AI {m.group(1)} {m.group(2) or ''}"),
        (r"ryzen\s*([3579])\s*[- ]?(\d{3,4}[a-z0-9]{0,4})?", lambda m: f"AMD Ryzen {m.group(1)} {m.group(2) or ''}"),
        (r"(?:core\s*)?ultra\s*([3579])\s*[- ]?(\d{3}[a-z]{0,2})?", lambda m: f"Intel Ultra {m.group(1)} {m.group(2) or ''}"),
        (r"\bi([3579])\s*[- ]?\s*n(\d{3})", lambda m: f"Intel Core i{m.group(1)}-N{m.group(2)}"),
        (r"\bi([3579])\s*[- ]\s*(\d{4,5}[a-z]{0,2})\b|\bi([3579])(\d{4,5}[a-z]{0,2})\b",
         lambda m: f"Intel Core i{m.group(1) or m.group(3)}-{(m.group(2) or m.group(4)).upper()}"),
        (r"\bcore\s*(?:tm\s*)?i([3579])\b|\bi([3579])\b", lambda m: f"Intel Core i{m.group(1) or m.group(2)}"),
        (r"\bcore\s*([3579])\s*[- ]?(\d{3}[a-z]{0,2})?\b", lambda m: f"Intel Core {m.group(1)} {m.group(2) or ''}"),
        (r"\b(m[1-5])\s*(pro|max|ultra)?\b(?=.*(?:chip|core|apple|macbook))|apple\s*(m[1-5])\s*(pro|max)?",
         lambda m: f"Apple {(m.group(1) or m.group(3)).upper()} {(m.group(2) or m.group(4) or '').title()}"),
        (r"snapdragon\s*(x\d?\s*(?:elite|plus)?)?", lambda m: "Snapdragon " + (m.group(1) or "")),
        (r"celeron", lambda m: "Intel Celeron"), (r"pentium", lambda m: "Intel Pentium"),
        (r"\bn(100|200|150)\b", lambda m: f"Intel N{m.group(1)}"),
    ]
    for pat, fmt in pats:
        m = re.search(pat, t, re.I)
        if m:
            return re.sub(r"\s+", " ", fmt(m)).strip()
    return None


def gpu_of(t):
    m = re.search(r"rtx\s*(a?\d{4})\s*(ti|super)?", t, re.I)
    if m:
        vram = re.search(r"rtx\s*a?\d{4}\s*(?:ti|super)?\s*(?:laptop\s*gpu\s*)?(\d{1,2})\s*gb", t, re.I)
        return f"RTX {m.group(1).upper()}" + (f" {m.group(2).title() if m.group(2).lower() == 'super' else 'Ti'}" if m.group(2) else "") + (f" {vram.group(1)}GB" if vram else "")
    for pat, fmt in ((r"gtx\s*(\d{3,4})\s*(ti)?", lambda m: f"GTX {m.group(1)}" + (" Ti" if m.group(2) else "")),
                     (r"\bmx\s*(\d{3})", lambda m: f"GeForce MX{m.group(1)}"),
                     (r"radeon\s*rx\s*(\d{4}[a-z]{0,2})", lambda m: f"Radeon RX {m.group(1).upper()}"),
                     (r"\brx\s*(\d{4}[ms]?)\b", lambda m: f"Radeon RX {m.group(1).upper()}"),
                     (r"\barc\s*(a\d{3}m)", lambda m: f"Intel Arc {m.group(1).upper()}")):
        m = re.search(pat, t, re.I)
        if m:
            return fmt(m)
    if re.search(r"\bm[1-5]\b.*(chip|core|gpu)|macbook", t, re.I):
        return "Apple GPU"
    if re.search(r"\barc\b", t, re.I):
        return "Integrated Intel Arc"
    if re.search(r"radeon|ryzen", t, re.I):
        return "Integrated AMD Radeon"
    if re.search(r"adreno|snapdragon", t, re.I):
        return "Integrated Adreno"
    return "Integrated"


RAM_SIZES = {"4", "8", "12", "16", "18", "20", "24", "32", "36", "48", "64", "96", "128"}


def ram_of(t):
    m = re.search(r"(\d{1,3})\s*gb\s*(?:of\s*)?(?:lp)?(?:ddr\d\w*\s*)?(?:ram|memory|unified|ddr|lpddr)", t, re.I)
    if m and m.group(1) in RAM_SIZES:
        return m.group(1) + "GB"
    m = re.search(r"(?:ram|memory)\s*:?\s*(\d{1,3})\s*gb", t, re.I)
    if m and m.group(1) in RAM_SIZES:
        return m.group(1) + "GB"
    for m in re.finditer(r"(\d{1,3})\s*gb(?!\s*(?:ssd|nvme|hdd|emmc|storage|pcie|m\.2|gddr|vram|dedicated))", t, re.I):
        if m.group(1) in RAM_SIZES and not re.search(r"(rtx|gtx|rx|vga|graphics)\s*\S*\s*$", t[:m.start()], re.I):
            return m.group(1) + "GB"
    return None


def storage_of(t):
    m = re.search(r"(\d(?:\.\d)?|\d{3,4})\s*(gb|tb)\s*(?:pcie\s*|gen\s*\d\s*|m\.2\s*)*(ssd|nvme|hdd|emmc|storage)", t, re.I)
    if m:
        kind = "HDD" if m.group(3).lower() == "hdd" else "SSD"
        return f"{m.group(1)}{m.group(2).upper()} {kind}"
    m = re.search(r"\b(1|2|4)\s*tb\b", t, re.I)
    if m:
        return f"{m.group(1)}TB SSD"
    m = re.search(r"\b(128|256|512)\s*gb\b", t, re.I)
    return f"{m.group(1)}GB SSD" if m else None


def screen_of(name):
    m = re.search(r"\b(1[0-8](?:\.\d)?)\s*(?:\"|”|″|''|-?\s*inch|in\b|-inch)", name, re.I)
    if not m:
        return None
    s = f'{m.group(1)}"'
    if re.search(r"oled", name, re.I):
        s += " OLED"
    if re.search(r"touch|x360|2[- ]in[- ]1|flip", name, re.I):
        s += " touch"
    return s


def condition_of(name):
    if re.search(r"open[- ]?box|\bob\b", name, re.I):
        return "Open box"
    if re.search(r"refurb", name, re.I):
        return "Refurbished"
    if re.search(r"\bused\b|like new", name, re.I):
        return "Used"
    return "New"


SPEC_START = re.compile(r"[,(–|]|\s-\s|\b(?:intel|amd|core|ultra|ryzen|i[3579](?:[- ]?\d{4,5}\w*)?|apple\s*m\d|m[1-5]\s*chip|"
                        r"snapdragon|celeron|\d+\s*gb|\d+\s*tb|\d\d(?:\.\d)?\s*(?:\"|”|″|-?inch)|rtx|gtx|nvidia|laptop|notebook)\b", re.I)


def short_model(name, brand):
    n = re.sub(rf"^\s*(buy\s+)?{re.escape(brand)}\s+", "", name.strip(), flags=re.I)
    words = n.split()
    n = re.sub(r"^(laptop|notebook|gaming laptop)\s+", "", n, flags=re.I)
    words = n.split()
    m = SPEC_START.search(n, len(words[0]) if len(words) > 1 else len(n))
    if m:
        n = n[:m.start()]
    n = re.sub(r"\s*(gaming|laptop|notebook|gaming laptop)s?\s*(lebanon|in lebanon)?\s*$", "", n.strip(), flags=re.I)
    return n.strip()[:90] or name[:90]


# ---------- one product page ----------
def inspect(store, url):
    try:
        final, html = fetch(url)
    except urllib.error.HTTPError as e:
        return url, {"ok": False, "reason": f"HTTP {e.code}"}, None
    except Exception as e:
        return url, {"ok": False, "reason": f"unreachable: {type(e).__name__}"}, None
    info = product_info(html)
    name = info["name"] or ""
    if not name:
        h1 = re.search(r"<h1[^>]*class=\"[^\"]*(?:product|title)[^\"]*\"[^>]*>(.*?)</h1>", html, re.I | re.S) \
            or re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
        name = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h1.group(1))).strip() if h1 else ""
    name = name.replace("&amp;", "&").replace("&#8243;", '"').replace("&quot;", '"')
    text = f"{name} {info['description'][:800]}"
    if not name or NOT_LAPTOP.search(name) or not cpu_of(name + " " + info["description"][:300]):
        return final, {"ok": False, "reason": "not a laptop"}, None
    if not (LAPTOP_WORDS.search(name) or LAPTOP_WORDS.search(urlparse(final).path.replace("-", " ")) or screen_of(name)):
        return final, {"ok": False, "reason": "not a laptop"}, None
    why = sold_reason(html, info)
    if why:
        return final, {"ok": False, "reason": why}, None
    price = info["price"] if info["price"] is not None else fallback_price(html)
    if info["currency"] and str(info["currency"]).upper() not in ("USD", "$"):
        price = None
    if price is not None and not (100 <= price <= 20000):
        price = None
    brand = brand_of(name)
    row = {
        "store": store, "brand": brand, "model": short_model(name, brand),
        "cpu": cpu_of(text) or "", "gpu": gpu_of(text), "ram": ram_of(text) or "",
        "storage": storage_of(text) or "", "screen": screen_of(name) or "",
        "price": f"{price:g}" if price else "", "condition": condition_of(name),
        "link": final, "link_is_product": "1",
    }
    reason = f"available ({info['avail'].rsplit('/', 1)[-1]})" if info["avail"] else "product page (no stock data; assumed available)"
    return final, {"ok": True, "reason": reason, "price": price}, row


def main():
    wanted = [a.lower() for a in sys.argv[1:]]
    stores = [s for s in STORES if not wanted or any(w in s[0].lower() for w in wanted)]
    rows, checks = [], {}
    for store, base in stores:
        print(f"{store}: reading product list...", flush=True)
        urls = sorted(u for u in sitemap_urls(base) if looks_like_laptop_url(u))
        if not urls:
            print(f"  {store}: no product list found, skipped", flush=True)
            continue
        print(f"  {len(urls)} possible laptop pages, opening them...", flush=True)
        kept = 0
        with ThreadPoolExecutor(max_workers=8) as pool:
            for i, (final, status, row) in enumerate(pool.map(lambda u: inspect(store, u), urls), 1):
                checks[final] = status
                if row:
                    rows.append(row)
                    kept += 1
                if i % 50 == 0 or i == len(urls):
                    print(f"  {i}/{len(urls)} opened, {kept} in-stock laptops", flush=True)
    # one row per link
    seen, unique = set(), []
    for r in rows:
        k = r["link"].rstrip("/").lower()
        if k not in seen:
            seen.add(k)
            unique.append(r)
    fields = ["store", "brand", "model", "cpu", "gpu", "ram", "storage", "screen", "price", "condition", "link", "link_is_product"]
    if stores != STORES and OUT_CSV.exists():  # partial run: keep the other stores' rows
        done = {s for s, _ in stores}
        with open(OUT_CSV, newline="", encoding="utf-8") as fh:
            unique = [r for r in csv.DictReader(fh) if r["store"] not in done] + unique
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(unique)
    old = json.loads(LINK_CHECK.read_text(encoding="utf-8")) if LINK_CHECK.exists() else {}
    old.update(checks)
    LINK_CHECK.write_text(json.dumps(old, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nDone: {len(unique)} in-stock laptops written to {OUT_CSV.relative_to(ROOT)}; "
          f"{len(checks)} pages recorded in {LINK_CHECK.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
