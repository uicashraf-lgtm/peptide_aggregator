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
        return rest_ensure_response($result['data']);
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
