# Peptide Aggregator WordPress Plugin

This plugin provides:
- CMS-managed frontend dashboard UI (prices grid + product detail)
- WordPress admin tools for vendors, monitoring, and manual prices
- FastAPI bridge for catalog/prices and live SSE updates
- Pretty product route: `/prices/{product-slug}`

## Install

1. Copy folder `peptide_aggregator/` into your WordPress site under:
   `wp-content/plugins/peptide_aggregator`
2. Activate **Peptide Aggregator** plugin from WordPress admin.
3. Go to **Peptide Aggregator -> Settings** and set:
   - FastAPI Base URL (example: `https://api.yourdomain.com`)
   - API Bearer Token (if your API requires auth)

## Shortcodes

- Main dashboard page:
  `[peptide_prices_dashboard]`

- Product detail embed:
  `[peptide_product_detail product_id="1"]`

## Public routes

- Product detail permalink:
  `/prices/{slug}`

Example: `/prices/bpc-157/`

## Admin pages

- **Settings**: FastAPI base URL/token
- **Vendors**:
  - Add vendor
  - Add target URLs
  - Set scrape selectors/patterns
  - Configure pagination limits
  - View current vendor list table
- **Manual Prices**:
  - Set manual price override by listing ID
- **Monitoring**:
  - Crawl status table
  - Alerts table

## Backend endpoints expected

- `GET /api/admin/vendors`
- `POST /api/admin/vendors`
- `PATCH /api/admin/vendors/{vendor_id}/scrape-config`
- `POST /api/admin/listings/{listing_id}/manual-price`
- `GET /api/dashboard/crawl-status`
- `GET /api/dashboard/alerts`
- `GET /api/products/search?q=...`
- `GET /api/products/{product_id}/prices`
- `GET /api/stream/prices`

## Notes

- If SSE is cross-domain, configure CORS on FastAPI for your WP domain.
- Affiliate links are rendered from `link` returned by backend prices endpoint.
- After plugin activation, resave permalinks once if your host caches rewrite rules.
