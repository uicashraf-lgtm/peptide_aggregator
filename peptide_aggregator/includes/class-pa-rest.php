<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Rest {
    private $api;

    public function __construct(PA_Api_Client $api) {
        $this->api = $api;
        delete_transient('pa_affiliate_map'); // Clear any stale cached map.
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function register_routes() {
        register_rest_route('pa/v1', '/products', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'get_products'),
            'permission_callback' => '__return_true',
        ));
        register_rest_route('pa/v1', '/debug/tag-overrides', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'debug_tag_overrides'),
            'permission_callback' => '__return_true',
        ));
        register_rest_route('pa/v1', '/products/(?P<id>[^/]+)/prices', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'get_prices'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'id' => array('required' => true, 'sanitize_callback' => 'sanitize_text_field'),
            ),
        ));
    }

    /**
     * Returns a map of lowercase vendor name -> affiliate_template.
     * Cached in a transient for 5 minutes to avoid repeated API calls.
     */
    private function get_affiliate_map() {
        $map = array();
        $result = $this->api->request('GET', '/api/admin/vendors', null, true);
        if (!$result['ok'] || !is_array($result['data'])) {
            return $map;
        }
        foreach ($result['data'] as $vendor) {
            $name = trim($vendor['name'] ?? '');
            $tpl  = trim($vendor['affiliate_template'] ?? '');
            if ($name !== '' && $tpl !== '') {
                $map[strtolower($name)] = $tpl;
            }
        }
        return $map;
    }

    /**
     * Applies an affiliate template to a product link URL.
     *
     * - Path suffix (no ://): appended directly after the product URL.
     *   e.g. link=https://vendor.com/product, tpl=/ref/amino
     *        => https://vendor.com/product/ref/amino
     *
     * - Template with {url}: product URL is URL-encoded into the template.
     *   e.g. tpl=https://aff.net/go?url={url}
     *        => https://aff.net/go?url=https%3A%2F%2F...
     *
     * - Full URL without {url}: returned as-is (redirect-style affiliate link).
     */
    private function apply_affiliate($link, $tpl) {
        if (!$link || !$tpl) return $link;
        if (strpos($tpl, '{url}') !== false) {
            return str_replace('{url}', rawurlencode($link), $tpl);
        }
        if (strpos($tpl, '://') === false) {
            return rtrim($link, '/') . '/' . ltrim($tpl, '/');
        }
        return $tpl;
    }

    public function get_products() {
        $result = $this->api->request('GET', '/api/products');
        if (!$result['ok']) {
            return new WP_Error('pa_api_error', $result['error'], array('status' => $result['status'] ?: 502));
        }
        $products = $result['data'];

        // Apply tag overrides.
        $tag_overrides = (array) get_option('pa_product_tag_overrides', array());
        if (!empty($tag_overrides) && is_array($products)) {
            $dosage_re = '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i';
            foreach ($products as &$product) {
                $pid  = (string) ($product['id'] ?? '');
                $base = strtolower(trim(preg_replace($dosage_re, '', $product['name'] ?? '')));
                if ($pid !== '' && array_key_exists($pid, $tag_overrides)) {
                    $product['tags'] = $tag_overrides[$pid];
                } elseif ($base !== '' && array_key_exists($base, $tag_overrides)) {
                    $product['tags'] = $tag_overrides[$base];
                }
            }
            unset($product);
        }

        // Apply affiliate templates to all vendor links (top_vendors and available_dosages).
        $affiliate_map = $this->get_affiliate_map();
        if (!empty($affiliate_map) && is_array($products)) {
            foreach ($products as &$product) {
                // Top-level vendor list
                if (!empty($product['top_vendors']) && is_array($product['top_vendors'])) {
                    foreach ($product['top_vendors'] as &$vendor) {
                        $key = strtolower(trim($vendor['vendor'] ?? ''));
                        $tpl = $affiliate_map[$key] ?? '';
                        if ($tpl !== '' && !empty($vendor['link'])) {
                            $vendor['link'] = $this->apply_affiliate($vendor['link'], $tpl);
                        }
                    }
                    unset($vendor);
                }
                // Per-dosage vendor lists (used by the card view)
                if (!empty($product['available_dosages']) && is_array($product['available_dosages'])) {
                    foreach ($product['available_dosages'] as &$dosage) {
                        if (!empty($dosage['vendors']) && is_array($dosage['vendors'])) {
                            foreach ($dosage['vendors'] as &$vendor) {
                                $key = strtolower(trim($vendor['vendor'] ?? ''));
                                $tpl = $affiliate_map[$key] ?? '';
                                if ($tpl !== '' && !empty($vendor['link'])) {
                                    $vendor['link'] = $this->apply_affiliate($vendor['link'], $tpl);
                                }
                            }
                            unset($vendor);
                        }
                    }
                    unset($dosage);
                }
            }
            unset($product);
        }

        $response = rest_ensure_response($products);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate');
        $response->header('Pragma', 'no-cache');
        return $response;
    }

    public function debug_tag_overrides() {
        $overrides = (array) get_option('pa_product_tag_overrides', array());
        $result    = $this->api->request('GET', '/api/products');
        $dosage_re = '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i';
        $products_info = array();
        if ($result['ok'] && is_array($result['data'])) {
            foreach ($result['data'] as $p) {
                $raw  = $p['name'] ?? '';
                $base = strtolower(trim(preg_replace($dosage_re, '', $raw)));
                $products_info[] = array(
                    'id'        => $p['id'] ?? null,
                    'name'      => $raw,
                    'base_name' => $base,
                    'tags'      => $p['tags'] ?? array(),
                    'override'  => array_key_exists($base, $overrides) ? $overrides[$base] : null,
                );
            }
        }
        return rest_ensure_response(array(
            'stored_overrides' => $overrides,
            'products'         => $products_info,
        ));
    }

    public function get_prices(WP_REST_Request $req) {
        $id = $req->get_param('id');
        $result = $this->api->request('GET', '/api/products/' . rawurlencode($id) . '/prices');
        if (!$result['ok']) {
            return new WP_Error('pa_api_error', $result['error'], array('status' => $result['status'] ?: 502));
        }
        $prices = $result['data'];

        // Apply affiliate templates to each price entry's link.
        $affiliate_map = $this->get_affiliate_map();
        if (!empty($affiliate_map) && is_array($prices)) {
            foreach ($prices as &$price) {
                $key = strtolower(trim($price['vendor'] ?? ''));
                $tpl = $affiliate_map[$key] ?? '';
                if ($tpl !== '' && !empty($price['link'])) {
                    $price['link'] = $this->apply_affiliate($price['link'], $tpl);
                }
            }
            unset($price);
        }

        return rest_ensure_response($prices);
    }
}
