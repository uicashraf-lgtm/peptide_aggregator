<?php
/**
 * Plugin Name: Peptide Aggregator
 * Description: CMS-driven frontend and admin bridge for the AminoPrices FastAPI backend.
 * Version: 17.0.18
 * Author: Peptide Aggregator
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PA_PLUGIN_VERSION', '17.0.18');
define('PA_PLUGIN_FILE', __FILE__);
define('PA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PA_PLUGIN_URL', plugin_dir_url(__FILE__));

function pa_register_rewrites() {
    add_rewrite_tag('%pa_product_slug%', '([^&]+)');
    add_rewrite_rule('^prices/([^/]+)/?$', 'index.php?pa_product_slug=$matches[1]', 'top');
}

register_activation_hook(__FILE__, function () {
    pa_register_rewrites();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function () {
    PA_Cache_Warmer::unschedule();
    flush_rewrite_rules();
});

require_once PA_PLUGIN_DIR . 'includes/class-pa-api-client.php';
require_once PA_PLUGIN_DIR . 'includes/class-pa-admin.php';
require_once PA_PLUGIN_DIR . 'includes/class-pa-ionpeptide-logger.php';
require_once PA_PLUGIN_DIR . 'includes/class-pa-shortcodes.php';
require_once PA_PLUGIN_DIR . 'includes/class-pa-rest.php';
require_once PA_PLUGIN_DIR . 'includes/class-pa-cache-warmer.php';

final class Peptide_Aggregator_Plugin {
    public function __construct() {
        add_action('plugins_loaded', array($this, 'bootstrap'));
        add_action('init', 'pa_register_rewrites');
    }

    public function bootstrap() {
        $api_client = new PA_Api_Client();
        new PA_Admin($api_client);
        new PA_Shortcodes($api_client);
        new PA_Rest($api_client);
        new PA_Cache_Warmer($api_client);
    }
}

new Peptide_Aggregator_Plugin();
