<?php
/**
 * Plugin Name: Peptide Aggregator
 * Description: CMS-driven frontend and admin bridge for the AminoPrices FastAPI backend.
 * Version: 17.0.43
 * Author: Peptide Aggregator
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PA_PLUGIN_VERSION', '17.0.43');
define('PA_PLUGIN_FILE', __FILE__);
define('PA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('PA_PLUGIN_URL', plugin_dir_url(__FILE__));

// Bumped when pa_register_rewrites() changes so running sites re-flush on upgrade.
define('PA_REWRITE_VERSION', '2');

function pa_register_rewrites() {
    add_rewrite_tag('%pa_product_slug%', '([^&]+)');
    // Route /prices/{slug}/ to the WordPress "prices" page that hosts the
    // [peptide_prices_dashboard] shortcode, with the slug in a query var so
    // the JS can auto-open the matching product detail view. Without the
    // pagename, WordPress cannot resolve the request to any content and
    // falls back to the homepage.
    add_rewrite_rule('^prices/([^/]+)/?$', 'index.php?pagename=prices&pa_product_slug=$matches[1]', 'top');
}

// Re-flush rewrite rules automatically when the rule definition changes,
// so sites that upgrade the plugin (instead of reactivating) pick up the
// new routing without manual intervention.
function pa_maybe_flush_rewrites() {
    if (get_option('pa_rewrite_version') !== PA_REWRITE_VERSION) {
        pa_register_rewrites();
        flush_rewrite_rules();
        update_option('pa_rewrite_version', PA_REWRITE_VERSION);
    }
}

// Fallback for sites where the rewrite rule has been matched but the
// pagename query var wasn't resolved (e.g. stale cached rules): force the
// request onto the "prices" page so the dashboard shortcode renders.
function pa_request_filter($query_vars) {
    if (!empty($query_vars['pa_product_slug'])
        && empty($query_vars['pagename'])
        && empty($query_vars['page_id'])
        && empty($query_vars['name'])) {
        $query_vars['pagename'] = 'prices';
    }
    return $query_vars;
}

register_activation_hook(__FILE__, function () {
    pa_register_rewrites();
    flush_rewrite_rules();
    update_option('pa_rewrite_version', PA_REWRITE_VERSION);
});

register_deactivation_hook(__FILE__, function () {
    PA_Cache_Warmer::unschedule();
    flush_rewrite_rules();
    delete_option('pa_rewrite_version');
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
        add_action('init', 'pa_maybe_flush_rewrites', 20);
        add_filter('request', 'pa_request_filter');
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
