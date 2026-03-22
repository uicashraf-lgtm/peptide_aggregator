(function () {
  'use strict';

  const UI = window.PA_UI || {
    api_base: '', sse_url: '', popular: [], categories: [], suppliers: [],
    price_ranges: [], sort_options: ['Popularity'],
  };

  const API = (UI.api_base || '').replace(/\/$/, '');
  const REST = (UI.rest_base || '').replace(/\/$/, '');
  const SSE_URL = UI.sse_url || '';
  let sseSource = null;

  // ─── Utility ─────────────────────────────────────────────────────────────
  // Formulation keywords used for detail-view vendor filtering.
  // Order matters: most specific first so the first match wins.
  var FORMULATIONS = [
    { key: 'vial',    label: 'Vial',     terms: ['vial'] },
    { key: 'tablet',  label: 'Tablets',  terms: ['tablet', 'tab', 'capsule', 'caps'] },
    { key: 'topical', label: 'Topical',  terms: ['topical', 'cream', 'gel', 'patch', 'lotion'] },
    { key: 'spray',   label: 'Spray',    terms: ['spray', 'nasal'] },
  ];

  function getFormulationKey(str) {
    var s = (str || '').toLowerCase();
    for (var i = 0; i < FORMULATIONS.length; i++) {
      var f = FORMULATIONS[i];
      for (var j = 0; j < f.terms.length; j++) {
        if (s.includes(f.terms[j])) return f.key;
      }
    }
    return null;
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(price, currency) {
    if (price == null) return '—';
    return '$' + Number(price).toFixed(2);
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // Category → colour mapping
  const CAT_COLORS = {
    'GLP-1': '#2a5fa3', 'Healing': '#1e6b4a', 'Blends': '#5a3a8a',
    'Growth Hormones': '#7a3a10', 'Hormones & Reproductive': '#6b1e3a',
    'Sleep & Recovery': '#1a5a6b', 'Accessories': '#4a4a2a',
  };
  function catColor(cat) { return CAT_COLORS[cat] || '#2a3f5a'; }

  // Return the custom display label for a dose, or the original if none is set
  function getDoseLabel(productName, originalLabel) {
    var key = (productName || '').toLowerCase().trim();
    var labelMap = (UI.dose_labels && UI.dose_labels[key]) || {};
    // Normalize: lowercase + strip whitespace so "5 mg" and "5mg" both match
    var norm = (originalLabel || '').toLowerCase().replace(/\s+/g, '');
    return labelMap[norm] || labelMap[originalLabel] || originalLabel;
  }

  // ─── State ────────────────────────────────────────────────────────────────
  const state = {
    activeFilters: new Set(),
    modalOpen: false,
    draft: {
      toggles: { instock: false, kits: false, blends: false, likes: false },
      categories: new Set(),
      suppliers: new Set(),
      priceRanges: new Set(),
      sort: (UI.sort_options && UI.sort_options[0]) || 'Popularity',
      usOnly: false, categoryQuery: '', supplierQuery: '',
    },
    applied: null,

    allProducts: [],
    barFilters: { coupon: false, favourites: false, usOnly: false, kits: false },
    priceMode: 'total', // 'total' or 'mgml'
    favourites: new Set(JSON.parse(localStorage.getItem('pa_favs') || '[]')),
    activeDosages: {}, // productId -> dosage index
    tagFilters: new Set(), // tags selected from popular chips
    detailPriceMode: 'total', // price toggle in detail view
    detailDosages: [],        // available dosages for current detail product
    detailActiveDosage: 0,    // selected dosage index in detail view
    detailProductName: '',    // product name shown in detail view
    detailStockFilter: 'all',       // 'all' | 'instock'
    detailTypeFilter: 'all',        // 'all' | 'kit' | 'vial'
    detailFormulationFilter: 'all', // 'all' | formulation key
    detailProductTags: [],          // tags of the current detail product
    detailSortDir: 'asc',     // 'asc' | 'desc'
    detailSupplierFilter: new Set(), // selected vendor names (empty = all)
    detailSupplierDraft: new Set(),  // draft while modal is open
    detailCurrentVendors: [],        // full unfiltered vendor list for current dosage
  };

  function copyDraft(src) {
    return {
      toggles: { ...src.toggles },
      categories: new Set(src.categories),
      suppliers: new Set(src.suppliers),
      priceRanges: new Set(src.priceRanges),
      sort: src.sort, usOnly: src.usOnly,
      categoryQuery: src.categoryQuery || '',
      supplierQuery: src.supplierQuery || '',
    };
  }

  // ─── Dosage grouping ────────────────────────────────────────
  var DOSAGE_RE = /\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?)$/i;

  function parseDosage(name) {
    var m = name.match(DOSAGE_RE);
    if (m) return { base: name.slice(0, name.length - m[0].length).trim(), dosage: m[1].replace(/\s+/g, '').toLowerCase().replace(/(\d)([a-z])/, '$1 $2') };
    return { base: name, dosage: null };
  }

  function groupByDosage(products) {
    var map = {};
    var order = [];
    products.forEach(function (p) {
      var pd = parseDosage(p.name);
      var key = pd.base.toLowerCase();
      if (!map[key]) {
        map[key] = {
          id: p.id, name: pd.base, category: p.category,
          description: p.description, dosages: [],
          top_vendors: p.top_vendors, min_price: p.min_price,
          vendor_count: p.vendor_count,
          tags: p.tags || [],
          available_dosages: p.available_dosages || [],
        };
        order.push(key);
      }
      var grp = map[key];
      // Merge tags from all variants into the group
      (p.tags || []).forEach(function(t) { if (grp.tags.indexOf(t) === -1) grp.tags.push(t); });
      // Merge available_dosages (objects with {label, vendors})
      (p.available_dosages || []).forEach(function(d) {
        var lbl = (d.label || d).toLowerCase();
        var existing = grp.available_dosages.find(function(x) { return (x.label || x).toLowerCase() === lbl; });
        if (existing) {
          // Merge vendors from duplicate dosage, skip vendors already present
          (d.vendors || []).forEach(function(v) {
            if (!existing.vendors.some(function(ev) { return ev.vendor === v.vendor; })) {
              existing.vendors.push(v);
            }
          });
          // Re-sort by price
          existing.vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        } else {
          grp.available_dosages.push(d);
        }
      });
      if (pd.dosage) {
        grp.dosages.push({ label: pd.dosage, id: p.id, top_vendors: p.top_vendors, min_price: p.min_price, vendor_count: p.vendor_count });
      } else {
        // Merge top_vendors from duplicate products
        (p.top_vendors || []).forEach(function(v) {
          if (!(grp.top_vendors || []).some(function(ev) { return ev.vendor === v.vendor; })) {
            grp.top_vendors = grp.top_vendors || [];
            grp.top_vendors.push(v);
          }
        });
        if (grp.top_vendors) grp.top_vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        grp.vendor_count = (grp.vendor_count || 0) + (p.vendor_count || 0);
        if (p.min_price != null && (grp.min_price == null || p.min_price < grp.min_price)) grp.min_price = p.min_price;
      }
    });
    // Sort dosage pills by numeric value
    order.forEach(function (k) {
      map[k].dosages.sort(function (a, b) {
        return parseFloat(a.label) - parseFloat(b.label);
      });
      // Use first dosage variant's vendors as default
      if (map[k].dosages.length > 0) {
        var first = map[k].dosages[0];
        map[k].id = first.id;
        map[k].top_vendors = first.top_vendors;
        map[k].min_price = first.min_price;
        map[k].vendor_count = first.vendor_count;
      }
    });
    return order.map(function (k) { return map[k]; });
  }

  // ─── Product grid ─────────────────────────────────────────────────────────
  async function loadAllProducts() {
    try {
      const res = await fetch((REST || API + '/api') + '/products');
      const raw = await res.json();
      state.allProducts = groupByDosage(raw);
      renderProductGrid(state.allProducts);
    } catch (e) {
      const grid = document.getElementById('pa-product-grid');
      if (grid) grid.innerHTML = '<p class="pa-error">Could not load products. Is the API running?</p>';
    }
  }

  function filteredProducts() {
    let list = state.allProducts.slice();
    const q = (document.getElementById('pa-search') || {}).value || '';
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(function (p) { return p.name.toLowerCase().includes(lq); });
    }
    // In Stock Only (from modal filter — uses real in_stock boolean from API)
    if (state.applied && state.applied.toggles.instock) {
      list = list.filter(function (p) {
        return (p.top_vendors || []).some(function (v) { return v.in_stock === true; });
      });
    }
    if (state.barFilters.coupon) {
      list = list.filter(function (p) {
        return (p.top_vendors || []).some(function (v) { return !!v.coupon_code; });
      });
    }
    if (state.barFilters.favourites) {
      list = list.filter(function (p) { return state.favourites.has(p.id); });
    }
    if (state.barFilters.kits) {
      list = list.filter(function (p) {
        return (p.tags || []).some(function (t) { return t.toLowerCase() === 'kit'; }) ||
               p.name.toLowerCase().includes('kit');
      });
    }
    // Tag filter (from popular chips)
    if (state.tagFilters.size > 0) {
      list = list.filter(function (p) {
        return Array.from(state.tagFilters).some(function (tag) {
          var tl = tag.toLowerCase();
          return (p.category && p.category.toLowerCase() === tl) ||
                 (p.tags || []).some(function (t) { return t.toLowerCase() === tl; }) ||
                 p.name.toLowerCase().includes(tl);
        });
      });
    }
    const sort = (document.getElementById('pa-grid-sort') || {}).value || 'name';
    list.sort(function (a, b) {
      if (sort === 'price_asc') return (a.min_price || 9999) - (b.min_price || 9999);
      if (sort === 'price_desc') return (b.min_price || 0) - (a.min_price || 0);
      if (sort === 'vendors') return b.vendor_count - a.vendor_count;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  function renderProductGrid(products) {
    const grid = document.getElementById('pa-product-grid');
    const countEl = document.getElementById('pa-grid-count');
    if (!grid) return;
    if (!products || products.length === 0) {
      grid.innerHTML = '<p class="pa-no-prices">No products found.</p>';
      if (countEl) countEl.textContent = '0 Results';
      return;
    }
    if (countEl) countEl.textContent = products.length + ' Result' + (products.length === 1 ? '' : 's');
    grid.innerHTML = '';
    products.forEach(function (p) {
      const card = buildProductCard(p);
      grid.appendChild(card);
    });
  }

  function vendorInitials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function buildVendorRow(v, isBest) {
    const row = el('div', 'pa-pcard-vendor-row' + (isBest ? ' is-best' : ''));

    // Avatar
    const avatar = el('div', 'pa-pcard-avatar');
    if (v.logo_url) {
      const img = document.createElement('img');
      img.src = v.logo_url; img.alt = v.vendor;
      avatar.appendChild(img);
    } else {
      avatar.textContent = vendorInitials(v.vendor);
    }
    row.appendChild(avatar);

    // Name + product name + status
    const info = el('div', 'pa-pcard-vinfo');
    info.appendChild(el('span', 'pa-pcard-vname', escHtml(v.vendor)));
    if (v.product_name) {
      info.appendChild(el('span', 'pa-pcard-vprod', escHtml(v.product_name)));
    }
    const status = el('span', 'pa-pcard-status' + (v.in_stock !== false ? ' is-instock' : ' is-oos'));
    status.textContent = v.in_stock !== false ? '\u25cf In Stock' : '\u25cf Out of Stock';
    info.appendChild(status);
    row.appendChild(info);

    // Right side: coupon + price + link
    const right = el('div', 'pa-pcard-vright');
    if (v.coupon_code) {
      const coupon = el('span', 'pa-coupon-badge');
      coupon.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span class="pa-coupon-text">' + escHtml(v.coupon_code) + '</span>';
      const copyBtn = el('button', 'pa-coupon-copy', '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
      copyBtn.title = 'Copy code';
      copyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        navigator.clipboard && navigator.clipboard.writeText(v.coupon_code);
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(function () { copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, 1500);
      });
      coupon.appendChild(copyBtn);
      right.appendChild(coupon);
    }
    const priceWrap = el('div', 'pa-pcard-price-wrap');
    const pricePer = v.price_per_mg != null ? v.price_per_mg
      : (v.price != null && v.amount_mg ? v.price / v.amount_mg : null);
    const showPerMg = state.priceMode === 'mgml' && pricePer != null;
    const displayPrice = showPerMg
      ? '$' + Number(pricePer).toFixed(1) + '/' + (v.amount_unit || 'mg')
      : fmt(v.price, v.currency);
    priceWrap.appendChild(el('span', 'pa-pcard-price', escHtml(displayPrice)));
    // Show previous price (crossed out) when it differs from current
    if (v.previous_price != null && v.previous_price !== v.price) {
      var prevPer = v.amount_mg ? v.previous_price / v.amount_mg : null;
      var prevDisplay = (showPerMg && prevPer != null)
        ? '$' + Number(prevPer).toFixed(1) + '/' + (v.amount_unit || 'mg')
        : fmt(v.previous_price, v.currency);
      priceWrap.appendChild(el('span', 'pa-pcard-price-prev', escHtml(prevDisplay)));
    }
    right.appendChild(priceWrap);
    if (v.link) {
      const a = document.createElement('a');
      a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'pa-pcard-extlink';
      a.innerHTML = '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      right.appendChild(a);
    }
    row.appendChild(right);
    return row;
  }

  function buildProductCard(p) {
    const card = el('div', 'pa-pcard');
    const color = catColor(p.category);

    // Header row: name + icons (no category badge here — moved to tag row below)
    const head = el('div', 'pa-pcard-head');
    const headLeft = el('div', 'pa-pcard-head-left');
    headLeft.appendChild(el('h3', 'pa-pcard-name', escHtml(p.name)));
    head.appendChild(headLeft);
    const headIcons = el('div', 'pa-pcard-head-icons');
    // Info button
    const infoBtn = el('button', 'pa-icon-btn', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>');
    infoBtn.title = 'Info'; infoBtn.type = 'button';
    infoBtn.addEventListener('click', function (e) { e.stopPropagation(); loadProductDetail(p.id, p.name); });
    // Share button
    const shareBtn = el('button', 'pa-icon-btn', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>');
    shareBtn.title = 'Share'; shareBtn.type = 'button';
    shareBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (navigator.share) { navigator.share({ title: p.name, url: window.location.href }); }
      else { navigator.clipboard && navigator.clipboard.writeText(window.location.href); }
    });
    // Favourite button
    const isFav = state.favourites.has(p.id);
    const favBtn = el('button', 'pa-icon-btn' + (isFav ? ' is-fav' : ''), '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>');
    favBtn.title = 'Favourite'; favBtn.type = 'button';
    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.favourites.has(p.id)) { state.favourites.delete(p.id); }
      else { state.favourites.add(p.id); }
      localStorage.setItem('pa_favs', JSON.stringify(Array.from(state.favourites)));
      renderProductGrid(filteredProducts());
    });
    headIcons.appendChild(infoBtn);
    headIcons.appendChild(shareBtn);
    headIcons.appendChild(favBtn);
    head.appendChild(headIcons);
    card.appendChild(head);

    // Tag row: category badge + semantic tags from API
    var allTagItems = [];
    if (p.category) allTagItems.push({ text: p.category, isCat: true });
    (p.tags || []).forEach(function(t) { allTagItems.push({ text: t, isCat: false }); });
    var tagRow = el('div', 'pa-pcard-tags');
    allTagItems.forEach(function(t) {
      var badge = el('span', t.isCat ? 'pa-cat-badge' : 'pa-tag-badge');
      badge.textContent = t.text;
      if (t.isCat) badge.style.cssText = 'background:' + color + '33;color:#c8deff;border-color:' + color + '88';
      badge.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!state.tagFilters.has(t.text)) state.tagFilters.add(t.text);
        renderPopular();
        renderActiveFilters();
        renderProductGrid(filteredProducts());
      });
      tagRow.appendChild(badge);
    });
    card.appendChild(tagRow);

    // Build dosage list: prefer available_dosages from API (has per-dosage vendors).
    var dosages;
    if (p.available_dosages && p.available_dosages.length >= 1) {
      dosages = p.available_dosages.map(function(d) {
        var lbl = (d && typeof d === 'object') ? String(d.label || '') : String(d || '');
        var vendors = (d && d.vendors) ? d.vendors : p.top_vendors || [];
        return { label: lbl, id: p.id, top_vendors: vendors, vendor_count: vendors.length };
      }).filter(function(d) { return d.label; });
    } else {
      dosages = p.dosages || [];
    }
    const vendorList = el('div', 'pa-pcard-vendors');

    function renderVendorRows(vList, vendors) {
      vList.innerHTML = '';
      if (vendors && vendors.length > 0) {
        vendors.forEach(function (v, i) { vList.appendChild(buildVendorRow(v, i === 0)); });
      } else {
        vList.appendChild(el('p', 'pa-pcard-empty', 'No prices scraped yet'));
      }
    }

    if (dosages.length >= 1) {
      var dosageRow = el('div', 'pa-pcard-dosage');
      dosageRow.appendChild(el('span', 'pa-dosage-label', 'Dosage:'));

      var scrollWrap = el('div', 'pa-dosage-scroll-wrap');
      var leftBtn = el('button', 'pa-dosage-arrow', '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>');
      leftBtn.type = 'button'; leftBtn.title = 'Scroll left';
      leftBtn.addEventListener('click', function(e) { e.stopPropagation(); pillsContainer.scrollLeft -= 130; });
      var pillsContainer = el('div', 'pa-dosage-pills');
      var rightBtn = el('button', 'pa-dosage-arrow', '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>');
      rightBtn.type = 'button'; rightBtn.title = 'Scroll right';
      rightBtn.addEventListener('click', function(e) { e.stopPropagation(); pillsContainer.scrollLeft += 130; });

      var activeIdx = state.activeDosages[p.id] || 0;
      if (activeIdx >= dosages.length) activeIdx = 0;

      dosages.forEach(function (d, idx) {
        var isActive = idx === activeIdx;
        var displayLabel = getDoseLabel(p.name, d.label);
        var pillHtml = (isActive ? '<svg class="pa-pill-star" viewBox="0 0 12 12" width="10" height="10" fill="currentColor"><path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5 2.9 10.1l.6-3.4L1 4.3l3.6-.5z"/></svg>' : '') + escHtml(displayLabel);
        var pill = el('button', 'pa-dosage-pill' + (isActive ? ' is-active' : ''), pillHtml);
        pill.type = 'button';
        pill.addEventListener('click', function (e) {
          e.stopPropagation();
          state.activeDosages[p.id] = idx;
          pillsContainer.querySelectorAll('.pa-dosage-pill').forEach(function (x) {
            x.classList.remove('is-active');
            x.querySelector('.pa-pill-star') && x.querySelector('.pa-pill-star').remove();
          });
          pill.classList.add('is-active');
          if (!pill.querySelector('.pa-pill-star')) {
            var star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            star.setAttribute('class', 'pa-pill-star'); star.setAttribute('viewBox', '0 0 12 12');
            star.setAttribute('width', '10'); star.setAttribute('height', '10');
            star.setAttribute('fill', 'currentColor');
            star.innerHTML = '<path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5 2.9 10.1l.6-3.4L1 4.3l3.6-.5z"/>';
            pill.insertBefore(star, pill.firstChild);
          }
          p._activeId = d.id;
          renderVendorRows(vendorList, d.top_vendors);
          var moreEl = card.querySelector('.pa-pcard-more');
          if (moreEl) {
            var extra = (d.vendor_count || 0) - (d.top_vendors || []).length;
            moreEl.textContent = extra > 0 ? '+' + extra + ' more' : '';
          }
        });
        pillsContainer.appendChild(pill);
      });

      scrollWrap.appendChild(leftBtn);
      scrollWrap.appendChild(pillsContainer);
      scrollWrap.appendChild(rightBtn);
      if (dosages.length > 4) {
        scrollWrap.appendChild(el('span', 'pa-dosage-more', '+' + (dosages.length - 4) + ' more'));
      }
      dosageRow.appendChild(scrollWrap);
      card.appendChild(dosageRow);
    }

    // Vendor rows — use active dosage's vendors if available, else top_vendors
    var activeIdx = state.activeDosages[p.id] || 0;
    var activeDosage = dosages.length > 0 ? dosages[Math.min(activeIdx, dosages.length - 1)] : null;
    var defaultVendors = (activeDosage && activeDosage.top_vendors && activeDosage.top_vendors.length > 0)
      ? activeDosage.top_vendors
      : p.top_vendors;
    renderVendorRows(vendorList, defaultVendors);
    card.appendChild(vendorList);

    // Footer
    const foot = el('div', 'pa-pcard-foot');
    var firstDosageCount = dosages.length > 0 ? (dosages[0].vendor_count || (dosages[0].top_vendors || []).length) : 0;
    var defaultCount = firstDosageCount || p.vendor_count;
    var defaultShown = (dosages.length > 0 && dosages[0].top_vendors) ? dosages[0].top_vendors.length : (p.top_vendors || []).length;
    const extra = defaultCount - defaultShown;
    if (extra > 0) foot.appendChild(el('span', 'pa-pcard-more', '+' + extra + ' more'));
    const arrow = el('button', 'pa-pcard-arrow', '&#8594;');
    arrow.type = 'button';
    arrow.title = 'View all prices';
    foot.appendChild(arrow);
    card.appendChild(foot);

    card.addEventListener('click', function () { loadProductDetail(p._activeId || p.id, p.name); });
    return card;
  }

  // ─── Product detail ────────────────────────────────────────────────────────
  async function loadProductDetail(productId, productName) {
    const grid   = document.getElementById('pa-product-grid');
    const bar    = document.getElementById('pa-results-bar');
    const detail = document.getElementById('pa-product-detail');
    const searchPanel = document.querySelector('.pa-search-panel');
    const nameEl = document.getElementById('pa-detail-name');
    const catEl = document.getElementById('pa-detail-category');
    const descEl = document.getElementById('pa-detail-description');
    const pricesEl = document.getElementById('pa-detail-prices');

    if (grid)        grid.classList.add('pa-hidden');
    if (bar)         bar.classList.add('pa-hidden');
    if (searchPanel) searchPanel.classList.add('pa-hidden');
    if (detail)      detail.classList.add('pa-visible');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (nameEl) nameEl.textContent = productName;
    if (pricesEl) pricesEl.innerHTML = '';
    state.detailProductName = productName;
    state.detailStockFilter = 'all';
    state.detailTypeFilter = 'all';
    state.detailFormulationFilter = 'all';
    state.detailProductTags = [];
    state.detailSortDir = 'asc';

    // Find product data — try exact id first, then by name
    var pData = state.allProducts.find(function (x) { return x.id === productId; }) ||
                state.allProducts.find(function (x) { return x.name.toLowerCase() === productName.toLowerCase(); });
    state.detailProductTags = (pData && pData.tags) || [];

    // Populate head icons (share + favourite)
    var iconsEl = document.getElementById('pa-detail-head-icons');
    if (iconsEl) {
      iconsEl.innerHTML = '';
      var shareBtn = el('button', 'pa-icon-btn', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>');
      shareBtn.title = 'Share'; shareBtn.type = 'button';
      shareBtn.addEventListener('click', function () {
        if (navigator.share) navigator.share({ title: productName, url: window.location.href });
        else navigator.clipboard && navigator.clipboard.writeText(window.location.href);
      });
      var pid = pData ? pData.id : productId;
      var isFav = state.favourites.has(pid);
      var favBtn = el('button', 'pa-icon-btn' + (isFav ? ' is-fav' : ''), '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>');
      favBtn.title = 'Favourite'; favBtn.type = 'button';
      favBtn.addEventListener('click', function () {
        if (state.favourites.has(pid)) state.favourites.delete(pid);
        else state.favourites.add(pid);
        localStorage.setItem('pa_favs', JSON.stringify(Array.from(state.favourites)));
        var svg = favBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', state.favourites.has(pid) ? 'currentColor' : 'none');
        favBtn.classList.toggle('is-fav', state.favourites.has(pid));
      });
      iconsEl.appendChild(shareBtn);
      iconsEl.appendChild(favBtn);
    }

    if (catEl) {
      catEl.textContent = (pData && pData.category) || '';
      catEl.style.display = (pData && pData.category) ? '' : 'none';
      if (pData && pData.category) {
        const c = catColor(pData.category);
        catEl.style.background = c + '55';
        catEl.style.borderColor = c;
      }
    }
    if (descEl) {
      descEl.textContent = (pData && pData.description) || '';
      descEl.style.display = (pData && pData.description) ? '' : 'none';
    }

    // Fetch all listings for this product from API (includes all listings per vendor)
    try {
      var pId = (pData && pData.id) || productId;
      const res = await fetch((REST || API + '/api') + '/products/' + pId + '/prices');
      const allPrices = await res.json();

      // Build dosage groups from all listings (no dedup — show every listing)
      var dosageMap = {};
      var dosageOrder = [];
      var DOSAGE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\b/i;
      allPrices.forEach(function(v) {
        var lbl = null;
        if (v.amount_mg != null && v.amount_unit) {
          var amt = v.amount_mg == Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
          lbl = amt + ' ' + (v.amount_unit || 'mg').toLowerCase();
        }
        if (!lbl) {
          var m = (v.product || '').match(DOSAGE_RE);
          if (m) lbl = m[1] + ' ' + m[2].toLowerCase();
        }
        if (!lbl) lbl = 'default';
        if (!dosageMap[lbl]) { dosageMap[lbl] = []; dosageOrder.push(lbl); }
        dosageMap[lbl].push(v);
      });
      // Sort dosage labels numerically
      dosageOrder.sort(function(a, b) {
        var na = parseFloat(a) || 0, nb = parseFloat(b) || 0;
        return na - nb;
      });
      var dosages = dosageOrder.map(function(lbl) {
        return {
          label: lbl,
          vendors: dosageMap[lbl].sort(function(a, b) {
            return (a.effective_price == null) - (b.effective_price == null) || (a.effective_price || 0) - (b.effective_price || 0);
          }).map(function(v) {
            return {
              vendor: v.vendor, price: v.effective_price, previous_price: v.previous_price,
              currency: v.currency, listing_id: v.listing_id, product_name: v.product_name || v.product,
              amount_mg: v.amount_mg, amount_unit: v.amount_unit, price_per_mg: v.price_per_mg,
              link: v.link, logo_url: v.logo_url, coupon_code: v.coupon_code,
              country: v.country, in_stock: v.in_stock
            };
          })
        };
      });
      // Remove 'default' label if it's the only one
      if (dosages.length === 1 && dosages[0].label === 'default') dosages[0].label = '';

      var initialIdx = 0;
      dosages.forEach(function(d, i) {
        if ((d.vendors || []).some(function(v) { return v.listing_id === productId; })) initialIdx = i;
      });
      state.detailActiveDosage = initialIdx;
      state.detailDosages = dosages;

      if (dosages.length > 0) {
        renderDetailDosageGrid();
      } else {
        var sec = document.getElementById('pa-detail-dosage-section');
        if (sec) sec.style.display = 'none';
        renderDetailPricesFallback(allPrices);
      }
    } catch (e) {
      if (pricesEl) pricesEl.innerHTML = '<p class="pa-error">Error loading prices.</p>';
    }
  }

  function renderDetailDosageGrid() {
    var dosages = state.detailDosages;
    var activeIdx = state.detailActiveDosage;
    var grid = document.getElementById('pa-detail-dosage-grid');
    var sec = document.getElementById('pa-detail-dosage-section');
    if (!grid) return;
    if (sec) sec.style.display = '';
    grid.innerHTML = '';

    dosages.forEach(function(d, idx) {
      var vendors = d.vendors || [];
      var prices = vendors.map(function(v) { return v.price || 0; }).filter(function(p) { return p > 0; });
      var minPrice = prices.length ? Math.min.apply(null, prices) : null;
      var pricePer = null;
      if (state.detailPriceMode === 'mgml' && vendors.length) {
        var ppm = vendors[0].price_per_mg != null ? vendors[0].price_per_mg : (vendors[0].price && vendors[0].amount_mg ? vendors[0].price / vendors[0].amount_mg : null);
        if (ppm != null) pricePer = ppm;
      }
      var isActive = idx === activeIdx;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-ddosage-btn' + (isActive ? ' is-active' : '');

      var labelSpan = el('span', 'pa-ddosage-label');
      var displayLabel = getDoseLabel(state.detailProductName, d.label);
      if (isActive) {
        labelSpan.innerHTML = '<svg class="pa-pill-star" viewBox="0 0 12 12" width="10" height="10" fill="currentColor" style="margin-right:3px"><path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5 2.9 10.1l.6-3.4L1 4.3l3.6-.5z"/></svg>' + escHtml(displayLabel);
      } else {
        labelSpan.textContent = displayLabel;
      }
      btn.appendChild(labelSpan);

      if (minPrice != null) {
        var priceDisplay = (pricePer != null) ? ('$' + Number(pricePer).toFixed(1) + '/' + (vendors[0].amount_unit || 'mg')) : fmt(minPrice, 'USD');
        btn.appendChild(el('span', 'pa-ddosage-price', priceDisplay));
      }

      btn.addEventListener('click', function() {
        state.detailActiveDosage = idx;
        renderDetailDosageGrid();
        renderDetailVendors(d.vendors || []);
      });
      grid.appendChild(btn);
    });

    // Render vendor list for currently active dosage
    renderDetailVendors((dosages[activeIdx] && dosages[activeIdx].vendors) ? dosages[activeIdx].vendors : []);
  }

  function renderDetailVendors(vendors) {
    var el2 = document.getElementById('pa-detail-prices');
    if (!el2) return;
    el2.innerHTML = '';

    var dosages = state.detailDosages;
    var activeIdx = state.detailActiveDosage;
    var rawDosageLabel = (dosages[activeIdx] && dosages[activeIdx].label) ? dosages[activeIdx].label : '';
    var productName = state.detailProductName || '';
    var dosageLabel = getDoseLabel(productName, rawDosageLabel);

    // ── Top bar ──────────────────────────────────────────────────────────────
    var bar = el('div', 'pa-detail-prices-bar');

    // Left: tag icon + title + subtitle
    var barLeft = el('div', 'pa-dpbar-left');
    barLeft.innerHTML = '<svg class="pa-dpbar-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    var barTitles = el('div', 'pa-dpbar-titles');
    barTitles.appendChild(el('span', 'pa-dpbar-title', 'Prices'));
    if (productName || dosageLabel) {
      barTitles.appendChild(el('span', 'pa-dpbar-subtitle', escHtml([productName, dosageLabel].filter(Boolean).join(' \u2022 '))));
    }
    barLeft.appendChild(barTitles);
    bar.appendChild(barLeft);

    // Center: stock filter + type filter
    var barCenter = el('div', 'pa-dpbar-center');
    ['all', 'instock'].forEach(function(mode) {
      var btn = el('button', 'pa-dpbar-stock-btn' + (state.detailStockFilter === mode ? ' is-active' : ''), mode === 'all' ? 'All' : 'In Stock');
      btn.type = 'button';
      btn.addEventListener('click', function() { state.detailStockFilter = mode; renderDetailVendors(vendors); });
      barCenter.appendChild(btn);
    });
    var typeSep = el('span', 'pa-dpbar-sep');
    barCenter.appendChild(typeSep);
    [['all', 'All'], ['vial', 'Vials'], ['kit', 'Kits']].forEach(function(pair) {
      var mode = pair[0], label = pair[1];
      var btn = el('button', 'pa-dpbar-stock-btn' + (state.detailTypeFilter === mode ? ' is-active' : ''), label);
      btn.type = 'button';
      btn.addEventListener('click', function() { state.detailTypeFilter = mode; renderDetailVendors(vendors); });
      barCenter.appendChild(btn);
    });
    bar.appendChild(barCenter);

    // Right: formulation select (dynamic) + sort + suppliers
    var barRight = el('div', 'pa-dpbar-right');

    // Formulation toggle buttons — always visible, same style as Vial/Kit type buttons.
    var formSep = el('span', 'pa-dpbar-sep');
    barRight.appendChild(formSep);
    [{ key: 'all', label: 'All' }].concat(FORMULATIONS).forEach(function(f) {
      var btn = el('button', 'pa-dpbar-stock-btn' + (state.detailFormulationFilter === f.key ? ' is-active' : ''), f.label);
      btn.type = 'button';
      btn.addEventListener('click', function() { state.detailFormulationFilter = f.key; renderDetailVendors(vendors); });
      barRight.insertBefore(btn, formSep);
    });

    var sortBtn = el('button', 'pa-dpbar-sort-btn', 'Price <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="' + (state.detailSortDir === 'asc' ? '18 11 12 5 6 11' : '6 13 12 19 18 13') + '"/></svg>');
    sortBtn.type = 'button';
    sortBtn.addEventListener('click', function() { state.detailSortDir = state.detailSortDir === 'asc' ? 'desc' : 'asc'; renderDetailVendors(vendors); });

    var selCount = state.detailSupplierFilter.size;
    var supplierLabel = selCount > 0
      ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' + selCount + ' Selected'
      : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>All Suppliers';
    var supplierBtn = el('button', 'pa-dpbar-supplier-btn' + (selCount > 0 ? ' is-active' : ''), supplierLabel);
    supplierBtn.type = 'button';
    supplierBtn.addEventListener('click', function() { openDetailSupplierModal(vendors); });
    barRight.appendChild(sortBtn);
    barRight.appendChild(supplierBtn);
    bar.appendChild(barRight);

    el2.appendChild(bar);

    // ── Filter & sort ────────────────────────────────────────────────────────
    if (!vendors || vendors.length === 0) {
      el2.appendChild(el('p', 'pa-no-prices', 'No prices available yet.'));
      return;
    }
    var filtered = vendors.slice();
    if (state.detailStockFilter === 'instock') {
      filtered = filtered.filter(function(v) { return v.in_stock !== false; });
    }
    if (state.detailTypeFilter === 'kit') {
      filtered = filtered.filter(function(v) { return (v.product_name || '').toLowerCase().includes('kit'); });
    } else if (state.detailTypeFilter === 'vial') {
      filtered = filtered.filter(function(v) { return !(v.product_name || '').toLowerCase().includes('kit'); });
    }
    if (state.detailFormulationFilter !== 'all') {
      filtered = filtered.filter(function(v) { return getFormulationKey(v.product_name) === state.detailFormulationFilter; });
    }
    if (state.detailSupplierFilter.size > 0) {
      filtered = filtered.filter(function(v) { return state.detailSupplierFilter.has(v.vendor); });
    }
    // Deduplicate by vendor name, keeping best (lowest) price per vendor
    var vendorBest = {};
    filtered.forEach(function(v) {
      var p = v.price != null ? v.price : Infinity;
      var existing = vendorBest[v.vendor];
      var ep = existing && existing.price != null ? existing.price : Infinity;
      if (!existing || p < ep) {
        vendorBest[v.vendor] = v;
      }
    });
    filtered = Object.keys(vendorBest).map(function(k) { return vendorBest[k]; });
    filtered.sort(function(a, b) {
      var d = (a.price || 0) - (b.price || 0);
      return state.detailSortDir === 'desc' ? -d : d;
    });
    if (filtered.length === 0) {
      el2.appendChild(el('p', 'pa-no-prices', 'No vendors match the current filters.'));
      return;
    }

    // ── Vendor rows ──────────────────────────────────────────────────────────
    var wrap = el('div', 'pa-detail-vendor-list');
    filtered.forEach(function(v, i) {
      var row = el('div', 'pa-detail-vrow' + (i === 0 ? ' is-best' : ''));
      if (v.listing_id) row.setAttribute('data-listing-id', v.listing_id);

      // Left: avatar + name + stock (direct grid children)
      var avatar = el('div', 'pa-vendor-avatar');
      if (v.logo_url) {
        var img = document.createElement('img');
        img.src = v.logo_url; img.alt = v.vendor;
        avatar.appendChild(img);
      } else {
        avatar.textContent = vendorInitials(v.vendor);
      }
      var info = el('div', 'pa-vendor-info');
      info.appendChild(el('span', 'pa-vendor-name', escHtml(v.vendor)));
      if (v.product_name) {
        info.appendChild(el('span', 'pa-vendor-prodname', escHtml(v.product_name)));
      }
      var inStock = v.in_stock !== false;
      info.appendChild(el('span', 'pa-vendor-stock ' + (inStock ? 'is-in-stock' : 'is-out-of-stock'), (inStock ? 'In Stock' : 'Out of Stock')));


      // Right: coupon + price + link
      var right = el('div', 'pa-detail-vrow-right');

      if (v.coupon_code) {
        var cbWrap = el('span', 'pa-coupon-wrap');
        cbWrap.appendChild(el('span', 'pa-coupon-badge', '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span class="pa-coupon-text">' + escHtml(v.coupon_code) + '</span>'));
        var copyBtn = el('button', 'pa-coupon-copy-btn', '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
        copyBtn.type = 'button'; copyBtn.title = 'Copy coupon';
        (function(code, btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            navigator.clipboard && navigator.clipboard.writeText(code);
            btn.textContent = '\u2713';
            setTimeout(function() { btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, 1500);
          });
        })(v.coupon_code, copyBtn);
        cbWrap.appendChild(copyBtn);
        right.appendChild(cbWrap);
      }

      var pricePer = v.price_per_mg != null ? v.price_per_mg : (v.price != null && v.amount_mg ? v.price / v.amount_mg : null);
      var showPer = state.detailPriceMode === 'mgml' && pricePer != null;
      var displayPrice = showPer ? ('$' + Number(pricePer).toFixed(1) + '/' + (v.amount_unit || 'mg')) : fmt(v.price, v.currency);
      var hasPrev = v.previous_price != null && v.previous_price !== v.price;
      var priceWrap = el('div', 'pa-detail-price-wrap');
      var priceEl = el('span', 'pa-detail-price', escHtml(displayPrice) + (hasPrev ? '<sup>*</sup>' : ''));
      if (v.listing_id) priceEl.setAttribute('data-listing-id', v.listing_id);
      priceWrap.appendChild(priceEl);
      if (hasPrev) {
        priceWrap.appendChild(el('span', 'pa-detail-prev-price', escHtml(fmt(v.previous_price, v.currency))));
      }
      right.appendChild(priceWrap);

      if (v.link) {
        var a = document.createElement('a');
        a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'pa-detail-link-icon';
        a.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        a.addEventListener('click', function(e) { e.stopPropagation(); });
        right.appendChild(a);
      }

      row.appendChild(avatar); row.appendChild(info); row.appendChild(right);
      wrap.appendChild(row);
    });
    el2.appendChild(wrap);
  }

  // ─── Detail supplier filter modal ─────────────────────────────────────────
  function openDetailSupplierModal(vendors) {
    var modal = document.getElementById('pa-detail-supplier-modal');
    if (!modal) return;
    state.detailSupplierDraft = new Set(state.detailSupplierFilter);
    state.detailCurrentVendors = vendors;
    renderDsmList('');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeDsmModal() {
    var modal = document.getElementById('pa-detail-supplier-modal');
    if (modal) modal.setAttribute('aria-hidden', 'true');
  }

  function renderDsmList(query) {
    var list = document.getElementById('pa-dsm-list');
    if (!list) return;
    list.innerHTML = '';
    var seen = new Set();
    var unique = [];
    state.detailCurrentVendors.forEach(function(v) { if (!seen.has(v.vendor)) { seen.add(v.vendor); unique.push(v); } });
    var q = (query || '').toLowerCase();
    var shown = q ? unique.filter(function(v) { return v.vendor.toLowerCase().indexOf(q) >= 0; }) : unique;
    shown.forEach(function(v) {
      var checked = state.detailSupplierDraft.has(v.vendor);
      var row = el('label', 'pa-dsm-row' + (checked ? ' is-checked' : ''));
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = checked;
      cb.addEventListener('change', function() {
        if (cb.checked) state.detailSupplierDraft.add(v.vendor);
        else state.detailSupplierDraft.delete(v.vendor);
        row.classList.toggle('is-checked', cb.checked);
        updateDsmCount();
      });
      var avatar = el('div', 'pa-vendor-avatar');
      if (v.logo_url) { var img = document.createElement('img'); img.src = v.logo_url; img.alt = v.vendor; avatar.appendChild(img); }
      else { avatar.textContent = vendorInitials(v.vendor); }
      row.appendChild(cb);
      row.appendChild(avatar);
      row.appendChild(el('span', 'pa-dsm-vendor-name', escHtml(v.vendor)));
      if (v.country) row.appendChild(el('span', 'pa-dsm-country', escHtml(v.country.toUpperCase())));
      list.appendChild(row);
    });
    updateDsmCount();
  }

  function updateDsmCount() {
    var countEl = document.getElementById('pa-dsm-count');
    if (countEl) countEl.textContent = state.detailSupplierDraft.size === 0 ? 'None selected' : state.detailSupplierDraft.size + ' selected';
  }

  function bindDsmEvents() {
    var modal = document.getElementById('pa-detail-supplier-modal');
    if (!modal) return;
    modal.querySelector('[data-dsm-close]').addEventListener('click', closeDsmModal);
    document.getElementById('pa-dsm-close').addEventListener('click', closeDsmModal);
    document.getElementById('pa-dsm-cancel').addEventListener('click', closeDsmModal);
    document.getElementById('pa-dsm-apply').addEventListener('click', function() {
      state.detailSupplierFilter = new Set(state.detailSupplierDraft);
      closeDsmModal();
      renderDetailVendors(state.detailCurrentVendors);
    });
    document.getElementById('pa-dsm-clear-all').addEventListener('click', function() {
      state.detailSupplierDraft.clear(); renderDsmList(document.getElementById('pa-dsm-search').value);
    });
    document.getElementById('pa-dsm-clear-list').addEventListener('click', function() {
      state.detailSupplierDraft.clear(); renderDsmList(document.getElementById('pa-dsm-search').value);
    });
    document.getElementById('pa-dsm-select-all').addEventListener('click', function() {
      state.detailCurrentVendors.forEach(function(v) { state.detailSupplierDraft.add(v.vendor); });
      renderDsmList(document.getElementById('pa-dsm-search').value);
    });
    document.getElementById('pa-dsm-search').addEventListener('input', function() { renderDsmList(this.value); });
  }

  function renderDetailPricesFallback(prices) {
    var el2 = document.getElementById('pa-detail-prices');
    if (!el2) return;
    if (!prices || prices.length === 0) {
      el2.innerHTML = '<p class="pa-no-prices">No prices available yet. The crawler may still be running.</p>';
      return;
    }
    prices.sort(function (a, b) { return (a.effective_price || 0) - (b.effective_price || 0); });
    var wrap = el('div', 'pa-detail-vendor-list');
    prices.forEach(function (p, i) {
      var row = el('div', 'pa-detail-vrow' + (i === 0 ? ' is-best' : ''));
      row.setAttribute('data-listing-id', p.listing_id);
      var avatar = el('div', 'pa-vendor-avatar', escHtml((p.vendor || '?')[0].toUpperCase()));
      var info = el('div', 'pa-vendor-info');
      info.appendChild(el('span', 'pa-vendor-name', escHtml(p.vendor)));
      if (p.last_fetched_at) info.appendChild(el('span', 'pa-vendor-updated', 'Updated ' + new Date(p.last_fetched_at).toLocaleDateString()));
      var right = el('div', 'pa-detail-vrow-right');
      var priceEl = el('span', 'pa-detail-price', escHtml(fmt(p.effective_price, p.currency)));
      priceEl.setAttribute('data-listing-id', p.listing_id);
      right.appendChild(priceEl);
      if (p.link) {
        var a = document.createElement('a');
        a.href = p.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'pa-buy-link'; a.textContent = 'Buy \u2192';
        right.appendChild(a);
      }
      row.appendChild(avatar); row.appendChild(info); row.appendChild(right);
      wrap.appendChild(row);
    });
    el2.innerHTML = '';
    el2.appendChild(wrap);
  }

  function showProductGrid() {
    const grid   = document.getElementById('pa-product-grid');
    const bar    = document.getElementById('pa-results-bar');
    const detail = document.getElementById('pa-product-detail');
    const searchPanel = document.querySelector('.pa-search-panel');
    if (detail)      detail.classList.remove('pa-visible');
    if (grid)        grid.classList.remove('pa-hidden');
    if (bar)         bar.classList.remove('pa-hidden');
    if (searchPanel) searchPanel.classList.remove('pa-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── SSE ──────────────────────────────────────────────────────────────────
  function initSSE() {
    if (!SSE_URL || sseSource) return;
    sseSource = new EventSource(SSE_URL);
    sseSource.addEventListener('price_update', function (e) {
      try { updateLivePrice(JSON.parse(e.data)); } catch (err) {}
    });
  }

  function updateLivePrice(data) {
    if (!data || !data.listing_id) return;
    document.querySelectorAll('[data-listing-id="' + data.listing_id + '"]').forEach(function (cell) {
      cell.textContent = fmt(data.price, data.currency);
      cell.classList.add('pa-price-flash');
      setTimeout(function () { cell.classList.remove('pa-price-flash'); }, 1500);
    });
  }

  function renderPopular() {
    const host = document.getElementById('pa-popular');
    if (!host) return;
    host.innerHTML = '';
    (UI.popular || []).forEach(function (name) {
      const isActive = state.tagFilters.has(name);
      const chip = el('button', 'pa-chip' + (isActive ? ' is-active' : ''));
      chip.type = 'button';
      chip.textContent = name;
      chip.addEventListener('click', function () {
        if (state.tagFilters.has(name)) {
          state.tagFilters.delete(name);
        } else {
          state.tagFilters.add(name);
        }
        renderPopular();
        renderActiveFilters();
        renderProductGrid(filteredProducts());
        showProductGrid();
      });
      host.appendChild(chip);
    });
  }

  function renderActiveFilters() {
    const host = document.getElementById('pa-active-filters');
    if (!host) return;
    host.innerHTML = '';
    // Tag filters from popular chips
    Array.from(state.tagFilters).forEach(function (name) {
      const chip = el('button', 'pa-active-chip');
      chip.type = 'button';
      chip.innerHTML = escHtml(name) + ' <span aria-hidden="true">\u00d7</span>';
      chip.addEventListener('click', function () {
        state.tagFilters.delete(name);
        renderPopular();
        renderActiveFilters();
        renderProductGrid(filteredProducts());
      });
      host.appendChild(chip);
    });
    // Modal-applied filters
    Array.from(state.activeFilters).forEach(function (name) {
      const chip = el('button', 'pa-active-chip');
      chip.type = 'button';
      chip.innerHTML = escHtml(name) + ' <span aria-hidden="true">\u00d7</span>';
      chip.addEventListener('click', function () {
        state.activeFilters.delete(name);
        renderActiveFilters();
      });
      host.appendChild(chip);
    });
    // Show/hide the entire row based on whether any filters are active
    const row = host.closest('.pa-active-row');
    if (row) row.classList.toggle('is-visible', state.tagFilters.size > 0 || state.activeFilters.size > 0);
  }

  function syncDraftToControls() {
    const byId = function (id) { return document.getElementById(id); };
    if (byId('pa-instock-only')) byId('pa-instock-only').checked = !!state.draft.toggles.instock;
    if (byId('pa-kits-only')) byId('pa-kits-only').checked = !!state.draft.toggles.kits;
    if (byId('pa-blends-only')) byId('pa-blends-only').checked = !!state.draft.toggles.blends;
    if (byId('pa-likes-only')) byId('pa-likes-only').checked = !!state.draft.toggles.likes;
    if (byId('pa-us-only')) byId('pa-us-only').checked = !!state.draft.usOnly;
  }

  function renderCategoryList() {
    const host = document.getElementById('pa-category-list');
    if (!host) return;
    host.innerHTML = '';
    const q = (state.draft.categoryQuery || '').toLowerCase();
    (UI.categories || []).filter(function (c) { return !q || String(c.name).toLowerCase().includes(q); }).forEach(function (c) {
      const selected = state.draft.categories.has(c.name);
      const item = el('button', 'pa-check-item' + (selected ? ' is-selected' : ''));
      item.type = 'button';
      item.innerHTML = '<span class="pa-check-box">' + (selected ? '✓' : '') + '</span><span class="pa-check-title">' + escHtml(c.name) + '</span><span class="pa-count-pill">' + (c.count || '') + '</span>';
      item.addEventListener('click', function () {
        if (state.draft.categories.has(c.name)) state.draft.categories.delete(c.name);
        else state.draft.categories.add(c.name);
        renderCategoryList();
      });
      host.appendChild(item);
    });
  }

  function renderSupplierList() {
    const host = document.getElementById('pa-supplier-list');
    if (!host) return;
    host.innerHTML = '';
    const q = (state.draft.supplierQuery || '').toLowerCase();
    (UI.suppliers || [])
      .filter(function (s) { return !state.draft.usOnly || String(s.country || '').toUpperCase() === 'US'; })
      .filter(function (s) { return !q || String(s.name).toLowerCase().includes(q); })
      .forEach(function (s) {
        const selected = state.draft.suppliers.has(s.name);
        const item = el('button', 'pa-check-item' + (selected ? ' is-selected' : ''));
        item.type = 'button';
        item.innerHTML = '<span class="pa-check-box">' + (selected ? '✓' : '') + '</span><span class="pa-check-title">' + escHtml(s.name) + '</span><span class="pa-country-pill">' + escHtml(s.country || '') + '</span>';
        item.addEventListener('click', function () {
          if (state.draft.suppliers.has(s.name)) state.draft.suppliers.delete(s.name);
          else state.draft.suppliers.add(s.name);
          renderSupplierList();
        });
        host.appendChild(item);
      });
  }

  function renderPriceRanges() {
    const host = document.getElementById('pa-price-range-grid');
    if (!host) return;
    host.innerHTML = '';
    (UI.price_ranges || []).forEach(function (r) {
      const selected = state.draft.priceRanges.has(r);
      const b = el('button', 'pa-price-btn' + (selected ? ' is-selected' : ''));
      b.type = 'button'; b.textContent = r;
      b.addEventListener('click', function () {
        if (state.draft.priceRanges.has(r)) state.draft.priceRanges.delete(r);
        else state.draft.priceRanges.add(r);
        renderPriceRanges();
      });
      host.appendChild(b);
    });
  }

  function renderSortOptions() {
    const host = document.getElementById('pa-sort-list');
    if (!host) return;
    host.innerHTML = '';
    (UI.sort_options || []).forEach(function (opt) {
      const selected = state.draft.sort === opt;
      const b = el('button', 'pa-sort-item' + (selected ? ' is-selected' : ''));
      b.type = 'button';
      b.innerHTML = '<span>' + escHtml(opt) + '</span><span>' + (selected ? '✓' : '') + '</span>';
      b.addEventListener('click', function () { state.draft.sort = opt; renderSortOptions(); });
      host.appendChild(b);
    });
  }

  function openModal() {
    const modal = document.getElementById('pa-filter-modal');
    if (!modal) return;
    state.draft = copyDraft(state.applied || state.draft);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('pa-modal-open');
    state.modalOpen = true;
    syncDraftToControls(); renderCategoryList(); renderSupplierList(); renderPriceRanges(); renderSortOptions();
  }

  function closeModal(revert) {
    const modal = document.getElementById('pa-filter-modal');
    if (!modal) return;
    if (revert && state.applied) state.draft = copyDraft(state.applied);
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('pa-modal-open');
    state.modalOpen = false;
  }

  function applyModal() {
    state.applied = copyDraft(state.draft);
    ['In Stock Only', 'Kits Only', 'Blends Only', 'Likes Only'].forEach(function (t) { state.activeFilters.delete(t); });
    if (state.applied.toggles.instock) state.activeFilters.add('In Stock Only');
    if (state.applied.toggles.kits) state.activeFilters.add('Kits Only');
    if (state.applied.toggles.blends) state.activeFilters.add('Blends Only');
    if (state.applied.toggles.likes) state.activeFilters.add('Likes Only');
    Array.from(UI.categories || []).forEach(function (c) { state.activeFilters.delete(c.name); });
    Array.from(UI.suppliers || []).forEach(function (s) { state.activeFilters.delete(s.name); });
    Array.from(UI.price_ranges || []).forEach(function (p) { state.activeFilters.delete(p); });
    state.applied.categories.forEach(function (c) { state.activeFilters.add(c); });
    state.applied.suppliers.forEach(function (s) { state.activeFilters.add(s); });
    state.applied.priceRanges.forEach(function (p) { state.activeFilters.add(p); });
    renderActiveFilters();
    closeModal(false);
  }

  function clearDraft() {
    state.draft.toggles = { instock: false, kits: false, blends: false, likes: false };
    state.draft.categories.clear(); state.draft.suppliers.clear(); state.draft.priceRanges.clear();
    state.draft.usOnly = false; state.draft.categoryQuery = ''; state.draft.supplierQuery = '';
    syncDraftToControls();
    const c = document.getElementById('pa-category-search');
    const s = document.getElementById('pa-supplier-search');
    if (c) c.value = ''; if (s) s.value = '';
    renderCategoryList(); renderSupplierList(); renderPriceRanges();
  }

  function bindModalEvents() {
    const filterBtn = document.getElementById('pa-filter-btn');
    if (filterBtn) filterBtn.addEventListener('click', openModal);
    document.querySelectorAll('[data-close="1"], #pa-modal-close, #pa-modal-cancel').forEach(function (e) {
      e.addEventListener('click', function () { closeModal(true); });
    });
    const apply = document.getElementById('pa-modal-apply');
    if (apply) apply.addEventListener('click', applyModal);
    const clearAll = document.getElementById('pa-modal-clear-all');
    if (clearAll) clearAll.addEventListener('click', clearDraft);

    document.querySelectorAll('.pa-modal-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-tab');
        document.querySelectorAll('.pa-modal-tab').forEach(function (b) { b.classList.remove('is-active'); });
        document.querySelectorAll('.pa-tab-content').forEach(function (c) { c.classList.remove('is-active'); });
        btn.classList.add('is-active');
        const content = document.querySelector('.pa-tab-content[data-content="' + target + '"]');
        if (content) content.classList.add('is-active');
      });
    });

    const ins = document.getElementById('pa-instock-only');
    const kits = document.getElementById('pa-kits-only');
    const blends = document.getElementById('pa-blends-only');
    const likes = document.getElementById('pa-likes-only');
    const usOnly = document.getElementById('pa-us-only');
    if (ins) ins.addEventListener('change', function () { state.draft.toggles.instock = ins.checked; });
    if (kits) kits.addEventListener('change', function () { state.draft.toggles.kits = kits.checked; });
    if (blends) blends.addEventListener('change', function () { state.draft.toggles.blends = blends.checked; });
    if (likes) likes.addEventListener('change', function () { state.draft.toggles.likes = likes.checked; });
    if (usOnly) usOnly.addEventListener('change', function () { state.draft.usOnly = usOnly.checked; renderSupplierList(); });

    const catSearch = document.getElementById('pa-category-search');
    if (catSearch) catSearch.addEventListener('input', function () { state.draft.categoryQuery = catSearch.value.trim(); renderCategoryList(); });
    const supSearch = document.getElementById('pa-supplier-search');
    if (supSearch) supSearch.addEventListener('input', function () { state.draft.supplierQuery = supSearch.value.trim(); renderSupplierList(); });

    const actions = {
      'toggle-category-search': function () { document.getElementById('pa-category-search-wrap') && document.getElementById('pa-category-search-wrap').classList.toggle('is-hidden'); },
      'toggle-supplier-search': function () { document.getElementById('pa-supplier-search-wrap') && document.getElementById('pa-supplier-search-wrap').classList.toggle('is-hidden'); },
      'cat-select-all': function () { (UI.categories || []).forEach(function (c) { state.draft.categories.add(c.name); }); renderCategoryList(); },
      'cat-clear-all': function () { state.draft.categories.clear(); renderCategoryList(); },
      'sup-select-all': function () { (UI.suppliers || []).forEach(function (s) { state.draft.suppliers.add(s.name); }); renderSupplierList(); },
      'sup-clear-all': function () { state.draft.suppliers.clear(); renderSupplierList(); },
      'price-select-all': function () { (UI.price_ranges || []).forEach(function (p) { state.draft.priceRanges.add(p); }); renderPriceRanges(); },
      'price-clear-all': function () { state.draft.priceRanges.clear(); renderPriceRanges(); },
    };
    document.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { const key = btn.getAttribute('data-action'); if (actions[key]) actions[key](); });
    });
  }

  // ─── Bar icon + price toggle + nav binding ────────────────────────────────
  function bindBarEvents() {
    // Price mode toggle
    var btnTotal = document.getElementById('pa-toggle-total');
    var btnMgml  = document.getElementById('pa-toggle-mgml');
    if (btnTotal) btnTotal.addEventListener('click', function () {
      state.priceMode = 'total';
      btnTotal.classList.add('is-active');
      if (btnMgml) btnMgml.classList.remove('is-active');
      renderProductGrid(filteredProducts());
    });
    if (btnMgml) btnMgml.addEventListener('click', function () {
      state.priceMode = 'mgml';
      btnMgml.classList.add('is-active');
      if (btnTotal) btnTotal.classList.remove('is-active');
      renderProductGrid(filteredProducts());
    });

    // Grid / List view toggle
    var btnGrid = document.getElementById('pa-view-grid');
    var btnList = document.getElementById('pa-view-list');
    var productGrid = document.getElementById('pa-product-grid');
    if (btnGrid) btnGrid.addEventListener('click', function () {
      if (productGrid) productGrid.classList.remove('is-list');
      btnGrid.classList.add('is-active');
      if (btnList) btnList.classList.remove('is-active');
    });
    if (btnList) btnList.addEventListener('click', function () {
      if (productGrid) productGrid.classList.add('is-list');
      btnList.classList.add('is-active');
      if (btnGrid) btnGrid.classList.remove('is-active');
    });

    // Detail view price toggle
    var btnDTotal = document.getElementById('pa-detail-toggle-total');
    var btnDMgml  = document.getElementById('pa-detail-toggle-mgml');
    if (btnDTotal) btnDTotal.addEventListener('click', function() {
      state.detailPriceMode = 'total';
      btnDTotal.classList.add('is-active');
      if (btnDMgml) btnDMgml.classList.remove('is-active');
      renderDetailDosageGrid();
    });
    if (btnDMgml) btnDMgml.addEventListener('click', function() {
      state.detailPriceMode = 'mgml';
      btnDMgml.classList.add('is-active');
      if (btnDTotal) btnDTotal.classList.remove('is-active');
      renderDetailDosageGrid();
    });

    // Bar icon buttons — toggle active state + re-render
    var barIcons = document.querySelectorAll('.pa-bar-icon[title]');
    barIcons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var title = btn.title;
        if (title === 'Has coupon') {
          state.barFilters.coupon = !state.barFilters.coupon;
          btn.classList.toggle('is-active', state.barFilters.coupon);
        } else if (title === 'Favourites') {
          state.barFilters.favourites = !state.barFilters.favourites;
          btn.classList.toggle('is-active', state.barFilters.favourites);
        } else if (title === 'US vendors only') {
          state.barFilters.usOnly = !state.barFilters.usOnly;
          btn.classList.toggle('is-active', state.barFilters.usOnly);
        } else if (title === 'Kits only') {
          state.barFilters.kits = !state.barFilters.kits;
          btn.classList.toggle('is-active', state.barFilters.kits);
        }
        renderProductGrid(filteredProducts());
      });
    });
  }

  function bindSearchEvents() {
    const search = document.getElementById('pa-search');
    if (search) {
      search.addEventListener('input', function () {
        renderProductGrid(filteredProducts());
        showProductGrid();
      });
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); renderProductGrid(filteredProducts()); showProductGrid(); }
      });
    }
    const clearBtn = document.getElementById('pa-clear-all');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      state.activeFilters.clear();
      state.tagFilters.clear();
      renderPopular();
      renderActiveFilters();
      renderProductGrid(filteredProducts());
    });

    const sort = document.getElementById('pa-grid-sort');
    if (sort) sort.addEventListener('change', function () { renderProductGrid(filteredProducts()); showProductGrid(); });


    const backBtn = document.getElementById('pa-detail-back');
    if (backBtn) backBtn.addEventListener('click', showProductGrid);

  }

  // ─── Init ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.pa-shell')) return;

    state.applied = copyDraft(state.draft);
    renderPopular();
    renderActiveFilters();
    bindSearchEvents();
    bindModalEvents();
    bindBarEvents();
    bindDsmEvents();
    initSSE();
    loadAllProducts();
  });
})();
