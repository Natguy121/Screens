#!/usr/bin/env python3
"""Convert the store spreadsheet into site/data.js.

Usage: python3 scripts/build_data.py [path/to/workbook.xlsx]

Reads the "Laptops (PCandParts)", "Desktops (PCandParts)" and "OLX Lebanon"
sheets, normalises every row into one product shape (CPU family, GPU model,
RAM/storage in GB, price as a number) and writes window.SPECS_DATA.
"""
import csv
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_XLSX = ROOT / "data" / "Lebanon_Laptops_and_PCs_Oct2026.xlsx"
EXTRA_CSVS = sorted((ROOT / "data").glob("more_stores*.csv"))
OUT = ROOT / "site" / "data.js"
SNAPSHOT = "2026-10-05"

KNOWN_BRANDS = ["Apple", "Lenovo", "HP", "Dell", "ASUS", "Acer", "MSI", "Gigabyte", "Alienware", "Intel"]

# Rough ranking used for the "Graphics power" sort. Higher is faster.
GPU_RANK = {
    "RTX 4090": 105, "RTX 3080 Ti": 78, "RTX 3080": 74, "RTX 3070 Ti": 68, "RTX 3070": 66,
    "RTX 3060": 46, "RTX 2060": 36, "RTX 2050": 24, "RX 6700": 62, "RX 6550": 32,
    "GTX 1050": 14, "MX550": 17, "MX330": 12, "RTX A3000": 60,
    "RTX 5090": 110, "RTX 4080": 85, "RTX 4070": 72, "RTX 3050 Ti": 40, "MX450": 16,
    "RTX 5080": 100, "RTX 5070 Ti": 90, "RX 9070 XT": 88, "RTX 5070": 80,
    "RTX 3070": 66, "RTX 2080 Super": 62, "RTX 5060 Ti": 70, "RTX 5060": 64,
    "RTX 4060": 60, "RTX 5050": 55, "RTX 2070": 52, "RTX 4050": 50,
    "RTX 3050": 38, "Radeon 8060S": 58, "MX570": 18,
}


def clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return None if s in ("", "None", "n/a") else s


def gb(text):
    """'1TB SSD' -> 1024, '512GB' -> 512, None if no size."""
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(TB|GB)", text, re.I)
    if not m:
        return None
    n = float(m.group(1))
    return int(n * 1024 if m.group(2).upper() == "TB" else n)


def storage_kind(text):
    if not text:
        return None
    t = text.upper()
    if "HDD" in t:
        return "HDD"
    if "GEN5" in t:
        return "Gen5 NVMe SSD"
    if "NVME" in t:
        return "NVMe SSD"
    if "SSD" in t:
        return "SSD"
    return None


def inches(text):
    if not text:
        return None
    m = re.search(r'(\d{2}(?:\.\d)?)\s*"', text)
    return float(m.group(1)) if m else None


def cpu_info(raw):
    """Return (vendor, family, exact_model_or_None)."""
    s = raw.strip()
    s = re.sub(r"^(Intel|AMD)\s+", "", s)
    up = s.upper()
    if not s:
        return "Other", "Not listed", None
    m = re.match(r"Apple (M\d)", s)
    if m:
        return "Apple", f"Apple {m.group(1)}", None
    if up.startswith("SNAPDRAGON"):
        return "Qualcomm", "Snapdragon X", None
    if up.startswith("CELERON"):
        return "Intel", "Intel Celeron", None
    m = re.match(r"Ryzen AI MAX\+?\s*(\d+)?", s, re.I)
    if m:
        return "AMD", "AMD Ryzen AI Max+", f"Ryzen AI Max+ {m.group(1)}" if m.group(1) else None
    m = re.match(r"Ryzen AI (\d)", s, re.I)
    if m:
        return "AMD", f"AMD Ryzen AI {m.group(1)}", None
    m = re.match(r"Ryzen (\d)\s*(\w+)?", s, re.I)
    if m:
        model = f"Ryzen {m.group(1)} {m.group(2)}" if m.group(2) else None
        return "AMD", f"AMD Ryzen {m.group(1)}", model
    s = re.sub(r"^Core\s+Ultra", "Ultra", s, flags=re.I)
    m = re.match(r"Ultra (\d)\s*([\w-]+)?", s, re.I)
    if m:
        extra = m.group(2)
        model = f"Core Ultra {m.group(1)} {extra}" if extra and re.match(r"\d", extra) else None
        return "Intel", f"Intel Core Ultra {m.group(1)}", model
    m = re.match(r"Core i(\d)(?:-(\w+))?", s, re.I)
    if m:
        model = f"Core i{m.group(1)}-{m.group(2)}" if m.group(2) else None
        return "Intel", f"Intel Core i{m.group(1)}", model
    m = re.match(r"Core (\d)\s*(\w+)?", s, re.I)
    if m:
        model = f"Core {m.group(1)} {m.group(2)}" if m.group(2) and re.match(r"\d", m.group(2)) else None
        return "Intel", f"Intel Core {m.group(1)}", model
    return "Other", s, None


def cpu_display(raw, vendor):
    """Full processor name as the store wrote it, with the vendor in front."""
    s = re.sub(r"^(Intel|AMD)\s+", "", raw.strip())
    s = re.sub(r"^Ultra\b", "Core Ultra", s)
    if not s:
        return "Not listed"
    if vendor in ("Intel", "AMD") and not s.startswith(("Snapdragon",)):
        s = f"{vendor} {s}"
    if vendor == "Qualcomm":
        s = "Qualcomm Snapdragon"
    return s


def gpu_info(raw, cpu_vendor):
    """Return (kind, vendor, short_model, display)."""
    if not raw:
        return "Unknown", None, None, "Not listed"
    s = raw.strip()
    if s.lower().startswith("integrated") or s.lower() == "integrated":
        rest = s[len("Integrated"):].strip()
        if "Arc" in rest:
            return "Integrated", "Intel", "Intel Arc", "Intel Arc (integrated)"
        if "Radeon" in rest:
            return "Integrated", "AMD", "Radeon", "AMD Radeon (integrated)"
        if "Adreno" in rest:
            return "Integrated", "Qualcomm", "Adreno", "Qualcomm Adreno (integrated)"
        return "Integrated", cpu_vendor, None, f"{cpu_vendor} integrated graphics"
    if s.startswith("Apple"):
        return "Integrated", "Apple", "Apple GPU", f"{s} (integrated)"
    if re.search(r"RTX 40 series", s, re.I):
        return "Dedicated", "NVIDIA", "RTX 40 series", "NVIDIA GeForce RTX 40 series (model not listed)"
    if re.search(r"dedicated", s, re.I):
        return "Dedicated", None, None, s.replace("dedicated", "dedicated card")
    vram = re.search(r"(\d+)\s*GB", s)
    m = re.search(r"RTX\s*(\d{4})\s*(Ti|Super)?", s, re.I)
    if m:
        short = f"RTX {m.group(1)}" + (f" {m.group(2).title() if m.group(2).lower()=='super' else 'Ti'}" if m.group(2) else "")
        disp = f"NVIDIA GeForce {short}" + (f" {vram.group(1)}GB" if vram else "")
        return "Dedicated", "NVIDIA", short, disp
    m = re.search(r"MX\s*(\d+)", s)
    if m:
        return "Dedicated", "NVIDIA", f"MX{m.group(1)}", f"NVIDIA GeForce MX{m.group(1)}"
    m = re.search(r"Radeon\s*(?:RX\s*)?(\d{4})\s*(XT)?", s, re.I)
    if m:
        short = f"RX {m.group(1)}" + (" XT" if m.group(2) else "")
        return "Dedicated", "AMD", short, f"AMD Radeon {short}"
    return "Dedicated", None, s, s


def brand_from_text(text):
    t = text.upper()
    if "ALIENWARE" in t:
        return "Dell"
    if "NUC" in t and t.startswith("INTEL"):
        return "Intel"
    for b in KNOWN_BRANDS:
        if re.search(rf"\b{b.upper()}\b", t):
            return b
    return None


def norm_brand(b):
    b = b.strip()
    if b.lower() == "asus":
        return "ASUS"
    if b.startswith("HyperX"):
        return "HP"
    return b


def gpu_rank(short, kind):
    if short in GPU_RANK:
        return GPU_RANK[short]
    if kind == "Integrated":
        return 10
    return 30 if kind == "Dedicated" else 0


def finish(p):
    raw = p.pop("cpu_raw")
    vendor, fam, exact = cpu_info(raw)
    p["cpuVendor"], p["cpuFamily"] = vendor, fam
    p["cpuModel"] = exact
    p["cpu"] = cpu_display(raw, vendor)
    kind, gvendor, gshort, gdisp = gpu_info(p.pop("gpu_raw"), vendor)
    if p["name"].startswith("ROG Flow Z13"):
        gshort, gdisp = "Radeon 8060S", "AMD Radeon 8060S (integrated)"
    p["gpuKind"], p["gpuVendor"], p["gpuModel"], p["gpu"] = kind, gvendor, gshort, gdisp
    p["gpuRank"] = gpu_rank(gshort, kind)
    p["ramGB"] = gb(p.get("ram"))
    p["storageGB"] = gb(p.get("storage"))
    p["storageType"] = storage_kind(p.get("storage"))
    return p


def laptops(ws):
    out = []
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True)):
        brand, model, cpu, gpu, ram, storage, screen, price, cat, link, note = (list(r) + [None] * 11)[:11]
        if not brand:
            continue
        name = clean(model)
        if str(brand).startswith("HyperX"):
            name = f"HyperX {name}"
        p = {
            "id": f"pcp-l-{i+1}",
            "form": "Laptop",
            "use": "Gaming" if "Gaming" in (cat or "") else "Everyday & Business",
            "brand": norm_brand(brand),
            "name": name,
            "cpu_raw": clean(cpu) or "",
            "gpu_raw": clean(gpu),
            "ram": clean(ram),
            "storage": clean(storage),
            "screen": clean(screen),
            "screenIn": inches(clean(screen)),
            "touch": "touch" in (screen or "").lower(),
            "oled": "oled" in (screen or "").lower(),
            "extras": None,
            "price": float(price) if isinstance(price, (int, float)) else None,
            "store": "PCandParts",
            "seller": "PCandParts",
            "condition": "New",
            "link": clean(link),
            "linkIsListing": True,
            "note": clean(note),
        }
        out.append(finish(p))
    return out


DESKTOP_FORM = {
    "Gaming PC": "Gaming PC",
    "All-in-One": "All-in-One",
    "Office tower": "Office PC",
    "Small form factor": "Office PC",
    "Mini PC": "Mini PC",
    "Mini PC (barebone)": "Mini PC",
}


def desktops(ws):
    out = []
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True)):
        name, typ, cpu, gpu, ram, storage, extras, price, link, note = (list(r) + [None] * 10)[:10]
        if not name:
            continue
        typ = clean(typ)
        brand = brand_from_text(name) or "Custom build"
        display = name
        if brand != "Custom build" and name.upper().startswith(brand.upper() + " "):
            display = name[len(brand) + 1:]
        extras = clean(extras)
        screen = extras if typ == "All-in-One" else None
        barebone = (clean(ram) or "").lower() == "barebone"
        p = {
            "id": f"pcp-d-{i+1}",
            "form": DESKTOP_FORM.get(typ, typ),
            "subtype": typ,
            "use": "Gaming" if typ == "Gaming PC" else "Everyday & Business",
            "brand": brand,
            "name": display,
            "cpu_raw": clean(cpu) or "",
            "gpu_raw": clean(gpu),
            "ram": "Not included (barebone)" if barebone else clean(ram),
            "storage": "Not included (barebone)" if barebone else clean(storage),
            "screen": screen,
            "screenIn": inches(screen),
            "touch": "touch" in (screen or "").lower(),
            "oled": False,
            "extras": None if screen else extras,
            "price": float(price) if isinstance(price, (int, float)) else None,
            "store": "PCandParts",
            "seller": "PCandParts",
            "condition": "New",
            "link": clean(link),
            "linkIsListing": True,
            "note": clean(note),
        }
        if barebone:
            p["ram_none"] = True
        out.append(finish(p))
    for p in out:
        if p.pop("ram_none", False):
            p["ramGB"] = None
            p["storageGB"] = None
    return out


OLX_FORM = {"Laptop": "Laptop", "Gaming PC": "Gaming PC", "All-in-One": "All-in-One"}


def olx(ws):
    out = []
    for i, r in enumerate(ws.iter_rows(min_row=2, values_only=True)):
        title, typ, cpu, gpu, ramsto, price, seller, page, note = (list(r) + [None] * 9)[:9]
        if not title:
            continue
        ramsto = clean(ramsto)
        ram = storage = None
        if ramsto:
            parts = [x.strip() for x in ramsto.split("/")]
            ram = parts[0]
            storage = parts[1] if len(parts) > 1 else None
        t = title.upper()
        if "OPEN BOX" in t:
            cond = "Open box"
        elif "NEW" in t or "SEALED" in t:
            cond = "New"
        elif note and "used" in note.lower():
            cond = "Used"
        else:
            cond = "Not stated"
        price_num = None
        m = re.search(r"([\d,]+)", str(price or ""))
        if m and "USD" in str(price):
            price_num = float(m.group(1).replace(",", ""))
        form = OLX_FORM.get(clean(typ), clean(typ))
        p = {
            "id": f"olx-{i+1}",
            "form": form,
            "use": None,
            "brand": brand_from_text(title) or ("Custom build" if form == "Gaming PC" else "Unbranded"),
            "name": title.strip(),
            "cpu_raw": clean(cpu) or "",
            "gpu_raw": clean(gpu),
            "ram": ram,
            "storage": storage,
            "screen": None,
            "screenIn": inches(title),
            "touch": False,
            "oled": False,
            "extras": None,
            "price": price_num,
            "store": "OLX Lebanon",
            "seller": clean(seller),
            "condition": cond,
            "link": clean(page),
            "linkIsListing": False,
            "note": clean(note),
        }
        if p["screenIn"]:
            p["screen"] = f'{p["screenIn"]:g}"'
        p = finish(p)
        p["use"] = "Gaming" if p["gpuKind"] == "Dedicated" and form != "All-in-One" else "Everyday & Business"
        out.append(p)
    return out


def extra_stores(paths, seen_links):
    """Laptops from other Lebanese stores, collected into CSVs. Skips links already listed."""
    out = []
    rows = []
    for path in paths:
        with open(path, newline="", encoding="utf-8") as fh:
            rows += list(csv.DictReader(fh))
    for i, r in enumerate(rows):
            link = (r["link"] or "").strip()
            # Only rows whose link opens the product itself; category pages and
            # hidden products (?showHidden) are left out.
            if r["link_is_product"].strip() != "1" or "showhidden" in link.lower():
                continue
            key = link.rstrip("/").lower()
            if key in seen_links:
                continue
            seen_links.add(key)
            screen = clean(r["screen"])
            price = clean(r["price"])
            p = {
                "id": "ext-" + str(i + 1),
                "form": "Laptop",
                "use": None,
                "brand": r["brand"].strip(),
                "name": r["model"].strip(),
                "cpu_raw": clean(r["cpu"]) or "",
                "gpu_raw": clean(r["gpu"]),
                "ram": clean(r["ram"]),
                "storage": clean(r["storage"]),
                "screen": screen,
                "screenIn": inches(screen),
                "touch": "touch" in (screen or "").lower(),
                "oled": "oled" in (screen or "").lower(),
                "extras": None,
                "price": float(price) if price else None,
                "store": r["store"].strip(),
                "seller": r["store"].strip(),
                "condition": r["condition"].strip() or "New",
                "link": clean(r["link"]),
                "linkIsListing": r["link_is_product"].strip() == "1",
                "note": None if r["link_is_product"].strip() == "1" else "Link opens the store's category page; search the model name there.",
            }
            p = finish(p)
            p["use"] = "Gaming" if p["gpuKind"] == "Dedicated" and p["gpuRank"] >= 38 else "Everyday & Business"
            out.append(p)
    return out


LINK_CHECK = ROOT / "data" / "link_check.json"


def apply_link_check(products):
    """Drop products that scripts/check_links.py marked as not a product page or sold out."""
    if not LINK_CHECK.exists():
        return products, 0
    status = json.loads(LINK_CHECK.read_text(encoding="utf-8"))
    keep = [p for p in products if status.get(p.get("link") or "", {}).get("ok", True)]
    return keep, len(products) - len(keep)


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    products = (
        laptops(wb["Laptops (PCandParts)"])
        + desktops(wb["Desktops (PCandParts)"])
    )
    # OLX rows are left out: their links open an OLX search page, not the ad itself.
    seen = {(p["link"] or "").rstrip("/").lower() for p in products if p.get("link")}
    products += extra_stores(EXTRA_CSVS, seen)
    products, dropped = apply_link_check(products)
    if dropped:
        print(f"Left out {dropped} listings whose link failed scripts/check_links.py")
    notes = []
    if "Read me" in wb.sheetnames:
        notes = [str(r[0]).strip() for r in wb["Read me"].iter_rows(values_only=True) if r and r[0]]
        notes = [n for n in notes if not n.startswith("OLX listings may already")]
    notes += [
        "Jak Computer, 961souq, Ayoub Computers, Mojitech, Mediatech, DSLR Zone, Laptops King and Mobileleb rows, and the extra PCandParts laptops (data/more_stores_*.csv), were collected on 5 Oct 2026 from web-search listings of those stores' pages, since the store sites could not be opened directly. Some prices may be out of date and some specs (RAM, storage) were not shown; check the store before buying.",
    ]
    notes = [n for n in notes if not n.startswith("OLX rows:")]
    notes.append("Every listing links to the product's own page. Listings that only linked to a category or search page (including all OLX ads) and products marked sold or out of stock are left out.")
    payload = {"snapshot": SNAPSHOT, "currency": "USD", "notes": notes, "products": products}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by scripts/build_data.py from data/*.xlsx. Do not edit by hand.\n"
        "window.SPECS_DATA = " + json.dumps(payload, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(products)} products to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
