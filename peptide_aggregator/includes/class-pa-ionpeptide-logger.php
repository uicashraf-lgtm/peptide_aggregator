<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Ionpeptide_Logger {
    const FILE_NAME = 'ionpeptide-crawl.log';
    const MAX_SIZE_BYTES = 1048576;

    public function log_products_snapshot($stage, $products, array $context = array()) {
        $matches = array();
        $retatrutide_matches = array();

        foreach ((array) $products as $product) {
            $name = (string) ($product['name'] ?? '');

            $top_vendor_rows = array();
            foreach ((array) ($product['top_vendors'] ?? array()) as $vendor) {
                if ($this->is_ionpeptide_vendor($vendor['vendor'] ?? '')) {
                    $top_vendor_rows[] = $this->summarize_vendor_row($vendor);
                }
            }

            $all_dosage_labels = array();
            $ionpeptide_dosage_labels = array();
            $ionpeptide_dosage_rows = array();

            foreach ((array) ($product['available_dosages'] ?? array()) as $dosage) {
                $label = is_array($dosage) ? (string) ($dosage['label'] ?? '') : (string) $dosage;
                if ($label !== '') {
                    $all_dosage_labels[] = $label;
                }

                if (!is_array($dosage) || empty($dosage['vendors']) || !is_array($dosage['vendors'])) {
                    continue;
                }

                foreach ($dosage['vendors'] as $vendor) {
                    if (!$this->is_ionpeptide_vendor($vendor['vendor'] ?? '')) {
                        continue;
                    }
                    if ($label !== '') {
                        $ionpeptide_dosage_labels[] = $label;
                    }
                    $ionpeptide_dosage_rows[] = array(
                        'label'  => $label,
                        'vendor' => $this->summarize_vendor_row($vendor),
                    );
                }
            }

            $is_match = $this->is_retatrutide_product($name)
                || !empty($top_vendor_rows)
                || !empty($ionpeptide_dosage_rows);

            if (!$is_match) {
                continue;
            }

            $match = array(
                'id'                        => $product['id'] ?? null,
                'name'                      => $name,
                'available_dosage_labels'   => array_values(array_unique(array_filter($all_dosage_labels))),
                'ionpeptide_dosage_labels'  => array_values(array_unique(array_filter($ionpeptide_dosage_labels))),
                'ionpeptide_top_vendors'    => $top_vendor_rows,
                'ionpeptide_dosage_vendors' => $ionpeptide_dosage_rows,
            );

            $matches[] = $match;

            if ($this->is_retatrutide_product($name)) {
                $retatrutide_matches[] = $match;
            }
        }

        $default_doses = array_change_key_case((array) get_option('pa_default_doses', array()), CASE_LOWER);

        $this->log('products_snapshot', array_merge($context, array(
            'stage'                    => $stage,
            'default_retatrutide_dose' => $default_doses['retatrutide'] ?? null,
            'match_count'              => count($matches),
            'matches'                  => $matches,
        )));

        $this->log_retatrutide_focus($stage, $retatrutide_matches, $default_doses, $context);
    }

    public function log_prices_snapshot($product_id, $prices, array $context = array()) {
        $ionpeptide_rows = array();

        foreach ((array) $prices as $price) {
            if (!$this->is_ionpeptide_vendor($price['vendor'] ?? '')) {
                continue;
            }
            $ionpeptide_rows[] = $this->summarize_vendor_row($price);
        }

        $this->log('prices_snapshot', array_merge($context, array(
            'product_id'        => $product_id,
            'match_count'       => count($ionpeptide_rows),
            'ionpeptide_prices' => $ionpeptide_rows,
        )));
    }

    private function summarize_vendor_row($vendor) {
        return array(
            'vendor'       => (string) ($vendor['vendor'] ?? ''),
            'product_name' => (string) ($vendor['product_name'] ?? ($vendor['product'] ?? '')),
            'price'        => $vendor['price'] ?? null,
            'currency'     => (string) ($vendor['currency'] ?? ''),
            'in_stock'     => $vendor['in_stock'] ?? null,
            'link'         => (string) ($vendor['link'] ?? ''),
        );
    }

    private function is_ionpeptide_vendor($vendor_name) {
        return strtolower(trim((string) $vendor_name)) === 'ionpeptide';
    }

    private function is_retatrutide_product($product_name) {
        return strpos(strtolower((string) $product_name), 'retatrutide') !== false;
    }

    private function log_retatrutide_focus($stage, array $matches, array $default_doses, array $context = array()) {
        $retatrutide_rows = array();

        foreach ($matches as $match) {
            $retatrutide_rows[] = array(
                'id'                            => $match['id'] ?? null,
                'name'                          => $match['name'] ?? '',
                'available_dosage_count'        => count((array) ($match['available_dosage_labels'] ?? array())),
                'available_dosage_labels'       => array_values((array) ($match['available_dosage_labels'] ?? array())),
                'ionpeptide_top_vendor_count'   => count((array) ($match['ionpeptide_top_vendors'] ?? array())),
                'ionpeptide_top_vendors'        => array_values((array) ($match['ionpeptide_top_vendors'] ?? array())),
                'ionpeptide_dosage_label_count' => count((array) ($match['ionpeptide_dosage_labels'] ?? array())),
                'ionpeptide_dosage_labels'      => array_values((array) ($match['ionpeptide_dosage_labels'] ?? array())),
                'ionpeptide_dosage_row_count'   => count((array) ($match['ionpeptide_dosage_vendors'] ?? array())),
                'ionpeptide_dosage_vendors'     => array_values((array) ($match['ionpeptide_dosage_vendors'] ?? array())),
            );
        }

        $this->log('retatrutide_focus', array_merge($context, array(
            'stage'                    => $stage,
            'default_retatrutide_dose' => $default_doses['retatrutide'] ?? null,
            'retatrutide_match_count'  => count($retatrutide_rows),
            'retatrutide_rows'         => $retatrutide_rows,
        )));
    }

    private function log($event, array $context = array()) {
        $path = $this->path();
        $this->rotate_if_needed($path);

        $payload = array(
            'timestamp' => gmdate('c'),
            'event'     => $event,
            'context'   => $context,
        );

        $line = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($line) || $line === '') {
            $line = wp_json_encode(array(
                'timestamp' => gmdate('c'),
                'event'     => 'logger_encode_failed',
            ));
        }

        file_put_contents($path, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
    }

    private function rotate_if_needed($path) {
        if (!file_exists($path)) {
            return;
        }

        $size = filesize($path);
        if ($size === false || $size < self::MAX_SIZE_BYTES) {
            return;
        }

        $rotated = $path . '.1';
        if (file_exists($rotated)) {
            unlink($rotated);
        }
        rename($path, $rotated);
    }

    private function path() {
        return trailingslashit(PA_PLUGIN_DIR) . self::FILE_NAME;
    }
}