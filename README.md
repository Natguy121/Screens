# Specs.lb

A searchable spec sheet of laptops and desktop PCs on sale in Lebanon, built from the
`data/Lebanon_Laptops_and_PCs_Oct2026.xlsx` snapshot plus `data/more_stores_Oct2026.csv` (both 5 Oct 2026). Stores covered:
PCandParts (laptops, gaming PCs, all-in-ones, office and mini PCs), Jak Computer, 961souq,
Ayoub Computers, Mojitech, Mediatech, DSLR Zone, Laptops King and Mobileleb.

The extra-store CSVs were collected from web-search listings of each store's pages. Only listings that link
to the product's own page are shown; category-page links, OLX ads and anything marked sold are left out.

Filter by processor family, graphics card, RAM, storage, screen size, brand, store, condition
and price; switch between cards and a sortable table; tick up to four items to compare side by side.

## Run it

It is a static site with no build step for viewing. Open `site/index.html` in a browser,
or serve the folder:

```sh
python3 -m http.server -d site 8000
```

## Update the data

1. Replace the workbook in `data/` (same sheet names and columns), and/or add rows to
   `data/more_stores_Oct2026.csv` (one laptop per row; `link_is_product` is 1 for a product page, 0 for a category page).
2. Regenerate `site/data.js`:

   ```sh
   pip install openpyxl
   python3 scripts/build_data.py            # or: python3 scripts/build_data.py path/to/new.xlsx
   ```

3. Check every link and drop the ones that are not a product page or are sold / out of stock:

   ```sh
   python3 scripts/check_links.py   # writes data/link_check.json
   python3 scripts/build_data.py    # rebuild without the failed links
   ```

   This has to run from a network that can open the store sites.

4. Optional: `python3 scripts/build_single.py` writes `dist/specs-lb.html`, a single-file
   version with the CSS, data and script inlined.

Update `SNAPSHOT` in `scripts/build_data.py` when the prices come from a new date.

## Files

- `site/index.html`, `site/app.css`, `site/app.js`: the page
- `site/data.js`: generated product data (do not edit by hand)
- `scripts/build_data.py`: spreadsheet → `site/data.js`, normalising CPU family, GPU model, RAM/storage sizes and prices
- `scripts/build_single.py`: bundles the site into one HTML file
