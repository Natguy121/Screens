(function () {
  "use strict";

  const DATA = window.SPECS_DATA || { products: [], notes: [] };
  const ALL = DATA.products;
  const MAX_COMPARE = 4;

  const FORMS = ["All", "Laptop", "Gaming PC", "All-in-One", "Office PC", "Mini PC"];
  const FORM_LABEL = { All: "Everything", Laptop: "Laptops", "Gaming PC": "Gaming PCs", "All-in-One": "All-in-Ones", "Office PC": "Office PCs", "Mini PC": "Mini PCs" };
  const RAM_STEPS = [0, 8, 16, 32, 64];
  const STORAGE_STEPS = [0, 256, 512, 1024, 2048];
  const SCREENS = [
    { id: "any", label: "Any" },
    { id: "s", label: "Up to 14\"", test: (n) => n <= 14.5 },
    { id: "m", label: "15–16\"", test: (n) => n > 14.5 && n <= 16.5 },
    { id: "l", label: "17\" and up", test: (n) => n > 16.5 },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const fullName = (p) => (p.brand === "Custom build" || p.brand === "Unbranded" ? p.name : p.brand + " " + p.name);
  const sizeLabel = (gb) => (gb >= 1024 ? gb / 1024 + "TB" : gb + "GB");

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { return null; }
  }

  const blank = () => ({
    q: "", form: "All", stores: new Set(), brands: new Set(), cpus: new Set(), gpus: new Set(),
    uses: new Set(), conds: new Set(), gpuKind: "any", ramMin: 0, storageMin: 0, screen: "any",
    pmin: null, pmax: null, pricedOnly: false, steals: false, favs: false, game: null, oled: false, apple: null,
  });
  let S = blank();
  let sort = "price-asc";
  let view = store("specs.view") === "table" ? "table" : "cards";
  let tableSort = null; // {key, dir}
  const compare = [];
  const favs = new Set((() => { try { return JSON.parse(store("specs.favs") || "[]"); } catch (e) { return []; } })());
  const saveFavs = () => store("specs.favs", JSON.stringify([...favs]));

  // ---------- filtering ----------
  function haystack(p) {
    return [p.brand, p.name, p.cpu, p.cpuFamily, p.gpu, p.gpuModel, p.ram, p.storage, p.screen, p.form, p.seller, p.extras].join(" ").toLowerCase();
  }
  ALL.forEach((p) => { p._hay = haystack(p); });

  // ---------- fun: power meter + steals ----------
  const MAX_RANK = Math.max(1, ...ALL.map((p) => p.gpuRank || 0));
  const TIERS = [
    [0, "🤷", "Mystery", "unknown"], [11, "🥔", "Potato", "t0"], [40, "🚲", "Casual", "t1"],
    [64, "🏎️", "Solid", "t2"], [90, "🔥", "Beast", "t3"], [999, "🐉", "Monster", "t4"],
  ];
  function tier(p) {
    const r = p.gpuRank || 0;
    if (!r) return TIERS[0];
    return TIERS.slice(1).find((t) => r < t[0]) || TIERS[TIERS.length - 1];
  }
  // A "steal" costs at least 20% less than the median of laptops with the same graphics and RAM.
  (function markSteals() {
    const groups = new Map();
    ALL.forEach((p) => {
      if (p.price == null || !p.ramGB) return;
      const k = (p.gpuModel || p.cpuFamily || "?") + "|" + p.ramGB + "|" + p.condition;
      (groups.get(k) || groups.set(k, []).get(k)).push(p);
    });
    groups.forEach((list) => {
      if (list.length < 5) return;
      const ps = list.map((p) => p.price).sort((a, b) => a - b);
      const med = ps[Math.floor(ps.length / 2)];
      list.forEach((p) => { if (p.price <= med * 0.8) { p.steal = true; p.saveVsMedian = Math.round(med - p.price); } });
    });
  })();

  function matches(p, skip) {
    if (S.q) {
      const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => p._hay.includes(w))) return false;
    }
    if (skip !== "form" && S.form !== "All" && p.form !== S.form) return false;
    if (S.steals && !p.steal) return false;
    if (S.favs && !favs.has(p.id)) return false;
    if (S.oled && !p.oled) return false;
    if (S.apple === "only" && p.cpuVendor !== "Apple") return false;
    if (S.apple === "no" && p.cpuVendor === "Apple") return false;
    if (S.game && !((p.gpuRank || 0) >= S.game.good && !(p.cpuVendor === "Apple" && S.game.pcOnly))) return false;
    if (skip !== "store" && S.stores.size && !S.stores.has(p.store)) return false;
    if (skip !== "brand" && S.brands.size && !S.brands.has(p.brand)) return false;
    if (skip !== "cpu" && S.cpus.size && !S.cpus.has(p.cpuFamily)) return false;
    if (skip !== "gpu" && S.gpus.size && !S.gpus.has(p.gpuModel)) return false;
    if (skip !== "use" && S.uses.size && !S.uses.has(p.use)) return false;
    if (skip !== "cond" && S.conds.size && !S.conds.has(p.condition)) return false;
    if (S.gpuKind !== "any" && p.gpuKind !== S.gpuKind) return false;
    if (S.ramMin && !(p.ramGB >= S.ramMin)) return false;
    if (S.storageMin && !(p.storageGB >= S.storageMin)) return false;
    if (S.screen !== "any") {
      const rule = SCREENS.find((s) => s.id === S.screen);
      if (!(p.screenIn && rule.test(p.screenIn))) return false;
    }
    if (S.pricedOnly && p.price == null) return false;
    if (S.pmin != null && !(p.price != null && p.price >= S.pmin)) return false;
    if (S.pmax != null && !(p.price != null && p.price <= S.pmax)) return false;
    return true;
  }

  const SORTS = {
    "price-asc": (a, b) => nullLast(a.price, b.price, 1),
    "price-desc": (a, b) => nullLast(a.price, b.price, -1),
    gpu: (a, b) => b.gpuRank - a.gpuRank || nullLast(a.price, b.price, 1),
    ram: (a, b) => nullLast(a.ramGB, b.ramGB, -1) || nullLast(a.price, b.price, 1),
    storage: (a, b) => nullLast(a.storageGB, b.storageGB, -1) || nullLast(a.price, b.price, 1),
    name: (a, b) => fullName(a).localeCompare(fullName(b)),
  };
  function nullLast(x, y, dir) {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  }

  // ---------- facets ----------
  function count(list, key) {
    const m = new Map();
    list.forEach((p) => { const k = p[key]; if (k != null) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  }

  function renderChecks(el, set, values, counts, labelFn) {
    el.innerHTML = values.map((v) => {
      const n = counts.get(v) || 0;
      const id = el.id + "-" + String(v).replace(/[^\w]+/g, "_");
      return `<label class="check${n ? "" : " zero"}" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-v="${esc(v)}"${set.has(v) ? " checked" : ""}><span class="lbl">${labelFn ? labelFn(v) : esc(v)}</span><span class="n">${n}</span></label>`;
    }).join("");
  }

  function renderSeg(el, items, current) {
    el.innerHTML = items.map((it) => `<button type="button" data-v="${esc(it.v)}" aria-pressed="${String(it.v) === String(current)}">${esc(it.label)}</button>`).join("");
  }

  const uniq = (key) => [...new Set(ALL.map((p) => p[key]).filter((v) => v != null))];
  const BRANDS = uniq("brand").sort((a, b) => (a === "Custom build" || a === "Unbranded") - (b === "Custom build" || b === "Unbranded") || a.localeCompare(b));
  const STORES = uniq("store");
  const USES = ["Gaming", "Everyday & Business"];
  const CONDS = ["New", "Open box", "Used", "Not stated"].filter((c) => ALL.some((p) => p.condition === c));
  const CPU_ORDER = (f) => {
    const m = f.match(/(\d)/);
    return m ? +m[1] : 0;
  };
  const CPUS = uniq("cpuFamily").sort((a, b) => {
    const va = a.split(" ")[0], vb = b.split(" ")[0];
    return va.localeCompare(vb) || a.replace(/\d.*/, "").localeCompare(b.replace(/\d.*/, "")) || CPU_ORDER(b) - CPU_ORDER(a);
  });
  const GPUS = (() => {
    const best = new Map();
    ALL.forEach((p) => { if (p.gpuModel) best.set(p.gpuModel, Math.max(best.get(p.gpuModel) || 0, p.gpuRank)); });
    return [...best.keys()].sort((a, b) => best.get(b) - best.get(a) || a.localeCompare(b));
  })();
  const gpuVendorOf = (m) => (ALL.find((p) => p.gpuModel === m) || {}).gpuVendor;
  const gpuLabel = (m) => {
    const p = ALL.find((x) => x.gpuModel === m);
    const integ = p && p.gpuKind === "Integrated";
    const name = integ ? (m === "Radeon" ? "AMD Radeon" : m === "Adreno" ? "Qualcomm Adreno" : m) : m;
    return `<span class="pip ${esc(gpuVendorOf(m) || "")}"></span>${esc(name)}${integ ? ' <span class="dim">(integrated)</span>' : ""}`;
  };

  function renderFacets() {
    const forFacet = (skip) => ALL.filter((p) => matches(p, skip));
    renderChecks($("f-brand"), S.brands, BRANDS, count(forFacet("brand"), "brand"));
    renderChecks($("f-store"), S.stores, STORES, count(forFacet("store"), "store"));
    renderChecks($("f-use"), S.uses, USES, count(forFacet("use"), "use"));
    renderChecks($("f-cond"), S.conds, CONDS, count(forFacet("cond"), "condition"));

    const cpuCounts = count(forFacet("cpu"), "cpuFamily");
    const groups = ["Intel", "AMD", "Apple", "Qualcomm", "Other"];
    $("f-cpu").innerHTML = "";
    groups.forEach((g) => {
      const fams = CPUS.filter((f) => (ALL.find((p) => p.cpuFamily === f) || {}).cpuVendor === g);
      if (!fams.length) return;
      const wrap = document.createElement("div");
      wrap.className = "fbody";
      wrap.id = "f-cpu-" + g;
      renderChecks(wrap, S.cpus, fams, cpuCounts, (f) => `<span class="pip ${g}"></span>${esc(f.replace(/^(Intel|AMD) /, ""))}`);
      const h = document.createElement("div");
      h.className = "sub";
      h.textContent = g;
      $("f-cpu").append(h, wrap);
    });

    renderChecks($("f-gpu"), S.gpus, GPUS, count(forFacet("gpu"), "gpuModel"), gpuLabel);
    renderSeg($("gpukind"), [{ v: "any", label: "Any" }, { v: "Dedicated", label: "Dedicated card" }, { v: "Integrated", label: "Integrated" }], S.gpuKind);
    renderSeg($("ram"), RAM_STEPS.map((v) => ({ v, label: v ? v + "GB+" : "Any" })), S.ramMin);
    renderSeg($("storage"), STORAGE_STEPS.map((v) => ({ v, label: v ? sizeLabel(v) + "+" : "Any" })), S.storageMin);
    renderSeg($("screen"), SCREENS.map((s) => ({ v: s.id, label: s.label })), S.screen);

    const formCounts = count(ALL.filter((p) => matches(p, "form")), "form");
    $("tabs").innerHTML = FORMS.map((f) => {
      const n = f === "All" ? [...formCounts.values()].reduce((a, b) => a + b, 0) : formCounts.get(f) || 0;
      return `<button type="button" class="tab" data-v="${esc(f)}" aria-pressed="${S.form === f}">${esc(FORM_LABEL[f])}<span class="n">${n}</span></button>`;
    }).join("");
  }

  // ---------- results ----------
  function specRows(p) {
    const rows = [
      ["CPU", esc(p.cpu)],
      ["GPU", `<span class="pip ${esc(p.gpuVendor || "")}"></span>${esc(p.gpu)}`],
      ["RAM", p.ram ? esc(p.ram) : '<span class="dim">Not listed</span>'],
      ["Storage", p.storage ? esc(p.storage) : '<span class="dim">Not listed</span>'],
    ];
    if (p.screen) rows.push(["Screen", esc(p.screen)]);
    else if (p.form === "Laptop") rows.push(["Screen", '<span class="dim">Not listed</span>']);
    if (p.extras) rows.push([p.form === "Gaming PC" ? "Build" : "Extras", esc(p.extras)]);
    return rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  const LBP_RATE = 89500;
  let currency = store("specs.cur") === "LBP" ? "LBP" : "USD";
  const lbp = (usd) => { const v = usd * LBP_RATE; return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + "M" : Math.round(v / 1000) + "K"; };
  function priceHTML(p) {
    return p.price != null
      ? `<div class="price"><small>${currency === "LBP" ? "LL" : "USD"}</small>${currency === "LBP" ? lbp(p.price) : Math.round(p.price).toLocaleString("en-US")}<span class="mana" title="At about $1.25 per za'atar manoushe">≈ ${Math.round(p.price / 1.25).toLocaleString("en-US")} manakish 🫓</span></div>`
      : `<div class="price none">Price on the ad</div>`;
  }

  function linkHTML(p) {
    if (!p.link) return "";
    const label = p.linkIsListing ? `View at ${p.store}` : p.store === "OLX Lebanon" ? "Open OLX search" : `Find at ${p.store}`;
    return `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  }

  function olxHTML(p) {
    if (p.store === "OLX") return "";
    const q = `${p.brand} ${p.name}`.replace(/\(.*?\)/g, " ").replace(/[^\w\s.+-]/g, " ").trim().split(/\s+/).slice(0, 5).join(" ");
    const url = "https://www.olx.com.lb/ads/q-" + encodeURIComponent(q.toLowerCase().replace(/\s+/g, "-")) + "/";
    return `<a class="olx" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Search on OLX ↗</a>`;
  }

  function olxEmpty() {
    const q = S.q.replace(/\bolx\b/gi, "").trim();
    const url = q ? "https://www.olx.com.lb/ads/q-" + encodeURIComponent(q.toLowerCase().replace(/\s+/g, "-")) + "/" : "https://www.olx.com.lb/computers-accessories/";
    return `<p style="margin-top:14px">Used laptops from people are on OLX, not on this site. Each laptop here has a <b>Search on OLX</b> button.</p><p><a class="olx-big" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${q ? `Search OLX for “${esc(q)}”` : "Open laptops on OLX"} ↗</a></p>`;
  }

  function badges(p) {
    const b = [];
    if (p.steal) b.push(`<span class="badge steal" title="About $${p.saveVsMedian} below similar laptops">🔥 Steal</span>`);
    if (p.use === "Gaming") b.push('<span class="badge gaming">Gaming</span>');
    if (p.subtype && p.subtype !== p.form && p.subtype !== "Gaming PC") b.push(`<span class="badge">${esc(p.subtype)}</span>`);
    if (p.oled) b.push('<span class="badge">OLED</span>');
    if (p.touch) b.push('<span class="badge">Touch</span>');
    if (p.condition !== "New") b.push(`<span class="badge cond">${esc(p.condition)}</span>`);
    return b.join("");
  }

  function powerHTML(p) {
    const [, emo, label, cls] = tier(p);
    const pct = p.gpuRank ? Math.max(6, Math.round((p.gpuRank / MAX_RANK) * 100)) : 0;
    return `<div class="power ${cls}" title="Gaming power, from the graphics card">
      <span class="pw-lbl">Gaming power</span>
      <span class="pw-bar"><i style="--w:${pct}%"></i></span>
      <span class="pw-tier">${emo} ${label}</span></div>`;
  }

  function card(p) {
    const picked = compare.includes(p.id);
    return `<article class="card${picked ? " picked" : ""}">
      <div class="card-top">
        <div class="eyebrow"><span class="who">${esc(p.brand)} · ${esc(p.form)}</span>
          <span class="acts"><button type="button" class="ico-btn" data-detail="${p.id}" aria-label="Details" title="Details: what it can run, similar deals">ℹ️</button><button type="button" class="ico-btn fav" data-fav="${p.id}" aria-pressed="${favs.has(p.id)}" aria-label="Save to favourites" title="Save to favourites">${favs.has(p.id) ? "❤️" : "🤍"}</button><button type="button" class="ico-btn" data-share="${p.id}" aria-label="Share" title="Share this laptop">🔗</button>
          <label class="cmp" for="c-${p.id}"><input type="checkbox" id="c-${p.id}" data-cmp="${p.id}"${picked ? " checked" : ""}>Compare</label></span></div>
        <h3><button type="button" class="title-btn" data-detail="${p.id}">${esc(p.name)}</button></h3>
        <div class="badges">${badges(p)}</div>
      </div>
      <dl class="specs">${specRows(p)}</dl>
      ${powerHTML(p)}
      <div class="card-foot">${priceHTML(p)}<div class="where"><span class="seller">${esc(p.store === "OLX Lebanon" ? "OLX · " + (p.seller || "") : p.store)}</span>${linkHTML(p)}${olxHTML(p)}</div></div>
      ${p.note ? `<div class="card-foot" style="border-top:1px dashed var(--line);padding-top:8px"><span class="dim" style="font-size:var(--step--1)">${esc(p.note)}</span></div>` : ""}
    </article>`;
  }

  const COLS = [
    { key: "name", label: "Model", get: (p) => fullName(p), cell: (p) => `<span class="model">${esc(fullName(p))}</span><span class="model-sub">${esc(p.form)}${p.condition !== "New" ? " · " + esc(p.condition) : ""}</span>` },
    { key: "cpu", label: "Processor", get: (p) => p.cpu, cell: (p) => esc(p.cpu) },
    { key: "gpu", label: "Graphics", get: (p) => p.gpuRank, cell: (p) => `<span class="pip ${esc(p.gpuVendor || "")}"></span>${esc(p.gpu)}` },
    { key: "ram", label: "RAM", num: true, get: (p) => p.ramGB, cell: (p) => (p.ramGB ? p.ramGB + "GB" : '<span class="dim">–</span>') },
    { key: "storage", label: "Storage", get: (p) => p.storageGB, cell: (p) => (p.storage ? esc(p.storage) : '<span class="dim">–</span>') },
    { key: "screen", label: "Screen", get: (p) => p.screenIn, cell: (p) => (p.screen ? esc(p.screen) : '<span class="dim">–</span>') },
    { key: "store", label: "Store", get: (p) => p.store, cell: (p) => (p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${esc(p.store === "OLX Lebanon" ? "OLX" : p.store)} ↗</a>` : esc(p.store)) + (p.store === "OLX Lebanon" && p.seller ? `<span class="model-sub">${esc(p.seller)}</span>` : "") },
    { key: "price", label: "Price", num: true, get: (p) => p.price, cell: (p) => (p.price != null ? money(p.price) : '<span class="dim">on ad</span>') },
  ];

  function table(list) {
    if (tableSort) {
      const col = COLS.find((c) => c.key === tableSort.key);
      list = list.slice().sort((a, b) => {
        const x = col.get(a), y = col.get(b);
        if (typeof x === "string" || typeof y === "string") return String(x || "").localeCompare(String(y || "")) * tableSort.dir;
        return nullLast(x, y, tableSort.dir);
      });
    }
    const head = COLS.map((c) => {
      const arrow = tableSort && tableSort.key === c.key ? (tableSort.dir > 0 ? " ↑" : " ↓") : "";
      return `<th class="${c.num ? "num" : ""}" scope="col"><button type="button" data-tsort="${c.key}">${c.label}${arrow}</button></th>`;
    }).join("");
    const rows = list.map((p) => `<tr><td><input type="checkbox" aria-label="Compare ${esc(p.name)}" data-cmp="${p.id}"${compare.includes(p.id) ? " checked" : ""}></td>${COLS.map((c) => `<td class="${c.num ? "num" : ""}">${c.cell(p)}</td>`).join("")}</tr>`).join("");
    return `<div class="tablewrap"><table><thead><tr><th scope="col"><span class="dim">Cmp</span></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function summary(list) {
    const prices = list.map((p) => p.price).filter((n) => n != null).sort((a, b) => a - b);
    let s = `<b>${list.length}</b> of ${ALL.length} listings`;
    if (prices.length) {
      const med = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
      s += ` · <b>${money(prices[0])}</b> to <b>${money(prices[prices.length - 1])}</b> · median <b>${money(med)}</b>`;
    }
    return s;
  }

  function chips() {
    const out = [];
    const add = (label, clear) => out.push({ label, clear });
    if (S.q) add(`“${S.q}”`, () => { S.q = ""; $("q").value = ""; });
    if (S.form !== "All") add(FORM_LABEL[S.form], () => { S.form = "All"; });
    [["stores", "Store"], ["brands", ""], ["cpus", ""], ["gpus", ""], ["uses", ""], ["conds", ""]].forEach(([k]) => {
      S[k].forEach((v) => add(v, () => S[k].delete(v)));
    });
    if (S.gpuKind !== "any") add(S.gpuKind === "Dedicated" ? "Dedicated graphics" : "Integrated graphics", () => { S.gpuKind = "any"; });
    if (S.ramMin) add(`RAM ${S.ramMin}GB+`, () => { S.ramMin = 0; });
    if (S.storageMin) add(`Storage ${sizeLabel(S.storageMin)}+`, () => { S.storageMin = 0; });
    if (S.screen !== "any") add(SCREENS.find((s) => s.id === S.screen).label, () => { S.screen = "any"; });
    if (S.pmin != null) add(`From ${money(S.pmin)}`, () => { S.pmin = null; $("pmin").value = ""; });
    if (S.pmax != null) add(`Up to ${money(S.pmax)}`, () => { S.pmax = null; $("pmax").value = ""; });
    if (S.game) add(S.game.name === "your needs" ? "💪 Strong enough for your work" : S.game.name === "your games" ? "🎮 Strong enough for your games" : `🎮 Runs ${S.game.name} smoothly`, () => { S.game = null; });
    if (S.oled) add("OLED screen", () => { S.oled = false; });
    if (S.apple) add(S.apple === "only" ? "Mac only" : "No Mac", () => { S.apple = null; });
    if (S.favs) add("❤️ Favourites", () => { S.favs = false; });
    if (S.steals) add("🔥 Steals only", () => { S.steals = false; });
    if (S.pricedOnly) add("Priced only", () => { S.pricedOnly = false; $("priced").checked = false; });
    chipClears = out.map((c) => c.clear);
    $("chips").innerHTML = out.map((c, i) => `<button type="button" class="chip" data-chip="${i}" aria-label="Remove filter ${esc(c.label)}">${esc(c.label)}</button>`).join("");
  }
  let chipClears = [];

  function render() {
    renderFacets();
    chips();
    const list = ALL.filter((p) => matches(p)).sort(SORTS[sort]);
    $("summary").innerHTML = summary(list);
    $("v-cards").setAttribute("aria-pressed", view === "cards");
    $("v-table").setAttribute("aria-pressed", view === "table");
    if (!list.length) {
      $("results").innerHTML = `<div class="empty"><div class="empty-emoji">🕵️</div><h3>Nothing matches these filters</h3><p>Remove a filter above or <button type="button" class="linkbtn" data-reset>clear all filters</button>.</p>${olxEmpty()}</div>`;
    } else if (view === "table") {
      $("results").innerHTML = table(list);
    } else {
      $("results").innerHTML = `<div class="grid">${list.map(card).join("")}</div>`;
    }
    renderTray();
    $("steals-btn").setAttribute("aria-pressed", S.steals);
    $("favs-btn").setAttribute("aria-pressed", S.favs);
    $("favs-btn").querySelector(".n").textContent = favs.size || "";
  }

  // ---------- compare ----------
  const byId = new Map(ALL.map((p) => [p.id, p]));

  function toggleCompare(id, on) {
    const i = compare.indexOf(id);
    if (on && i < 0) {
      if (compare.length >= MAX_COMPARE) compare.shift();
      compare.push(id);
    } else if (!on && i >= 0) compare.splice(i, 1);
    render();
  }

  function renderTray() {
    $("tray").hidden = compare.length === 0;
    $("slots").innerHTML = compare.map((id) => `<span class="slot" title="${esc(fullName(byId.get(id)))}">${esc(fullName(byId.get(id)))}</span>`).join("") +
      (compare.length < 2 ? '<span class="slot" style="opacity:.6">Pick one more</span>' : "");
    $("cmp-open").disabled = compare.length < 2;
  }

  function openCompare() {
    const items = compare.map((id) => byId.get(id));
    const best = (fn, dir) => {
      const vals = items.map(fn).filter((v) => v != null);
      if (vals.length < 2) return null;
      const b = dir > 0 ? Math.max(...vals) : Math.min(...vals);
      return vals.filter((v) => v === b).length === vals.length ? null : b;
    };
    const bPrice = best((p) => p.price, -1), bRam = best((p) => p.ramGB, 1), bSto = best((p) => p.storageGB, 1), bGpu = best((p) => p.gpuRank, 1);
    const mark = (val, b, html) => (b != null && val === b ? `<span class="best">${html}</span>` : html);
    const rows = [
      ["Price", (p) => mark(p.price, bPrice, p.price != null ? money(p.price) : "On the ad")],
      ["Type", (p) => esc(p.form) + (p.use ? ` · ${esc(p.use)}` : "")],
      ["Processor", (p) => esc(p.cpu)],
      ["Graphics", (p) => mark(p.gpuRank, bGpu, `<span class="pip ${esc(p.gpuVendor || "")}"></span>${esc(p.gpu)}`)],
      ["RAM", (p) => mark(p.ramGB, bRam, esc(p.ram || "Not listed"))],
      ["Storage", (p) => mark(p.storageGB, bSto, esc(p.storage || "Not listed"))],
      ["Screen", (p) => esc(p.screen || "–")],
      ["Condition", (p) => esc(p.condition)],
      ["Store", (p) => esc(p.store === "OLX Lebanon" ? "OLX · " + (p.seller || "") : p.store)],
      ["Link", (p) => linkHTML(p) || "–"],
      ["Used on OLX", (p) => olxHTML(p)],
    ];
    $("cmp-body").innerHTML = `<table class="cmp-table"><thead><tr><th></th>${items.map((p) => `<td><span class="model">${esc(fullName(p))}</span></td>`).join("")}</tr></thead><tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th>${items.map((p) => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const dlg = $("cmp-dialog");
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  // ---------- events ----------
  function bindChecks(elId, key) {
    $(elId).addEventListener("change", (e) => {
      const v = e.target.dataset && e.target.dataset.v;
      if (v == null) return;
      e.target.checked ? S[key].add(v) : S[key].delete(v);
      render();
    });
  }
  bindChecks("f-brand", "brands");
  bindChecks("f-store", "stores");
  bindChecks("f-use", "uses");
  bindChecks("f-cond", "conds");
  bindChecks("f-cpu", "cpus");
  bindChecks("f-gpu", "gpus");

  function bindSeg(elId, apply) {
    $(elId).addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      apply(b.dataset.v);
      render();
    });
  }
  bindSeg("gpukind", (v) => { S.gpuKind = v; });
  bindSeg("ram", (v) => { S.ramMin = +v; });
  bindSeg("storage", (v) => { S.storageMin = +v; });
  bindSeg("screen", (v) => { S.screen = v; });
  bindSeg("tabs", (v) => { S.form = v; });

  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(qTimer);
    S.q = $("q").value.trim();
    render();
    $("q").blur();
    const top = $("tabs").getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  let qTimer;
  $("q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value.trim(); render(); }, 120);
  });
  const num = (v) => (v === "" || isNaN(+v) ? null : +v);
  $("pmin").addEventListener("input", (e) => { S.pmin = num(e.target.value); render(); });
  $("pmax").addEventListener("input", (e) => { S.pmax = num(e.target.value); render(); });
  $("priced").addEventListener("change", (e) => { S.pricedOnly = e.target.checked; render(); });
  $("sort").addEventListener("change", (e) => { sort = e.target.value; tableSort = null; render(); });

  function reset() {
    S = blank();
    $("q").value = ""; $("pmin").value = ""; $("pmax").value = ""; $("priced").checked = false;
    render();
  }
  $("reset").addEventListener("click", reset);

  $("v-cards").addEventListener("click", () => { view = "cards"; store("specs.view", view); render(); });
  $("v-table").addEventListener("click", () => { view = "table"; store("specs.view", view); render(); });

  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    chipClears[+b.dataset.chip]();
    render();
  });

  $("results").addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.cmp;
    if (id) toggleCompare(id, e.target.checked);
  });
  $("results").addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) return reset();
    const th = e.target.closest("[data-tsort]");
    if (th) {
      const k = th.dataset.tsort;
      tableSort = tableSort && tableSort.key === k ? { key: k, dir: -tableSort.dir } : { key: k, dir: k === "ram" || k === "storage" || k === "gpu" ? -1 : 1 };
      render();
    }
  });

  $("cmp-clear").addEventListener("click", () => { compare.length = 0; render(); });
  $("cmp-open").addEventListener("click", openCompare);
  $("cmp-close").addEventListener("click", () => { const d = $("cmp-dialog"); d.close ? d.close() : d.removeAttribute("open"); });

  const setMh = () => document.documentElement.style.setProperty("--mh", document.querySelector(".masthead").offsetHeight + "px");
  setMh(); addEventListener("resize", setMh);
  $("open-filters").addEventListener("click", () => $("filters").classList.add("open"));
  for (const id of ["close-filters", "close-filters-x"]) $(id).addEventListener("click", () => $("filters").classList.remove("open"));

  // ---------- fun: surprise spin, confetti, steals ----------
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function confetti(x, y) {
    if (calm) return;
    const colors = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("i");
      c.className = "confetti";
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
      c.style.cssText = `left:${x}px;top:${y}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 160}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 80}ms`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 1500);
    }
  }

  let spinning = false;
  function spin() {
    if (spinning) return;
    let pool = ALL.filter((p) => matches(p) && p.price != null);
    if (!pool.length) pool = ALL.filter((p) => p.price != null);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const d = $("spin-dialog"), reel = $("reel"), out = $("spin-result");
    out.innerHTML = ""; out.hidden = true;
    $("spin-again").hidden = true;
    d.showModal ? d.showModal() : d.setAttribute("open", "");
    spinning = true;
    let t = 0, delay = calm ? 0 : 40;
    const steps = calm ? 1 : 22;
    (function tick() {
      t++;
      const p = t >= steps ? pick : pool[Math.floor(Math.random() * pool.length)];
      reel.innerHTML = `<span class="reel-name">${esc(fullName(p))}</span><span class="reel-price">${money(p.price)}</span>`;
      reel.classList.toggle("blur", t < steps);
      if (t < steps) { delay *= 1.1; setTimeout(tick, delay); return; }
      spinning = false;
      out.innerHTML = `<div class="grid one">${card(pick)}</div>`;
      out.hidden = false;
      $("spin-again").hidden = false;
      const r = reel.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2);
      ach("spin");
    })();
  }
  $("spin-btn").addEventListener("click", spin);
  $("spin-again").addEventListener("click", spin);
  $("spin-close").addEventListener("click", () => { const d = $("spin-dialog"); d.close ? d.close() : d.removeAttribute("open"); });
  $("spin-result").addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.cmp;
    if (id) toggleCompare(id, e.target.checked);
  });

  const stealCount = ALL.filter((p) => p.steal).length;
  $("steals-btn").querySelector(".n").textContent = stealCount;
  $("steals-btn").addEventListener("click", (e) => {
    S.steals = !S.steals;
    if (S.steals) { ach("steal"); sort = "price-asc"; $("sort").value = sort; const r = e.currentTarget.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top); }
    render();
  });

  // ---------- more fun ----------
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("out"), 2200);
    setTimeout(() => t.remove(), 2700);
  }
  function rain(emoji, n = 40) {
    if (calm) return toast(emoji.repeat(5));
    for (let i = 0; i < n; i++) {
      const e = document.createElement("span");
      e.className = "rain"; e.textContent = emoji;
      e.style.cssText = `left:${Math.random() * 100}vw;font-size:${18 + Math.random() * 26}px;animation-duration:${1.8 + Math.random() * 1.8}s;animation-delay:${Math.random() * 900}ms`;
      document.body.appendChild(e);
      setTimeout(() => e.remove(), 4800);
    }
  }

  const FD = $("fun-dialog");
  function openFun(title, html) {
    FD.classList.remove("gamer", "t-school", "t-work", "t-create", "t-code");
    $("fun-title").textContent = title;
    $("fun-body").innerHTML = html;
    if (!FD.open) FD.showModal ? FD.showModal() : FD.setAttribute("open", "");
    $("fun-body").scrollTop = 0;
  }
  const closeFun = () => (FD.close ? FD.close() : FD.removeAttribute("open"));
  $("fun-close").addEventListener("click", closeFun);

  // favourites, share and compare from any card on the page (results, spin, dialogs)
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-fav]");
    if (f) {
      const id = f.dataset.fav, on = !favs.has(id);
      on ? favs.add(id) : favs.delete(id);
      saveFavs();
      document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => { b.textContent = on ? "❤️" : "🤍"; b.setAttribute("aria-pressed", on); });
      $("favs-btn").querySelector(".n").textContent = favs.size || "";
      if (on) { const r = f.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top); toast("Saved to favourites ❤️"); ach("fav"); if (favs.size >= 5) ach("fav5"); }
      if (S.favs && !on) render();
      return;
    }
    const sh = e.target.closest("[data-share]");
    if (sh) {
      const p = byId.get(sh.dataset.share);
      const url = location.href.split("#")[0] + "#p=" + encodeURIComponent(p.id);
      ach("share");
      const text = `${fullName(p)}${p.price != null ? " for " + money(p.price) : ""} at ${p.store}`;
      if (navigator.share) navigator.share({ title: "Specs.lb", text, url }).catch(() => {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text + " " + url).then(() => toast("Link copied 🔗"), () => toast(url));
      else toast(url);
    }
  });
  $("fun-body").addEventListener("change", (e) => {
    const id = e.target.dataset && e.target.dataset.cmp;
    if (id) toggleCompare(id, e.target.checked);
  });
  $("favs-btn").addEventListener("click", () => {
    if (!favs.size) return toast("Tap 🤍 on any laptop to save it here");
    S.favs = !S.favs; render();
  });
  // open a shared laptop
  (function sharedLink() {
    const m = location.hash.match(/^#p=(.+)$/);
    const p = m && byId.get(decodeURIComponent(m[1]));
    if (p) setTimeout(() => openFun("Someone shared this laptop with you 👀", `<div class="grid one">${card(p)}</div>`), 300);
  })();

  // ---- Find my laptop quiz: every path has its own look and questions ----
  // Each answer is a set of effects: rank (min graphics power), ram, ded (dedicated GPU),
  // pmax, size, brands, cond, oled, apple ("only"/"no"), pcOnly.
  const Q_USE = { q: "What will you mostly do with it?", k: "use", a: [
    ["🎮", "Gaming", { path: "game" }], ["📚", "School & university", { path: "school" }], ["💼", "Work & office", { path: "work" }],
    ["🎨", "3D, design & video", { path: "create" }], ["👨‍💻", "Programming", { path: "code" }]] };
  const gameOpt = (name) => { const g = GAMES.find((x) => x.name === name); return [g.ico, g.name, { rank: g.good, pcOnly: !!g.pcOnly }]; };
  const COND_Q = { q: "New or second-hand?", a: [["✨", "Brand new only", { cond: "new" }], ["♻️", "Used is fine if cheaper", {}]] };
  const PATHS = {
    game: { cls: "gamer", title: "🎮 Gamer mode: find your rig", step: "Level", done: "🏆 GG! Your gaming rigs", second: "🐉 Most powerful in your budget", fail: ["💀 Game over", "🔁 Respawn"], rain: "🎮",
      qs: () => [
        { q: "What do you play the most?", a: [gameOpt("Valorant"), gameOpt("Counter-Strike 2"), gameOpt("Fortnite"), gameOpt("Minecraft"), gameOpt("EA Sports FC"), gameOpt("Call of Duty: Warzone"), gameOpt("GTA V"), ["🌆", "Big new games (Cyberpunk, Wukong…)", { rank: 72, pcOnly: true }]] },
        { q: "What matters more to you?", a: [["⚡", "Max FPS: I play competitive", { boost: 10 }], ["🎨", "Max graphics: it must look amazing", { boost: 18 }], ["👍", "Just let it run well", {}]] },
        { q: "Do you stream or record your games?", a: [["🔴", "Yes, I stream on Twitch / TikTok", { ram: 32, boost: 6 }], ["🎬", "Sometimes I record clips", { ram: 16 }], ["🙅", "No, I just play", {}]] },
        { q: "What's your gaming budget?", a: [["🪙", "Under $900", { pmax: 900 }], ["💵", "Up to $1,300", { pmax: 1300 }], ["💰", "Up to $1,800", { pmax: 1800 }], ["💎", "Up to $2,500", { pmax: 2500 }], ["🤑", "Sky's the limit", {}]] },
        { q: "Pick your size", a: [["🎒", "15–16\": I carry it around", { size: "m" }], ["🖥️", "17–18\": big-screen battlestation", { size: "l" }], ["🤷", "Don't care", {}]] },
        { q: "Choose your team", a: [["🦅", "ASUS ROG / TUF", { brands: ["ASUS"] }], ["⚔️", "Lenovo Legion / LOQ", { brands: ["Lenovo"] }], ["🐉", "MSI", { brands: ["MSI"] }], ["🌀", "HP Omen / Victus", { brands: ["HP"] }], ["🔺", "Acer Nitro / Predator", { brands: ["Acer"] }], ["👽", "Dell Alienware", { brands: ["Dell"] }], ["🤝", "No favourite", {}]] },
        COND_Q,
      ] },
    school: { cls: "t-school", title: "📒 Back to school: find your laptop", step: "Page", done: "🎓 Your study buddies", second: "🏅 Top of the class (best in your budget)", fail: ["📝 Nothing fits yet", "✏️ Try again"], rain: "📚",
      qs: () => [
        { q: "Where do you study?", a: [["🏫", "School", { pmaxSoft: 700 }], ["🎓", "University", {}], ["🧑‍🏫", "Online courses at home", {}]] },
        { q: "What do you study?", a: [["📐", "Engineering / architecture", { ram: 16, ded: true, rank: 38 }], ["💻", "Computer science / IT", { ram: 16 }], ["🩺", "Medicine / science", { ram: 8 }], ["📊", "Business / economics", { ram: 8 }], ["🎨", "Art / design / media", { ram: 16, rank: 24 }], ["📖", "Literature / languages / other", {}]] },
        { q: "Will you carry it all day?", a: [["🎒", "Yes, it must be light", { size: "s" }], ["🚌", "Sometimes", { sizeSoft: "m" }], ["🏠", "No, it stays on my desk", {}]] },
        { q: "How many tabs and apps do you keep open?", a: [["🐢", "A few, one thing at a time", {}], ["🐇", "Lots of tabs + Word + Teams", { ram: 16 }], ["🚀", "Everything, all the time", { ram: 32 }]] },
        { q: "Any gaming after homework?", a: [["🎮", "Yes, some gaming too", { rank: 38, pcOnly: true }], ["🙂", "Light games like Minecraft", {}], ["📚", "No, just studying", {}]] },
        { q: "Mac or Windows?", a: [["🍎", "MacBook", { apple: "only" }], ["🪟", "Windows", { apple: "no" }], ["🤷", "Either is fine", {}]] },
        { q: "What's your budget?", a: [["🪙", "Under $400", { pmax: 400 }], ["💵", "Up to $600", { pmax: 600 }], ["💰", "Up to $900", { pmax: 900 }], ["💎", "Up to $1,400", { pmax: 1400 }], ["🤑", "Parents are paying 😎", {}]] },
        COND_Q,
      ] },
    work: { cls: "t-work", title: "💼 Work mode: find your work laptop", step: "Step", done: "📈 Your shortlist", second: "🚀 Power user pick", fail: ["📉 No match", "🔁 Start over"], rain: "💼",
      qs: () => [
        { q: "What's your job like?", a: [["📧", "Email, Word, Excel, meetings", { ram: 8 }], ["📊", "Big Excel files, data, finance", { ram: 16 }], ["🧾", "Accounting software & ERP", { ram: 16 }], ["📞", "Sales, always on the road", { size: "s" }], ["🏗️", "Engineering & CAD", { ram: 32, ded: true, rank: 50 }], ["🎤", "Presentations & clients", { ram: 16 }]] },
        { q: "How many video calls a day?", a: [["📵", "Almost none", {}], ["📹", "A few", {}], ["🎥", "All day long on Zoom/Teams", { ram: 16 }]] },
        { q: "How often do you travel with it?", a: [["✈️", "Every week", { size: "s" }], ["🚗", "Between office and home", { sizeSoft: "m" }], ["🪑", "It stays on my desk", {}]] },
        { q: "Business-grade build?", a: [["🛡️", "Yes: ThinkPad / Latitude / EliteBook class", { brands: ["Lenovo", "Dell", "HP"] }], ["💡", "Any good laptop is fine", {}]] },
        { q: "Screen size you prefer?", a: [["📱", "Compact (14\" or less)", { size: "s" }], ["💻", "15–16\"", { size: "m" }], ["🖥️", "Big 17\"+ for spreadsheets", { size: "l" }], ["🤷", "Don't mind", {}]] },
        { q: "Who's paying?", a: [["🪙", "Me, under $600", { pmax: 600 }], ["💵", "Up to $1,000", { pmax: 1000 }], ["💰", "Up to $1,600", { pmax: 1600 }], ["🏢", "The company 😏", {}]] },
        COND_Q,
      ] },
    create: { cls: "t-create", title: "🎨 Creator studio: find your machine", step: "Layer", done: "✨ Your creative machines", second: "🎨 Creative powerhouse in your budget", fail: ["🖌️ Blank canvas", "🔁 Try again"], rain: "🎨",
      qs: () => [
        { q: "What do you create?", a: [["🖼️", "Photo editing", { ram: 16, rank: 12 }], ["🖌️", "Graphic design & illustration", { ram: 16, rank: 12 }], ["🎬", "Video editing", { ram: 16, rank: 46, ded: true }], ["🧊", "3D modelling & rendering", { ram: 32, rank: 60, ded: true }], ["🏛️", "Architecture & interior (CAD/BIM)", { ram: 32, rank: 55, ded: true }], ["🎧", "Music production", { ram: 16 }]] },
        { q: "Which software do you use most?", a: [["🅰️", "Adobe Photoshop / Illustrator", {}], ["🎞️", "Premiere / DaVinci Resolve", { rank: 50 }], ["🟠", "Blender / Cinema 4D", { rank: 60, ram: 32 }], ["📐", "AutoCAD / Revit / SketchUp", { rank: 50, ram: 16 }], ["🎹", "FL Studio / Ableton / Logic", {}], ["🤷", "A bit of everything", { rank: 46 }]] },
        { q: "How big are your projects?", a: [["🌱", "Small: social posts, short clips", {}], ["🌳", "Medium: client work, YouTube", { ram: 16, boost: 6 }], ["🏔️", "Huge: 4K/8K, heavy 3D scenes", { ram: 32, boost: 14 }]] },
        { q: "How important is the screen?", a: [["🌈", "Must be OLED, perfect colours", { oled: true }], ["🖥️", "Big screen, 16\" or more", { size: "big" }], ["👌", "Any good screen", {}]] },
        { q: "Mac or Windows?", a: [["🍎", "MacBook (great for creators)", { apple: "only", macOk: true }], ["🪟", "Windows with a real graphics card", { apple: "no" }], ["🤷", "Either", { macOk: true }]] },
        { q: "What's your budget?", a: [["💵", "Up to $1,000", { pmax: 1000 }], ["💰", "Up to $1,600", { pmax: 1600 }], ["💎", "Up to $2,500", { pmax: 2500 }], ["🤑", "Whatever it takes", {}]] },
        COND_Q,
      ] },
    code: { cls: "t-code", title: "👨‍💻 Dev mode: find your coding machine", step: "Commit", done: "✅ Build passed: your laptops", second: "🧠 Beast for heavy builds", fail: ["❌ Build failed", "🔁 git reset"], rain: "💾",
      qs: () => [
        { q: "What do you build?", a: [["🌐", "Websites & web apps", { ram: 16 }], ["📱", "Mobile apps (Android/iOS)", { ram: 16 }], ["🎮", "Games (Unity / Unreal)", { ram: 32, rank: 55, ded: true }], ["🤖", "AI & machine learning", { ram: 32, rank: 60, ded: true }], ["🖥️", "Backend, servers, Docker", { ram: 32 }], ["📚", "Learning to code", { ram: 8 }]] },
        { q: "Do you build iPhone apps?", a: [["🍏", "Yes, I need Xcode (Mac)", { apple: "only" }], ["🐧", "No, I prefer Windows/Linux", { apple: "no" }], ["🤷", "Not sure", {}]] },
        { q: "How many things run at once?", a: [["🧘", "Editor + browser", {}], ["🐳", "Editor, browser, Docker, emulator", { ram: 32 }], ["🔥", "Everything + VMs", { ram: 64 }]] },
        { q: "Where do you code?", a: [["☕", "Cafés & university: needs to be light", { size: "s" }], ["🏠", "Mostly at my desk", {}], ["🔀", "Both", { sizeSoft: "m" }]] },
        { q: "What's your budget?", a: [["🪙", "Under $700", { pmax: 700 }], ["💵", "Up to $1,200", { pmax: 1200 }], ["💰", "Up to $2,000", { pmax: 2000 }], ["🤑", "Ship it, no limit", {}]] },
        COND_Q,
      ] },
  };
  // Follow-up questions that appear only after a specific answer.
  const HZ = { q: "What refresh rate are you aiming for?", a: [["🙂", "60 FPS is fine", {}], ["⚡", "144 Hz smooth", { boost: 8 }], ["🏆", "240 Hz+ like the pros", { boost: 18 }]] };
  const FOLLOW = {
    "Valorant": [{ q: "How seriously do you play Valorant?", a: [["🎲", "Unrated & Spike Rush for fun", {}], ["📈", "Ranked grind (Gold–Diamond)", { boost: 6 }], ["👑", "Immortal / Radiant dreams", { boost: 12 }]] }, HZ],
    "Counter-Strike 2": [{ q: "Which CS2 do you play most?", a: [["🎯", "Premier / FACEIT competitive", { boost: 10 }], ["💥", "Deathmatch & casual", {}], ["🗺️", "Workshop maps, surf & KZ", { ram: 16 }]] }, HZ,
      { q: "Will you run CS2 with other stuff open?", a: [["💬", "Discord + browser at the same time", { ram: 16 }], ["🔴", "Discord + OBS recording", { ram: 32, boost: 6 }], ["🎮", "Just CS2", {}]] }],
    "Fortnite": [{ q: "How do you play Fortnite?", a: [["🏗️", "Build battles & competitive", { boost: 8 }], ["🚫", "Zero Build chill", {}], ["🎨", "Creative & LEGO maps", { ram: 16 }]] },
      { q: "Which graphics mode?", a: [["⚡", "Performance mode (max FPS)", {}], ["✨", "DirectX 12 with Lumen & ray tracing", { boost: 18 }]] }],
    "Minecraft": [{ q: "How do you play Minecraft?", a: [["🟩", "Vanilla", {}], ["🧩", "Big modpacks (100+ mods)", { ram: 16, rank: 24 }], ["🌅", "Shaders / RTX", { rank: 50, pcOnly: true }]] }],
    "EA Sports FC": [{ q: "Which mode do you play?", a: [["🃏", "Ultimate Team online", { boost: 6 }], ["🏆", "Career mode", {}], ["👥", "Couch co-op with friends", { size: "l" }]] }],
    "Call of Duty: Warzone": [{ q: "Which Warzone?", a: [["🪂", "Battle Royale (big map)", { ram: 16, boost: 6 }], ["⚡", "Resurgence (small map)", { ram: 16 }]] }, HZ],
    "GTA V": [{ q: "What do you do in GTA?", a: [["📖", "Story mode", {}], ["🌐", "GTA Online", { ram: 16 }], ["👮", "Roleplay servers (FiveM)", { ram: 16, boost: 14 }], ["🛠️", "Graphics mods (NaturalVision)", { ram: 32, rank: 64 }]] }],
    "Big new games (Cyberpunk, Wukong…)": [{ q: "Which one do you want most?", a: [["🌆", "Cyberpunk 2077 with path tracing", { rank: 90 }], ["🐒", "Black Myth: Wukong", { rank: 80 }], ["🤠", "Red Dead Redemption 2", { rank: 60 }], ["🪄", "Hogwarts Legacy", { rank: 64 }]] }],
    "Engineering / architecture": [{ q: "Which software does your course use?", a: [["📏", "AutoCAD 2D drawings", { rank: 24 }], ["🏢", "Revit / 3ds Max / Lumion", { rank: 60, ram: 32, ded: true }], ["⚙️", "SolidWorks / ANSYS / MATLAB", { rank: 46, ram: 16, ded: true }], ["🤷", "Not sure yet", { rank: 38 }]] }],
    "Computer science / IT": [{ q: "What will you code in your degree?", a: [["🌐", "Web & apps", {}], ["🤖", "AI / machine learning projects", { rank: 55, ram: 32, ded: true }], ["🐧", "Linux, networks, VMs", { ram: 32 }]] }],
    "Art / design / media": [{ q: "What kind of design?", a: [["🖌️", "Photoshop / Illustrator", { ram: 16 }], ["🎬", "Video & animation", { rank: 46, ram: 16 }], ["🧊", "3D & motion design", { rank: 60, ram: 32 }], ["✏️", "Drawing with a pen", { touch: true }]] }],
    "Medicine / science": [{ q: "How do you study?", a: [["📑", "Lots of PDFs & slides", { sizeSoft: "m" }], ["🏥", "Carry it to hospital & labs", { size: "s" }], ["🧪", "Lab software & statistics (SPSS, R)", { ram: 16 }]] }],
    "Big Excel files, data, finance": [{ q: "How big are your spreadsheets?", a: [["📄", "A few thousand rows", {}], ["📚", "Hundreds of thousands of rows", { ram: 16 }], ["🐘", "Millions + Power BI / Python", { ram: 32 }]] }],
    "Engineering & CAD": [{ q: "Which CAD do you use?", a: [["📏", "AutoCAD 2D", { rank: 24, ram: 16 }], ["🏢", "Revit / BIM", { rank: 60, ram: 32 }], ["⚙️", "SolidWorks / Inventor", { rank: 55, ram: 32 }], ["🌍", "GIS & civil (Civil 3D)", { rank: 50, ram: 32 }]] }],
    "Sales, always on the road": [{ q: "What matters most on the road?", a: [["🪶", "As light as possible", { size: "s" }], ["🔋", "Battery that lasts all day", { size: "s", noGamer: true }], ["🛡️", "Tough build that survives travel", { brands: ["Lenovo", "Dell", "HP"] }]] }],
    "Video editing": [{ q: "Highest resolution you edit?", a: [["📱", "1080p, Reels & TikTok", { rank: 46 }], ["🎥", "4K YouTube & client work", { rank: 60, ram: 32 }], ["🎞️", "6K–8K RAW / colour grading", { rank: 80, ram: 64 }]] }],
    "3D modelling & rendering": [{ q: "How do you render?", a: [["🟠", "Blender Cycles on the GPU", { rank: 72 }], ["🎮", "Real-time (Unreal, Twinmotion, D5)", { rank: 72, ram: 32 }], ["🖥️", "V-Ray / Corona on the CPU", { rank: 46, ram: 32 }], ["🧩", "Just modelling, little rendering", { rank: 46 }]] }],
    "Architecture & interior (CAD/BIM)": [{ q: "What's your main tool?", a: [["🏠", "SketchUp + V-Ray", { rank: 55, ram: 32 }], ["🏢", "Revit + Enscape / Lumion", { rank: 64, ram: 32 }], ["📏", "AutoCAD drawings mostly", { rank: 24, ram: 16 }]] }],
    "Photo editing": [{ q: "What kind of photos?", a: [["📱", "Phone photos & social media", {}], ["📷", "RAW photos from a real camera", { ram: 16, oledSoft: true }], ["🖼️", "Huge print files, 100+ layers", { ram: 32 }]] }],
    "Music production": [{ q: "How big are your sessions?", a: [["🎹", "A few tracks & plugins", { ram: 16 }], ["🎛️", "Orchestral libraries, 100+ tracks", { ram: 32 }], ["🎙️", "Recording live with an audio interface", { ram: 16 }]] }],
    "AI & machine learning": [{ q: "How will you run AI models?", a: [["☁️", "Mostly cloud / APIs", { rank: 0, ded: false, ram: 16 }], ["🧪", "Small models locally", { rank: 64, ram: 32 }], ["🔥", "Train big models locally", { rank: 90, ram: 64 }]] }],
    "Games (Unity / Unreal)": [{ q: "Which engine?", a: [["🟦", "Unity", { rank: 55 }], ["⬛", "Unreal Engine 5", { rank: 72, ram: 32 }], ["🟩", "Godot / 2D games", { rank: 24 }]] }],
    "Mobile apps (Android/iOS)": [{ q: "Which phones do you build for?", a: [["🤖", "Android (emulator needs RAM)", { ram: 16, apple: "no" }], ["🍏", "iPhone (needs a Mac)", { apple: "only" }], ["🔀", "Both with Flutter / React Native", { ram: 16 }]] }],
  };
  let quizAns = [], quizFlow = [Q_USE], quizPath = null;
  // The flow is the path's questions plus the follow-ups of the answers given so far.
  function buildFlow() {
    const queue = [Q_USE, ...(quizPath ? PATHS[quizPath].qs() : [])], out = [];
    while (queue.length) {
      const q = queue.shift();
      out.push(q);
      const pick = quizAns[out.length - 1];
      if (pick && pick.label && FOLLOW[pick.label]) queue.unshift(...FOLLOW[pick.label]);
    }
    return out;
  }
  const pathOf = () => (quizPath ? PATHS[quizPath] : null);
  // Label of the answer that brought in question i, if it is a follow-up.
  function FOLLOW_OF(i) {
    for (let j = i - 1; j >= 1; j--) {
      const pick = quizAns[j];
      if (pick && pick.label && FOLLOW[pick.label] && FOLLOW[pick.label].includes(quizFlow[i])) return pick.label;
    }
    return null;
  }
  function quizStep(i) {
    if (i >= quizFlow.length) return quizDone();
    const st = quizFlow[i], P = pathOf();
    openFun(P ? P.title : "🧭 Find my laptop", `<div class="quiz"><div class="quiz-prog"><i style="width:${(i / quizFlow.length) * 100}%"></i></div>
      <p class="quiz-n">${P ? P.step : "Question"} ${i + 1}${P ? " of " + quizFlow.length : ""}</p><h4>${st.q}</h4>
      <div class="quiz-opts${st.a.length > 4 ? " many" : ""}">${st.a.map((a, j) => `<button type="button" class="quiz-opt" data-qi="${i}" data-qa="${j}"><span>${a[0]}</span>${esc(a[1])}</button>`).join("")}</div>
      ${i > 0 ? `<p style="text-align:center;margin:12px 0 0"><button type="button" class="linkbtn" data-qback="${i - 1}">← Back</button></p>` : ""}</div>`);
    if (FOLLOW_OF(i)) $("fun-body").querySelector(".quiz-n").insertAdjacentHTML("beforeend", ` <span class="qf">✨ follow-up for “${esc(FOLLOW_OF(i))}”</span>`);
    if (P) FD.classList.add(P.cls);
  }
  function quizDone() {
    const P = pathOf();
    const E = { rank: 0, ram: 0, boost: 0, brands: [] };
    quizAns.forEach((a) => {
      Object.entries(a).forEach(([k, v]) => {
        if (k === "label" || k === "oledSoft" || k === "touch" || k === "noGamer") return;
        if (k === "rank" && v === 0) { E.rank = 0; E.cloud = true; return; }
        if (k === "ded" && v === false) { E.ded = false; return; }
        if ((k === "rank" || k === "ram") && E.cloud && k === "rank") return;
        if (k === "rank" || k === "ram" || k === "pmaxSoft") E[k] = Math.max(E[k] || 0, v);
        else if (k === "boost") E.boost += v;
        else if (k === "brands") E.brands = v;
        else E[k] = v;
      });
    });
    S = blank(); $("q").value = ""; $("pmin").value = ""; $("priced").checked = false;
    const need = E.rank ? Math.min(MAX_RANK, E.rank + E.boost) : 0;
    if (need > 10) S.game = { name: quizPath === "game" ? "your games" : "your needs", good: need, pcOnly: !!E.pcOnly && !E.macOk };
    if (E.ded && E.apple !== "only") S.gpuKind = "Dedicated";
    if (E.ram) S.ramMin = Math.min(64, E.ram);
    if (E.apple) S.apple = E.apple;
    if (E.apple === "only") { S.game = null; S.gpuKind = "any"; }
    if (E.oled) S.oled = true;
    if (E.brands.length) E.brands.forEach((b) => S.brands.add(b));
    S.pmax = E.pmax || null; $("pmax").value = S.pmax || "";
    S.screen = E.size === "big" ? "any" : E.size || E.sizeSoft || "any";
    if (E.cond === "new") S.conds.add("New");
    S.pricedOnly = true; $("priced").checked = true;
    sort = "price-asc"; $("sort").value = sort;
    const relax = [
      () => E.sizeSoft && S.screen === E.sizeSoft && (S.screen = "any"),
      () => S.oled && !(S.oled = false),
      () => S.brands.size && (S.brands.clear(), true),
      () => S.screen !== "any" && (S.screen = "any"),
      () => S.ramMin > 16 && (S.ramMin = 16),
    ];
    let list = ALL.filter((p) => matches(p) && (E.size !== "big" || (p.screenIn || 0) >= 15.9));
    for (const r of relax) { if (list.length) break; if (r()) list = ALL.filter((p) => matches(p)); }
    render();
    const best = list.sort(SORTS[sort])[0];
    const score = (x) => (x.gpuRank || 0) * 3 + (x.ramGB || 0) + (x.storageGB || 0) / 256;
    const top = list.length > 1 ? list.slice().sort((x, y) => score(y) - score(x) || x.price - y.price)[0] : null;
    const cls = P ? P.cls : "";
    if (!best) {
      openFun(P ? P.fail[0] : "😅 No match", `<p>Nothing fits all of that right now. Try a bigger budget or fewer must-haves.</p><p style="text-align:center"><button type="button" class="btn primary" data-quiz>${P ? P.fail[1] : "Try again"}</button></p>`);
      if (cls) FD.classList.add(cls);
      return;
    }
    openFun(P ? P.done : "🎉 Your matches", `<p class="quiz-n"><b>${list.length}</b> ${list.length === 1 ? "laptop fits" : "laptops fit"} you. ${list.length === 1 ? "It's" : "They're"} on the page now${list.length === 1 ? "" : ", cheapest first"}.</p>
      <h4 class="pick-h">💸 Best value: cheapest that fits</h4><div class="grid one">${card(best)}</div>
      ${top && top !== best ? `<h4 class="pick-h">${P ? P.second : "⭐ Best in your budget"}</h4><div class="grid one">${card(top)}</div>` : ""}
      <p style="text-align:center"><button type="button" class="btn primary" data-see-all>See all ${list.length}</button></p>`);
    if (cls) FD.classList.add(cls);
    if (P && !calm) rain(P.rain, 24);
    const r = $("fun-body").getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 40); ach("quiz");
  }
  const startQuiz = () => { quizAns = []; quizFlow = [Q_USE]; quizPath = null; quizStep(0); };
  $("quiz-btn").addEventListener("click", startQuiz);
  $("fun-body").addEventListener("click", (e) => {
    const o = e.target.closest("[data-qi]");
    if (o) {
      const i = +o.dataset.qi, opt = quizFlow[i].a[+o.dataset.qa];
      quizAns = quizAns.slice(0, i);
      if (i === 0) { quizPath = opt[2].path; quizAns.push({}); }
      else quizAns.push({ ...opt[2], label: opt[1] });
      quizFlow = buildFlow();
      return quizStep(i + 1);
    }
    const bk = e.target.closest("[data-qback]");
    if (bk) return quizStep(+bk.dataset.qback);
    if (e.target.closest("[data-quiz]")) return startQuiz();
    if (e.target.closest("[data-see-all]")) { closeFun(); $("summary").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" }); return; }
    const g = e.target.closest("[data-guess]");
    if (g) return guess(g.dataset.guess);
    if (e.target.closest("[data-hl-new]")) return hlStart();
  });

  // ---- Higher or Lower price game ----
  const HL_POOL = ALL.filter((p) => p.price != null && p.cpu && p.cpu !== "Not listed");
  let hl = null;
  const hlBest = () => +(store("specs.hlbest") || 0);
  const pickHL = (not) => { let p; do { p = HL_POOL[Math.floor(Math.random() * HL_POOL.length)]; } while (p === not || (not && Math.abs(p.price - not.price) < 15)); return p; };
  function mini(p, showPrice) {
    return `<div class="hl-card"><div class="who">${esc(p.brand)} · ${esc(p.store)}</div><h4>${esc(p.name)}</h4>
      <div class="hl-specs">${esc(p.cpu)}<br>${esc(p.gpu)}<br>${p.ramGB ? p.ramGB + "GB RAM" : ""}${p.storage ? " · " + esc(p.storage) : ""}</div>
      <div class="hl-price">${showPrice ? money(p.price) : "$ ???"}</div></div>`;
  }
  function hlDraw(msg) {
    openFun("💸 Higher or Lower", `<div class="hl"><p class="hl-score">Streak <b>${hl.streak}</b> · Best <b>${hlBest()}</b></p>
      <div class="hl-row">${mini(hl.a, true)}<div class="hl-vs">VS</div>${mini(hl.b, hl.done)}</div>
      ${msg ? `<p class="hl-msg">${msg}</p>` : `<p class="hl-msg">Is the second laptop <b>more</b> or <b>less</b> expensive?</p>`}
      <div class="hl-btns">${hl.done ? `<button type="button" class="btn primary" data-hl-new>Play again</button>` : `<button type="button" class="btn hl-up" data-guess="up">⬆️ Higher</button><button type="button" class="btn hl-down" data-guess="down">⬇️ Lower</button>`}</div></div>`);
  }
  function hlStart() { hl = { a: pickHL(), streak: 0, done: false }; hl.b = pickHL(hl.a); hlDraw(); }
  function guess(dir) {
    if (!hl || hl.done) return;
    const right = dir === "up" ? hl.b.price > hl.a.price : hl.b.price < hl.a.price;
    if (right) {
      hl.streak++;
      if (hl.streak > hlBest()) store("specs.hlbest", hl.streak);
      if (hl.streak >= 3) ach("hl3");
      if (hl.streak >= 10) ach("hl10");
      const r = $("fun-body").getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + 60);
      const was = hl.b;
      hl.a = was; hl.b = pickHL(was);
      hlDraw(`✅ Yes! It was <b>${money(was.price)}</b>. Next one:`);
    } else {
      hl.done = true;
      hlDraw(`❌ Nope, it's <b>${money(hl.b.price)}</b>. ${hl.streak >= 5 ? "Great run! 🏆" : hl.streak >= 2 ? "Not bad! 👏" : "Laptop prices are tricky 😅"}`);
      $("fun-body").querySelector(".hl-row").classList.add("shake");
    }
  }
  $("hl-btn").addEventListener("click", hlStart);

  // ---- Hall of Fame ----
  function hallOfFame() {
    const priced = ALL.filter((p) => p.price != null);
    const min = (arr, f) => arr.reduce((b, p) => (b == null || f(p) < f(b) ? p : b), null);
    const max = (arr, f) => arr.reduce((b, p) => (b == null || f(p) > f(b) ? p : b), null);
    const awards = [
      ["🪙", "Cheapest laptop in Lebanon", min(priced, (p) => p.price)],
      ["🎮", "Cheapest with a real graphics card", min(priced.filter((p) => p.gpuKind === "Dedicated"), (p) => p.price)],
      ["🔥", "Cheapest Beast (strong gaming)", min(priced.filter((p) => (p.gpuRank || 0) >= 64), (p) => p.price)],
      ["🐉", "Cheapest Monster", min(priced.filter((p) => (p.gpuRank || 0) >= 90), (p) => p.price)],
      ["⚖️", "Most gaming power per dollar", max(priced.filter((p) => (p.gpuRank || 0) > 24), (p) => p.gpuRank / p.price)],
      ["🧠", "Most RAM", max(priced, (p) => (p.ramGB || 0) * 100000 - p.price)],
      ["💾", "Most storage", max(priced, (p) => (p.storageGB || 0) * 100000 - p.price)],
      ["👑", "Most expensive laptop", max(priced, (p) => p.price)],
    ].filter((a) => a[2]);
    openFun("🏆 Hall of Fame", `<div class="hof">${awards.map(([e, t, p]) => `<section><h4><span>${e}</span>${t}</h4>${card(p)}</section>`).join("")}</div>`);
  }
  $("hof-btn").addEventListener("click", () => { hallOfFame(); ach("hof"); });

  // ---- hidden search tricks ----
  const EGGS = { potato: "🥔", lebanon: "🇱🇧", "لبنان": "🇱🇧", dragon: "🐉", money: "💸", pizza: "🍕", manoushe: "🫓", manakish: "🫓", cat: "🐈", fire: "🔥" };
  let lastEgg = "";
  $("q").addEventListener("input", (e) => {
    const v = e.target.value.trim().toLowerCase();
    if (v === lastEgg) return;
    const clearSoon = () => setTimeout(() => { if ($("q").value.trim().toLowerCase() === v) { $("q").value = ""; S.q = ""; render(); } }, 1400);
    if (EGGS[v]) { lastEgg = v; rain(EGGS[v]); clearSoon(); ach("egg"); }
    else if (v === "rgb" || v === "rainbow") { lastEgg = v; document.body.classList.add("rgb"); setTimeout(() => document.body.classList.remove("rgb"), 6000); toast("🌈 RGB mode: +10 FPS"); clearSoon(); ach("egg"); }
    else if (v === "hacker" || v === "matrix") { lastEgg = v; document.body.classList.toggle("matrix"); toast(document.body.classList.contains("matrix") ? "🟩 Welcome to the matrix" : "Back to normal"); clearSoon(); }
    else lastEgg = "";
  });

  // ---- theme switch ----
  const root = document.documentElement;
  function applyTheme(t) {
    if (t) root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
    const dark = t ? t === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
    $("theme-btn").textContent = dark ? "☀️" : "🌙";
    $("theme-btn").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  applyTheme(store("specs.theme"));
  $("theme-btn").addEventListener("click", () => {
    const dark = $("theme-btn").textContent === "☀️";
    const t = dark ? "light" : "dark";
    store("specs.theme", t); applyTheme(t);
  });

  // ---------- even more fun ----------
  // Games and the graphics power they need (same scale as the Gaming power bar).
  const GAMES = [
    { name: "Minecraft", ico: "⛏️", min: 10, good: 10 },
    { name: "Roblox", ico: "🧱", min: 10, good: 10 },
    { name: "The Sims 4", ico: "🏡", min: 10, good: 12 },
    { name: "League of Legends", ico: "🧙", min: 10, good: 10, pcOnly: true },
    { name: "Dota 2", ico: "🛡️", min: 10, good: 16 },
    { name: "Valorant", ico: "🎯", min: 10, good: 24, pcOnly: true },
    { name: "Counter-Strike 2", alias: "cs2 cs go csgo", ico: "💣", min: 10, good: 36, pcOnly: true },
    { name: "Rocket League", ico: "🚀", min: 12, good: 24, pcOnly: true },
    { name: "Fortnite", ico: "🪂", min: 12, good: 38, pcOnly: true },
    { name: "Overwatch 2", ico: "🦸", min: 14, good: 36, pcOnly: true },
    { name: "GTA V", ico: "🚗", min: 14, good: 36, pcOnly: true },
    { name: "Rainbow Six Siege", alias: "r6", ico: "🔫", min: 14, good: 38, pcOnly: true },
    { name: "Apex Legends", ico: "🏹", min: 16, good: 38, pcOnly: true },
    { name: "EA Sports FC", alias: "fifa fc26 fc 26", ico: "⚽", min: 24, good: 46, pcOnly: true },
    { name: "PUBG: Battlegrounds", alias: "pubg", ico: "🍳", min: 24, good: 46, pcOnly: true },
    { name: "Forza Horizon 5", ico: "🏎️", min: 24, good: 50, pcOnly: true },
    { name: "Marvel Rivals", ico: "🕷️", min: 36, good: 55, pcOnly: true },
    { name: "Call of Duty: Warzone", alias: "cod", ico: "🪖", min: 36, good: 55, pcOnly: true },
    { name: "Baldur's Gate 3", ico: "🎲", min: 38, good: 55 },
    { name: "Elden Ring", ico: "🗡️", min: 38, good: 60, pcOnly: true },
    { name: "Red Dead Redemption 2", alias: "rdr2", ico: "🤠", min: 38, good: 60, pcOnly: true },
    { name: "Hogwarts Legacy", ico: "🪄", min: 46, good: 64, pcOnly: true },
    { name: "Cyberpunk 2077", ico: "🌆", min: 46, good: 72 },
    { name: "Black Myth: Wukong", ico: "🐒", min: 50, good: 80, pcOnly: true },
  ];
  function runs(p, g) {
    const r = p.gpuRank || 0;
    if (!r) return ["❓", "Unknown", "unk"];
    if (p.cpuVendor === "Apple" && g.pcOnly) return ["🍎", "Not on Mac", "no"];
    if (r >= g.good) return ["✅", "Smooth", "ok"];
    if (r >= g.min) return ["⚠️", "Low settings", "meh"];
    return ["❌", "Too weak", "no"];
  }

  // ---- achievements ----
  const ACH = {
    spin: ["🎰", "Gambler", "Spin the slot machine"], quiz: ["🧭", "Know thyself", "Finish the laptop quiz"],
    hl3: ["💸", "Price whisperer", "Get a streak of 3 in Higher or Lower"], hl10: ["🧠", "Human price tag", "Get a streak of 10 in Higher or Lower"],
    fav: ["❤️", "Crush", "Save a favourite"], fav5: ["💘", "Collector", "Save 5 favourites"],
    share: ["🔗", "Spread the word", "Share a laptop"], egg: ["🥚", "Easter egg hunter", "Find a secret search word"],
    steal: ["🔥", "Bargain hunter", "Look at the Steals"], hof: ["🏆", "Historian", "Visit the Hall of Fame"],
    battle: ["⚔️", "Gladiator", "Watch a laptop battle"], game: ["🎮", "Gamer", "Check which laptops run a game"],
    detail: ["🔍", "Inspector", "Open the details of 5 laptops"], budget: ["💰", "Money talks", "Use the budget slider"],
    cur: ["🇱🇧", "Local", "Switch prices to Lebanese pounds"], lotd: ["⭐", "Daily visitor", "Open the laptop of the day"],
  };
  const got = new Set((() => { try { return JSON.parse(store("specs.ach") || "[]"); } catch (e) { return []; } })());
  function ach(id) {
    if (got.has(id) || !ACH[id]) return;
    got.add(id); store("specs.ach", JSON.stringify([...got]));
    setTimeout(() => toast(`🏅 Achievement unlocked: ${ACH[id][0]} ${ACH[id][1]}`), 600);
    updAch();
    if (got.size === Object.keys(ACH).length) setTimeout(() => { rain("🏆", 60); toast("👑 You unlocked everything. Legend."); }, 2600);
  }
  function updAch() { $("ach-btn").querySelector(".n").textContent = `${got.size}/${Object.keys(ACH).length}`; }
  $("ach-btn").addEventListener("click", () => {
    openFun("🏅 Achievements", `<p class="quiz-n">${got.size} of ${Object.keys(ACH).length} unlocked. They're saved on this device.</p>
      <div class="achs">${Object.entries(ACH).map(([id, [e, t, d]]) => `<div class="ach${got.has(id) ? " on" : ""}"><span>${got.has(id) ? e : "🔒"}</span><b>${t}</b><small>${d}</small></div>`).join("")}</div>`);
  });

  // ---- laptop details ----
  let detailCount = +(store("specs.details") || 0);
  function similarMedian(p) {
    const k = (x) => (x.gpuModel || x.cpuFamily || "?") + "|" + x.ramGB;
    const ps = ALL.filter((x) => x.price != null && x.ramGB && k(x) === k(p)).map((x) => x.price).sort((a, b) => a - b);
    return ps.length >= 3 ? { med: ps[Math.floor(ps.length / 2)], n: ps.length } : null;
  }
  function goodFor(p) {
    const r = p.gpuRank || 0, ram = p.ramGB || 0;
    return [
      ["📚", "School & browsing", true], ["💼", "Office work", ram >= 8 || !ram], ["👨‍💻", "Programming", ram >= 16],
      ["🖼️", "Photo editing", ram >= 16], ["🎬", "Video editing", ram >= 16 && (r >= 38 || /M\d (Pro|Max)/.test(p.cpu || ""))],
      ["🎮", "Gaming", r >= 38], ["🤖", "AI & 3D work", ram >= 32 && r >= 60],
    ];
  }
  function detail(id) {
    const p = byId.get(id);
    if (!p) return;
    detailCount++; store("specs.details", detailCount); if (detailCount >= 5) ach("detail");
    const sm = p.price != null && similarMedian(p);
    let market = "";
    if (sm) {
      const diff = Math.round(p.price - sm.med), pct = Math.round((diff / sm.med) * 100);
      const pos = Math.max(4, Math.min(96, 50 + pct));
      market = `<section class="dt-sec"><h4>💰 Price vs ${sm.n} similar laptops</h4>
        <div class="mkt"><div class="mkt-bar"><span class="mkt-mid"></span><i style="left:${pos}%"></i></div>
        <div class="mkt-lbl"><span>Cheaper</span><span>Typical ${money(sm.med)}</span><span>Pricier</span></div></div>
        <p class="mkt-say ${diff <= 0 ? "good" : "bad"}">${Math.abs(pct) < 5 ? "👌 About the normal price." : diff < 0 ? `🎉 ${money(-diff)} (${-pct}%) below the typical price.` : `😬 ${money(diff)} (${pct}%) above the typical price.`}</p></section>`;
    }
    const alts = ALL.filter((x) => x !== p && x.price != null && p.price != null && x.price < p.price - 20 && (x.gpuRank || 0) >= (p.gpuRank || 0) && (x.ramGB || 0) >= (p.ramGB || 0) && (x.storageGB || 0) >= (p.storageGB || 0) && x.condition === p.condition)
      .sort((a, b) => a.price - b.price).slice(0, 3);
    openFun(fullName(p), `<div class="grid one">${card(p)}</div>
      <section class="dt-sec"><h4>🎮 Can it run…?</h4><div class="games">${GAMES.map((g) => { const [e, t, c] = runs(p, g); return `<div class="game ${c}"><span>${g.ico}</span><b>${g.name}</b><em>${e} ${t}</em></div>`; }).join("")}</div>
      <p class="dim small">A rough guide from the graphics card, not a benchmark.</p></section>
      <section class="dt-sec"><h4>👍 Good for</h4><div class="goodfor">${goodFor(p).map(([e, t, ok]) => `<span class="gf ${ok ? "ok" : "no"}">${ok ? e : "✖️"} ${t}</span>`).join("")}</div></section>
      ${market}
      ${alts.length ? `<section class="dt-sec"><h4>💡 Same power or better, for less</h4><div class="alts">${alts.map((a) => `<button type="button" class="alt" data-detail="${a.id}"><b>${esc(fullName(a))}</b><span>${esc(a.store)} · ${a.gpu ? esc(a.gpu) : ""}</span><em>${money(a.price)} <small>save ${money(p.price - a.price)}</small></em></button>`).join("")}</div></section>` : ""}`);
  }
  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-detail]");
    if (d) { e.preventDefault(); detail(d.dataset.detail); }
  });

  // ---- Can it run ...? ----
  $("game-btn").addEventListener("click", () => {
    openFun("🎮 Can it run…?", `<p class="quiz-n">Pick a game to see every laptop that runs it smoothly.</p>
      <input type="search" id="game-q" class="game-q" placeholder="Find a game, e.g. CS2" aria-label="Find a game">
      <div class="quiz-opts games-pick">${GAMES.map((g, i) => {
        const n = ALL.filter((p) => (p.gpuRank || 0) >= g.good && !(p.cpuVendor === "Apple" && g.pcOnly)).length;
        return `<button type="button" class="quiz-opt" data-game="${i}" data-gname="${esc((g.name + " " + (g.alias || "")).toLowerCase())}"><span>${g.ico}</span>${esc(g.name)}<small>${n} laptops</small></button>`;
      }).join("")}</div>`);
    $("game-q").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase().replace(/\s+/g, " ");
      document.querySelectorAll("[data-gname]").forEach((b) => { b.hidden = q && !b.dataset.gname.includes(q); });
    });
  });
  $("fun-body").addEventListener("click", (e) => {
    const g = e.target.closest("[data-game]");
    if (!g) return;
    S.game = GAMES[+g.dataset.game];
    sort = "price-asc"; $("sort").value = sort;
    render(); closeFun(); ach("game");
    toast(`${S.game.ico} Cheapest laptops that run ${S.game.name} first`);
    $("summary").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  });

  // ---- Laptop battle ----
  function battle(a, b) {
    const pool = ALL.filter((p) => p.price != null && p.ramGB && p.gpuRank);
    if (!a) { a = pool[Math.floor(Math.random() * pool.length)]; do { b = pool[Math.floor(Math.random() * pool.length)]; } while (b === a); }
    const rounds = [
      ["🎮", "Graphics ×2", (p) => p.gpuRank || 0, (p) => p.gpu, 2],
      ["🧠", "RAM", (p) => p.ramGB || 0, (p) => (p.ramGB ? p.ramGB + "GB" : "?"), 1],
      ["💾", "Storage", (p) => p.storageGB || 0, (p) => p.storage || "?", 1],
      ["🖥️", "Screen", (p) => p.screenIn || 0, (p) => p.screen || "?", 1],
      ["💵", "Price (cheaper wins)", (p) => -(p.price || 1e9), (p) => money(p.price), 1],
    ];
    let sa = 0, sb = 0;
    const rows = rounds.map(([ico, name, val, show, pts]) => {
      const x = val(a), y = val(b), w = x === y ? 0 : x > y ? 1 : 2;
      if (w === 1) sa += pts; if (w === 2) sb += pts;
      return `<div class="bt-row"><span class="${w === 1 ? "win" : ""}">${esc(show(a))}</span><b>${ico} ${name}</b><span class="${w === 2 ? "win" : ""}">${esc(show(b))}</span></div>`;
    });
    const winner = sa === sb ? null : sa > sb ? a : b;
    openFun("⚔️ Laptop Battle", `<div class="bt">
      <div class="bt-head"><div class="bt-f a"><small>${esc(a.store)}</small><b>${esc(fullName(a))}</b></div><div class="bt-vs">VS</div><div class="bt-f b"><small>${esc(b.store)}</small><b>${esc(fullName(b))}</b></div></div>
      <div class="bt-rows">${rows.map((r, i) => r.replace('class="bt-row"', `class="bt-row" style="animation-delay:${calm ? 0 : i * 450}ms"`)).join("")}</div>
      <div class="bt-res" style="animation-delay:${calm ? 0 : rounds.length * 450}ms">${winner ? `👑 <b>${esc(fullName(winner))}</b> wins ${Math.max(sa, sb)}–${Math.min(sa, sb)}!` : `🤝 It's a draw, ${sa}–${sb}!`}</div>
      <div class="hl-btns"><button type="button" class="btn" data-detail="${a.id}">Left details</button><button type="button" class="btn primary" data-battle>⚔️ New battle</button><button type="button" class="btn" data-detail="${b.id}">Right details</button></div></div>`);
    setTimeout(() => { const r = $("fun-body").getBoundingClientRect(); if (winner) confetti(r.left + r.width / 2, r.top + 60); ach("battle"); }, calm ? 0 : rounds.length * 450 + 200);
  }
  $("battle-btn").addEventListener("click", () => {
    if (compare.length >= 2) battle(byId.get(compare[0]), byId.get(compare[1])); else battle();
  });
  $("fun-body").addEventListener("click", (e) => { if (e.target.closest("[data-battle]")) battle(); });

  // ---- Budget slider: the strongest laptop your money buys ----
  $("budget-btn").addEventListener("click", () => {
    openFun("💰 What does my budget buy?", `<div class="bud"><p class="bud-val">$<b id="bud-n">1000</b></p>
      <input type="range" id="bud" min="200" max="4000" step="50" value="1000" aria-label="Budget in US dollars">
      <div id="bud-out"></div></div>`);
    const upd = () => {
      const v = +$("bud").value; $("bud-n").textContent = v.toLocaleString("en-US");
      const ok = ALL.filter((p) => p.price != null && p.price <= v && p.condition === "New");
      const top = ok.slice().sort((a, b) => (b.gpuRank || 0) - (a.gpuRank || 0) || (b.ramGB || 0) - (a.ramGB || 0) || a.price - b.price)[0];
      const [, emo, lbl] = top ? tier(top) : [0, "", ""];
      $("bud-out").innerHTML = top ? `<p class="quiz-n"><b>${ok.length}</b> new laptops fit. The most powerful is ${emo} <b>${lbl}</b>:</p><div class="grid one">${card(top)}</div>` : `<p>Nothing new at that price 😅</p>`;
    };
    $("bud").addEventListener("input", upd); upd(); ach("budget");
  });

  // ---- Currency switch ----
  function updCur() { $("cur-btn").textContent = currency === "LBP" ? "LL" : "$"; $("cur-btn").title = currency === "LBP" ? "Showing Lebanese pounds (at 89,500 per $). Tap for dollars" : "Show prices in Lebanese pounds"; }
  updCur();
  $("cur-btn").addEventListener("click", () => {
    currency = currency === "USD" ? "LBP" : "USD"; store("specs.cur", currency); updCur(); render();
    toast(currency === "LBP" ? "🇱🇧 Prices in Lebanese pounds (89,500 LL per $)" : "💵 Prices in US dollars");
    if (currency === "LBP") ach("cur");
  });

  // ---- Laptop of the day ----
  (function lotd() {
    const pool = ALL.filter((p) => p.price != null && p.condition === "New" && (p.steal || (p.gpuRank || 0) >= 50)).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!pool.length) return;
    const day = Math.floor(Date.now() / 864e5);
    const p = pool[(day * 2654435761) % pool.length];
    const [, emo, lbl] = tier(p);
    $("lotd").innerHTML = `<span class="lotd-star">⭐</span><span class="lotd-t"><small>Laptop of the day</small><b>${esc(fullName(p))}</b><span>${emo} ${lbl} · ${money(p.price)} at ${esc(p.store)}${p.steal ? " · 🔥 Steal" : ""}</span></span><button type="button" class="btn primary" data-detail="${p.id}" data-lotd>See it</button>`;
    $("lotd").hidden = false;
    $("lotd").addEventListener("click", (e) => { if (e.target.closest("[data-lotd]")) ach("lotd"); });
  })();
  updAch();

  // ---------- static text ----------
  (function staticText() {
    const d = new Date(DATA.snapshot + "T12:00:00");
    const when = isNaN(d) ? DATA.snapshot : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    $("stamp").textContent = `Prices as of ${when}`;
    const byStore = count(ALL, "store");
    if ($("intro-text")) $("intro-text").textContent = `${ALL.length} laptops and desktop PCs from ${byStore.size} Lebanese stores and marketplaces. Compare processor, graphics card, memory, storage, screen and price in US dollars, as listed on ${when}.`;
    if ($("storestrip")) $("storestrip").innerHTML = [...byStore].sort((a, b) => b[1] - a[1]).map(([s, n]) => `<span>${esc(s)} <b>${n}</b></span>`).join("");
    $("stores-line").textContent = [...byStore].map(([s, n]) => `${s}: ${n} listings`).join(" · ");
    $("notes").innerHTML = (DATA.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
  })();

  render();
})();
