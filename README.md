# Specs.lb

A searchable spec sheet of laptops and desktop PCs on sale in Lebanon, built from the
`data/Lebanon_Laptops_and_PCs_Oct2026.xlsx` snapshot (5 Oct 2026). Stores covered:
PCandParts (laptops, gaming PCs, all-in-ones, office and mini PCs) and OLX Lebanon listings.

Filter by processor family, graphics card, RAM, storage, screen size, brand, store, condition
and price; switch between cards and a sortable table; tick up to four items to compare side by side.

## Run it

It is a static site with no build step for viewing. Open `site/index.html` in a browser,
or serve the folder:

```sh
python3 -m http.server -d site 8000
```

## Update the data

1. Replace the workbook in `data/` (same sheet names and columns).
2. Regenerate `site/data.js`:

   ```sh
   pip install openpyxl
   python3 scripts/build_data.py            # or: python3 scripts/build_data.py path/to/new.xlsx
   ```

3. Optional: `python3 scripts/build_single.py` writes `dist/specs-lb.html`, a single-file
   version with the CSS, data and script inlined.

Update `SNAPSHOT` in `scripts/build_data.py` when the prices come from a new date.

## Files

- `site/index.html`, `site/app.css`, `site/app.js`: the page
- `site/data.js`: generated product data (do not edit by hand)
- `scripts/build_data.py`: spreadsheet → `site/data.js`, normalising CPU family, GPU model, RAM/storage sizes and prices
- `scripts/build_single.py`: bundles the site into one HTML file
