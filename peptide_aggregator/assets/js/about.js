(function () {
  'use strict';

  const UI = window.PA_ABOUT_UI || { api_base: '' };
  const API = (UI.api_base || '').replace(/\/$/, '');
  const API_ROOT = API.endsWith('/api') ? API : (API ? API + '/api' : '');

  function setCount(key, value) {
    const el = document.querySelector('[data-about-count="' + key + '"]');
    if (el) el.textContent = value;
  }

  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function loadStats() {
    if (!API_ROOT) return;

    const stats = await fetchJson(API_ROOT + '/stats');
    if (stats) {
      if (typeof stats.product_count === 'number') {
        setCount('products', stats.product_count.toLocaleString());
      }
      if (typeof stats.vendor_count === 'number') {
        setCount('suppliers', stats.vendor_count.toLocaleString());
      }
      if (typeof stats.product_count === 'number' && typeof stats.vendor_count === 'number') {
        return;
      }
    }

    const vendors = await fetchJson(API_ROOT + '/vendors');
    if (Array.isArray(vendors)) {
      setCount('suppliers', vendors.length.toLocaleString());
    }

    const products = await fetchJson(API_ROOT + '/products');
    if (Array.isArray(products)) {
      setCount('products', products.length.toLocaleString());
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!document.querySelector('.pa-about-shell')) return;
    loadStats();

    document.querySelectorAll('[data-copy-email]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var email = btn.getAttribute('data-copy-email') || '';
        if (!email || !navigator.clipboard) return;
        navigator.clipboard.writeText(email).then(function () {
          btn.classList.add('is-copied');
          setTimeout(function () { btn.classList.remove('is-copied'); }, 1200);
        });
      });
    });
  });
})();

