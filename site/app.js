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
    pmin: null, pmax: null, pricedOnly: false,
  });
  let S = blank();
  let sort = "price-asc";
  let view = store("specs.view") === "table" ? "table" : "cards";
  let tableSort = null; // {key, dir}
  const compare = [];

  // ---------- filtering ----------
  function haystack(p) {
    return [p.brand, p.name, p.cpu, p.cpuFamily, p.gpu, p.gpuModel, p.ram, p.storage, p.screen, p.form, p.seller, p.extras].join(" ").toLowerCase();
  }
  ALL.forEach((p) => { p._hay = haystack(p); });

  function matches(p, skip) {
    if (S.q) {
      const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => p._hay.includes(w))) return false;
    }
    if (skip !== "form" && S.form !== "All" && p.form !== S.form) return false;
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

  function priceHTML(p) {
    return p.price != null
      ? `<div class="price"><small>USD</small>${Math.round(p.price).toLocaleString("en-US")}</div>`
      : `<div class="price none">Price on the ad</div>`;
  }

  function linkHTML(p) {
    if (!p.link) return "";
    const label = p.linkIsListing ? `View at ${p.store}` : p.store === "OLX Lebanon" ? "Open OLX search" : `Find at ${p.store}`;
    return `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  }

  function olxHTML(p) {
    const q = `${p.brand} ${p.name}`.replace(/\(.*?\)/g, " ").replace(/[^\w\s.+-]/g, " ").trim().split(/\s+/).slice(0, 5).join(" ");
    const url = "https://www.olx.com.lb/ads/q-" + encodeURIComponent(q.toLowerCase().replace(/\s+/g, "-")) + "/";
    return `<a class="olx" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Search on OLX ↗</a>`;
  }

  function badges(p) {
    const b = [];
    if (p.use === "Gaming") b.push('<span class="badge gaming">Gaming</span>');
    if (p.subtype && p.subtype !== p.form && p.subtype !== "Gaming PC") b.push(`<span class="badge">${esc(p.subtype)}</span>`);
    if (p.oled) b.push('<span class="badge">OLED</span>');
    if (p.touch) b.push('<span class="badge">Touch</span>');
    if (p.condition !== "New") b.push(`<span class="badge cond">${esc(p.condition)}</span>`);
    return b.join("");
  }

  function card(p) {
    const picked = compare.includes(p.id);
    return `<article class="card${picked ? " picked" : ""}">
      <div class="card-top">
        <div class="eyebrow"><span class="who">${esc(p.brand)} · ${esc(p.form)}</span>
          <label class="cmp" for="c-${p.id}"><input type="checkbox" id="c-${p.id}" data-cmp="${p.id}"${picked ? " checked" : ""}>Compare</label></div>
        <h3>${esc(p.name)}</h3>
        <div class="badges">${badges(p)}</div>
      </div>
      <dl class="specs">${specRows(p)}</dl>
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
      $("results").innerHTML = `<div class="empty"><h3>Nothing matches these filters</h3><p>Remove a filter above or <button type="button" class="linkbtn" data-reset>clear all filters</button>.</p></div>`;
    } else if (view === "table") {
      $("results").innerHTML = table(list);
    } else {
      $("results").innerHTML = `<div class="grid">${list.map(card).join("")}</div>`;
    }
    renderTray();
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
