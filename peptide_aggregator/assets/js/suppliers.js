(function () {
  'use strict';

  const UI = window.PA_SUPPLIERS_UI || { api_base: '', prices_url: '' };
  const API = (UI.api_base || '').replace(/\/$/, '');
  const PRICES_URL = UI.prices_url || '';

  // ─── Utility ─────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ─── State ────────────────────────────────────────────────────────────────
  var allVendors = [];
  var state = {
    query: '',
    popularFilter: null,   // vendor name or null
    couponOnly: false,
    cryptoOnly: false,
    favsOnly: false,
    usOnly: false,
    sort: 'name',
    sortDir: 'asc',
    viewMode: 'grid',
    favourites: new Set(JSON.parse(localStorage.getItem('pas_favs') || '[]')),
  };

  // ─── Payment helpers ─────────────────────────────────────────────────────  var PM_LABELS = {
    credit_card: 'Credit Card',
    crypto: 'Crypto',
    apple_pay: 'Apple Pay',
    bank_ach: 'Bank / ACH',
    cash_app: 'Cash App',
    zelle: 'Zelle',
    paypal: 'PayPal',
    venmo: 'Venmo',
    google_pay: 'Google Pay',
    ach_bank: 'ACH/Bank Transfer',
    check: 'Check'
  };
  var PM_ALIASES = {
    'Credit Card': 'credit_card',
    'credit card': 'credit_card',
    'Crypto': 'crypto',
    'crypto': 'crypto',
    'Apple Pay': 'apple_pay',
    'apple pay': 'apple_pay',
    'Bank / ACH': 'bank_ach',
    'Bank/ACH': 'bank_ach',
    'bank/ach': 'bank_ach',
    'Cash App': 'cash_app',
    'cash app': 'cash_app',
    'Zelle': 'zelle',
    'zelle': 'zelle',
    'PayPal': 'paypal',
    'paypal': 'paypal',
    'Venmo': 'venmo',
    'venmo': 'venmo',
    'Google Pay': 'google_pay',
    'google pay': 'google_pay',
    'ACH/Bank Transfer': 'ach_bank',
    'ACH / Bank Transfer': 'ach_bank',
    'ach/bank transfer': 'ach_bank',
    'ach_bank_transfer': 'ach_bank',
    'Check': 'check',
    'check': 'check'
  };
  // Payment logo badges — brand-coloured pills shown on supplier cards
  var PM_ICONS = {
    credit_card: '<span class="pas-pm-logo" style="background:#1a1f71;" title="Credit Card"><svg viewBox="0 0 32 22" width="32" height="22"><rect width="32" height="22" rx="3" fill="#1a1f71"/><rect y="6" width="32" height="6" fill="#e8b84b"/><rect x="3" y="16" width="8" height="2" rx="1" fill="rgba(255,255,255,0.55)"/><circle cx="25" cy="17" r="3" fill="rgba(235,80,50,0.75)"/><circle cx="27.5" cy="17" r="3" fill="rgba(255,180,0,0.75)"/></svg></span>',
    crypto: '<span class="pas-pm-logo" style="background:#f7931a;" title="Crypto"><svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M11.5 2v2.1C8.4 4.6 6 7 6 10c0 2 1 3.7 2.5 4.8V17H6v2h5.5v3h3v-3H17v-2h-2.5v-2.4c1.4-.9 2.5-2.4 2.5-4.1 0-2.2-1.4-4.1-3.5-4.8V2h-2zM12 7c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3z"/></svg></span>',
    apple_pay: '<span class="pas-pm-logo" style="background:#000;" title="Apple Pay"><svg viewBox="0 0 38 16" width="38" height="16"><text x="2" y="12" font-family="-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif" font-size="10" font-weight="600" fill="white"> Pay</text><path d="M5 3.5c.35-.42.82-.72 1.35-.7.06.57-.22 1.14-.56 1.52-.34.4-.8.68-1.3.65-.06-.57.23-1.15.51-1.47zm1.35 1.82c.75 0 1.37.43 1.72.43.36 0 .97-.43 1.72-.43 1.3 0 2.28.86 2.82 2.18-2.48 1.38-2.08 4.99.42 5.83-.4.9-.82 1.72-1.46 2.32-.55.72-1.14 1.3-1.94 1.3-.81 0-1.04-.5-2.03-.5-.9 0-1.2.5-1.93.5-.82 0-1.45-.65-2.04-1.4C2.74 13.78 2 11.7 2 9.68c0-3.04 1.96-4.64 3.82-4.64.74 0 1.38.48 2.03.48.3 0 .38-.5.38-.5h.06c.15 0 .4.5.58.5.15 0 .04-.7.04-.7z" fill="white" transform="scale(1.1) translate(-1,-1)"/></svg></span>',
    bank_ach: '<span class="pas-pm-logo" style="background:#1d4ed8;" title="Bank / ACH"><svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M3 21h18M3 10h18M12 3 3 9h18L12 3z"/><rect x="5" y="10" width="3" height="8"/><rect x="10.5" y="10" width="3" height="8"/><rect x="16" y="10" width="3" height="8"/></svg></span>',
    cash_app: '<span class="pas-pm-logo" style="background:#00d54b;" title="Cash App"><svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M12.75 4v1.28c1.96.36 3.25 1.6 3.25 3.22h-2c0-.84-.6-1.5-1.25-1.5v3.05l.83.22c1.68.44 2.42 1.53 2.42 2.96C16 14.77 14.68 16 12.75 16.22V18h-1.5v-1.77C9.26 15.87 8 14.57 8 12.93h2c0 .87.6 1.57 1.25 1.57V11.4l-.77-.2C8.8 10.74 8 9.7 8 8.33 8 6.79 9.26 5.55 11.25 5.27V4h1.5z"/></svg></span>',
    zelle: '<span class="pas-pm-logo" style="background:#6d1ed4;" title="Zelle"><svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M6 7h12l-9 10h9M6 17h0" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
    paypal: '<span class="pas-pm-logo" style="background:#003087;" title="PayPal"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 18.5H4.5l1.7-11h5.1c2.6 0 4.2 1.2 3.7 3.7-.5 2.5-2.5 3.7-5 3.7H8.3L7 18.5z" fill="#009cde"/><path d="M9.5 14.5H7.3l1.4-8h4.6c2.2 0 3.5 1 3.3 3.2-.4 2.2-2.2 3.3-4.4 3.3H10L9.5 14.5z" fill="white" opacity="0.8"/></svg></span>',
    venmo: '<span class="pas-pm-logo" style="background:#3d95ce;" title="Venmo"><svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M5 5.5c.5 1.5 1.5 5 2.5 8L11.5 5.5h6L10 19h-5L4 5.5h1z"/></svg></span>',
    google_pay: '<span class="pas-pm-logo" style="background:#fff;border:1px solid #e0e0e0;" title="Google Pay"><svg viewBox="0 0 40 16" width="40" height="16"><text x="2" y="12" font-family="Arial,sans-serif" font-size="9.5" font-weight="700"><tspan fill="#4285F4">G</tspan><tspan fill="#EA4335">o</tspan><tspan fill="#FBBC05">o</tspan><tspan fill="#34A853">g</tspan><tspan fill="#EA4335">l</tspan><tspan fill="#4285F4">e</tspan><tspan fill="#5f6368" font-weight="400"> Pay</tspan></text></svg></span>',
    ach_bank: '<span class="pas-pm-logo" style="background:#1d4ed8;" title="ACH / Bank Transfer"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/><path d="M17 9l3 3-3 3M7 9l-3 3 3 3"/></svg></span>',
    check: '<span class="pas-pm-logo" style="background:#6b7280;" title="Check"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>'
  };
  var PM_DESCS = {
    credit_card: 'Visa, Mastercard, American Express',
    crypto: '5% discount with crypto',
    apple_pay: 'Apple Pay',
    bank_ach: 'Bank transfer or ACH',
    cash_app: 'Cash App',
    zelle: 'Zelle',
    paypal: 'PayPal',
    venmo: 'Venmo',
    google_pay: 'Google Pay',
    ach_bank: 'ACH/Bank Transfer',
    check: 'Check'
  };
  function pmLabel(key, raw) {
    return PM_LABELS[key] || PM_LABELS[raw] || raw || 'Payment';
  }
  function pmDesc(key) {
    return PM_DESCS[key] || '';
  }

  function pmKey(pm) {
    var raw = String(pm || '');
    if (PM_ALIASES[raw]) return PM_ALIASES[raw];
    var slug = raw.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return PM_ALIASES[slug] || slug;
  }

  function parsePms(v) {
    var pms = v && v.payment_methods;
    if (!pms) return [];
    if (typeof pms === 'string') {
      try { pms = JSON.parse(pms); }
      catch (e) { pms = pms.split(','); }
    }
    if (!Array.isArray(pms)) pms = [pms];
    return pms.map(function(pm) {
      if (pm && typeof pm === 'object') {
        if (pm.name) return String(pm.name);
        if (pm.label) return String(pm.label);
      }
      return String(pm || '');
    }).map(function(pm) { return pm.trim(); }).filter(Boolean);
  }

  function buildAffiliateLink(v) {
    var base = v.base_url || '';
    var tpl = v.affiliate_template || '';
    if (tpl) {
      if (tpl.indexOf('{url}') !== -1) {
        return tpl.replace('{url}', base ? encodeURIComponent(base) : '');
      }
      if (tpl.indexOf('://') !== -1) {
        // Full URL: extract only the path/query/fragment and append to base
        try {
          var parsed = new URL(tpl);
          var suffix = parsed.pathname + parsed.search + parsed.hash;
          if (!suffix || suffix === '/') return base;
          if (suffix.charAt(0) === '?') return base ? base.replace(/\/$/, '') + suffix : '';
          return base ? base.replace(/\/$/, '') + '/' + suffix.replace(/^\//, '') : '';
        } catch(e) {
          return base;
        }
      }
      // Path or query suffix
      if (tpl.charAt(0) === '?') {
        return base ? base.replace(/\/$/, '') + tpl : '';
      }
      return base ? base.replace(/\/$/, '') + '/' + tpl.replace(/^\//, '') : '';
    }
    return base;
  }

  function openPaymentModal(v) {
    var modal = document.getElementById('pa-pm-modal');
    if (!modal) return;
    var list = document.getElementById('pa-pm-modal-list');
    if (list) {
      list.innerHTML = '';
      var pms = parsePms(v);
      if (!pms.length) {
        list.appendChild(el('div', 'pa-pm-modal-empty', 'No payment methods listed.'));
      } else {
        var seen = new Set();
        pms.forEach(function(pm) {
          var key = pmKey(pm);
          if (seen.has(key)) return;
          seen.add(key);
          var label = pmLabel(key, pm);
          var desc = pmDesc(key);
          var item = el('div', 'pa-pm-modal-item');
          var iconWrap = el('div', 'pa-pm-modal-icon');
          iconWrap.innerHTML = PM_ICONS[key] || ('<span class="pas-pm-logo pas-pm-logo--fallback">' + escHtml(String(label).slice(0,3)) + '</span>');
          var textWrap = el('div', 'pa-pm-modal-text');
          textWrap.appendChild(el('div', 'pa-pm-modal-name', escHtml(label)));
          if (desc) textWrap.appendChild(el('div', 'pa-pm-modal-desc', escHtml(desc)));
          item.appendChild(iconWrap);
          item.appendChild(textWrap);
          list.appendChild(item);
        });
      }
    }
    var cta = document.getElementById('pa-pm-modal-cta');
    if (cta) {
      var link = buildAffiliateLink(v);
      if (link) {
        cta.href = link;
        cta.style.display = 'flex';
        cta.innerHTML = escHtml('Continue to ' + (v.name || 'site')) + ' <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      } else {
        cta.style.display = 'none';
      }
    }
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('pa-modal-open');
  }

  function closePaymentModal() {
    var modal = document.getElementById('pa-pm-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('pa-modal-open');
  }

  function initPaymentModal() {
    var modal = document.getElementById('pa-pm-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-pm-close="1"]').forEach(function(btn) {
      btn.addEventListener('click', closePaymentModal);
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closePaymentModal();
    });
  }

  // ─── Popular chips (top vendors by product count) ─────────────────────────
  function renderPopularChips() {
    var wrap = document.getElementById('pas-popular');
    if (!wrap) return;
    wrap.innerHTML = '';
    var top = allVendors.slice().sort(function(a,b){ return (b.product_count||0)-(a.product_count||0); }).slice(0, 8);
    top.forEach(function(v) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pa-chip' + (state.query === v.name ? ' is-active' : '');
      var avatarEl;
      if (v.logo_url) {
        avatarEl = '<img src="' + escHtml(v.logo_url) + '" width="18" height="18" style="border-radius:50%;object-fit:cover;flex-shrink:0;margin-right:5px">';
      } else {
        avatarEl = '<span style="width:18px;height:18px;border-radius:50%;background:#253a5e;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0;margin-right:5px">' + escHtml((v.name||'?')[0].toUpperCase()) + '</span>';
      }
      btn.innerHTML = avatarEl + escHtml(v.name);
      btn.addEventListener('click', function() {
        var searchEl = document.getElementById('pas-search');
        if (state.query === v.name) {
          // deselect: clear search
          state.query = '';
          if (searchEl) searchEl.value = '';
        } else {
          state.query = v.name;
          if (searchEl) { searchEl.value = v.name; searchEl.focus(); }
        }
        renderPopularChips();
        filterAndRender();
      });
      wrap.appendChild(btn);
    });
  }

  function renderActiveFilters() {
    var row = document.getElementById('pas-active-row');
    var list = document.getElementById('pas-active-filters');
    if (!list || !row) return;
    list.innerHTML = '';
    var tags = [];
    if (state.couponOnly) tags.push({ label: 'Has Coupon',   clear: function(){ state.couponOnly = false; document.getElementById('pas-filter-coupon') && document.getElementById('pas-filter-coupon').classList.remove('is-active'); } });
    if (state.cryptoOnly) tags.push({ label: 'Crypto Only',  clear: function(){ state.cryptoOnly = false; document.getElementById('pas-filter-crypto') && document.getElementById('pas-filter-crypto').classList.remove('is-active'); } });
    if (state.favsOnly)   tags.push({ label: 'Favourites',   clear: function(){ state.favsOnly = false; document.getElementById('pas-filter-favs') && document.getElementById('pas-filter-favs').classList.remove('is-active'); } });
    if (state.usOnly)     tags.push({ label: 'US Only',      clear: function(){ state.usOnly = false; document.getElementById('pas-filter-us') && document.getElementById('pas-filter-us').classList.remove('is-active'); } });
    tags.forEach(function(t) {
      var tag = el('span', 'pa-active-tag');
      tag.innerHTML = escHtml(t.label) + ' <button type="button" class="pa-active-tag-remove" aria-label="Remove">&times;</button>';
      tag.querySelector('button').addEventListener('click', function() {
        t.clear(); renderActiveFilters(); filterAndRender();
      });
      list.appendChild(tag);
    });
    row.classList.toggle('is-visible', tags.length > 0);
  }

  // ─── Build supplier card ─────────────────────────────────────────────────
  function buildSupplierCard(v) {
    var card = el('div', 'pa-scard');

    // ── Header: logo + name + favourite ──────────────────────────────────
    var head = el('div', 'pa-scard-head');
    var logo = el('div', 'pa-scard-logo');
    if (v.logo_url) {
      var img = document.createElement('img');
      img.src = v.logo_url; img.alt = v.name; img.width = 48; img.height = 48;
      logo.appendChild(img);
    } else {
      logo.textContent = (v.name || '?')[0].toUpperCase();
    }
    var headInfo = el('div', 'pa-scard-head-info');
    headInfo.appendChild(el('span', 'pa-scard-name', escHtml(v.name)));
    head.appendChild(logo);
    head.appendChild(headInfo);

    var isFav = state.favourites.has(v.id);
    var favBtn = el('button', 'pa-scard-fav' + (isFav ? ' is-active' : ''), '<svg viewBox="0 0 24 24" width="16" height="16" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>');
    favBtn.type = 'button'; favBtn.title = 'Favourite';
    favBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (state.favourites.has(v.id)) state.favourites.delete(v.id);
      else state.favourites.add(v.id);
      localStorage.setItem('pas_favs', JSON.stringify(Array.from(state.favourites)));
      var svg = favBtn.querySelector('svg');
      if (svg) svg.setAttribute('fill', state.favourites.has(v.id) ? 'currentColor' : 'none');
      favBtn.classList.toggle('is-active', state.favourites.has(v.id));
      if (state.favsOnly) filterAndRender();
    });
    head.appendChild(favBtn);
    card.appendChild(head);

    // ── Stats chips ───────────────────────────────────────────────────────
    var stats = el('div', 'pa-scard-stats');
    if (v.founded_year) stats.appendChild(el('span', 'pa-scard-stat', 'Est. ' + v.founded_year));
    if (v.product_count) stats.appendChild(el('span', 'pa-scard-stat', v.product_count + ' products'));
    card.appendChild(stats);

    // ── Shipping row ──────────────────────────────────────────────────────
    if (v.shipping_info) {
      var shippingRow = el('div', 'pa-scard-info-row');
      shippingRow.innerHTML = '<svg class="pa-scard-row-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#4b8fff" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg><span class="pa-scard-row-text">' + escHtml(v.shipping_info) + '</span>';
      card.appendChild(shippingRow);
    }

    // ── Payment methods row ───────────────────────────────────────────────
    var pms = parsePms(v);
    if (pms.length) {
      var pmRow = el('div', 'pa-scard-info-row pa-scard-payment-row');
      pmRow.tabIndex = 0;
      pmRow.setAttribute('role', 'button');
      pmRow.setAttribute('aria-label', 'View payment methods');
      pmRow.addEventListener('click', function(e) { e.stopPropagation(); openPaymentModal(v); });
      pmRow.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPaymentModal(v); } });
      var pmInner = '<svg class="pa-scard-row-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#4caf82" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg><span class="pa-scard-pm-label">Payments</span>';
      var shown = pms.slice(0, 5);
      var extra = pms.length - shown.length;
      shown.forEach(function(pm) {
        var key = pmKey(pm);
        var icon = PM_ICONS[key];
        if (icon) {
          pmInner += icon;
        } else {
          var label = PM_LABELS[key] || PM_LABELS[pm] || pm;
          pmInner += '<span class="pas-pm-logo pas-pm-logo--fallback" title="' + escHtml(label) + '">' + escHtml(String(label).slice(0,3)) + '</span>';
        }
      });
      if (extra > 0) pmInner += '<span class="pas-pm-more">+' + extra + '</span>';
      pmRow.innerHTML = pmInner;
      card.appendChild(pmRow);
    }

    // ── Coupon row ────────────────────────────────────────────────────────
    if (v.coupon_code) {
      var couponRow = el('div', 'pa-scard-info-row pa-scard-coupon-row');
      couponRow.innerHTML = '<svg class="pa-scard-row-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#f4a94a" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span class="pa-scard-coupon-text">Use coupon code</span>';
      var codeWrap = el('span', 'pa-coupon-wrap');
      codeWrap.appendChild(el('span', 'pa-coupon-badge', '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span class="pa-coupon-text">' + escHtml(v.coupon_code) + '</span>'));
      var copyBtn = el('button', 'pa-coupon-copy-btn', '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>');
      copyBtn.type = 'button'; copyBtn.title = 'Copy';
      (function(code, btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          navigator.clipboard && navigator.clipboard.writeText(code);
          btn.textContent = '\u2713';
          setTimeout(function() { btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, 1500);
        });
      })(v.coupon_code, copyBtn);
      codeWrap.appendChild(copyBtn);
      couponRow.appendChild(codeWrap);
      card.appendChild(couponRow);
    }

    // ── Footer buttons ────────────────────────────────────────────────────
    var btns = el('div', 'pa-scard-btns');
    if (v.base_url) {
      var visitBtn = document.createElement('a');
      visitBtn.href = buildAffiliateLink(v) || v.base_url; visitBtn.target = '_blank'; visitBtn.rel = 'noopener noreferrer';
      visitBtn.className = 'pa-scard-btn is-outline';
      visitBtn.innerHTML = 'Visit site <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      btns.appendChild(visitBtn);
    }
    if (PRICES_URL) {
      var pricesBtn = document.createElement('a');
      pricesBtn.href = PRICES_URL;
      pricesBtn.className = 'pa-scard-btn is-primary';
      pricesBtn.textContent = 'View Prices \u2192';
      btns.appendChild(pricesBtn);
    }
    card.appendChild(btns);
    return card;
  }

  // ─── Render grid ─────────────────────────────────────────────────────────
  function renderGrid(vendors) {
    var grid = document.getElementById('pas-grid');
    var countEl = document.getElementById('pas-count');
    if (!grid) return;
    if (!vendors || vendors.length === 0) {
      grid.innerHTML = '<p class="pa-no-prices">No suppliers found.</p>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (countEl) countEl.textContent = vendors.length + ' Result' + (vendors.length === 1 ? '' : 's');
    grid.innerHTML = '';
    vendors.forEach(function(v) { grid.appendChild(buildSupplierCard(v)); });
  }

  // ─── Filter + sort ────────────────────────────────────────────────────────
  function filterAndRender() {
    var q = state.query.toLowerCase();
    var list = allVendors.slice();
    if (q)            list = list.filter(function(v) { return (v.name||'').toLowerCase().includes(q); });
    if (state.couponOnly)    list = list.filter(function(v) { return !!v.coupon_code; });
    if (state.cryptoOnly)    list = list.filter(function(v) { return parsePms(v).some(function(pm) { return pmKey(pm) === 'crypto'; }); });
    if (state.favsOnly)      list = list.filter(function(v) { return state.favourites.has(v.id); });
    if (state.usOnly)        list = list.filter(function(v) { return String(v.country||'').toUpperCase() === 'US'; });

    list.sort(function(a, b) {
      var dir = state.sortDir === 'desc' ? -1 : 1;
      if (state.sort === 'products') return dir * ((b.product_count||0) - (a.product_count||0));
      if (state.sort === 'founded')  return dir * ((b.founded_year||0) - (a.founded_year||0));
      return dir * (a.name||'').localeCompare(b.name||'');
    });
    renderGrid(list);
  }

  // ─── Load ─────────────────────────────────────────────────────────────────
  async function loadVendors() {
    var grid = document.getElementById('pas-grid');
    if (grid) grid.innerHTML = '<p class="pa-loading">Loading suppliers\u2026</p>';
    try {
      var res = await fetch(API + '/api/vendors');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      allVendors = await res.json();
      renderPopularChips();
      filterAndRender();
    } catch(e) {
      if (grid) grid.innerHTML = '<p class="pa-error">Could not load suppliers.</p>';
    }
  }

  // ─── Bind toggle helper ───────────────────────────────────────────────────
  function bindToggle(id, stateKey) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function() {
      state[stateKey] = !state[stateKey];
      btn.classList.toggle('is-active', state[stateKey]);
      renderActiveFilters();
      filterAndRender();
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    if (!document.getElementById('pas-shell')) return;

    initPaymentModal();

    var searchEl = document.getElementById('pas-search');
    if (searchEl) searchEl.addEventListener('input', function() { state.query = searchEl.value.trim(); renderPopularChips(); filterAndRender(); });

    var sortEl = document.getElementById('pas-sort');
    if (sortEl) sortEl.addEventListener('change', function() { state.sort = sortEl.value; filterAndRender(); });

    var sortAsc = document.getElementById('pas-sort-asc');
    var sortDesc = document.getElementById('pas-sort-desc');
    if (sortAsc) sortAsc.addEventListener('click', function() {
      state.sortDir = 'asc';
      sortAsc.classList.add('is-active'); if (sortDesc) sortDesc.classList.remove('is-active');
      filterAndRender();
    });
    if (sortDesc) sortDesc.addEventListener('click', function() {
      state.sortDir = 'desc';
      sortDesc.classList.add('is-active'); if (sortAsc) sortAsc.classList.remove('is-active');
      filterAndRender();
    });

    bindToggle('pas-filter-coupon', 'couponOnly');
    bindToggle('pas-filter-crypto', 'cryptoOnly');
    bindToggle('pas-filter-favs',   'favsOnly');
    bindToggle('pas-filter-us',     'usOnly');

    var viewGrid = document.getElementById('pas-view-grid');
    var viewList = document.getElementById('pas-view-list');
    var grid = document.getElementById('pas-grid');
    if (viewGrid) viewGrid.addEventListener('click', function() {
      state.viewMode = 'grid'; grid && grid.classList.remove('is-list');
      viewGrid.classList.add('is-active'); if (viewList) viewList.classList.remove('is-active');
    });
    if (viewList) viewList.addEventListener('click', function() {
      state.viewMode = 'list'; grid && grid.classList.add('is-list');
      viewList.classList.add('is-active'); if (viewGrid) viewGrid.classList.remove('is-active');
    });

    var clearBtn = document.getElementById('pas-clear-all');
    if (clearBtn) clearBtn.addEventListener('click', function() {
      state.couponOnly = false; state.cryptoOnly = false;
      state.favsOnly = false; state.usOnly = false; state.query = '';
      if (searchEl) searchEl.value = '';
      ['pas-filter-coupon','pas-filter-crypto','pas-filter-favs','pas-filter-us'].forEach(function(id) {
        var b = document.getElementById(id); if (b) b.classList.remove('is-active');
      });
      renderPopularChips();
      renderActiveFilters();
      filterAndRender();
    });

    loadVendors();
  });
})();













