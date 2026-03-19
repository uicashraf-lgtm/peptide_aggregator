<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Api_Client {
    const OPT_BASE_URL = 'pa_api_base_url';
    const OPT_API_TOKEN = 'pa_api_token';

    public function base_url() {
        $url = get_option(self::OPT_BASE_URL, 'http://localhost:8002');
        return untrailingslashit(trim($url));
    }

    public function sse_url() {
        return $this->base_url() . '/api/stream/prices';
    }

    public function request($method, $path, $body = null, $auth = false) {
        $url = $this->base_url() . $path;
        $args = array(
            'method'  => strtoupper($method),
            'timeout' => 30,
            'headers' => array(
                'Accept' => 'application/json',
            ),
        );

        if (!is_null($body)) {
            $args['headers']['Content-Type'] = 'application/json';
            $args['body'] = wp_json_encode($body);
        }

        if ($auth) {
            $token = trim((string) get_option(self::OPT_API_TOKEN, ''));
            if ($token !== '') {
                $args['headers']['Authorization'] = 'Bearer ' . $token;
            }
        }

        $resp = wp_remote_request($url, $args);
        if (is_wp_error($resp)) {
            return array(
                'ok' => false,
                'status' => 0,
                'error' => $resp->get_error_message(),
                'data' => null,
            );
        }

        $status = (int) wp_remote_retrieve_response_code($resp);
        $raw = (string) wp_remote_retrieve_body($resp);
        $decoded = json_decode($raw, true);

        if ($status < 200 || $status >= 300) {
            return array(
                'ok' => false,
                'status' => $status,
                'error' => is_array($decoded) ? wp_json_encode($decoded) : $raw,
                'data' => $decoded,
            );
        }

        return array(
            'ok' => true,
            'status' => $status,
            'error' => null,
            'data' => is_null($decoded) ? array() : $decoded,
        );
    }
}
