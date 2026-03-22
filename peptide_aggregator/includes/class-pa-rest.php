<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Rest {
    private $api;

    public function __construct(PA_Api_Client $api) {
        $this->api = $api;
        add_action('rest_api_init', array($this, 'register_routes'));
    }

    public function register_routes() {
        register_rest_route('pa/v1', '/products', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'get_products'),
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

    public function get_products() {
        $result = $this->api->request('GET', '/api/products');
        if (!$result['ok']) {
            return new WP_Error('pa_api_error', $result['error'], array('status' => $result['status'] ?: 502));
        }
        $products = $result['data'];
        $tag_overrides = (array) get_option('pa_product_tag_overrides', array());
        if (!empty($tag_overrides) && is_array($products)) {
            // The public endpoint returns one entry per dosage variant (e.g. "BPC-157 5mg",
            // "BPC-157 10mg") while the admin overrides only the specific ID the admin
            // edited. Build a base-name → tags map so every dosage variant of a product
            // inherits the same override; otherwise groupByDosage() merges the
            // non-overridden variants and the removed tag reappears.
            $dosage_re = '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i';
            $name_overrides = array();
            foreach ($products as $product) {
                $pid = (string) ($product['id'] ?? '');
                if ($pid !== '' && array_key_exists($pid, $tag_overrides)) {
                    $base = strtolower(trim(preg_replace($dosage_re, '', $product['name'] ?? '')));
                    if ($base !== '') {
                        $name_overrides[$base] = $tag_overrides[$pid];
                    }
                }
            }
            foreach ($products as &$product) {
                $pid = (string) ($product['id'] ?? '');
                if ($pid !== '' && array_key_exists($pid, $tag_overrides)) {
                    $product['tags'] = $tag_overrides[$pid];
                    continue;
                }
                $base = strtolower(trim(preg_replace($dosage_re, '', $product['name'] ?? '')));
                if ($base !== '' && array_key_exists($base, $name_overrides)) {
                    $product['tags'] = $name_overrides[$base];
                }
            }
            unset($product);
        }
        $response = rest_ensure_response($products);
        $response->header('Cache-Control', 'no-store, no-cache, must-revalidate');
        $response->header('Pragma', 'no-cache');
        return $response;
    }

    public function get_prices(WP_REST_Request $req) {
        $id = $req->get_param('id');
        $result = $this->api->request('GET', '/api/products/' . rawurlencode($id) . '/prices');
        if (!$result['ok']) {
            return new WP_Error('pa_api_error', $result['error'], array('status' => $result['status'] ?: 502));
        }
        return rest_ensure_response($result['data']);
    }
}
