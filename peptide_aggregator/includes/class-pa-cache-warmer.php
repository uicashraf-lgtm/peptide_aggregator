<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Cache_Warmer {

    const CRON_HOOK     = 'pa_warm_prices_cache';
    const CRON_INTERVAL = 'pa_every_2_minutes';
    const BATCH_SIZE    = 10;  // products fetched per cron run to avoid timeout
    const PRICES_TTL    = 10 * MINUTE_IN_SECONDS;
    const LOG_OPTION    = 'pa_cache_warmer_log';

    private $api;

    public function __construct(PA_Api_Client $api) {
        $this->api = $api;

        // Register custom cron interval (2 minutes)
        add_filter('cron_schedules', array($this, 'add_cron_interval'));

        // Register the cron action
        add_action(self::CRON_HOOK, array($this, 'run'));

        // Schedule on init if not already scheduled
        add_action('init', array($this, 'maybe_schedule'));
    }

    // ── Cron scheduling ───────────────────────────────────────────────────────

    public function add_cron_interval($schedules) {
        $schedules[self::CRON_INTERVAL] = array(
            'interval' => 2 * MINUTE_IN_SECONDS,
            'display'  => 'Every 2 minutes',
        );
        return $schedules;
    }

    public function maybe_schedule() {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), self::CRON_INTERVAL, self::CRON_HOOK);
        }
    }

    public static function unschedule() {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);
        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    // ── Main runner ───────────────────────────────────────────────────────────

    /**
     * Called by WP-Cron every 2 minutes.
     * Fetches one batch of products and warms their /prices cache.
     * Uses a pointer stored in options to cycle through all products
     * across multiple cron runs, so no single run times out.
     */
    public function run() {
        $products = $this->get_all_product_ids();
        if (empty($products)) {
            $this->log('No products found — skipping.');
            return;
        }

        $total   = count($products);
        $pointer = (int) get_option('pa_cache_warmer_pointer', 0);

        // Wrap around if we've finished a full cycle
        if ($pointer >= $total) {
            $pointer = 0;
        }

        $batch    = array_slice($products, $pointer, self::BATCH_SIZE);
        $warmed   = 0;
        $skipped  = 0;
        $errors   = 0;

        foreach ($batch as $product) {
            $id        = $product['id'];
            $cache_key = 'pa_prices_' . md5($id);

            // Skip if still fresh — don't hammer the upstream API unnecessarily
            if (get_transient($cache_key) !== false) {
                $skipped++;
                continue;
            }

            $result = $this->api->request('GET', '/api/products/' . rawurlencode($id) . '/prices');

            if (!$result['ok'] || !is_array($result['data'])) {
                $errors++;
                continue;
            }

            $prices = $result['data'];

            // Apply affiliate templates, mirroring what PA_Rest::get_prices() does
            $affiliate_map = $this->get_affiliate_map();
            if (!empty($affiliate_map)) {
                foreach ($prices as &$price) {
                    $key = strtolower(trim($price['vendor'] ?? ''));
                    $tpl = $affiliate_map[$key] ?? '';
                    if ($tpl !== '' && !empty($price['link'])) {
                        $price['link'] = $this->apply_affiliate($price['link'], $tpl);
                    }
                }
                unset($price);
            }

            set_transient($cache_key, $prices, self::PRICES_TTL);
            $warmed++;
        }

        // Advance pointer for next run
        update_option('pa_cache_warmer_pointer', $pointer + self::BATCH_SIZE, false);

        $this->log(sprintf(
            'Batch %d–%d of %d: warmed=%d, skipped=%d (still fresh), errors=%d',
            $pointer + 1,
            min($pointer + self::BATCH_SIZE, $total),
            $total,
            $warmed,
            $skipped,
            $errors
        ));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Get all product IDs from the /products cache (or fetch if needed).
     * Reuses the same transient PA_Rest uses, so no extra API call if already warm.
     */
    private function get_all_product_ids() {
        $products = get_transient('pa_products_cache');

        if ($products === false) {
            $result = $this->api->request('GET', '/api/products');
            if (!$result['ok'] || !is_array($result['data'])) {
                return array();
            }
            $products = $result['data'];
            set_transient('pa_products_cache', $products, 30 * MINUTE_IN_SECONDS);
        }

        // Queue any brand-new product IDs for admin review. Running this from
        // the cron ensures newly crawled products get flagged even between
        // frontend requests.
        if (is_array($products) && class_exists('PA_Admin')) {
            PA_Admin::detect_new_products($products);
        }

        // Extract unique IDs (products list may have multiple entries per base product)
        $seen = array();
        $ids  = array();
        foreach ($products as $p) {
            $id = (string) ($p['id'] ?? '');
            if ($id !== '' && !isset($seen[$id])) {
                $seen[$id] = true;
                $ids[]     = array('id' => $id, 'name' => $p['name'] ?? $id);
            }
        }
        return $ids;
    }

    private function get_affiliate_map() {
        $cached = get_transient('pa_affiliate_map');
        if ($cached !== false) {
            return $cached;
        }
        $raw = (array) get_option('pa_affiliate_templates', array());
        $map = array();
        foreach ($raw as $vendor => $tpl) {
            $map[strtolower(trim($vendor))] = $tpl;
        }
        set_transient('pa_affiliate_map', $map, HOUR_IN_SECONDS);
        return $map;
    }

    /**
     * Mirrors PA_Rest::apply_affiliate so links written into the warmed
     * cache use the same format as links produced by the on-demand REST
     * endpoint. The previous str_replace-only implementation silently
     * dropped the vendor URL whenever the template lacked a {url} token,
     * leaving relative paths like "/ref/amino" in the cache that the
     * browser then resolved against the current site origin.
     */
    private function apply_affiliate($link, $tpl) {
        if (!$link || !$tpl) return $link;
        // Redirect template: replace {url} placeholder with the encoded product URL.
        if (strpos($tpl, '{url}') !== false) {
            return str_replace('{url}', rawurlencode($link), $tpl);
        }
        // Full URL entered (e.g. https://aminoprices.com/ref/amino):
        // Extract just the path/query suffix and append it to the product URL.
        if (strpos($tpl, '://') !== false) {
            $parsed = parse_url($tpl);
            $suffix = ($parsed['path'] ?? '');
            if (isset($parsed['query']))    $suffix .= '?' . $parsed['query'];
            if (isset($parsed['fragment'])) $suffix .= '#' . $parsed['fragment'];
            if ($suffix === '' || $suffix === '/') return $link;
            $tpl = $suffix;
        }
        // Path or query suffix: append to the product URL.
        if (substr($tpl, 0, 1) === '?') {
            return rtrim($link, '/') . $tpl;
        }
        return rtrim($link, '/') . '/' . ltrim($tpl, '/');
    }

    private function log($message) {
        $log   = (array) get_option(self::LOG_OPTION, array());
        $log[] = array(
            'time'    => current_time('mysql'),
            'message' => $message,
        );
        // Keep last 50 entries only
        if (count($log) > 50) {
            $log = array_slice($log, -50);
        }
        update_option(self::LOG_OPTION, $log, false);
    }

    // ── Admin status (for debug) ───────────────────────────────────────────────

    public static function get_log() {
        return (array) get_option(self::LOG_OPTION, array());
    }

    public static function get_status() {
        $next = wp_next_scheduled(self::CRON_HOOK);
        return array(
            'scheduled'  => (bool) $next,
            'next_run'   => $next ? human_time_diff($next) . ' from now' : 'not scheduled',
            'pointer'    => (int) get_option('pa_cache_warmer_pointer', 0),
            'last_log'   => array_slice((array) get_option(self::LOG_OPTION, array()), -5),
        );
    }
}
