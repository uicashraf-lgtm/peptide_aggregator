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
        register_rest_route('pa/v1', '/debug/affiliate', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'debug_affiliate'),
            'permission_callback' => '__return_true',
        ));
        register_rest_route('pa/v1', '/affiliate-templates', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'get_affiliate_templates_endpoint'),
            'permission_callback' => function() { return current_user_can('manage_options'); },
        ));
        register_rest_route('pa/v1', '/affiliate-templates', array(
            'methods'             => 'POST',
            'callback'            => array($this, 'save_affiliate_template_endpoint'),
            'permission_callback' => function() { return current_user_can('manage_options'); },
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

    public function get_affiliate_templates_endpoint() {
        return rest_ensure_response((object) get_option('pa_affiliate_templates', array()));
    }

    public function save_affiliate_template_endpoint(WP_REST_Request $req) {
        $vendor = strtolower(trim((string) $req->get_param('vendor')));
        $tpl    = trim((string) $req->get_param('template'));
        if ($vendor === '') {
            return new WP_Error('invalid', 'vendor is required', array('status' => 400));
        }
        $templates = (array) get_option('pa_affiliate_templates', array());
        if ($tpl === '') {
            unset($templates[$vendor]);
        } else {
            $templates[$vendor] = $tpl;
        }
        update_option('pa_affiliate_templates', $templates);
        return rest_ensure_response(array('ok' => true));
    }

    private function get_affiliate_map() {
        return (array) get_option('pa_affiliate_templates', array());
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

        // Auto-tag products as 'kit' when any vendor listing has 'kit' in its product name.
        // Admin tag overrides (applied above) take precedence; this only fills in the gap
        // for products that have no override but whose vendors sell kit formulations.
        if (is_array($products)) {
            foreach ($products as &$product) {
                if (in_array('kit', array_map('strtolower', (array) ($product['tags'] ?? [])), true)) {
                    continue; // already tagged
                }
                $has_kit = false;
                foreach ((array) ($product['top_vendors'] ?? []) as $v) {
                    $pn = strtolower($v['product_name'] ?? $v['product'] ?? '');
                    if ($pn !== '' && strpos($pn, 'kit') !== false) { $has_kit = true; break; }
                }
                if (!$has_kit) {
                    foreach ((array) ($product['available_dosages'] ?? []) as $d) {
                        foreach ((array) ($d['vendors'] ?? []) as $v) {
                            $pn = strtolower($v['product_name'] ?? $v['product'] ?? '');
                            if ($pn !== '' && strpos($pn, 'kit') !== false) { $has_kit = true; break 2; }
                        }
                    }
                }
                if ($has_kit) {
                    $product['tags']   = (array) ($product['tags'] ?? []);
                    $product['tags'][] = 'kit';
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

    public function debug_affiliate() {
        $affiliate_map = $this->get_affiliate_map();
        $result = $this->api->request('GET', '/api/products');
        $samples = array();
        if ($result['ok'] && is_array($result['data'])) {
            foreach (array_slice($result['data'], 0, 10) as $p) {
                $product_name = $p['name'] ?? '';
                // Collect vendor links from both sources
                $vendor_links = array();
                if (!empty($p['top_vendors']) && is_array($p['top_vendors'])) {
                    foreach ($p['top_vendors'] as $v) {
                        $key = strtolower(trim($v['vendor'] ?? ''));
                        $tpl = $affiliate_map[$key] ?? '';
                        $original = $v['link'] ?? '';
                        $vendor_links[] = array(
                            'source'    => 'top_vendors',
                            'vendor'    => $v['vendor'] ?? '',
                            'key'       => $key,
                            'tpl'       => $tpl,
                            'original'  => $original,
                            'result'    => ($tpl !== '' && $original !== '') ? $this->apply_affiliate($original, $tpl) : $original,
                        );
                    }
                }
                if (!empty($p['available_dosages']) && is_array($p['available_dosages'])) {
                    foreach (array_slice($p['available_dosages'], 0, 2) as $d) {
                        if (!empty($d['vendors']) && is_array($d['vendors'])) {
                            foreach ($d['vendors'] as $v) {
                                $key = strtolower(trim($v['vendor'] ?? ''));
                                $tpl = $affiliate_map[$key] ?? '';
                                $original = $v['link'] ?? '';
                                $vendor_links[] = array(
                                    'source'    => 'available_dosages',
                                    'vendor'    => $v['vendor'] ?? '',
                                    'key'       => $key,
                                    'tpl'       => $tpl,
                                    'original'  => $original,
                                    'result'    => ($tpl !== '' && $original !== '') ? $this->apply_affiliate($original, $tpl) : $original,
                                );
                            }
                        }
                    }
                }
                if (!empty($vendor_links)) {
                    $samples[] = array('product' => $product_name, 'vendors' => $vendor_links);
                }
            }
        }
        return rest_ensure_response(array(
            'affiliate_map' => $affiliate_map,
            'samples'       => $samples,
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
