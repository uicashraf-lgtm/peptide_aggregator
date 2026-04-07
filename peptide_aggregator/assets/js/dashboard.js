(function () {
  'use strict';

  const UI = window.PA_UI || {
    api_base: '', sse_url: '', popular: [], categories: [], suppliers: [],
    price_ranges: [], sort_options: ['Popularity'],
  };

  const API = (UI.api_base || '').replace(/\/$/, '');
  const REST = (UI.rest_base || '').replace(/\/$/, '');
  const SSE_URL = UI.sse_url || '';
  const COUPON_SAVINGS = UI.coupon_savings || {};
  let sseSource = null;


  // ─── Utility ─────────────────────────────────────────────────────────────
  // Formulation keywords used for detail-view vendor filtering
  // Order matters: most specific first so the first match wins.
  var FORMULATIONS = [
    { key: 'tablet',  label: 'Tablets',  terms: ['tablet', 'tab', 'capsule', 'caps'] },
    { key: 'liquid',  label: 'Liquid',   terms: ['liquid', 'solution', 'dropper', '/ml'] },
    { key: 'topical', label: 'Topical',  terms: ['topical', 'cream', 'gel', 'patch', 'lotion', 'balm'] },
    { key: 'spray',   label: 'Spray',    terms: ['spray', 'nasal', 'aerosol', 'dispersal', 'air dispersal'] },
  ];
  // Keys that are NOT vials — used to exclude non-vial vendors when Vials is selected
  var NON_VIAL_KEYS = FORMULATIONS.map(function(f) { return f.key; });

  // Returns true if a lowercase product/dosage name matches any kit term:
  // "kit", "pack", "bulk", or a numeric vials pattern like "3 vials", "10vials".
  // Returns false when the name also matches a non-vial formulation (e.g.
  // "Air Dispersal Kit" → spray formulation, not a kit).
  var KIT_VIALS_RE = /(?:^|\s)\d+\s*vials?\b/;
  function isKitTerm(s) {
    var hasKit = s.includes('kit') || s.includes('pack') || s.includes('bulk') || KIT_VIALS_RE.test(s);
    if (!hasKit) return false;
    // If the name matches a non-vial formulation (spray, tablet, etc.) it is
    // a delivery method, not a kit bundle.
    var formulation = getFormulationKey(s);
    return formulation === null;
  }

  function getFormulationKey(str) {
    var s = (str || '').toLowerCase();

    for (var i = 0; i < FORMULATIONS.length; i++) {
      var f = FORMULATIONS[i];
      for (var j = 0; j < f.terms.length; j++) {
        if (s.includes(f.terms[j])) {
          return f.key;
        }
      }
    }
    
    return null;
  }
  // Resolve formulation key for a vendor: name-detection wins, product tags as fallback.
  function vendorFormulationKey(v) {
    var k = getFormulationKey(v.product_name || v.product || '');
    if (k !== null) return k;
    if (v._formulation) return v._formulation;
    if (v.formulation) return v.formulation;
    if (v.formulation_key) return v.formulation_key;
    var tags = state.detailProductTags || [];
    for (var fi = 0; fi < FORMULATIONS.length; fi++) {
      if (tags.some(function(t) { return t.toLowerCase() === FORMULATIONS[fi].key; })) return FORMULATIONS[fi].key;
    }
    return null;
  }

  function vendorListingKey(v) {
    var amountKey = '';
    if (v && v.amount_mg != null) {
      amountKey = String(v.amount_mg) + String(v.amount_unit || '').toLowerCase();
    }
    return [
      String((v && v.vendor) || '').toLowerCase().trim(),
      String((v && (v.product_name || v.product)) || '').toLowerCase().trim(),
      String((v && (v._formulation || v.formulation || v.formulation_key)) || '').toLowerCase().trim(),
      amountKey,
      (v && v._is_kit) ? 'kit' : 'nonkit'
    ].join('::');
  }

  function sameVendorListing(a, b) {
    if (!a || !b) return false;
    if (a.listing_id && b.listing_id) return String(a.listing_id) === String(b.listing_id);
    return vendorListingKey(a) === vendorListingKey(b);
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

  function showCouponToast(code, cx, cy, savings) {
    var existing = document.querySelector('.pa-coupon-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'pa-coupon-toast';
    var subHtml = savings ? '<span class="pa-coupon-toast-sub">' + escHtml(savings) + ' off your order</span>' : '';
    toast.innerHTML =
      '<span class="pa-coupon-toast-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#16a34a" stroke-width="2.5"><circle cx="12" cy="12" r="10" fill="#dcfce7" stroke="#16a34a"/><polyline points="8 12 11 15 16 9" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="pa-coupon-toast-body">' +
        '<span class="pa-coupon-toast-title">Copied code: <span class="pa-coupon-toast-code">' + escHtml(code) + '</span></span>' +
        subHtml +
      '</span>';
    document.body.appendChild(toast);
    var offset = 12;
    var w = toast.offsetWidth || 240;
    var h = toast.offsetHeight || 60;
    var x = Math.min(cx + offset, window.innerWidth - w - 8);
    var y = Math.min(cy + offset, window.innerHeight - h - 8);
    if (y < 8) y = 8;
    toast.style.left = x + 'px';
    toast.style.top = y + 'px';
    requestAnimationFrame(function() { toast.classList.add('pa-coupon-toast--visible'); });
    setTimeout(function() {
      toast.classList.remove('pa-coupon-toast--visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 2500);
  }

  // Category → colour mapping
  const CAT_COLORS = {
    'GLP-1': '#2a5fa3', 'Healing': '#1e6b4a', 'Blends': '#5a3a8a',
    'Growth Hormones': '#7a3a10', 'Hormones & Reproductive': '#6b1e3a',
    'Sleep & Recovery': '#1a5a6b', 'Accessories': '#4a4a2a',
  };
  function catColor(cat) { return CAT_COLORS[cat] || '#2a3f5a'; }

  // Return the custom display label for a dose, or the original if none is set.
  // Returns null when the dose has been hidden via the admin Dose Labels editor.
  function getDoseLabel(productName, originalLabel) {
    var key = (productName || '').toLowerCase().trim();
    var labelMap = (UI.dose_labels && UI.dose_labels[key]) || {};
    // Normalize: lowercase + strip whitespace so "5 mg" and "5mg" both match
    var norm = (originalLabel || '').toLowerCase().replace(/\s+/g, '');
    var resolved = labelMap.hasOwnProperty(norm) ? labelMap[norm]
                 : labelMap.hasOwnProperty(originalLabel) ? labelMap[originalLabel]
                 : null;
    if (resolved === '__exclude__') return null;
    return resolved || originalLabel;
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
    detailFormulationFilter: 'vial', // 'vial' | formulation key
    detailProductTags: [],          // tags of the current detail product
    detailSortDir: 'asc',     // 'asc' | 'desc'
    detailSupplierFilter: new Set(), // selected vendor names (empty = all)
    detailSupplierDraft: new Set(),  // draft while modal is open
    detailCurrentVendors: [],        // full unfiltered vendor list for current dosage
    detailFormKeys: [],              // formulation keys present for current detail product
    detailHasVials: true,            // whether current detail product has any vial vendors
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
  var DOSAGE_RE = /\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?)(?:\s*\([^)]*\))?$/i;

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
      // srcIsKit: only true for admin-tagged 'kit'/'kits' products.
      // PHP auto-detected kits use 'kit_auto' tag and do NOT set srcIsKit,
      // so their vendors are identified by product_name only.
      var rawNameLower = (p.name || '').toLowerCase();
      var srcIsKit = (p.tags || []).some(function(t) { var tl = t.toLowerCase(); return tl === 'kit' || tl === 'kits'; }) || isKitTerm(rawNameLower);
      // Derive formulation from the product name itself so vendors whose product_name
      // field lacks spray/etc keywords still get correctly classified.
      var srcFormulation = getFormulationKey(p.name || '');
      function stampVendor(v) {
        // Mirror detail view exactly: normalise product_name to product_name||product
        // so all downstream code (formulation detection, kit detection) has the best name.
        var effectiveName = v.product_name || v.product || '';
        var pn = effectiveName.toLowerCase();
        var formulation = getFormulationKey(pn) || srcFormulation || v.formulation || v.formulation_key || v._formulation || null;
        // If the product name has a detected formulation (e.g. "dispersal" → spray),
        // don't also flag it as a kit — "Air Dispersal Kit" is a delivery method, not a bundle.
        var isKitByName = formulation === null && isKitTerm(pn);
        return Object.assign({}, v, {
          product_name: effectiveName,
          _is_kit: formulation === null && (v._is_kit === true || srcIsKit || isKitByName),
          _formulation: formulation
        });
      }
      if (!map[key]) {
        var pKey0 = (pd.base || '').toLowerCase().trim();
        var remapMap0 = (UI.dose_remaps && UI.dose_remaps[pKey0]) || {};
        map[key] = {
          id: p.id, name: pd.base, category: (p.category || '').trim(),
          description: p.description, dosages: [],
          top_vendors: (p.top_vendors || []).map(stampVendor),
          min_price: p.min_price,
          vendor_count: p.vendor_count,
          tags: p.tags || [],
          _is_kit_product: p._is_kit_product || srcIsKit || false,
          available_dosages: (function() {
            var initDosages = [];
            (p.available_dosages || []).forEach(function(d) {
              var normRaw0 = (d.label || '').toLowerCase().replace(/\s+/g, '');
              var remapped = d;
              if (remapMap0[normRaw0]) {
                var newLabel0 = remapMap0[normRaw0];
                var doseM0 = newLabel0.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
                var newVendors0 = doseM0 ? (d.vendors || []).map(function(v) {
                  if (v.amount_mg != null) return v;
                  return Object.assign({}, v, { amount_mg: parseFloat(doseM0[1]), amount_unit: doseM0[2].toLowerCase() });
                }) : d.vendors;
                remapped = Object.assign({}, d, { label: newLabel0, vendors: newVendors0 });
              }
              var entry = Object.assign({}, remapped, { vendors: (remapped.vendors || []).map(stampVendor) });
              var normLbl0 = (entry.label || '').toLowerCase().replace(/\s+/g, '');
              var existingInit = initDosages.find(function(x) { return (x.label || '').toLowerCase().replace(/\s+/g, '') === normLbl0; });
              if (existingInit) {
                // Same label appears twice within one product's available_dosages — just append.
                // Do NOT dedup here: vial and spray from the same vendor legitimately
                // share a label and must both be preserved for formulation tabs to work.
                (entry.vendors || []).forEach(function(v) { existingInit.vendors.push(v); });
              } else {
                initDosages.push(entry);
              }
            });
            return initDosages;
          })(),
        };
        order.push(key);
      }
      var grp = map[key];
      // Propagate kit designation — once any variant is marked as a kit, the group is a kit.
      if (p._is_kit_product || srcIsKit) grp._is_kit_product = true;
      // Merge tags from all variants into the group
      (p.tags || []).forEach(function(t) { if (grp.tags.indexOf(t) === -1) grp.tags.push(t); });
      // Merge available_dosages (objects with {label, vendors})
      (p.available_dosages || []).forEach(function(d) {
        var rawLabel = (d.label || d);
        // Apply dose remap: if this product has a remap for this scraped label,
        // rewrite the label so it merges into the correct canonical bucket.
        var pKey = (pd.base || '').toLowerCase().trim();
        var remapMap = (UI.dose_remaps && UI.dose_remaps[pKey]) || {};
        var normRaw = rawLabel.toLowerCase().replace(/\s+/g, '');
        if (remapMap[normRaw]) {
          var newLabel = remapMap[normRaw];
          var doseM = newLabel.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
          var newVendors = doseM ? (d.vendors || []).map(function(v) {
            if (v.amount_mg != null) return v;
            return Object.assign({}, v, { amount_mg: parseFloat(doseM[1]), amount_unit: doseM[2].toLowerCase() });
          }) : d.vendors;
          d = Object.assign({}, d, { label: newLabel, vendors: newVendors });
        }
        var lbl = (d.label || d).toLowerCase().replace(/\s+/g, '');
        var existing = grp.available_dosages.find(function(x) { return (x.label || x).toLowerCase().replace(/\s+/g, '') === lbl; });
        if (existing) {
          // Merge vendors from duplicate dosage, skip vendors already present.
          // Deduplicate by real listing identity so remapped dosage buckets do not
          // collapse distinct dosages from the same vendor into one reused row.
          (d.vendors || []).forEach(function(v) {
            var stamped = stampVendor(v);
            if (!existing.vendors.some(function(ev) { return sameVendorListing(ev, stamped); })) {
              existing.vendors.push(stamped);
            }
          });
          // Re-sort by price
          existing.vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        } else {
          grp.available_dosages.push(Object.assign({}, d, { vendors: (d.vendors || []).map(stampVendor) }));
        }
      });
      if (pd.dosage) {
        var dosageRemap = (UI.dose_remaps && UI.dose_remaps[(pd.base || '').toLowerCase().trim()]) || {};
        var dosageNorm = pd.dosage.toLowerCase().replace(/\s+/g, '');
        var mappedDosageLabel = dosageRemap[dosageNorm] || pd.dosage;
        grp.dosages.push({ label: mappedDosageLabel, id: p.id, top_vendors: (p.top_vendors || []).map(stampVendor), min_price: p.min_price, vendor_count: p.vendor_count });
      } else {
        // Merge top_vendors from duplicate products.
        // Deduplicate by vendor+product_name so distinct listings (vial vs spray) survive.
        (p.top_vendors || []).forEach(function(v) {
          var stamped = stampVendor(v);
          if (!(grp.top_vendors || []).some(function(ev) { return sameVendorListing(ev, stamped); })) {
            grp.top_vendors = grp.top_vendors || [];
            grp.top_vendors.push(stamped);
          }
          // Also merge into every existing dosage's top_vendors so null-dosage
          // vendors (e.g. "CAPSULES – Product 50mg x 60 Capsules") appear
          // alongside dosage-specific vendors on the card.
          grp.dosages.forEach(function(dos) {
            if (!dos.top_vendors.some(function(ev) { return sameVendorListing(ev, stamped); })) {
              dos.top_vendors.push(stamped);
              dos.top_vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
            }
          });
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
      map[k].available_dosages.sort(function (a, b) {
        return parseFloat(a.label) - parseFloat(b.label);
      });
      // Use first dosage variant's vendors as default
      if (map[k].dosages.length > 0) {
        var first = map[k].dosages[0];
        // Save any null-dosage vendors accumulated into top_vendors before overwriting
        var nullDosageVendors = (map[k].top_vendors || []).filter(function(v) {
          return !map[k].dosages.some(function(d) {
            return d.top_vendors.some(function(dv) { return sameVendorListing(dv, v); });
          });
        });
        map[k].id = first.id;
        map[k].top_vendors = first.top_vendors;
        map[k].min_price = first.min_price;
        map[k].vendor_count = first.vendor_count;
        // Merge null-dosage vendors into every dosage so they appear on all pills
        if (nullDosageVendors.length > 0) {
          map[k].dosages.forEach(function(dos) {
            nullDosageVendors.forEach(function(v) {
              if (!dos.top_vendors.some(function(ev) { return sameVendorListing(ev, v); })) {
                dos.top_vendors.push(v);
              }
            });
            dos.top_vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
          });
          // Also reflect in the root top_vendors (now pointing to first dosage)
          nullDosageVendors.forEach(function(v) {
            if (!map[k].top_vendors.some(function(ev) { return sameVendorListing(ev, v); })) {
              map[k].top_vendors.push(v);
            }
          });
          map[k].top_vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        }
      }
      // Merge top_vendors from dosage-variant products into matching available_dosages entries.
      // A vendor whose product name ends with "500mg" (contributing to grp.dosages) should also
      // appear under the "500 mg" available_dosages tab, even if that tab came from a different
      // product's available_dosages list that didn't include that vendor.
      map[k].dosages.forEach(function(dos) {
        var normDos = (dos.label || '').toLowerCase().replace(/\s+/g, '');
        var avail = map[k].available_dosages.find(function(ad) {
          return (ad.label || '').toLowerCase().replace(/\s+/g, '') === normDos;
        });
        if (avail) {
          (dos.top_vendors || []).forEach(function(v) {
            if (!avail.vendors.some(function(ev) { return sameVendorListing(ev, v); })) {
              avail.vendors.push(v);
            }
          });
          avail.vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        }
      });
      // Backfill vendors from purchase-size dosage entries ("single", "5 pack", etc.) into
      // matching mg-amount entries using each vendor's amount_mg + amount_unit fields.
      // This ensures vendors that only appear under hidden purchase-size tabs (e.g. "single")
      // are still visible under their corresponding mg-amount tab (e.g. "500 mg").
      var mgStartRe = /^\d/;
      map[k].available_dosages.forEach(function(srcDosage) {
        // Only redistribute from non-mg labels (purchase sizes like "single", "5 pack")
        if (mgStartRe.test((srcDosage.label || '').trim())) return;
        (srcDosage.vendors || []).forEach(function(v) {
          if (v.amount_mg == null || !v.amount_unit) return;
          var amt = v.amount_mg === Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
          var mgLabel = (amt + ' ' + (v.amount_unit || 'mg')).toLowerCase().replace(/\s+/g, '');
          var destDosage = map[k].available_dosages.find(function(ad) {
            return mgStartRe.test((ad.label || '').trim()) &&
                   (ad.label || '').toLowerCase().replace(/\s+/g, '') === mgLabel;
          });
          if (!destDosage) {
            // No mg-amount tab exists yet — create one so compact mode shows it.
            var displayLabel = amt + ' ' + (v.amount_unit || 'mg');
            destDosage = { label: displayLabel, vendors: [] };
            map[k].available_dosages.push(destDosage);
          }
          if (!destDosage.vendors.some(function(ev) { return sameVendorListing(ev, v); })) {
            destDosage.vendors.push(v);
          }
        });
      });
      // Re-sort mg-amount entries' vendors by price after backfill, and remove
      // vendors whose amount_mg contradicts the bucket label (stale backend data).
      map[k].available_dosages.forEach(function(d) {
        if (mgStartRe.test((d.label || '').trim())) {
          var bucketNorm = (d.label || '').toLowerCase().replace(/\s+/g, '');
          d.vendors = d.vendors.filter(function(v) {
            if (v.amount_mg == null || !v.amount_unit) return true; // no amount info → keep
            var vAmt = v.amount_mg === Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
            var vNorm = (vAmt + '' + (v.amount_unit || 'mg')).toLowerCase().replace(/\s+/g, '');
            return vNorm === bucketNorm;
          });
          d.vendors.sort(function(a, b) { return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0); });
        }
      });
      // If a "default" remap is configured and the target dose bucket doesn't already
      // exist in available_dosages, create a synthetic one so the compact card can
      // honour the remap. Previously this only ran when available_dosages was empty,
      // but the remapped target may also be absent when the product has other doses.
      if ((map[k].top_vendors || []).length > 0) {
        var pKeyD = (map[k].name || '').toLowerCase().trim();
        var remapMapD = (UI.dose_remaps && UI.dose_remaps[pKeyD]) || {};
        if (remapMapD['default']) {
          var newLabelD = remapMapD['default'];
          var newNormD = newLabelD.toLowerCase().replace(/\s+/g, '');
          var bucketExists = map[k].available_dosages.some(function(d) {
            return (d.label || '').toLowerCase().replace(/\s+/g, '') === newNormD;
          });
          if (!bucketExists) {
            var doseMD = newLabelD.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
            var synthVendorsD = (map[k].top_vendors || []).map(function(v) {
              if (!doseMD || v.amount_mg != null) return v;
              return Object.assign({}, v, { amount_mg: parseFloat(doseMD[1]), amount_unit: doseMD[2].toLowerCase() });
            });
            map[k].available_dosages.push({ label: newLabelD, vendors: synthVendorsD });
            map[k].available_dosages.sort(function(a, b) { return parseFloat(a.label) - parseFloat(b.label); });
          }
        }
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
      // Derive real categories and counts from the actual product data.
      var catCounts = {};
      state.allProducts.forEach(function(p) {
        var cat = (p.category || '').trim();
        if (!cat) return;
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
      UI.categories = Object.keys(catCounts).sort().map(function(name) {
        return { name: name, count: catCounts[name] };
      });
      // Derive unique supplier list from all product vendors
      var supplierMap = {};
      state.allProducts.forEach(function(p) {
        (p.top_vendors || []).forEach(function(v) {
          var name = (v.vendor || '').trim();
          if (!name) return;
          if (!supplierMap[name]) supplierMap[name] = { name: name, country: v.country || '', logo_url: v.logo_url || '' };
        });
      });
      UI.suppliers = Object.keys(supplierMap).sort().map(function(name) { return supplierMap[name]; });
      renderProductGrid(state.allProducts);
      // Kick off full vendor data loading in background so supplier filter is accurate
      loadAllVendorNames();
    } catch (e) {
      const grid = document.getElementById('pa-product-grid');
      if (grid) grid.innerHTML = '<p class="pa-error">Could not load products. Is the API running?</p>';
    }
  }

  // ─── Full vendor names loader ─────────────────────────────────────────────
  // Fetches /products/{id}/prices for every product so the supplier filter can
  // match vendors that don't appear in top_vendors (e.g. non-cheapest vendors).
  var _allVendorNamesPromise = null;
  function loadAllVendorNames() {
    if (_allVendorNamesPromise) return _allVendorNamesPromise;
    _allVendorNamesPromise = Promise.all((state.allProducts || []).map(function(p) {
      if (p._allVendorNamesReady) return Promise.resolve();
      return fetch((REST || API + '/api') + '/products/' + p.id + '/prices')
        .then(function(r) { return r.json(); })
        .then(function(raw) {
          var names = new Set();
          var supplierInfo = {};
          var doseVendors = {}; // normLabel -> Set<vendorName>
          var DOSAGE_RE_AV = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\b/i;
          (Array.isArray(raw) ? raw : []).forEach(function(v) {
            if (v.vendor) {
              names.add(v.vendor);
              if (!supplierInfo[v.vendor]) supplierInfo[v.vendor] = { name: v.vendor, country: v.country || '', logo_url: v.logo_url || '' };
              // Build per-dosage vendor map
              var lbl = null;
              if (v.amount_mg != null) {
                var amt = v.amount_mg == Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
                lbl = amt + ' ' + (v.amount_unit || 'mg').toLowerCase();
              }
              if (!lbl) {
                var m2 = (v.product || v.product_name || '').match(DOSAGE_RE_AV);
                if (m2) lbl = m2[1] + ' ' + m2[2].toLowerCase();
              }
              if (!lbl) lbl = 'default';
              var normLbl = lbl.toLowerCase().replace(/\s+/g, '');
              if (!doseVendors[normLbl]) doseVendors[normLbl] = new Set();
              doseVendors[normLbl].add(v.vendor);
            }
          });
          p._allVendorNames = names;
          p._vendorsByDoseLabel = doseVendors;
          p._allVendorNamesReady = true;
          // Also pre-populate the card price cache so cards built after a supplier
          // filter re-render don't need a second fetch and show "No prices scraped yet".
          if (!p._cardAllPricesPromise) {
            var cardDosageMap = {};
            var cardDosageLabelMap = {};
            var pKeyAV = (p.name || '').toLowerCase().trim();
            var remapMapAV = (UI.dose_remaps && UI.dose_remaps[pKeyAV]) || {};
            (Array.isArray(raw) ? raw : []).forEach(function(v) {
              var lbl2 = null;
              if (v.amount_mg != null) {
                var amt2 = v.amount_mg == Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
                lbl2 = amt2 + ' ' + (v.amount_unit || 'mg').toLowerCase();
              }
              if (!lbl2) {
                var m3 = (v.product || v.product_name || '').match(DOSAGE_RE_AV);
                if (m3) lbl2 = m3[1] + ' ' + m3[2].toLowerCase();
              }
              if (!lbl2) lbl2 = 'default';
              var normLbl2 = lbl2.toLowerCase().replace(/\s+/g, '');
              if (remapMapAV[normLbl2]) {
                lbl2 = remapMapAV[normLbl2];
                normLbl2 = lbl2.toLowerCase().replace(/\s+/g, '');
                var remapM2 = lbl2.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
                if (remapM2 && v.amount_mg == null) {
                  v = Object.assign({}, v, { amount_mg: parseFloat(remapM2[1]), amount_unit: remapM2[2].toLowerCase() });
                }
              }
              if (!cardDosageMap[normLbl2]) { cardDosageMap[normLbl2] = []; cardDosageLabelMap[normLbl2] = lbl2; }
              var effName = v.product_name || v.product || '';
              var pn2 = effName.toLowerCase();
              cardDosageMap[normLbl2].push(Object.assign({}, v, {
                vendor: v.vendor,
                product_name: effName,
                price: v.effective_price != null ? v.effective_price : v.price,
                previous_price: v.previous_price,
                currency: v.currency,
                listing_id: v.listing_id,
                amount_mg: v.amount_mg,
                amount_unit: v.amount_unit,
                price_per_mg: v.price_per_mg,
                link: v.link,
                logo_url: v.logo_url,
                coupon_code: v.coupon_code,
                country: v.country,
                in_stock: v.in_stock,
                _formulation: getFormulationKey(pn2) || v._formulation || v.formulation || v.formulation_key || null,
                _is_kit: getFormulationKey(pn2) === null && (v._is_kit === true || isKitTerm(pn2))
              }));
            });
            Object.keys(cardDosageMap).forEach(function(k) {
              cardDosageMap[k].sort(function(a, b) {
                return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0);
              });
            });
            p._cardPricesByDose = cardDosageMap;
            p._cardDosageLabelMap = cardDosageLabelMap;
            p._cardAllPricesReady = true;
            p._cardAllPricesPromise = Promise.resolve();
          }
          // Merge any newly discovered vendors into UI.suppliers
          var changed = false;
          Object.keys(supplierInfo).forEach(function(name) {
            if (!(UI.suppliers || []).some(function(s) { return s.name === name; })) {
              UI.suppliers = (UI.suppliers || []).concat([supplierInfo[name]]);
              changed = true;
            }
          });
          if (changed) {
            UI.suppliers.sort(function(a, b) { return a.name.localeCompare(b.name); });
          }
        })
        .catch(function() {
          p._allVendorNames = new Set();
          p._allVendorNamesReady = true;
        });
    })).then(function() {
      // Re-render if a supplier filter is currently active so the full data is used
      if (state.applied && state.applied.suppliers.size > 0) {
        renderProductGrid(filteredProducts());
      }
    });
    return _allVendorNamesPromise;
  }

  // Returns true if dosage d of product p has at least one vendor matching active supplier filter.
  function dosageHasSupplierFilter(p, d) {
    if (!state.applied || state.applied.suppliers.size === 0) return true;
    var normLbl = (d.label || '').toLowerCase().replace(/\s+/g, '');
    if (p._vendorsByDoseLabel) {
      var dv = p._vendorsByDoseLabel[normLbl] || p._vendorsByDoseLabel['default'];
      if (!dv) return false;
      return Array.from(state.applied.suppliers).some(function(s) { return dv.has(s); });
    }
    // Before full data is loaded, fall back to top_vendors
    return (d.top_vendors || []).some(function(v) { return state.applied.suppliers.has(v.vendor); });
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
        return (p.top_vendors || []).some(function (v) { return !!v.in_stock; });
      });
    }
    if (state.barFilters.coupon) {
      list = list.filter(function (p) {
        return (p.top_vendors || []).some(function (v) { return !!v.coupon_code; });
      });
    }
    if (state.barFilters.favourites || (state.applied && state.applied.toggles.likes)) {
      list = list.filter(function (p) { return state.favourites.has(p.id); });
    }
    if (state.barFilters.kits || (state.applied && state.applied.toggles.kits)) {
      list = list.filter(function (p) {
        // Only 2 sources of truth for Kits:
        //  1) Admin-enabled kit products (p._is_kit_product)
        //  2) Product name contains kit/bulk/pack
        if (p._is_kit_product) return true;
        var pnl = (p.name || '').toLowerCase();
        return pnl.includes('kit') || pnl.includes('pack') || pnl.includes('bulk') || KIT_VIALS_RE.test(pnl);
      });
    }
    if (state.applied && state.applied.toggles.blends) {
      list = list.filter(function (p) {
        return (p.category && p.category.toLowerCase() === 'blends') ||
               (p.tags || []).some(function (t) { return t.toLowerCase() === 'blend'; }) ||
               p.name.toLowerCase().includes('blend');
      });
    }
    // Tag filter (from popular chips — also used by modal category filter via applyModal sync)
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
    // Price range filter
    if (state.applied && state.applied.priceRanges.size > 0 && !state.applied.priceRanges.has('Any Price')) {
      list = list.filter(function (p) {
        // Use API min_price when available; otherwise derive from top_vendors prices
        var price = p.min_price;
        if (price == null) {
          var vprices = (p.top_vendors || []).map(function (v) { return v.price; }).filter(function (pr) { return pr != null && pr > 0; });
          price = vprices.length > 0 ? Math.min.apply(null, vprices) : null;
        }
        // If we still have no price data, don't exclude the product
        if (price == null) return true;
        return Array.from(state.applied.priceRanges).some(function (range) {
          if (range === '$0 - $50')    return price >= 0   && price <= 50;
          if (range === '$50 - $100')  return price >  50  && price <= 100;
          if (range === '$100 - $250') return price >  100 && price <= 250;
          if (range === '$250 - $500') return price >  250 && price <= 500;
          if (range === '$500+')       return price >= 500;
          return true;
        });
      });
    }
    // Supplier filter — use full vendor names if loaded, else fall back to top_vendors
    if (state.applied && state.applied.suppliers.size > 0) {
      list = list.filter(function(p) {
        if (p._allVendorNamesReady) {
          return Array.from(state.applied.suppliers).some(function(s) { return p._allVendorNames.has(s); });
        }
        return (p.top_vendors || []).some(function(v) { return state.applied.suppliers.has(v.vendor); });
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

  // When the kits filter is active, restrict a vendor list to kit vendors only.
  // Uses the same principle as the detail view's Kits button: a vendor entry is
  // a kit if its product_name contains "kit" (case-insensitive). If the dosage
  // label itself contains "kit" all its vendors are implicitly kit vendors.
  function kitFilterVendors(vendors, dosage, isKitProduct) {
    if (!(state.barFilters.kits || (state.applied && state.applied.toggles.kits))) {
      // Deduplicate conservatively: keep multiple listings for the same vendor when they
      // differ by formulation (e.g. vial vs spray) so the Formulation toggle can work.
      var seen = {};
      return (vendors || []).filter(function(v) {
        var f = (v._formulation || v.formulation || v.formulation_key || '') + '';
        var key = (v.vendor || '') + '::' + f;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    // For admin-designated kit products, prefer the explicit _is_kit flag injected by the backend.
    // This lets kit-only mode show the correct kit listings even when the vendor product_name
    // doesn't contain the word "kit".
    if (isKitProduct) {
      var byFlag = (vendors || []).filter(function(v) { return v._is_kit === true; });
      if (byFlag.length > 0) return byFlag;
    }

    if (dosage && isKitTerm((dosage.label || '').toLowerCase())) return vendors || [];
    // Primary: product_name contains "kit" or "pack"
    var byName = (vendors || []).filter(function(v) {
      var pn = (v.product_name || '').toLowerCase(); return isKitTerm(pn);
    });
    if (byName.length > 0) return byName;
    // Fallback: _is_kit flag
    return (vendors || []).filter(function(v) { return v._is_kit === true; });
  }

  // Returns true if a dosage entry is a kit dosage (label contains "kit", or any vendor has _is_kit).
  function isKitDosage(d) {
    if (isKitTerm((d.label || '').toLowerCase())) return true;
    return (d.top_vendors || []).some(function(v) {
      return isKitTerm((v.product_name || '').toLowerCase()) || v._is_kit === true;
    });
  }

  // When the kits filter is active, pick the first kit dosage index; otherwise pick the dosage
  // with the most vendors. If an admin default dose is set for this product, honour it first.
  // Returns the best index from the dosages array.
  function bestDosageIdx(dosages, productName) {
    var kitsActive = state.barFilters.kits || (state.applied && state.applied.toggles.kits);
    if (kitsActive) {
      for (var i = 0; i < dosages.length; i++) {
        if (isKitDosage(dosages[i])) return i;
      }
    }
    // Check for an admin-set default dose for this product.
    if (productName && UI.default_doses) {
      var pKey = productName.toLowerCase().trim();
      var savedDefault = (UI.default_doses[pKey] || '').toLowerCase().replace(/\s+/g, '');
      if (savedDefault) {
        for (var j = 0; j < dosages.length; j++) {
          var normLabel = (dosages[j].label || '').toLowerCase().replace(/\s+/g, '');
          if (normLabel === savedDefault) return j;
        }
      }
    }
    var best = 0, bestCount = -1;
    dosages.forEach(function(d, i) {
      var cnt = (d.top_vendors ? d.top_vendors.length : 0) || (d.vendor_count || 0);
      if (cnt > bestCount) { bestCount = cnt; best = i; }
    });
    return best;
  }

  function vendorInitials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function buildVendorRow(v, isBest) {
    const row = el('div', 'pa-pcard-vendor-row' + (isBest ? ' is-best' : ''));
// ADD THIS: Make the row look clickable and add the listener
  row.style.cursor = 'pointer';
  row.addEventListener('click', function(e) {
    e.stopPropagation(); // THIS PREVENTS THE DETAIL VIEW FROM OPENING
    if (v.link) {
      window.open(v.link, '_blank', 'noopener noreferrer');
    }
  });
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

    // Right side: price + link on top row, coupon below
    const right = el('div', 'pa-pcard-vright');
    const priceLinkRow = el('div', 'pa-pcard-price-link-row');
    const priceWrap = el('div', 'pa-pcard-price-wrap');
    const pricePer = v.price_per_mg != null ? v.price_per_mg
      : (v.price != null && v.amount_mg ? v.price / v.amount_mg : null);
    const showPerMg = state.priceMode === 'mgml' && pricePer != null;

    // Compute coupon-discounted price for this vendor (if any)
    var _compactSav = COUPON_SAVINGS[(v.vendor || '').toLowerCase()] || '';
    var _compactDiscountedPrice = null;
    if (_compactSav && v.price != null) {
      var _cSavStr = String(_compactSav).trim();
      var _cPctM = _cSavStr.match(/(\d+(?:\.\d+)?)\s*%/);
      var _cFixM = !_cPctM ? _cSavStr.match(/\$\s*(\d+(?:\.\d+)?)/) : null;
      _compactDiscountedPrice = _cPctM
        ? v.price * (1 - parseFloat(_cPctM[1]) / 100)
        : (_cFixM ? Math.max(0, v.price - parseFloat(_cFixM[1])) : null);
    }

    // If there's a coupon discount: show discounted price as main, actual price crossed out
    // Otherwise: show actual price as main (original behaviour)
    var _actualPrice = showPerMg
      ? '$' + Number(pricePer).toFixed(1) + '/' + (v.amount_unit || 'mg')
      : fmt(v.price, v.currency);

    if (_compactDiscountedPrice != null) {
      var _discountedPer = v.amount_mg ? _compactDiscountedPrice / v.amount_mg : null;
      var _discountedDisplay = showPerMg && _discountedPer != null
        ? '$' + Number(_discountedPer).toFixed(1) + '/' + (v.amount_unit || 'mg')
        : fmt(_compactDiscountedPrice, v.currency);
      // Crossed-out actual price (shown first, above the discounted price)
      priceWrap.appendChild(el('span', 'pa-pcard-price-orig-crossed', escHtml(_actualPrice)));
      // Discounted price as the main price
      priceWrap.appendChild(el('span', 'pa-pcard-price' + (isBest ? ' pa-price--best' : ''), escHtml(_discountedDisplay)));
    } else {
      priceWrap.appendChild(el('span', 'pa-pcard-price' + (isBest ? ' pa-price--best' : ''), escHtml(_actualPrice)));
    }
    // Coupon price tooltip — shown on row hover when a savings value is configured
    priceLinkRow.appendChild(priceWrap);
    // 1. Handle the external link icon (if it exists)
    if (v.link) {
      const a = document.createElement('a');
      a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'pa-pcard-extlink';
      a.innerHTML = '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      priceLinkRow.appendChild(a);
    }
    right.appendChild(priceLinkRow);

    // 2. Handle the Coupon Badge (Copy anywhere logic)
    if (v.coupon_code) {
      const vendorSavings = COUPON_SAVINGS[(v.vendor || '').toLowerCase()] || '';
      const coupon = el('span', 'pa-coupon-badge');
      
      // Make the entire badge look like a button
      coupon.style.cursor = 'pointer';
      
      // We combine the icon and text into the badge
      coupon.innerHTML = `
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <span class="pa-coupon-text">${escHtml(v.coupon_code)}</span>
        ${vendorSavings ? `<span class="pa-coupon-save-inline">\u00b7 Save ${escHtml(vendorSavings)}</span>` : ''}
      `;

      // Click listener for the ENTIRE badge
      coupon.addEventListener('click', function (e) {
        e.stopPropagation(); // Prevents the vendor row redirect from firing
        
        // Copy to clipboard
        navigator.clipboard && navigator.clipboard.writeText(v.coupon_code);
        
        // Show the toast notification
        showCouponToast(v.coupon_code, e.clientX, e.clientY, vendorSavings);
        
        // Visual feedback on the badge
        const originalContent = coupon.innerHTML;
        coupon.innerHTML = '<span style="color:#16a34a; font-weight:bold;">\u2713 Copied!</span>';
        setTimeout(() => { coupon.innerHTML = originalContent; }, 1500);
      });

      right.appendChild(coupon);
    }

    // 3. Finalize the row
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
    (p.tags || []).forEach(function(t) {
      // Skip internal/admin-only tags that should not be shown to users.
      var tl = t.toLowerCase();
      if (tl === 'kit_auto' || tl.includes('exclude')) return;
      allTagItems.push({ text: t, isCat: false });
    });
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

    // Build dosage list from available_dosages.
    var dosages;
    if (p.available_dosages && p.available_dosages.length >= 1) {
      dosages = p.available_dosages.map(function(d) {
        var lbl = (d && typeof d === 'object') ? String(d.label || '') : String(d || '');
        var vendors = (d && d.vendors && d.vendors.length > 0) ? d.vendors : p.top_vendors || [];
        return { label: lbl, id: p.id, top_vendors: vendors, vendor_count: vendors.length };
      }).filter(function(d) { return d.label; });
    } else {
      dosages = p.dosages || [];
    }
    // When mg-amount labels (e.g. "500 mg") exist, suppress purchase-size labels
    // ("single", "5 pack", "10 pack", etc.) — show only raw mg amounts by default.
    // Skip suppression entirely for kit products so the kit filter is unaffected.
    var isKitProduct = p._is_kit_product || (p.tags || []).some(function(t) {
      var tl = t.toLowerCase(); return tl === 'kit' || tl === 'kits' || tl === 'kit_auto';
    });
    var hasMgLabels = !isKitProduct && dosages.some(function(d) { return /^\d/.test((d.label || '').trim()); });
    if (hasMgLabels) {
      dosages = dosages.filter(function(d) { return /^\d/.test((d.label || '').trim()); });
    }
    // Remove dosages hidden via admin dose labels (__exclude__ sentinel) so that
    // the active-index logic and vendor list always start on a visible dosage.
    dosages = dosages.filter(function(d) { return getDoseLabel(p.name, d.label) !== null; });
    const vendorList = el('div', 'pa-pcard-vendors');

    var CARD_VENDOR_LIMIT = 4;

    function renderVendorRows(vList, vendors) {
      if (state.applied && state.applied.suppliers.size > 0) {
        vendors = (vendors || []).filter(function(v) { return state.applied.suppliers.has(v.vendor); });
      }
      vList.innerHTML = '';
      if (vendors && vendors.length > 0) {
        var shown = vendors.slice(0, CARD_VENDOR_LIMIT);
        var hidden = vendors.slice(CARD_VENDOR_LIMIT);
        shown.forEach(function (v, i) { vList.appendChild(buildVendorRow(v, i === 0)); });
        if (hidden.length > 0) {
          var expandBtn = el('button', 'pa-vendors-expand', 'Show ' + hidden.length + ' more vendor' + (hidden.length !== 1 ? 's' : ''));
          expandBtn.type = 'button';
          expandBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            hidden.forEach(function (v) { vList.insertBefore(buildVendorRow(v, false), expandBtn); });
            expandBtn.remove();
          });
          vList.appendChild(expandBtn);
        }
      } else {
        vList.appendChild(el('p', 'pa-pcard-empty', cardKitsActive ? 'No kits available for this product' : 'No prices scraped yet'));
      }
    }

    // Card view uses the lightweight /products endpoint which may not include all listings
    // for a vendor (e.g. Atomik vial + "Air Dispersal" listing). When the user switches
    // to a non-vial formulation (Spray/etc), we lazily enrich the card with the full
    // /products/{id}/prices payload and merge those listings into the existing dosage buckets.
    // Fetch /products/{id}/prices once and build a dosage->vendors map using the
    // exact same logic as the detail view (group by amount_mg + amount_unit).
    // Returns a Promise that resolves to a map of normLabel -> vendor array.
    function ensureCardAllPricesLoaded() {
      if (p._cardAllPricesPromise) return p._cardAllPricesPromise;
      var pKeyRM = (p.name || '').toLowerCase().trim();
      var remapMapRM = (UI.dose_remaps && UI.dose_remaps[pKeyRM]) || {};
      var DOSAGE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\b/i;
      p._cardAllPricesPromise = fetch((REST || API + '/api') + '/products/' + p.id + '/prices')
        .then(function(r) { return r.json(); })
        .then(function(allPrices) {
          if (!Array.isArray(allPrices)) { p._cardPricesByDose = {}; return; }
          // Build dosage map exactly as the detail view does.
          var dosageMap = {};
          var dosageLabelMap = {}; // normLbl -> display label
          allPrices.forEach(function(v) {
            var lbl = null;
            if (v.amount_mg != null) {
              var amt = v.amount_mg == Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
              lbl = amt + ' ' + (v.amount_unit || 'mg').toLowerCase();
            }
            if (!lbl) {
              var m = (v.product || v.product_name || '').match(DOSAGE_RE);
              if (m) lbl = m[1] + ' ' + m[2].toLowerCase();
            }
            if (!lbl) lbl = 'default';
            var normLbl = lbl.toLowerCase().replace(/\s+/g, '');
            // Apply dose remaps
            if (remapMapRM[normLbl]) {
              lbl = remapMapRM[normLbl];
              normLbl = lbl.toLowerCase().replace(/\s+/g, '');
              var remapDoseM = lbl.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
              if (remapDoseM && v.amount_mg == null) {
                v = Object.assign({}, v, { amount_mg: parseFloat(remapDoseM[1]), amount_unit: remapDoseM[2].toLowerCase() });
              }
            }
            if (!dosageMap[normLbl]) { dosageMap[normLbl] = []; dosageLabelMap[normLbl] = lbl; }
            var effectiveName = v.product_name || v.product || '';
            var pn = effectiveName.toLowerCase();
            var formulation = getFormulationKey(pn) || v._formulation || v.formulation || v.formulation_key || null;
            dosageMap[normLbl].push(Object.assign({}, v, {
              vendor: v.vendor,
              product_name: effectiveName,
              price: v.effective_price != null ? v.effective_price : v.price,
              previous_price: v.previous_price,
              currency: v.currency,
              listing_id: v.listing_id,
              amount_mg: v.amount_mg,
              amount_unit: v.amount_unit,
              price_per_mg: v.price_per_mg,
              link: v.link,
              logo_url: v.logo_url,
              coupon_code: v.coupon_code,
              country: v.country,
              in_stock: v.in_stock,
              _formulation: formulation,
              _is_kit: formulation === null && (v._is_kit === true || isKitTerm(pn))
            }));
          });
          // Sort each bucket by price (mirrors detail view)
          Object.keys(dosageMap).forEach(function(k) {
            dosageMap[k].sort(function(a, b) {
              return (a.price == null) - (b.price == null) || (a.price || 0) - (b.price || 0);
            });
          });
          p._cardPricesByDose = dosageMap;
          p._cardDosageLabelMap = dosageLabelMap;
          p._cardAllPricesReady = true;
        })
        .catch(function() {
          p._cardPricesByDose = {};
        });
      return p._cardAllPricesPromise;
    }

    // Look up vendors for a given dose label from the API-sourced price map.
    // Falls back to the preprocessed top_vendors if the API hasn't loaded yet or has no match.
    function getCardVendorsForDose(doseLabel, fallbackVendors) {
      if (!p._cardPricesByDose) return fallbackVendors;
      var normLbl = (doseLabel || '').toLowerCase().replace(/\s+/g, '');
      var byDose = p._cardPricesByDose[normLbl];
      var byDefault = p._cardPricesByDose['default'] || [];
      var vendors;
      if (byDose) {
        // Start with the dosage-specific price data, merge in null-dose bucket.
        vendors = byDose.concat(byDefault.filter(function(v) { return !byDose.some(function(ev) { return sameVendorListing(ev, v); }); }));
        // Also merge pre-loaded fallbackVendors (top_vendors from available_dosages):
        // they carry correct _formulation from the products endpoint even when the
        // prices endpoint returns a plain product name with no formulation keywords.
        // Skip vendors whose amount_mg places them in a different dosage bucket —
        // the prices API is the authoritative source after inline dose edits.
        var doseLblMatch = normLbl.match(/^(\d+(?:\.\d+)?)(mg|mcg|ug|g|iu|ml)$/);
        (fallbackVendors || []).forEach(function(v) {
          if (vendors.some(function(ev) { return sameVendorListing(ev, v); })) return;
          // If the vendor has an explicit amount_mg that doesn't match this bucket, skip it.
          if (doseLblMatch && v.amount_mg != null && v.amount_unit) {
            var vNorm = (String(v.amount_mg === Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg) + v.amount_unit).toLowerCase().replace(/\s+/g, '');
            if (vNorm !== normLbl) return;
          }
          vendors.push(v);
        });
      } else {
        vendors = fallbackVendors;
      }
      // Deduplicate by vendor+formulation when kits filter is OFF — mirrors the detail view's
      // kitFilterVendors behaviour: no isKitTerm exclusion, just deduplicate so vendors with
      // a detected formulation (e.g. Spray kit) are still visible.
      var kitsOn = cardKitsActive || state.barFilters.kits || (state.applied && state.applied.toggles.kits);
      if (!kitsOn) {
        var seen = {};
        vendors = (vendors || []).filter(function(v) {
          var f = getCardFormulationKey(v) || '';
          var key = (v.vendor || '') + '::' + f;
          if (seen[key]) return false;
          seen[key] = true;
          return true;
        });
      }
      return vendors;
    }

    // Compute which non-vial formulations exist for this product (needed before pill render).
    // Include enriched price data when available so formulations discovered after the
    // initial /products call (e.g. "Air Dispersal Kit" → Spray) appear in the row.
    var allCardVendors = [];
    dosages.forEach(function(d) { (d.top_vendors || []).forEach(function(v) { allCardVendors.push(v); }); });
    if (allCardVendors.length === 0) (p.top_vendors || []).forEach(function(v) { allCardVendors.push(v); });
    if (p._cardPricesByDose) {
      Object.keys(p._cardPricesByDose).forEach(function(k) {
        (p._cardPricesByDose[k] || []).forEach(function(v) { allCardVendors.push(v); });
      });
    }

    // Tag-aware formulation resolver for compact card — mirrors vendorFormulationKey()
    // but uses this card's product tags instead of state.detailProductTags.
    var cardTags = (p.tags || []);
    function getCardFormulationKey(v) {
      var k = getFormulationKey(v.product_name || v.product || '');
      if (k !== null) return k;
      if (v._formulation) return v._formulation;
      if (v.formulation) return v.formulation;
      if (v.formulation_key) return v.formulation_key;
      for (var fi = 0; fi < FORMULATIONS.length; fi++) {
        if (cardTags.some(function(t) { return t.toLowerCase() === FORMULATIONS[fi].key; })) return FORMULATIONS[fi].key;
      }
      
      return null;
    }

    var cardFormKeys = [];
    allCardVendors.forEach(function(v) {
      var fk = getCardFormulationKey(v);
      if (fk && cardFormKeys.indexOf(fk) === -1) cardFormKeys.push(fk);
    });
    var hasFormulationRow = cardFormKeys.length >= 1;

    // Check if any dosage actually has vial vendors (used to hide the Vials button and auto-select)
    var hasVialVendors = false;
    // We need filterByFormulation defined first, so we check after — use a pre-check here:
    // A vendor is a vial if its formulation key is NOT in NON_VIAL_KEYS
    function vendorIsVial(v) {
      return NON_VIAL_KEYS.indexOf(getCardFormulationKey(v)) === -1;
    }
    if (hasFormulationRow) {
      allCardVendors.forEach(function(v) { if (vendorIsVial(v)) hasVialVendors = true; });
    } else {
      hasVialVendors = true; // no formulation row means treat everything as vial
    }

    // Default to 'vial' if any vial vendors exist; otherwise pick the first available formulation
    var activeFormulation = hasVialVendors ? 'vial' : (cardFormKeys[0] || 'vial');

    // Helper: filter vendors by active formulation.
    // 'vial' = exclude all non-vial formulation vendors.
    // Any other key = include only vendors matching that key.
    // When no formulation row exists, 'vial' acts like 'all'.
    function filterByFormulation(vendors, fKey) {
      if (!hasFormulationRow) return vendors || [];
      if (fKey === 'vial') {
        return (vendors || []).filter(function(v) {
          return NON_VIAL_KEYS.indexOf(getCardFormulationKey(v)) === -1;
        });
      }
      return (vendors || []).filter(function(v) {
        return getCardFormulationKey(v) === fKey;
      });
    }

    // Returns true if a dosage has at least one vendor visible under the given formulation.
    // Per-card kit filter toggle state (independent of the global bar filter).
    var cardKitsActive = false;

    // When Kits Only is active, only count kit listings (to avoid showing dosage/formulation
    // options that would render an empty vendor list).
    var kitsActive = state.barFilters.kits || (state.applied && state.applied.toggles.kits);
    function dosageHasFormulation(d, fKey) {
      // Use the API-sourced vendor list when available — it has correct _is_kit flags.
      // For kit visibility checks always use the unfiltered list (before kit exclusion)
      // so pills aren't hidden when kits is toggled on.
      var rawVendors;
      if (p._cardPricesByDose) {
        var byDose = p._cardPricesByDose[(d.label || '').toLowerCase().replace(/\s+/g, '')];
        var byDefault = p._cardPricesByDose['default'] || [];
        if (byDose) {
          rawVendors = byDose.concat(byDefault.filter(function(v) { return !byDose.some(function(ev) { return sameVendorListing(ev, v); }); }));
        } else {
          rawVendors = (d.top_vendors || []).slice();
        }
        // Always also merge pre-loaded top_vendors: the products endpoint gives them
        // correct _formulation (e.g. 'spray' from "dispersal" in product name) while
        // the prices endpoint may return a plain name that can't be classified.
        (d.top_vendors || []).forEach(function(v) {
          if (!rawVendors.some(function(ev) { return sameVendorListing(ev, v); })) rawVendors.push(v);
        });
      } else {
        rawVendors = d.top_vendors || [];
      }
      var byForm = filterByFormulation(rawVendors, fKey);
      var effectiveKitsActive = cardKitsActive || kitsActive;
      if (!effectiveKitsActive) return byForm.filter(function(v) {
        var pn = (v.product_name || '').toLowerCase();
        return (getCardFormulationKey(v) !== null || !isKitTerm(pn)) && !v._is_kit;
      }).length > 0;
      if (!p._cardAllPricesReady) return byForm.length > 0;
      return cardKitFilter(byForm, d).length > 0;
    }

    // Card-local kit filter: applies cardKitsActive on top of (or instead of) the global state.
    function cardKitFilter(vendors, dosage) {
      if (!cardKitsActive) return kitFilterVendors(vendors, dosage, isKitProduct);
      var orig = state.barFilters.kits;
      state.barFilters.kits = true;
      var r = kitFilterVendors(vendors, dosage, isKitProduct);
      state.barFilters.kits = orig;
      return r;
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

      var activeIdx = state.activeDosages[p.id] != null ? state.activeDosages[p.id] : bestDosageIdx(dosages, p.name);
      if (activeIdx >= dosages.length) activeIdx = 0;
      // If Kits Only is active, ensure the active dosage has at least one kit listing.
      // Only do this after enrichment has run; otherwise we may choose incorrectly.
      if (kitsActive && p._cardAllPricesReady && dosages.length > 0 && !dosageHasFormulation(dosages[activeIdx], activeFormulation)) {
        for (var kdi = 0; kdi < dosages.length; kdi++) {
          if (dosageHasFormulation(dosages[kdi], activeFormulation)) { activeIdx = kdi; break; }
        }
      }
      // If the active dosage has no vendors for the current supplier filter, move to the first that does.
      if (!dosageHasSupplierFilter(p, dosages[activeIdx] || {})) {
        for (var sdi = 0; sdi < dosages.length; sdi++) {
          if (dosageHasSupplierFilter(p, dosages[sdi])) { activeIdx = sdi; break; }
        }
      }

      dosages.forEach(function (d, idx) {
        var isActive = idx === activeIdx;
        var displayLabel = getDoseLabel(p.name, d.label);
        if (displayLabel === null) return; // hidden via admin dose labels
        if (!dosageHasFormulation(d, activeFormulation)) return; // hidden for current formulation
        if (!dosageHasSupplierFilter(p, d)) return; // hidden for current supplier filter
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
          // Always fetch from /prices API (same source as detail view) so each dose
          // pill shows the correct per-dose vendors, not the preprocessed fallback.
          ensureCardAllPricesLoaded().then(function() {
            var vendors = getCardVendorsForDose(d.label, d.top_vendors);
            var filteredByForm = filterByFormulation(vendors, activeFormulation);
            renderVendorRows(vendorList, cardKitFilter(filteredByForm, d));
          });
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

      dosageRow.appendChild(scrollWrap);
      card.appendChild(dosageRow);
    }

    // Formulation filter row — shown only when non-vial formulations exist across vendors
    if (hasFormulationRow) {
      var formRow = el('div', 'pa-pcard-dosage');
      formRow.appendChild(el('span', 'pa-dosage-label', 'Formulation:'));
      var formBtns = [];
      var formOptions = (hasVialVendors ? [{ key: 'vial', label: 'Vials' }] : []).concat(FORMULATIONS.filter(function(f) { return cardFormKeys.indexOf(f.key) !== -1; }));
      // In Kits Only mode, hide formulation buttons that would show no kit listings.
      // Only apply after enrichment has run; otherwise the async merge may add kit listings.
      if (kitsActive && p._cardAllPricesReady) {
        formOptions = formOptions.filter(function(opt) {
          return dosages.some(function(d) { return dosageHasFormulation(d, opt.key); });
        });
      }
      // Hide formulation buttons that have no vendor matching the active supplier filter.
      if (state.applied && state.applied.suppliers.size > 0) {
        formOptions = formOptions.filter(function(opt) {
          return filterByFormulation(allCardVendors, opt.key).some(function(v) { return state.applied.suppliers.has(v.vendor); });
        });
        // If active formulation was hidden, switch to first remaining
        if (formOptions.length > 0 && !formOptions.some(function(o) { return o.key === activeFormulation; })) {
          activeFormulation = formOptions[0].key;
        }
      }
      formOptions.forEach(function(f) {
        var btn = el('button', 'pa-dosage-pill' + (f.key === activeFormulation ? ' is-active' : ''), f.label);
        btn.type = 'button';
        btn.setAttribute('data-fkey', f.key);
        btn.addEventListener('click', (function(fKey, fBtn) { return function(e) {
          e.stopPropagation();

          var proceed = function() {
            activeFormulation = fKey;
            formBtns.forEach(function(b) { b.classList.remove('is-active'); });
            fBtn.classList.add('is-active');
            // Re-render dosage pills: show only those that have vendors for the selected formulation
            pillsContainer.innerHTML = '';
            var newActiveIdx = -1;
            var savedIdx = state.activeDosages[p.id] != null ? state.activeDosages[p.id] : 0;
            dosages.forEach(function(d2, idx2) {
              var dl2 = getDoseLabel(p.name, d2.label);
              if (dl2 === null) return;
              if (!dosageHasFormulation(d2, fKey)) return;
              if (newActiveIdx === -1 && dosageHasFormulation(d2, fKey)) {
                if (idx2 === savedIdx) { newActiveIdx = idx2; }
                else if (newActiveIdx === -1) { newActiveIdx = idx2; }
              }
              var ph = escHtml(dl2);
              var p2 = el('button', 'pa-dosage-pill', ph);
              p2.type = 'button';
              p2.addEventListener('click', (function(d3, i3, p3) { return function(ev) {
                ev.stopPropagation();
                state.activeDosages[p.id] = i3;
                pillsContainer.querySelectorAll('.pa-dosage-pill').forEach(function(x) {
                  x.classList.remove('is-active');
                  x.querySelector('.pa-pill-star') && x.querySelector('.pa-pill-star').remove();
                });
                p3.classList.add('is-active');
                ensureCardAllPricesLoaded().then(function() {
                  var vendors = getCardVendorsForDose(d3.label, d3.top_vendors);
                  renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vendors, activeFormulation), d3));
                });
              }; })(d2, idx2, p2));
              pillsContainer.appendChild(p2);
            });
            // Activate first visible pill
            var firstPill = pillsContainer.querySelector('.pa-dosage-pill');
            if (firstPill) { firstPill.classList.add('is-active'); }
            // Find the first visible dosage and render its vendors
            var visibleDosage = null;
            for (var vi = 0; vi < dosages.length; vi++) {
              if (getDoseLabel(p.name, dosages[vi].label) !== null && dosageHasFormulation(dosages[vi], fKey)) {
                if (visibleDosage === null || vi === savedIdx) visibleDosage = dosages[vi];
                if (vi === savedIdx) break;
              }
            }
            var doRenderV = function() {
              var vds = visibleDosage
                ? getCardVendorsForDose(visibleDosage.label, visibleDosage.top_vendors)
                : (p.top_vendors || []);
              renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vds, fKey), visibleDosage));
            };
            ensureCardAllPricesLoaded().then(doRenderV);
          };

          // If switching to a non-vial formulation, ensure we have all listings first.
          if (fKey !== 'vial') {
            ensureCardAllPricesLoaded().then(function() {
              // Recompute keys because enrichment can add non-vial listings.
              cardFormKeys = [];
              allCardVendors = [];
              dosages.forEach(function(d) { (d.top_vendors || []).forEach(function(v) { allCardVendors.push(v); }); });
              if (allCardVendors.length === 0) (p.top_vendors || []).forEach(function(v) { allCardVendors.push(v); });
              allCardVendors.forEach(function(v) {
                var fk = getCardFormulationKey(v);
                if (fk && cardFormKeys.indexOf(fk) === -1) cardFormKeys.push(fk);
              });
              proceed();
            });
            return;
          }

          proceed();
        }; })(f.key, btn));
        formBtns.push(btn);
        formRow.appendChild(btn);
      });
      card.appendChild(formRow);
    }

    // Kit filter toggle row — local to this card only, does not affect the global grid filter
    var kitRow = el('div', 'pa-pcard-dosage');
    kitRow.appendChild(el('span', 'pa-dosage-label', 'KIT Only'));
    var kitToggleLabel = document.createElement('label');
    kitToggleLabel.className = 'pa-kit-toggle-label';
    kitToggleLabel.style.cssText = 'display:inline-flex;align-items:center;cursor:pointer;';
    var kitToggleInput = document.createElement('input');
    kitToggleInput.type = 'checkbox';
    kitToggleInput.style.cssText = 'position:absolute;opacity:0;width:0;height:0;';
    var kitToggleTrack = document.createElement('span');
    kitToggleTrack.className = 'pa-kit-toggle-track';
    kitToggleTrack.style.cssText = 'display:inline-flex;align-items:center;width:52px;height:22px;background:#d1d5db;border-radius:11px;position:relative;transition:background 0.25s ease;flex-shrink:0;';
    var kitToggleKnob = document.createElement('span');
    kitToggleKnob.style.cssText = 'position:absolute;width:16px;height:16px;background:#fff;border-radius:50%;top:3px;left:3px;transition:transform 0.25s ease;box-shadow:0 1px 4px rgba(0,0,0,0.25);';
    var kitToggleText = document.createElement('span');
    kitToggleText.style.cssText = 'position:absolute;right:6px;font-size:9px;font-weight:700;color:#999;letter-spacing:0.5px;pointer-events:none;';
    kitToggleText.textContent = 'OFF';
    kitToggleTrack.appendChild(kitToggleKnob);
    kitToggleTrack.appendChild(kitToggleText);
    kitToggleLabel.appendChild(kitToggleInput);
    kitToggleLabel.appendChild(kitToggleTrack);
    var kitToggleBtn = kitToggleLabel;
    kitToggleLabel.addEventListener('click', function(e) { e.stopPropagation(); });
    kitRow.addEventListener('click', function(e) { e.stopPropagation(); });
    kitToggleInput.addEventListener('change', function(e) {
      e.stopPropagation();
      cardKitsActive = kitToggleInput.checked;
      if (cardKitsActive) {
        kitToggleTrack.style.background = '#2563eb';
        kitToggleKnob.style.transform = 'translateX(30px)';
        kitToggleText.style.cssText = 'position:absolute;left:6px;font-size:9px;font-weight:700;color:#fff;letter-spacing:0.5px;pointer-events:none;';
        kitToggleText.textContent = 'ON';
      } else {
        kitToggleTrack.style.background = '#d1d5db';
        kitToggleKnob.style.transform = 'translateX(0)';
        kitToggleText.style.cssText = 'position:absolute;right:6px;font-size:9px;font-weight:700;color:#999;letter-spacing:0.5px;pointer-events:none;';
        kitToggleText.textContent = 'OFF';
      }

      ensureCardAllPricesLoaded().then(function() {
        // Rebuild dosage pills to show only those with kit vendors (or restore all when off)
        if (pillsContainer) {
          pillsContainer.innerHTML = '';
          dosages.forEach(function(d2, idx2) {
            var dl2 = getDoseLabel(p.name, d2.label);
            if (dl2 === null) return;
            if (!dosageHasFormulation(d2, activeFormulation)) return;
            var p2 = el('button', 'pa-dosage-pill', escHtml(dl2));
            p2.type = 'button';
            p2.addEventListener('click', (function(d3, i3, p3) { return function(ev) {
              ev.stopPropagation();
              state.activeDosages[p.id] = i3;
              pillsContainer.querySelectorAll('.pa-dosage-pill').forEach(function(x) { x.classList.remove('is-active'); });
              p3.classList.add('is-active');
              ensureCardAllPricesLoaded().then(function() {
                var vendors = getCardVendorsForDose(d3.label, d3.top_vendors);
                renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vendors, activeFormulation), d3));
              });
            }; })(d2, idx2, p2));
            pillsContainer.appendChild(p2);
          });
          // Auto-select the first visible pill and update active dosage index
          var firstPill = pillsContainer.querySelector('.pa-dosage-pill');
          if (firstPill) {
            firstPill.classList.add('is-active');
            var firstIdx = dosages.findIndex(function(d2) {
              return getDoseLabel(p.name, d2.label) !== null && dosageHasFormulation(d2, activeFormulation);
            });
            if (firstIdx !== -1) state.activeDosages[p.id] = firstIdx;
          }
        }

        // Rebuild formulation buttons — mirrors how dosage pills are rebuilt on kit toggle.
        // Clear and re-add only formulation options that have kit vendors.
        if (formRow) {
          var formLabel = formRow.querySelector('.pa-dosage-label');
          formRow.innerHTML = '';
          if (formLabel) formRow.appendChild(formLabel);
          formBtns.length = 0;
          var visibleFormOptions = cardKitsActive
            ? formOptions.filter(function(opt) { return dosages.some(function(d) { return dosageHasFormulation(d, opt.key); }); })
            : formOptions;
          visibleFormOptions.forEach(function(f) {
            var btn = el('button', 'pa-dosage-pill' + (f.key === activeFormulation ? ' is-active' : ''), f.label);
            btn.type = 'button';
            btn.setAttribute('data-fkey', f.key);
            btn.addEventListener('click', (function(fKey, fBtn) { return function(e) {
              e.stopPropagation();
              activeFormulation = fKey;
              formBtns.forEach(function(b) { b.classList.remove('is-active'); });
              fBtn.classList.add('is-active');
              pillsContainer.innerHTML = '';
              dosages.forEach(function(d2, idx2) {
                var dl2 = getDoseLabel(p.name, d2.label);
                if (dl2 === null) return;
                if (!dosageHasFormulation(d2, fKey)) return;
                var p2 = el('button', 'pa-dosage-pill', escHtml(dl2));
                p2.type = 'button';
                p2.addEventListener('click', (function(d3, i3, p3) { return function(ev) {
                  ev.stopPropagation();
                  state.activeDosages[p.id] = i3;
                  pillsContainer.querySelectorAll('.pa-dosage-pill').forEach(function(x) { x.classList.remove('is-active'); });
                  p3.classList.add('is-active');
                  ensureCardAllPricesLoaded().then(function() {
                    var vendors = getCardVendorsForDose(d3.label, d3.top_vendors);
                    renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vendors, activeFormulation), d3));
                  });
                }; })(d2, idx2, p2));
                pillsContainer.appendChild(p2);
              });
              var firstPill = pillsContainer.querySelector('.pa-dosage-pill');
              if (firstPill) { firstPill.classList.add('is-active'); }
              var visibleDosage = null;
              for (var vi = 0; vi < dosages.length; vi++) {
                if (getDoseLabel(p.name, dosages[vi].label) !== null && dosageHasFormulation(dosages[vi], fKey)) {
                  visibleDosage = dosages[vi]; break;
                }
              }
              var vds = visibleDosage ? getCardVendorsForDose(visibleDosage.label, visibleDosage.top_vendors) : (p.top_vendors || []);
              renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vds, fKey), visibleDosage));
            }; })(f.key, btn));
            formBtns.push(btn);
            formRow.appendChild(btn);
          });
          // If active formulation was removed, switch to first available
          var activeStillVisible = formBtns.some(function(b) { return b.classList.contains('is-active'); });
          if (!activeStillVisible && formBtns.length > 0) {
            activeFormulation = formBtns[0].getAttribute('data-fkey');
            formBtns[0].classList.add('is-active');
          }
          formRow.style.display = formBtns.length > 0 ? '' : 'none';
        }

        renderInitial();
      });
    });
    kitRow.appendChild(kitToggleLabel);
    card.appendChild(kitRow);

    // Vendor rows — fetch from /prices API (same as detail view) then render.
    var activeIdx = state.activeDosages[p.id] != null ? state.activeDosages[p.id] : bestDosageIdx(dosages, p.name);
    var activeDosage = dosages.length > 0 ? dosages[Math.min(activeIdx, dosages.length - 1)] : null;
    var renderInitial = function() {
      var curIdx = state.activeDosages[p.id] != null ? state.activeDosages[p.id] : bestDosageIdx(dosages, p.name);
      var curDosage = dosages.length > 0 ? dosages[Math.min(curIdx, dosages.length - 1)] : null;
      var vendors = curDosage
        ? getCardVendorsForDose(curDosage.label, curDosage.top_vendors)
        : (p.top_vendors || []);
      renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vendors, activeFormulation), curDosage));
    };
    ensureCardAllPricesLoaded().then(function() {
      if (state.barFilters.kits || (state.applied && state.applied.toggles.kits)) {
        if (!p._kitsAutoSelected && p._cardAllPricesReady) {
          for (var ai = 0; ai < dosages.length; ai++) {
            var vendors = getCardVendorsForDose(dosages[ai].label, dosages[ai].top_vendors || []);
            var byForm = filterByFormulation(vendors, activeFormulation);
            if (kitFilterVendors(byForm, dosages[ai], isKitProduct).length > 0) {
              state.activeDosages[p.id] = ai;
              p._kitsAutoSelected = true;
              renderProductGrid(filteredProducts());
              return;
            }
          }
          p._kitsAutoSelected = true;
        }
      }
      renderInitial();
      // After prices load, rebuild formulation buttons for the global kits filter —
      // mirrors the dose pill rebuild so only formulations with kit vendors are shown.
      if (kitsActive && formRow) {
        var formLabelG = formRow.querySelector('.pa-dosage-label');
        formRow.innerHTML = '';
        if (formLabelG) formRow.appendChild(formLabelG);
        formBtns.length = 0;
        var visibleFormOptionsG = formOptions.filter(function(opt) {
          return dosages.some(function(d) { return dosageHasFormulation(d, opt.key); });
        });
        visibleFormOptionsG.forEach(function(f) {
          var btn = el('button', 'pa-dosage-pill' + (f.key === activeFormulation ? ' is-active' : ''), f.label);
          btn.type = 'button';
          btn.setAttribute('data-fkey', f.key);
          btn.addEventListener('click', (function(fKey, fBtn) { return function(e) {
            e.stopPropagation();
            activeFormulation = fKey;
            formBtns.forEach(function(b) { b.classList.remove('is-active'); });
            fBtn.classList.add('is-active');
            pillsContainer.innerHTML = '';
            dosages.forEach(function(d2, idx2) {
              var dl2 = getDoseLabel(p.name, d2.label);
              if (dl2 === null) return;
              if (!dosageHasFormulation(d2, fKey)) return;
              var p2 = el('button', 'pa-dosage-pill', escHtml(dl2));
              p2.type = 'button';
              p2.addEventListener('click', (function(d3, i3, p3) { return function(ev) {
                ev.stopPropagation();
                state.activeDosages[p.id] = i3;
                pillsContainer.querySelectorAll('.pa-dosage-pill').forEach(function(x) { x.classList.remove('is-active'); });
                p3.classList.add('is-active');
                ensureCardAllPricesLoaded().then(function() {
                  var vendors = getCardVendorsForDose(d3.label, d3.top_vendors);
                  renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vendors, activeFormulation), d3));
                });
              }; })(d2, idx2, p2));
              pillsContainer.appendChild(p2);
            });
            var firstPill = pillsContainer.querySelector('.pa-dosage-pill');
            if (firstPill) { firstPill.classList.add('is-active'); }
            var visibleDosage = null;
            for (var vi = 0; vi < dosages.length; vi++) {
              if (getDoseLabel(p.name, dosages[vi].label) !== null && dosageHasFormulation(dosages[vi], fKey)) {
                visibleDosage = dosages[vi]; break;
              }
            }
            var vds = visibleDosage ? getCardVendorsForDose(visibleDosage.label, visibleDosage.top_vendors) : (p.top_vendors || []);
            renderVendorRows(vendorList, cardKitFilter(filterByFormulation(vds, fKey), visibleDosage));
          }; })(f.key, btn));
          formBtns.push(btn);
          formRow.appendChild(btn);
        });
        var activeStillVisibleG = formBtns.some(function(b) { return b.classList.contains('is-active'); });
        if (!activeStillVisibleG && formBtns.length > 0) {
          activeFormulation = formBtns[0].getAttribute('data-fkey');
          formBtns[0].classList.add('is-active');
        }
        formRow.style.display = formBtns.length > 0 ? '' : 'none';
      }
    });
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

    // After enrichment, check whether the full /prices data reveals non-vial
    // formulations that weren't present in the lightweight /products top_vendors
    // (e.g. "Air Dispersal Kit" → Spray). Rebuilds the grid once if new
    // formulations are discovered; guarded by _formRowAdded so it doesn't loop.
    if (!hasFormulationRow && !p._formRowAdded) {
      p._formRowAdded = true;
      ensureCardAllPricesLoaded().then(function() {
        var newCardFormKeys = [];
        // Check both the original dosage vendors and the enriched price data
        var newAllCardVendors = [];
        dosages.forEach(function(d) { (d.top_vendors || []).forEach(function(v) { newAllCardVendors.push(v); }); });
        if (newAllCardVendors.length === 0) (p.top_vendors || []).forEach(function(v) { newAllCardVendors.push(v); });
        if (p._cardPricesByDose) {
          Object.keys(p._cardPricesByDose).forEach(function(k) {
            (p._cardPricesByDose[k] || []).forEach(function(v) { newAllCardVendors.push(v); });
          });
        }
        newAllCardVendors.forEach(function(v) {
          var fk = getCardFormulationKey(v);
          if (fk && newCardFormKeys.indexOf(fk) === -1) newCardFormKeys.push(fk);
        });
        if (newCardFormKeys.length >= 1) {
          renderProductGrid(filteredProducts());
        }
      });
    }

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
    state.detailFormulationFilter = 'vial';
    state.detailFormKeys = [];
    state.detailHasVials = true;
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
      var dosageMap = {};    // normKey -> array of vendors
      var dosageLabelMap = {}; // normKey -> display label (first seen wins)
      var dosageOrder = [];  // normKeys in insertion order
      var DOSAGE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\b/i;
      var detailRemapMap = (UI.dose_remaps && state.detailProductName && UI.dose_remaps[state.detailProductName.toLowerCase().trim()]) || {};
      allPrices.forEach(function(v) {
        var lbl = null;
        if (v.amount_mg != null) {
          var amt = v.amount_mg == Math.floor(v.amount_mg) ? Math.floor(v.amount_mg) : v.amount_mg;
          lbl = amt + ' ' + (v.amount_unit || 'mg').toLowerCase();
        }
        if (!lbl) {
          var m = (v.product || '').match(DOSAGE_RE);
          if (m) lbl = m[1] + ' ' + m[2].toLowerCase();
        }
        if (!lbl) lbl = 'default';
        var normLbl = lbl.toLowerCase().replace(/\s+/g, '');
        if (detailRemapMap[normLbl]) {
          lbl = detailRemapMap[normLbl];
          normLbl = lbl.toLowerCase().replace(/\s+/g, '');
          var remapDoseM = lbl.match(/^(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|iu|ml)\s*$/i);
          if (remapDoseM && v.amount_mg == null) {
            v = Object.assign({}, v, { amount_mg: parseFloat(remapDoseM[1]), amount_unit: remapDoseM[2].toLowerCase() });
          }
        }
        // Use normKey for bucket identity so "6 mg" and "6mg" always merge.
        if (!dosageMap[normLbl]) { dosageMap[normLbl] = []; dosageLabelMap[normLbl] = lbl; dosageOrder.push(normLbl); }
        dosageMap[normLbl].push(v);
      });
      // Sort dosage labels numerically
      dosageOrder.sort(function(a, b) {
        var na = parseFloat(a) || 0, nb = parseFloat(b) || 0;
        return na - nb;
      });
      var dosages = dosageOrder.map(function(normKey) {
        return {
          label: dosageLabelMap[normKey],
          vendors: dosageMap[normKey].sort(function(a, b) {
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

      // Compute which formulations exist across all dosages for this product
      var allDetailVendors = [];
      dosages.forEach(function(d) { (d.vendors || []).forEach(function(v) { allDetailVendors.push(v); }); });
      var detailFormKeys = [];
      allDetailVendors.forEach(function(v) {
        var fk = vendorFormulationKey(v);
        if (fk && detailFormKeys.indexOf(fk) === -1) detailFormKeys.push(fk);
      });
      var detailHasVials = allDetailVendors.some(function(v) {
        return NON_VIAL_KEYS.indexOf(vendorFormulationKey(v)) === -1;
      });
      state.detailFormKeys = detailFormKeys;
      state.detailHasVials = detailHasVials;

      // Auto-select nearest valid type filter: if no vials exist, switch away from 'vial'
      if (state.detailTypeFilter === 'vial' && !detailHasVials) {
        state.detailTypeFilter = 'all';
      }
      // Auto-select nearest valid formulation filter: if selected formulation has no vendors, reset to 'all'
      if (state.detailFormulationFilter !== 'vial' && state.detailFormulationFilter !== 'all' && detailFormKeys.indexOf(state.detailFormulationFilter) === -1) {
        state.detailFormulationFilter = 'vial';
      }

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

    // Only show dosages that have at least one vendor matching the active type + formulation filters,
    // and that are not hidden via admin dose labels (__exclude__ sentinel).
    var visibleDosages = dosages.filter(function(d) {
      if (getDoseLabel(state.detailProductName, d.label) === null) return false;
      return (d.vendors || []).some(function(v) {
        var name = (v.product_name || '').toLowerCase();
        if (state.detailTypeFilter === 'kit' && !isKitTerm(name)) return false;
        if (state.detailTypeFilter === 'vial' && isKitTerm(name)) return false;
        if (state.detailFormulationFilter === 'vial' && NON_VIAL_KEYS.indexOf(vendorFormulationKey(v)) !== -1) return false;
        if (state.detailFormulationFilter !== 'all' && state.detailFormulationFilter !== 'vial' && vendorFormulationKey(v) !== state.detailFormulationFilter) return false;
        return true;
      });
    });
    // If no dosages match the current formulation filter, switch to the nearest one that has vendors.
    if (visibleDosages.length === 0 && state.detailFormulationFilter !== 'vial') {
      var fallbackOrder = ['vial'].concat((state.detailFormKeys || []).filter(function(k) { return k !== state.detailFormulationFilter; }));
      for (var fi = 0; fi < fallbackOrder.length; fi++) {
        var candidate = fallbackOrder[fi];
        var hasMatch = dosages.some(function(d) {
          if (getDoseLabel(state.detailProductName, d.label) === null) return false;
          return (d.vendors || []).some(function(v) {
            var name = (v.product_name || '').toLowerCase();
            if (state.detailTypeFilter === 'kit' && !isKitTerm(name)) return false;
            if (state.detailTypeFilter === 'vial' && isKitTerm(name)) return false;
            if (candidate === 'vial' && NON_VIAL_KEYS.indexOf(vendorFormulationKey(v)) !== -1) return false;
            if (candidate !== 'vial' && vendorFormulationKey(v) !== candidate) return false;
            return true;
          });
        });
        if (hasMatch) {
          state.detailFormulationFilter = candidate;
          // Recompute visibleDosages with new filter
          visibleDosages = dosages.filter(function(d) {
            if (getDoseLabel(state.detailProductName, d.label) === null) return false;
            return (d.vendors || []).some(function(v) {
              var name = (v.product_name || '').toLowerCase();
              if (state.detailTypeFilter === 'kit' && !isKitTerm(name)) return false;
              if (state.detailTypeFilter === 'vial' && isKitTerm(name)) return false;
              if (state.detailFormulationFilter === 'vial' && NON_VIAL_KEYS.indexOf(vendorFormulationKey(v)) !== -1) return false;
              if (state.detailFormulationFilter !== 'all' && state.detailFormulationFilter !== 'vial' && vendorFormulationKey(v) !== state.detailFormulationFilter) return false;
              return true;
            });
          });
          break;
        }
      }
    }

    // If the active dosage is now hidden, advance to first visible one.
    if (visibleDosages.length > 0 && !visibleDosages.some(function(d) { return dosages.indexOf(d) === activeIdx; })) {
      state.detailActiveDosage = dosages.indexOf(visibleDosages[0]);
      activeIdx = state.detailActiveDosage;
    }

    visibleDosages.forEach(function(d) {
      var idx = dosages.indexOf(d);
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
      if (displayLabel === null) return; // hidden via admin dose labels
      if (isActive) {
        labelSpan.innerHTML = '<svg class="pa-pill-star" viewBox="0 0 12 12" width="10" height="10" fill="currentColor" style="margin-right:3px"><path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5 2.9 10.1l.6-3.4L1 4.3l3.6-.5z"/></svg>' + escHtml(displayLabel);
      } else {
        labelSpan.textContent = displayLabel;
      }
      btn.appendChild(labelSpan);


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
      // Hide "Vials" button if this product has no vial vendors
      if (mode === 'vial' && state.detailHasVials === false) return;
      var btn = el('button', 'pa-dpbar-stock-btn' + (state.detailTypeFilter === mode ? ' is-active' : ''), label);
      btn.type = 'button';
      btn.addEventListener('click', (function(m) { return function() { state.detailTypeFilter = m; renderDetailDosageGrid(); }; })(mode));
      barCenter.appendChild(btn);
    });
    bar.appendChild(barCenter);

    // Right: formulation select (dynamic) + sort + suppliers
    var barRight = el('div', 'pa-dpbar-right');

    // Formulation toggle buttons — show 'Vials' first, then formulations that actually have vendors for this product.
    var formSep = el('span', 'pa-dpbar-sep');
    barRight.appendChild(formSep);
    var vialBtn = el('button', 'pa-dpbar-stock-btn' + (state.detailFormulationFilter === 'vial' ? ' is-active' : ''), 'Vials');
    vialBtn.type = 'button';
    vialBtn.addEventListener('click', function() {
      state.detailFormulationFilter = 'vial';
      renderDetailDosageGrid();
    });
    barRight.insertBefore(vialBtn, formSep);
    var availableFormulations = FORMULATIONS.filter(function(f) { return (state.detailFormKeys || []).indexOf(f.key) !== -1; });
    availableFormulations.forEach(function(f) {
      var btn = el('button', 'pa-dpbar-stock-btn' + (state.detailFormulationFilter === f.key ? ' is-active' : ''), f.label);
      btn.type = 'button';
      btn.addEventListener('click', (function(fKey) { return function() {
        state.detailFormulationFilter = fKey;
        renderDetailDosageGrid();
      }; })(f.key));
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
      filtered = filtered.filter(function(v) { var pn = (v.product_name || '').toLowerCase(); return isKitTerm(pn); });
    } else if (state.detailTypeFilter === 'vial') {
      filtered = filtered.filter(function(v) { var pn = (v.product_name || '').toLowerCase(); return !isKitTerm(pn); });
    }
    if (state.detailFormulationFilter === 'vial') {
      filtered = filtered.filter(function(v) { return NON_VIAL_KEYS.indexOf(vendorFormulationKey(v)) === -1; });
    } else if (state.detailFormulationFilter !== 'all') {
      filtered = filtered.filter(function(v) { return vendorFormulationKey(v) === state.detailFormulationFilter; });
    }
    if (state.detailSupplierFilter.size > 0) {
      filtered = filtered.filter(function(v) { return state.detailSupplierFilter.has(v.vendor); });
    }
    // Deduplicate: in kit mode use vendor+product_name so distinct kit products from the
    // same vendor (e.g. "DSIP Kit" and "DSIP Bulk Pack") both appear; otherwise keep
    // best (lowest) price per vendor.
    var vendorBest = {};
    filtered.forEach(function(v) {
      var dedupKey = state.detailTypeFilter === 'kit'
        ? v.vendor + '\x00' + (v.product_name || '')
        : v.vendor;
      var p = v.price != null ? v.price : Infinity;
      var existing = vendorBest[dedupKey];
      var ep = existing && existing.price != null ? existing.price : Infinity;
      if (!existing || p < ep) {
        vendorBest[dedupKey] = v;
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


      // Right: price+link row, coupon row below
      var right = el('div', 'pa-detail-vrow-right');

      var priceRow = el('div', 'pa-detail-price-row');

      var pricePer = v.price_per_mg != null ? v.price_per_mg : (v.price != null && v.amount_mg ? v.price / v.amount_mg : null);
      var showPer = state.detailPriceMode === 'mgml' && pricePer != null;
      var priceWrap = el('div', 'pa-detail-price-wrap');

      // Compute coupon-discounted price for this vendor (if any)
      var _detailSav = COUPON_SAVINGS[(v.vendor || '').toLowerCase()] || '';
      var _detailDiscountedPrice = null;
      if (_detailSav && v.price != null) {
        var _dsSavStr = String(_detailSav).trim();
        var _dsPctM = _dsSavStr.match(/(\d+(?:\.\d+)?)\s*%/);
        var _dsFixM = !_dsPctM ? _dsSavStr.match(/\$\s*(\d+(?:\.\d+)?)/) : null;
        _detailDiscountedPrice = _dsPctM
          ? v.price * (1 - parseFloat(_dsPctM[1]) / 100)
          : (_dsFixM ? Math.max(0, v.price - parseFloat(_dsFixM[1])) : null);
      }

      var _detailActualPrice = showPer
        ? '$' + Number(pricePer).toFixed(1) + '/' + (v.amount_unit || 'mg')
        : fmt(v.price, v.currency);

      if (_detailDiscountedPrice != null) {
        var _detailDiscountedPer = v.amount_mg ? _detailDiscountedPrice / v.amount_mg : null;
        var _detailDiscountedDisplay = showPer && _detailDiscountedPer != null
          ? '$' + Number(_detailDiscountedPer).toFixed(1) + '/' + (v.amount_unit || 'mg')
          : fmt(_detailDiscountedPrice, v.currency);
        // Crossed-out actual price
        priceWrap.appendChild(el('span', 'pa-detail-prev-price', escHtml(_detailActualPrice)));
        // Discounted price as the main price
        var priceEl = el('span', 'pa-detail-price' + (i === 0 ? ' pa-price--best' : ''), escHtml(_detailDiscountedDisplay));
        if (v.listing_id) priceEl.setAttribute('data-listing-id', v.listing_id);
        priceWrap.appendChild(priceEl);
      } else {
        var priceEl = el('span', 'pa-detail-price' + (i === 0 ? ' pa-price--best' : ''), escHtml(_detailActualPrice));
        if (v.listing_id) priceEl.setAttribute('data-listing-id', v.listing_id);
        priceWrap.appendChild(priceEl);
      }
      // Coupon price tooltip — shown on row hover when a savings value is configured
      priceRow.appendChild(priceWrap);

      if (v.link) {
        var a = document.createElement('a');
        a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'pa-detail-link-icon';
        a.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
        a.addEventListener('click', function(e) { e.stopPropagation(); });
        priceRow.appendChild(a);
      }
      right.appendChild(priceRow);

      if (v.coupon_code) {
        var detailVendorSavings = COUPON_SAVINGS[(v.vendor || '').toLowerCase()] || '';
        var cbWrap = el('span', 'pa-coupon-wrap');
        var badgeInner = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span class="pa-coupon-text">' + escHtml(v.coupon_code) + '</span>' + (detailVendorSavings ? '<span class="pa-coupon-save-inline">\u00b7 Save ' + escHtml(detailVendorSavings) + '</span>' : '');
        var badge = el('span', 'pa-coupon-badge', badgeInner);
        var copyBtn = el('button', 'pa-coupon-copy-btn', '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
        copyBtn.type = 'button'; copyBtn.title = 'Copy coupon';
        (function(code, btn, sav) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            navigator.clipboard && navigator.clipboard.writeText(code);
            showCouponToast(code, e.clientX, e.clientY, sav);
            btn.textContent = '\u2713';
            setTimeout(function() { btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, 1500);
          });
        })(v.coupon_code, copyBtn, detailVendorSavings);

        // Make the entire badge clickable — same as compact view
        badge.style.cursor = 'pointer';
        (function(code, bdg, sav) {
          bdg.addEventListener('click', function(e) {
            if (e.target.closest('.pa-coupon-copy-btn')) return;
            e.stopPropagation();
            navigator.clipboard && navigator.clipboard.writeText(code);
            showCouponToast(code, e.clientX, e.clientY, sav);
            var originalContent = bdg.innerHTML;
            bdg.innerHTML = '<span style="color:#16a34a; font-weight:bold;">\u2713 Copied!</span>';
            setTimeout(function() { bdg.innerHTML = originalContent; }, 1500);
          });
        })(v.coupon_code, badge, detailVendorSavings);

        badge.appendChild(copyBtn);
        cbWrap.appendChild(badge);
        right.appendChild(cbWrap);
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
        // Also clear the matching applied state so filteredProducts() stops filtering on it
        if (state.applied) {
          if (name === 'In Stock Only') state.applied.toggles.instock = false;
          if (name === 'KIT Only') state.applied.toggles.kits = false;
          if (name === 'Blends Only') state.applied.toggles.blends = false;
          if (name === 'Likes Only') state.applied.toggles.likes = false;
          state.applied.priceRanges.delete(name);
          state.applied.suppliers.delete(name);
        }
        renderActiveFilters();
        renderProductGrid(filteredProducts());
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
      item.innerHTML = '<span class="pa-check-title">' + escHtml(c.name) + '</span><span class="pa-count-pill">' + (c.count || '') + '</span><span class="pa-check-box">' + (selected ? '✓' : '') + '</span>';
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
        var logoHtml = s.logo_url
          ? '<img class="pa-check-logo" src="' + escHtml(s.logo_url) + '" alt="">'
          : '<span class="pa-check-avatar">' + escHtml(vendorInitials(s.name)) + '</span>';
        item.innerHTML = logoHtml + '<span class="pa-check-title">' + escHtml(s.name) + '</span><span class="pa-check-box">' + (selected ? '✓' : '') + '</span>';
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
    modal.setAttribute('aria-hidden', 'false');
    // Force a reflow so the translateY(100%) starting state is painted before we add is-open
    modal.offsetHeight; // eslint-disable-line no-unused-expressions
    modal.classList.add('is-open');
    document.body.classList.add('pa-modal-open');
    state.modalOpen = true;
    syncDraftToControls(); renderCategoryList(); renderSupplierList(); renderPriceRanges(); renderSortOptions();
  }

  function closeModal(revert) {
    const modal = document.getElementById('pa-filter-modal');
    if (!modal) return;
    if (revert && state.applied) state.draft = copyDraft(state.applied);
    modal.classList.remove('is-open');
    state.modalOpen = false;
    document.body.classList.remove('pa-modal-open');
    var card = modal.querySelector('.pa-modal-card');
    var onEnd = function() {
      modal.setAttribute('aria-hidden', 'true');
      if (card) card.removeEventListener('transitionend', onEnd);
    };
    if (card) {
      card.addEventListener('transitionend', onEnd);
    } else {
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function applyModal() {
    state.applied = copyDraft(state.draft);
    ['In Stock Only', 'KIT Only', 'Blends Only', 'Likes Only'].forEach(function (t) { state.activeFilters.delete(t); });
    if (state.applied.toggles.instock) state.activeFilters.add('In Stock Only');
    if (state.applied.toggles.kits) state.activeFilters.add('KIT Only');
    if (state.applied.toggles.blends) state.activeFilters.add('Blends Only');
    if (state.applied.toggles.likes) state.activeFilters.add('Likes Only');
    Array.from(UI.categories || []).forEach(function (c) { state.activeFilters.delete(c.name); });
    Array.from(UI.suppliers || []).forEach(function (s) { state.activeFilters.delete(s.name); });
    Array.from(UI.price_ranges || []).forEach(function (p) { state.activeFilters.delete(p); });
    // Categories are synced into tagFilters (rendered by renderActiveFilters already),
    // so do NOT also add them to activeFilters — that would show duplicate chips.
    state.applied.suppliers.forEach(function (s) { state.activeFilters.add(s); });
    state.applied.priceRanges.forEach(function (p) { state.activeFilters.add(p); });
    // Sync selected categories into tagFilters — the same mechanism used by card
    // category badge clicks, which is what filteredProducts() actually reads.
    Array.from(UI.categories || []).forEach(function (c) { state.tagFilters.delete(c.name); });
    state.applied.categories.forEach(function (c) { state.tagFilters.add(c); });
    renderActiveFilters();
    renderProductGrid(filteredProducts());
    showProductGrid();
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
