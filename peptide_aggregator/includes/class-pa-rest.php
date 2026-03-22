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
        register_rest_route('pa/v1', '/debug/tag-overrides', array(
            'methods'             => 'GET',
            'callback'            => array($this, 'debug_tag_overrides'),
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

    public function get_products() {
        $result = $this->api->request('GET', '/api/products');
        if (!$result['ok']) {
            return new WP_Error('pa_api_error', $result['error'], array('status' => $result['status'] ?: 502));
        }
        $products = $result['data'];
        $tag_overrides = (array) get_option('pa_product_tag_overrides', array());
        if (!empty($tag_overrides) && is_array($products)) {
            // Overrides are now keyed by normalised base name (dosage suffix stripped,
            // lowercase) so they apply to every dosage variant automatically.
            $dosage_re = '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i';
            foreach ($products as &$product) {
                $base = strtolower(trim(preg_replace($dosage_re, '', $product['name'] ?? '')));
                if ($base !== '' && array_key_exists($base, $tag_overrides)) {
                    $product['tags'] = $tag_overrides[$base];
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
        return rest_ensure_response($result['data']);
    }
}
