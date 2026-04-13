<?php
/**
 * Plugin Name: Peptide Aggregator
 * Description: CMS-driven frontend and admin bridge for the AminoPrices FastAPI backend.
 * Version: 17.0.65
 * Author: Peptide Aggregator
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PA_PLUGIN_VERSION', '17.0.65');
define('PA_PLUGIN_FILE', __FILE__);
define('PA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PA_PLUGIN_URL', plugin_dir_url(__FILE__));

register_deactivation_hook(__FILE__, function () {
    PA_Cache_Warmer::unschedule();
    // Clean up the stale /prices/{slug} rewrite rule from older versions.
    flush_rewrite_rules();
});

register_activation_hook(__FILE__, function () {
    // Ensure no stale /prices/{slug} rule lingers from older versions.
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
    }

    public function bootstrap() {
        $api_client = new PA_Api_Client();
        new PA_Admin($api_client);
        new PA_Shortcodes($api_client);
        new PA_Rest($api_client);
        new PA_Cache_Warmer($api_client);

        // One-time bust of any pa_prices_* transients written by an older
        // build that had a broken cache-warmer apply_affiliate (it dropped
        // the vendor URL when the affiliate template was a path suffix,
        // leaving relative paths in the cache that pointed at the site
        // origin instead of the vendor's product page).
        if (get_option('pa_prices_cache_busted_v') !== PA_PLUGIN_VERSION) {
            global $wpdb;
            $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_pa_prices_%' OR option_name LIKE '_transient_timeout_pa_prices_%'");
            update_option('pa_prices_cache_busted_v', PA_PLUGIN_VERSION, false);
        }
    }
}

new Peptide_Aggregator_Plugin();
