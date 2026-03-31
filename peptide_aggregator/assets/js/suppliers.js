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

  function showCouponToast(code, cx, cy) {
    var existing = document.querySelector('.pa-coupon-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'pa-coupon-toast';
    toast.innerHTML =
      '<span class="pa-coupon-toast-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#16a34a" stroke-width="2.5"><circle cx="12" cy="12" r="10" fill="#dcfce7" stroke="#16a34a"/><polyline points="8 12 11 15 16 9" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="pa-coupon-toast-body">' +
        '<span class="pa-coupon-toast-title">Copied code: <span class="pa-coupon-toast-code">' + escHtml(code) + '</span></span>' +
        '<span class="pa-coupon-toast-sub">10% off your order</span>' +
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
 
  // ─── Payment helpers ─────────────────────────────────────────────────────
  var PM_LABELS = {
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
  // Payment method logo badges — brand-coloured pills
  var PM_ICONS = {
    credit_card: '<span class="pas-pm-logo" style="background:#1a1f71;" title="Credit Card"><svg viewBox="0 0 22 14" width="22" height="14" fill="none"><rect x=".6" y=".6" width="20.8" height="12.8" rx="1.4" stroke="rgba(255,255,255,0.3)" stroke-width=".7"/><rect y="3" width="22" height="4" fill="rgba(255,255,255,0.2)"/><rect x="2" y="9" width="5" height="2.5" rx=".7" fill="rgba(255,255,255,0.9)"/><rect x="9" y="9.5" width="8" height="1.5" rx=".5" fill="rgba(255,255,255,0.4)"/></svg></span>',
    crypto:      '<span class="pas-pm-logo" style="background:#f7931a;" title="Crypto"><svg viewBox="0 0 13 14" width="13" height="14" fill="white"><path d="M6.8 1v.9h.4c1.4 0 2.3.6 2.3 1.8 0 .7-.4 1.2-.9 1.4.7.3 1.1.9 1.1 1.7C9.7 8.2 8.7 9 7.2 9H6.8v.9H5.8V9H4.3V1h1.5H6.8zM5.8 4.1H7c.7 0 1-.3 1-.8 0-.5-.3-.8-1-.8H5.8v1.6zm0 3.5h1.3c.8 0 1.1-.3 1.1-.9s-.3-.9-1.1-.9H5.8V7.6z"/></svg></span>',
    apple_pay:   '<span class="pas-pm-logo" style="background:#111;" title="Apple Pay"><svg viewBox="0 0 28 14" width="28" height="14" fill="white"><path d="M8.7 3.9c.3-.4.6-.8 1-.8.1.5-.1 1-.4 1.3-.3.4-.7.7-1.1.6-.1-.4.1-.8.5-1.1zm1 1.5c.5 0 1 .3 1.3.3.3 0 .7-.3 1.2-.3 1 0 1.7.6 2.1 1.6-1.8 1-1.5 3.8.4 4.4-.2.6-.5 1.2-1 1.7-.5.6-.9 1-1.4 1-.6 0-.8-.3-1.5-.3s-.7.3-1.4.3c-.6 0-1-.5-1.5-1.1-.9-1.3-1.6-3.5-1.6-5.2 0-2.3 1.4-3.5 2.9-3.5.6 0 1 .4 1.5.4h.1V5.4zM17 4h3v1.2h-1.8l2.3 4.8h-3.2l.5 1.2h-2.6v-1.2H17l-2.4-4.8H17V4z"/></svg></span>',
    bank_ach:    '<span class="pas-pm-logo" style="background:#1d4ed8;" title="Bank / ACH"><svg viewBox="0 0 20 14" width="20" height="14" fill="none" stroke="white" stroke-width="1.3" stroke-linecap="round"><path d="M2 13h16M2 7h16M10 2 2 6h16L10 2z"/><rect x="3" y="7" width="2" height="5"/><rect x="9" y="7" width="2" height="5"/><rect x="15" y="7" width="2" height="5"/></svg></span>',
    cash_app:    '<span class="pas-pm-logo" style="background:#00d54b;" title="Cash App"><svg viewBox="0 0 14 14" width="14" height="14" fill="white"><path d="M7.6 2.5v.6c1.1.2 1.8.9 1.8 1.8H8.2c0-.4-.3-.7-.7-.7V6l.4.1c1 .3 1.5.8 1.5 1.7 0 .9-.7 1.5-1.9 1.7V10h-1v-.5C6 9.3 5.3 8.5 5.3 7.5H6.8c0 .4.3.7.7.7V7.2L7 7.1C6 6.9 5.4 6.3 5.4 5.5c0-.9.6-1.5 1.5-1.7V3.2h1.2v-.7h-.5z"/></svg></span>',
    zelle:       '<span class="pas-pm-logo" style="background:#6d1ed4;" title="Zelle"><svg viewBox="0 0 16 14" width="16" height="14" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h10L3 11h10"/></svg></span>',
    paypal:      '<span class="pas-pm-logo" style="background:#009cde;" title="PayPal"><svg viewBox="0 0 28 14" width="28" height="14" fill="white"><path d="M6 11.5H4.5L5.8 3h4c2 0 3 .9 2.6 2.7-.4 2-1.8 2.9-3.8 2.9H7.2L6 11.5zm1.3-4.8H8.5c.9 0 1.4-.4 1.6-1.2.2-.8-.2-1.2-1.1-1.2H7.7L7.3 6.7zm4.2 4.8H9.8L11 3h3.8c1.9 0 2.8.9 2.4 2.7-.4 2-1.7 2.9-3.6 2.9H12L11.2 11.5zm1.3-4.8h1.1c.8 0 1.4-.4 1.5-1.2.2-.8-.2-1.2-1-1.2h-1.1L12.6 6.7z" opacity=".6"/><path d="M8.3 9H7L8.1 2h3.5c1.8 0 2.7.8 2.3 2.4-.4 1.8-1.6 2.6-3.3 2.6H9.2L8.3 9z"/></svg></span>',
    venmo:       '<span class="pas-pm-logo" style="background:#3d95ce;" title="Venmo"><svg viewBox="0 0 20 14" width="20" height="14" fill="white"><path d="M3.5 2.5h2L8 9l4.5-6.5H15L9.5 12H7L3.5 2.5z"/></svg></span>',
    google_pay:  '<span class="pas-pm-logo pas-pm-logo--gpay" title="Google Pay"><svg viewBox="0 0 40 14" width="40" height="14"><text x="1" y="10.5" font-family="Arial,sans-serif" font-size="9.5" font-weight="500"><tspan fill="#4285F4">G</tspan><tspan fill="#EA4335">o</tspan><tspan fill="#FBBC05">o</tspan><tspan fill="#34A853">g</tspan><tspan fill="#EA4335">l</tspan><tspan fill="#4285F4">e</tspan></text><text x="21" y="10.5" font-family="Arial,sans-serif" font-size="9.5" font-weight="700" fill="#5f6368">Pay</text></svg></span>',
    ach_bank:    '<span class="pas-pm-logo" style="background:#1d4ed8;" title="ACH/Bank Transfer"><svg viewBox="0 0 22 14" width="22" height="14" fill="none" stroke="white" stroke-width="1.4" stroke-linecap="round"><line x1="1" y1="5" x2="21" y2="5"/><line x1="1" y1="9" x2="21" y2="9"/><path d="M16 3l5 2.5-5 2.5M6 8.5l-5 2.5 5 2.5"/></svg></span>',
    check:       '<span class="pas-pm-logo" style="background:#6b7280;" title="Check"><svg viewBox="0 0 16 14" width="16" height="14" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14 3 6 11 2 7"/></svg></span>'
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
          iconWrap.innerHTML = PM_ICONS[key] || ('<span class="pas-pm-badge">' + escHtml(String(label).slice(0,3)) + '</span>');
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
      shippingRow.innerHTML = '<svg class="pa-scard-row-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#4b8fff" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg><span class="pa-scard-row-text">' + escHtml(v.shipping_info) + '</span>';
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
      var pmInner = '<svg class="pa-scard-row-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#4caf82" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg><span class="pa-scard-pm-label">Payments</span>';
      var shown = pms.slice(0, 5);
      var extra = pms.length - shown.length;
      shown.forEach(function(pm) {
        var key = pmKey(pm);
        var icon = PM_ICONS[key];
        if (icon) {
          pmInner += icon;
        } else {
          var label = PM_LABELS[key] || PM_LABELS[pm] || pm;
          pmInner += '<span class="pas-pm-logo" style="background:#64748b;" title="' + escHtml(label) + '"><span class="pas-pm-logo-text">' + escHtml(String(label).slice(0,3)) + '</span></span>';
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
          showCouponToast(code, e.clientX, e.clientY);
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




