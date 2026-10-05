#!/usr/bin/env python3
"""Bundle site/ into one self-contained HTML fragment at dist/specs-lb.html.

The fragment has no <html>/<head>/<body> wrapper so it can be published as a
hosted page that adds its own skeleton. For normal hosting, serve site/ as-is.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "dist" / "specs-lb.html"

html = (SITE / "index.html").read_text(encoding="utf-8")
title = re.search(r"<title>.*?</title>", html, re.S).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]+>', html).group(0)
body = html.split("<!--BODY-START-->")[1].split("<!--BODY-END-->")[0]
css = (SITE / "app.css").read_text(encoding="utf-8")
data = (SITE / "data.js").read_text(encoding="utf-8")
app = (SITE / "app.js").read_text(encoding="utf-8")

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(
    f"{title}\n{fonts}\n<style>\n{css}</style>\n{body}\n<script>\n{data}</script>\n<script>\n{app}</script>\n",
    encoding="utf-8",
)
print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
