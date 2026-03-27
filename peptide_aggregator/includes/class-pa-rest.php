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
        register_rest_route('pa/v1', '/debug/kits', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'debug_kits'),
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
        delete_transient('pa_products_cache');
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
        $cached = get_transient('pa_products_cache');
        if ($cached !== false) {
            $products = $cached;
        } else {
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
                        // Only inherit the base-name override for dosage variants
                        // (e.g. "BPC-157 10mg"). Products whose name has no dosage
                        // suffix are separate products (e.g. non-kit "Retatrutide"
                        // alongside kit "Retatrutide") and must not inherit the tag.
                        if (preg_match($dosage_re, $product['name'] ?? '')) {
                            $product['tags'] = $tag_overrides[$base];
                        }
                    }
                }
                unset($product);
            }

            // Auto-tag products as 'kit' when the API signals kit availability.
            // Checks (in order of reliability for the /products endpoint):
            //   1. available_dosages label contains 'kit' (e.g. "Kit", "5mg Kit")
            //   2. top_vendors product_name contains 'kit' (present when the field is populated)
            //   3. available_dosages vendor product_name contains 'kit'
            // Admin tag overrides applied above always take precedence.
            if (is_array($products)) {
                foreach ($products as &$product) {
                    $existing_tags = array_map('strtolower', (array) ($product['tags'] ?? []));
                    if (in_array('kit', $existing_tags, true) || in_array('kit_auto', $existing_tags, true)) {
                        continue; // already tagged — do not overwrite
                    }
                    $has_kit = false;
                    // Check available_dosages labels first — most reliable field in /products response.
                    foreach ((array) ($product['available_dosages'] ?? []) as $d) {
                        $lbl = strtolower(is_array($d) ? ($d['label'] ?? '') : (string) $d);
                        if ($lbl !== '' && strpos($lbl, 'kit') !== false) { $has_kit = true; break; }
                    }
                    // Fall back to vendor product_name fields.
                    if (!$has_kit) {
                        foreach ((array) ($product['top_vendors'] ?? []) as $v) {
                            $pn = strtolower($v['product_name'] ?? $v['product'] ?? '');
                            if ($pn !== '' && strpos($pn, 'kit') !== false) { $has_kit = true; break; }
                        }
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
                        $product['tags'][] = 'kit_auto';
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

            set_transient('pa_products_cache', $products, 60);
        } // end cache miss block

        // Mark admin-designated kit products and their specific vendor entries fresh
        // on every request (never cached) so admin changes apply immediately.
        //
        // pa_kit_vendor_map  = { lowercase_product_name => original_name_prefix }
        // pa_kit_exclude_map = { lowercase_product_name => [ sibling original_names ] }
        //
        // A vendor entry is kit only when its product_name starts with the kit prefix
        // AND the text before the first dosage unit (e.g. "5mg") matches the prefix
        // exactly. This distinguishes "EZP-1P 5mg" (kit) from "EZP-1P (GLP-1SG) 5mg"
        // (non-kit variant with extra text before the dosage) regardless of naming
        // conventions. The exclusion map adds an extra layer for edge cases.
        $kit_vendor_map  = (array) get_option('pa_kit_vendor_map', array());
        $kit_exclude_map = (array) get_option('pa_kit_exclude_map', array());
        $kit_ids         = array_map('intval', (array) get_option('pa_kit_product_ids', array()));
        if (!empty($kit_vendor_map) && is_array($products)) {
            foreach ($products as &$product) {
                $pname_lc = strtolower(trim($product['name'] ?? ''));
                if (!isset($kit_vendor_map[$pname_lc]) || $kit_vendor_map[$pname_lc] === '') continue;
                $prefix     = $kit_vendor_map[$pname_lc];
                $exclusions = (array) ($kit_exclude_map[$pname_lc] ?? array());
                $product['_is_kit_product'] = true;
                // Only mark individual vendor entries as kit for the designated kit product.
                // Non-kit siblings with the same name must not have their vendor entries
                // flagged — otherwise both EZP kit and non-kit entries get _is_kit:true,
                // and the cheaper non-kit price is shown first in the kit filter.
                if (!in_array((int) ($product['id'] ?? 0), $kit_ids, true)) continue;
                // Returns true when a vendor product_name is the kit entry.
                // Two complementary checks:
                //   1. Explicit exclusion: does NOT start with any sibling original_name.
                //   2. Dosage-boundary check: the text before the first dosage unit (e.g.
                //      "5mg", "10mcg") must match the kit prefix exactly when trimmed. This
                //      auto-detects non-kit variants without needing re-toggling.
                $dosage_re = '/\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?/i';
                $is_kit_vendor = function($pn) use ($prefix, $exclusions, $dosage_re) {
                    if (strpos($pn, $prefix) !== 0) return false;
                    foreach ($exclusions as $excl) {
                        if ($excl !== '' && strpos($pn, $excl) === 0) return false;
                    }
                    // Extract variant prefix: everything before the first dosage number.
                    if (preg_match($dosage_re, $pn, $dm, PREG_OFFSET_CAPTURE)) {
                        $variant_prefix = rtrim(substr($pn, 0, (int) $dm[0][1]));
                    } else {
                        $variant_prefix = $pn; // no dosage found — use full name
                    }
                    return $variant_prefix === rtrim($prefix);
                };
                // Mark matching vendor entries in top_vendors.
                if (!empty($product['top_vendors']) && is_array($product['top_vendors'])) {
                    foreach ($product['top_vendors'] as &$vendor) {
                        if ($is_kit_vendor($vendor['product_name'] ?? '')) {
                            $vendor['_is_kit'] = true;
                        }
                    }
                    unset($vendor);
                }
                // Mark matching vendor entries in available_dosages.
                if (!empty($product['available_dosages']) && is_array($product['available_dosages'])) {
                    foreach ($product['available_dosages'] as &$dosage) {
                        if (!empty($dosage['vendors']) && is_array($dosage['vendors'])) {
                            foreach ($dosage['vendors'] as &$vendor) {
                                if ($is_kit_vendor($vendor['product_name'] ?? '')) {
                                    $vendor['_is_kit'] = true;
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

    public function debug_kits() {
        $kit_ids = array_map('intval', (array) get_option('pa_kit_product_ids', array()));

        // Fetch admin products to inspect the kit listings.
        $admin_result = $this->api->request('GET', '/api/admin/products', null, true);
        $admin_kits   = array();
        $kit_names    = array();
        if ($admin_result['ok'] && is_array($admin_result['data'])) {
            foreach ($admin_result['data'] as $p) {
                $pid = (int) ($p['id'] ?? 0);
                if (in_array($pid, $kit_ids, true)) {
                    $admin_kits[] = array(
                        'id'            => $pid,
                        'name'          => $p['name'] ?? '',
                        'original_name' => $p['original_name'] ?? '',
                        'dosages'       => $p['dosages'] ?? array(),
                        'vendor_ids'    => $p['vendor_ids'] ?? array(),
                        'category'      => $p['category'] ?? '',
                    );
                    $n = strtolower(trim($p['name'] ?? ''));
                    if ($n !== '') $kit_names[] = $n;
                }
            }
        }

        // Fetch public products, apply injection, and show which vendors are marked _is_kit.
        $kit_vendor_map  = (array) get_option('pa_kit_vendor_map', array());
        $kit_exclude_map = (array) get_option('pa_kit_exclude_map', array());
        $dosage_re_inj   = '/\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?/i';
        $pub_result      = $this->api->request('GET', '/api/products');
        $kit_products    = array();
        if ($pub_result['ok'] && is_array($pub_result['data'])) {
            foreach ($pub_result['data'] as $p) {
                $pname = strtolower(trim($p['name'] ?? ''));
                if (!in_array($pname, $kit_names, true)) continue;
                $prefix     = $kit_vendor_map[$pname] ?? '';
                $exclusions = (array) ($kit_exclude_map[$pname] ?? array());
                $summarise_vendors = function($vendors) use ($prefix, $exclusions, $dosage_re_inj) {
                    $out = array();
                    foreach ((array) $vendors as $v) {
                        $pn = $v['product_name'] ?? '';
                        $would_be_kit = false;
                        if ($prefix !== '' && strpos($pn, $prefix) === 0) {
                            $excluded = false;
                            foreach ($exclusions as $excl) {
                                if ($excl !== '' && strpos($pn, $excl) === 0) { $excluded = true; break; }
                            }
                            if (!$excluded) {
                                if (preg_match($dosage_re_inj, $pn, $dm, PREG_OFFSET_CAPTURE)) {
                                    $vp = rtrim(substr($pn, 0, (int) $dm[0][1]));
                                } else {
                                    $vp = $pn;
                                }
                                $would_be_kit = ($vp === rtrim($prefix));
                            }
                        }
                        $out[] = array(
                            'vendor'       => $v['vendor'] ?? '',
                            'product_name' => $pn,
                            'price'        => $v['price'] ?? null,
                            'would_be_kit' => $would_be_kit,
                        );
                    }
                    return $out;
                };
                $dosages_summary = array();
                foreach ((array) ($p['available_dosages'] ?? array()) as $d) {
                    $dosages_summary[] = array(
                        'label'   => $d['label'] ?? '',
                        'vendors' => $summarise_vendors($d['vendors'] ?? array()),
                    );
                }
                $kit_products[] = array(
                    'id'               => $p['id'] ?? '',
                    'name'             => $p['name'] ?? '',
                    'kit_prefix'       => $prefix,
                    'exclusions'       => $exclusions,
                    'top_vendors'      => $summarise_vendors($p['top_vendors'] ?? array()),
                    'available_dosages' => $dosages_summary,
                );
            }
        }

        return rest_ensure_response(array(
            'pa_kit_product_ids'  => $kit_ids,
            'pa_kit_vendor_map'   => $kit_vendor_map,
            'pa_kit_exclude_map'  => $kit_exclude_map,
            'admin_kit_products'  => $admin_kits,
            'public_kit_products' => $kit_products,
        ));
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
