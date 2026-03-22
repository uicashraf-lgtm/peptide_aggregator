<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Shortcodes {
    private $api;

    public function __construct(PA_Api_Client $api) {
        $this->api = $api;
        add_shortcode('peptide_prices_dashboard',     array($this, 'render_dashboard_shortcode'));
        add_shortcode('peptide_suppliers_dashboard',  array($this, 'render_suppliers_shortcode'));
                        add_shortcode('peptide_about_dashboard',      array($this, 'render_about_shortcode'));
        add_action('wp_enqueue_scripts', array($this, 'register_assets'), 999);
        // wp_head at the latest possible priority so our <style> block appears
        // after every theme / Elementor stylesheet regardless of their load order.
        add_action('wp_head', array($this, 'print_head_layout_css'), 9999);
    }

    /**
     * Output a <style> block in <head> at priority 9999.
     * Being last in document order means it wins all same-specificity !important
     * battles without needing to know what the theme/Elementor is doing.
     */
    public function print_head_layout_css() {
        if ( is_admin() ) return;
        echo '<style id="pa-head-layout">' . $this->critical_layout_css() . '</style>' . "\n";
    }

    /**
     * Return the critical layout CSS that must load AFTER Elementor.
     * Covers flex/grid display values only – colours live in dashboard.css.
     */
    private function critical_layout_css() {
        return '
/* pa: critical layout – injected after Elementor to guarantee source-order win */
.pa-shell,.pa-shell *,.pa-shell *::before,.pa-shell *::after{box-sizing:border-box!important}
.pa-shell{display:block!important;width:100%!important}
/* detail view show/hide — pa-hidden/pa-visible toggled on each element */
/* belt-and-suspenders: height:0+overflow:hidden ensures no space even if display is overridden */
#pa-product-detail{display:none!important;height:0!important;max-height:0!important;overflow:hidden!important}
#pa-product-detail.pa-visible{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important}
#pa-product-grid.pa-hidden{display:none!important}
#pa-results-bar.pa-hidden{display:none!important}
.pa-search-panel.pa-hidden{display:none!important}
.pa-shell .pa-search-row{display:grid!important;grid-template-columns:1fr 56px!important;gap:12px!important;align-items:center!important}
.pa-shell .pa-search-input-wrap{position:relative!important;display:flex!important;align-items:center!important}
.pa-shell .pa-filter-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important}
.pa-shell .pa-popular-row{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:nowrap!important;margin-top:12px!important;overflow:hidden!important}
.pa-shell .pa-chip-list{display:flex!important;flex-wrap:nowrap!important;gap:8px!important;align-items:center!important;overflow-x:auto!important;scrollbar-width:none!important}
.pa-shell .pa-chip{display:inline-flex!important;align-items:center!important;gap:4px!important;white-space:nowrap!important}
.pa-shell .pa-active-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
.pa-shell .pa-active-list{display:flex!important;flex-wrap:wrap!important;gap:6px!important;align-items:center!important}
.pa-shell .pa-results-bar{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;flex-wrap:wrap!important;gap:12px!important;padding:10px 2px!important}
.pa-shell .pa-results-left{display:flex!important;align-items:center!important;gap:8px!important}
.pa-shell .pa-results-right{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important}
.pa-shell .pa-price-toggle{display:flex!important;align-items:center!important;gap:6px!important}
.pa-shell .pa-sort-label{display:flex!important;align-items:center!important;gap:8px!important;white-space:nowrap!important}
.pa-shell .pa-bar-icons{display:flex!important;align-items:center!important;gap:4px!important}
.pa-shell .pa-view-toggle{display:flex!important;align-items:center!important;gap:2px!important}
.pa-shell .pa-ptoggle{display:inline-flex!important;align-items:center!important;justify-content:center!important}
.pa-shell .pa-bar-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:34px!important;height:34px!important}
.pa-shell .pa-view-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:28px!important;height:28px!important;border:none!important}
.pa-shell .pa-product-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))!important;gap:10px!important;margin-top:4px!important}
.pa-shell .pa-product-grid.is-list{grid-template-columns:1fr!important}
.pa-shell .pa-pcard{display:flex!important;flex-direction:column!important;gap:10px!important;padding:14px 14px 10px!important;cursor:pointer!important}
.pa-shell .pa-pcard-head{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:8px!important}
.pa-shell .pa-pcard-head-left{flex:1!important;min-width:0!important}
.pa-shell .pa-pcard-head-icons{display:flex!important;align-items:center!important;gap:4px!important;flex-shrink:0!important}
.pa-shell .pa-pcard-tags{display:flex!important;flex-wrap:wrap!important;gap:6px!important;align-items:center!important}
.pa-shell .pa-pcard-dosage{display:flex!important;align-items:center!important;gap:8px!important}
.pa-shell .pa-dosage-scroll-wrap{display:flex!important;align-items:center!important;gap:4px!important;flex:1!important;min-width:0!important}
.pa-shell .pa-dosage-pills{display:flex!important;gap:6px!important;overflow-x:auto!important;flex:1!important;scrollbar-width:none!important}
.pa-shell .pa-dosage-pill{display:inline-flex!important;align-items:center!important;gap:4px!important;white-space:nowrap!important;flex-shrink:0!important}
.pa-shell .pa-dosage-arrow{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0!important;width:24px!important;height:24px!important}
.pa-shell .pa-pcard-vendors{display:flex!important;flex-direction:column!important;gap:6px!important}
.pa-shell .pa-pcard-vendor-row{display:grid!important;grid-template-columns:36px 1fr minmax(0,auto)!important;gap:10px!important;align-items:center!important;padding:8px 10px!important;border-radius:10px!important}
.pa-shell .pa-pcard-avatar{display:flex!important;align-items:center!important;justify-content:center!important;width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;max-width:36px!important;max-height:36px!important;flex-shrink:0!important;overflow:hidden!important}
.pa-shell .pa-pcard-avatar img{display:block!important;width:100%!important;height:100%!important;max-width:36px!important;max-height:36px!important;object-fit:contain!important}
.pa-shell .pa-pcard-vinfo{display:flex!important;flex-direction:column!important;min-width:0!important}
.pa-shell .pa-pcard-vright{display:flex!important;flex-direction:row!important;align-items:center!important;gap:6px!important;min-width:0!important;overflow:hidden!important;flex-shrink:0!important}
.pa-shell .pa-pcard-price-wrap{display:flex!important;flex-direction:column!important;align-items:flex-end!important;flex-shrink:0!important}
.pa-shell .pa-coupon-badge{display:inline-flex!important;align-items:center!important;gap:3px!important;max-width:100%!important;overflow:hidden!important;min-width:0!important}
.pa-shell .pa-coupon-text{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;min-width:0!important}
.pa-shell .pa-coupon-copy{display:inline-flex!important;align-items:center!important;background:none!important;border:none!important;cursor:pointer!important;padding:0 2px!important}
.pa-shell .pa-pcard-extlink{display:inline-flex!important;align-items:center!important;text-decoration:none!important}
.pa-shell .pa-pcard-foot{display:flex!important;align-items:center!important;justify-content:space-between!important;padding-top:4px!important}
.pa-shell .pa-icon-btn{display:inline-flex!important;align-items:center!important;background:none!important;border:none!important;cursor:pointer!important;padding:4px!important;border-radius:6px!important}
.pa-shell .pa-detail-layout{display:flex!important;gap:20px!important;align-items:flex-start!important}
.pa-shell .pa-detail-sidebar{width:200px!important;flex-shrink:0!important}
.pa-shell .pa-detail-main{flex:1!important;display:flex!important;flex-direction:column!important;gap:16px!important;min-width:0!important}
.pa-shell .pa-detail-head{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:12px!important;margin-bottom:12px!important}
.pa-shell .pa-detail-dosage-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;flex-wrap:wrap!important;margin-bottom:14px!important}
.pa-shell .pa-detail-price-toggle-wrap{display:flex!important;align-items:center!important;gap:6px!important}
.pa-shell .pa-detail-dosage-grid{display:flex!important;flex-wrap:wrap!important;gap:8px!important}
.pa-shell .pa-detail-prices-bar{display:flex!important;align-items:center!important;justify-content:space-between!important;flex-wrap:wrap!important;gap:10px!important;padding:14px 16px!important}
.pa-shell .pa-dpbar-center{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important}
.pa-shell .pa-dpbar-right{display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important}
.pa-shell .pa-dpbar-left{display:flex!important;align-items:center!important;gap:8px!important}
.pa-shell .pa-dpbar-titles{display:flex!important;flex-direction:column!important;gap:1px!important}
.pa-shell .pa-dpbar-stock-btn,.pa-shell .pa-dpbar-sort-btn,.pa-shell .pa-dpbar-supplier-btn{display:inline-flex!important;align-items:center!important;gap:5px!important;cursor:pointer!important}
.pa-shell .pa-detail-vendor-list{display:flex!important;flex-direction:column!important;gap:8px!important;padding:10px!important}
.pa-shell .pa-detail-vrow{display:grid!important;grid-template-columns:40px 1fr auto!important;gap:12px!important;align-items:center!important;padding:14px 10px!important;border-radius:0!important;border-bottom:1px solid var(--line)!important}
.pa-shell .pa-detail-vrow:last-child{border-bottom:none!important}
.pa-shell .pa-detail-vrow-right{display:flex!important;flex-direction:row!important;align-items:center!important;gap:10px!important;flex-shrink:0!important}
.pa-shell .pa-vendor-avatar{display:flex!important;align-items:center!important;justify-content:center!important;width:40px!important;height:40px!important;min-width:40px!important;flex-shrink:0!important;overflow:hidden!important;border-radius:50%!important}
.pa-shell .pa-vendor-avatar img{display:block!important;width:100%!important;height:100%!important;object-fit:contain!important}
.pa-shell .pa-vendor-info{display:flex!important;flex-direction:column!important;gap:2px!important;min-width:0!important}
.pa-shell .pa-detail-price-wrap{display:flex!important;flex-direction:column!important;align-items:flex-end!important}
.pa-shell .pa-detail-link-icon{display:inline-flex!important;align-items:center!important;text-decoration:none!important}
.pa-shell .pa-coupon-wrap{display:flex!important;align-items:center!important;gap:4px!important}
.pa-shell .pa-coupon-copy-btn{display:inline-flex!important;align-items:center!important;background:none!important;border:none!important;cursor:pointer!important;padding:0 2px!important}
.pa-shell .pa-ddosage-btn{display:flex!important;flex-direction:column!important;align-items:center!important;gap:3px!important;cursor:pointer!important}
.pa-shell .pa-ddosage-label{display:flex!important;align-items:center!important;gap:3px!important}
.pa-shell .pa-back-btn{display:inline-flex!important;align-items:center!important;gap:6px!important;cursor:pointer!important;white-space:nowrap!important}
.pa-shell .pa-nav-links{display:flex!important;gap:4px!important;padding:4px!important}
.pa-shell .pa-sort-dir-btns{display:flex!important;align-items:center!important;gap:4px!important}
.pa-shell .pa-sort-dir{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:30px!important;height:30px!important}
.pa-shell .pa-supplier-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))!important;gap:16px!important;margin-top:4px!important}
.pa-shell .pa-supplier-grid.is-list{grid-template-columns:1fr!important}
.pa-shell .pa-scard{display:flex!important;flex-direction:column!important;gap:12px!important;padding:18px!important;cursor:pointer!important}
.pa-shell .pa-scard-info-row{display:flex!important;align-items:flex-start!important;gap:12px!important;padding:12px!important}
.pa-shell.pa-about-shell{display:flex!important;flex-direction:column!important;gap:24px!important}
.pa-about-stats{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:16px!important}
.pa-about-stat{display:flex!important;flex-direction:column!important;align-items:center!important;gap:8px!important}
.pa-about-actions{display:flex!important;justify-content:center!important;gap:12px!important;flex-wrap:wrap!important}
.pa-about-btn{display:inline-flex!important;align-items:center!important}
.pa-about-panels{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:20px!important}
.pa-about-list{display:flex!important;flex-direction:column!important;gap:8px!important}
.pa-about-list-item{display:flex!important;align-items:center!important;gap:10px!important}
.pa-about-grid{display:grid!important;grid-template-columns:repeat(2,1fr)!important;gap:8px!important}
.pa-about-mini{display:flex!important;align-items:center!important;gap:8px!important}
.pa-about-stat-icon,.pa-about-list-icon,.pa-about-mini-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0!important}
.pa-about-contact-pill{display:inline-flex!important;align-items:center!important;gap:8px!important}
.pa-about-copy-btn{display:inline-flex!important;align-items:center!important;background:none!important;border:none!important;cursor:pointer!important}
.pa-modal{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;z-index:999999!important;display:flex!important;align-items:flex-end!important;justify-content:center!important}
.pa-modal[aria-hidden="true"]{display:none!important}
.pa-modal-backdrop{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important}
.pa-modal-card{position:relative!important;width:100%!important;max-width:480px!important;max-height:80vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;z-index:1!important;border-radius:22px 22px 0 0!important;background:#ffffff!important;color:#1a2332!important}
.pa-modal-head{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:16px 20px 12px!important;flex-shrink:0!important;border-bottom:1px solid #e4e9f0!important}
.pa-modal-head-actions{display:flex!important;align-items:center!important;gap:12px!important}
.pa-modal-tabs{display:flex!important;gap:4px!important;padding:4px!important;margin:0 20px 12px!important;flex-shrink:0!important;background:#f7f9fc!important;border-radius:8px!important}
.pa-modal-tab{display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;flex:1!important;padding:8px 14px!important;border:none!important;background:none!important;cursor:pointer!important;color:#6b7a90!important}
.pa-modal-tab.is-active{background:#ffffff!important;color:#1a2332!important;border-radius:6px!important}
.pa-modal-body{overflow-y:auto!important;flex:1!important;padding:0 20px!important;display:block!important}
.pa-tab-content{display:none!important}
.pa-tab-content.is-active{display:block!important}
.pa-modal-foot,.pa-modal-footer{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:14px 20px!important;flex-shrink:0!important;border-top:1px solid #e4e9f0!important;gap:8px!important}
.pa-modal-close{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:32px!important;height:32px!important;cursor:pointer!important;background:none!important;border:none!important}
.pa-toggle-list{display:flex!important;flex-direction:column!important;gap:4px!important}
.pa-toggle-row{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:8px 0!important;cursor:pointer!important}
.pa-toggle-row input[type="checkbox"]{-webkit-appearance:none!important;-moz-appearance:none!important;appearance:none!important;position:absolute!important;opacity:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important}
.pa-toggle-row i{display:inline-block!important;flex-shrink:0!important;width:36px!important;height:20px!important;background:#e4e9f0!important;border-radius:10px!important;position:relative!important;transition:background 0.2s ease!important}
.pa-toggle-row i::after{content:""!important;position:absolute!important;width:16px!important;height:16px!important;background:#fff!important;border-radius:50%!important;top:2px!important;left:2px!important;transition:transform 0.2s ease!important}
.pa-toggle-row input:checked~i{background:#2563eb!important}
.pa-toggle-row input:checked~i::after{transform:translateX(16px)!important}
.pa-section-head{display:flex!important;align-items:center!important;justify-content:space-between!important;margin:16px 0 8px!important}
.pa-section-tools{display:flex!important;align-items:center!important;gap:8px!important}
.pa-check-list{display:flex!important;flex-direction:column!important;gap:4px!important;max-height:180px!important;overflow-y:auto!important;margin-bottom:8px!important}
.pa-check-item{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;padding:8px 12px!important;cursor:pointer!important}
.pa-price-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:6px!important;margin-bottom:8px!important}
.pa-sort-list{display:flex!important;flex-direction:column!important;gap:4px!important}
.pa-sort-item{display:flex!important;align-items:center!important;gap:10px!important;padding:10px 12px!important;cursor:pointer!important}
.pa-search-inline-wrap.is-hidden{display:none!important}
.pa-dot{display:inline-block!important;width:3px!important;height:3px!important;border-radius:50%!important}
.pa-dsm-search-wrap{position:relative!important;display:flex!important;align-items:center!important;padding:0 20px 12px!important}
.pa-dsm-search-icon{position:absolute!important;left:32px!important}
.pa-dsm-status-row{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:0 20px 8px!important}
.pa-dsm-status-actions{display:flex!important;align-items:center!important;gap:8px!important}
.pa-dsm-list{overflow-y:auto!important;max-height:280px!important;padding:0 20px!important}
.pa-inline-check{display:flex!important;align-items:center!important;gap:5px!important;cursor:pointer!important}
@media(max-width:600px){
.pa-shell .pa-detail-layout{flex-direction:column!important;gap:12px!important}
.pa-shell .pa-detail-sidebar{width:100%!important}
.pa-shell .pa-detail-prices-bar{flex-direction:column!important;align-items:flex-start!important}
.pa-shell .pa-detail-dosage-head{flex-direction:column!important;align-items:flex-start!important}
.pa-shell .pa-detail-vrow{grid-template-columns:40px 1fr!important;grid-template-rows:auto auto!important}
.pa-shell .pa-vendor-avatar{grid-row:1/3!important;align-self:start!important;margin-top:2px!important}
.pa-shell .pa-detail-vrow-right{grid-column:2!important;flex-wrap:wrap!important}
}
';
    }

    public function register_assets() {
        // If Elementor is active, make our stylesheet load after it so our
        // layout rules take precedence in document source order.
        $css_deps = array();
        if ( wp_style_is( 'elementor-frontend', 'registered' ) ) {
            $css_deps[] = 'elementor-frontend';
        }

        wp_register_style('pa-dashboard-css',   plugin_dir_url(__FILE__) . '../assets/css/dashboard.css', $css_deps, '0.9.61');
        wp_register_script('pa-dashboard-js',   plugin_dir_url(__FILE__) . '../assets/js/dashboard.js',   array(), '0.9.42', false);
        wp_register_script('pa-suppliers-js',   plugin_dir_url(__FILE__) . '../assets/js/suppliers.js',   array(), '0.9.21', false);
        wp_register_script('pa-about-js',       plugin_dir_url(__FILE__) . '../assets/js/about.js',       array(), '0.9.21', false);
        if (!is_admin()) {
            wp_enqueue_style('pa-dashboard-css');
            // Inline CSS appended to our stylesheet – guaranteed to appear after
            // both Elementor and dashboard.css in document order.
            wp_add_inline_style( 'pa-dashboard-css', $this->critical_layout_css() );
            wp_enqueue_script('pa-dashboard-js');
            wp_enqueue_script('pa-suppliers-js');
            wp_enqueue_script('pa-about-js');

            // Build the full PA_UI object here so it is available before dashboard.js
            // runs regardless of whether scripts are loaded in <head> or footer.
            // Normalize dose_labels keys to lowercase so they always match the
            // lowercase lookup in getDoseLabel(), even if older data was saved
            // under original-case product names.
            $dose_labels_raw = get_option('pa_dose_labels', array());
            $dose_labels = array();
            foreach ( (array) $dose_labels_raw as $k => $v ) {
                $dose_labels[ strtolower( trim( $k ) ) ] = $v;
            }
            wp_add_inline_script('pa-dashboard-js',
                'window.PA_UI = {' .
                    'api_base:'     . json_encode($this->api->base_url()) . ',' .
                    'rest_base:'    . json_encode(rest_url('pa/v1'))      . ',' .
                    'sse_url:'      . json_encode($this->api->sse_url())  . ',' .
                    'popular:'      . json_encode(['Retatrutide','Tirzepatide','Tesamorelin','GHK-Cu','Ipamorelin/CJC-1295','BPC-157/TB-500','MOTS-c','BPC-157']) . ',' .
                    'categories:'   . json_encode([
                        ['name'=>'GLP-1','count'=>9],['name'=>'Healing','count'=>7],['name'=>'Blends','count'=>9],
                        ['name'=>'Growth Hormones','count'=>10],['name'=>'Hormones & Reproductive','count'=>4],
                        ['name'=>'Sleep & Recovery','count'=>1],['name'=>'Accessories','count'=>2],
                    ]) . ',' .
                    'price_ranges:' . json_encode(['Any Price','$0 - $50','$50 - $100','$100 - $250','$250 - $500','$500+']) . ',' .
                    'sort_options:' . json_encode(['Popularity','Price: Low to High','Price: High to Low','Newest']) . ',' .
                    'dose_labels:'  . json_encode( empty($dose_labels) ? new stdClass() : $dose_labels ) .
                '};',
                'before'
            );
            wp_add_inline_script('pa-suppliers-js',
                'window.PA_SUPPLIERS_UI = window.PA_SUPPLIERS_UI || {}; window.PA_SUPPLIERS_UI.api_base = ' . json_encode($this->api->base_url()) . ';',
                'before'
            );
            wp_add_inline_script('pa-about-js',
                'window.PA_ABOUT_UI = window.PA_ABOUT_UI || {}; window.PA_ABOUT_UI.api_base = ' . json_encode($this->api->base_url()) . ';',
                'before'
            );
        }
    }

    public function render_dashboard_shortcode() {
        wp_enqueue_style('pa-dashboard-css');
        wp_enqueue_script('pa-dashboard-js');

        // Read dose labels here so they are always available regardless of
        // whether wp_add_inline_script ran first (caching plugins, page builders,
        // etc. can alter script output order).
        $sc_dose_labels_raw = get_option('pa_dose_labels', array());
        $sc_dose_labels = array();
        foreach ( (array) $sc_dose_labels_raw as $k => $v ) {
            $sc_dose_labels[ strtolower( trim( $k ) ) ] = $v;
        }
        ob_start();
        ?>
        <script>
        // Ensure PA_UI and dose_labels are always present no matter when this
        // inline block executes relative to dashboard.js.
        window.PA_UI = window.PA_UI || {};
        window.PA_UI.api_base = <?php echo json_encode($this->api->base_url()); ?>;
        window.PA_UI.rest_base = <?php echo json_encode(rest_url('pa/v1')); ?>;
        window.PA_UI.sse_url  = <?php echo json_encode($this->api->sse_url()); ?>;
        window.PA_UI.dose_labels = <?php echo json_encode( empty($sc_dose_labels) ? new stdClass() : $sc_dose_labels ); ?>;
        </script>
        <div class="pa-shell">
                <section class="pa-search-panel">
                    <div class="pa-search-row">
                        <div class="pa-search-input-wrap">
                            <span class="pa-search-icon" aria-hidden="true">
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <line x1="20" y1="20" x2="16.5" y2="16.5"></line>
                                </svg>
                            </span>
                            <input id="pa-search" type="search" placeholder="Search for peptides or suppliers..." />
                        </div>
                        <button id="pa-filter-btn" class="pa-filter-btn" type="button" aria-label="Open filters">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 5h18l-7 8v6l-4-2v-4z"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="pa-popular-row">
                        <span class="pa-label">Popular:</span>
                        <div id="pa-popular" class="pa-chip-list"></div>
                    </div>
                    <div class="pa-divider"></div>
                    <div class="pa-active-row">
                        <div id="pa-active-filters" class="pa-active-list"></div>
                        <button id="pa-clear-all" class="pa-clear-all" type="button">Clear All</button>
                    </div>
                </section>

                <!-- Results bar -->
                <div id="pa-results-bar" class="pa-results-bar">
                    <div class="pa-results-left">
                        <span id="pa-grid-count" class="pa-results-count"></span>
                    </div>
                    <div class="pa-results-right">
                        <div class="pa-price-toggle">
                            <span class="pa-price-toggle-label">Show prices:</span>
                            <button id="pa-toggle-total" class="pa-ptoggle is-active" type="button">Total</button>
                            <button id="pa-toggle-mgml" class="pa-ptoggle" type="button">mg/mL</button>
                        </div>
                        <label class="pa-sort-label">Sort cards by:
                            <select id="pa-grid-sort" class="pa-grid-sort-select">
                                <option value="name">Name</option>
                                <option value="price_asc">Price: Low to High</option>
                                <option value="price_desc">Price: High to Low</option>
                                <option value="vendors">Most Vendors</option>
                            </select>
                        </label>
                        <div class="pa-bar-icons">
                            <button class="pa-bar-icon" type="button" title="Has coupon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
                            <button class="pa-bar-icon" type="button" title="Favourites"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></button>
                            <button class="pa-bar-icon" type="button" title="US vendors only"><span class="pa-flag-us">US</span></button>
                        </div>
                        <div class="pa-view-toggle">
                            <button id="pa-view-grid" class="pa-view-btn is-active" type="button" title="Grid view"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
                            <button id="pa-view-list" class="pa-view-btn" type="button" title="List view"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
                        </div>
                    </div>
                </div>

                <!-- Product grid -->
                <div id="pa-product-grid" class="pa-product-grid">
                    <p class="pa-loading">Loading products&#8230;</p>
                </div>

                <!-- Product detail (overlay within view) -->
                <div id="pa-product-detail" class="pa-product-detail" style="display:none">
                    <div class="pa-detail-layout">
                        <div class="pa-detail-sidebar">
                            <button id="pa-detail-back" class="pa-back-btn" type="button">&#8592; Back to Prices</button>
                        </div>
                        <div class="pa-detail-main">
                            <div class="pa-detail-card">
                                <div class="pa-detail-head">
                                    <div>
                                        <h2 id="pa-detail-name" class="pa-detail-name"></h2>
                                        <span id="pa-detail-category" class="pa-cat-badge"></span>
                                    </div>
                                    <div id="pa-detail-head-icons" class="pa-pcard-head-icons"></div>
                                </div>
                                <p id="pa-detail-description" class="pa-detail-desc"></p>
                            </div>
                            <div id="pa-detail-dosage-section" class="pa-detail-dosage-card">
                                <div class="pa-detail-dosage-head">
                                    <span class="pa-detail-dosage-title">Select Dosage</span>
                                    <div class="pa-detail-price-toggle-wrap">
                                        <span class="pa-detail-toggle-label">Show prices:</span>
                                        <button id="pa-detail-toggle-total" class="pa-ptoggle is-active" type="button">Total</button>
                                        <button id="pa-detail-toggle-mgml" class="pa-ptoggle" type="button">mg/mL</button>
                                    </div>
                                </div>
                                <div id="pa-detail-dosage-grid" class="pa-detail-dosage-grid"></div>
                            </div>
                            <div id="pa-detail-prices" class="pa-detail-prices"></div>
                        </div>
                    </div>
                </div>
        </div><!-- /.pa-shell -->

        <!-- Detail supplier filter modal -->
        <div id="pa-detail-supplier-modal" class="pa-modal" aria-hidden="true">
            <div class="pa-modal-backdrop" data-dsm-close="1"></div>
            <div class="pa-modal-card pa-dsm-card" role="dialog" aria-modal="true">
                <div class="pa-modal-grip" aria-hidden="true"></div>
                <div class="pa-modal-head">
                    <h2>Filter Suppliers</h2>
                    <div class="pa-modal-head-actions">
                        <button id="pa-dsm-clear-all" class="pa-link-btn" type="button">Clear All</button>
                        <button id="pa-dsm-close" class="pa-modal-close" type="button" aria-label="Close">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="pa-dsm-search-wrap">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" class="pa-dsm-search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="pa-dsm-search" class="pa-dsm-search-input" type="search" placeholder="Search suppliers...">
                </div>
                <div class="pa-dsm-status-row">
                    <span id="pa-dsm-count">None selected</span>
                    <div class="pa-dsm-status-actions">
                        <button id="pa-dsm-select-all" class="pa-link-btn" type="button">Select All</button>
                        <span class="pa-dot"></span>
                        <button id="pa-dsm-clear-list" class="pa-link-btn pa-danger" type="button">Clear All</button>
                    </div>
                </div>
                <div id="pa-dsm-list" class="pa-dsm-list"></div>
                <div class="pa-modal-footer">
                    <button id="pa-dsm-cancel" class="pa-modal-cancel-btn" type="button">Cancel</button>
                    <button id="pa-dsm-apply" class="pa-modal-apply-btn" type="button">Apply</button>
                </div>
            </div>
        </div>

        <!-- Filter modal -->
        <div id="pa-filter-modal" class="pa-modal" aria-hidden="true">
            <div class="pa-modal-backdrop" data-close="1"></div>
            <div class="pa-modal-card" role="dialog" aria-modal="true" aria-labelledby="pa-modal-title">
                <div class="pa-modal-grip" aria-hidden="true"></div>
                <div class="pa-modal-head">
                    <h2 id="pa-modal-title">Filter &amp; Sort</h2>
                    <div class="pa-modal-head-actions">
                        <button id="pa-modal-clear-all" class="pa-link-btn" type="button">Clear All</button>
                        <button id="pa-modal-close" class="pa-modal-close" type="button" aria-label="Close">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="pa-modal-tabs">
                    <button class="pa-modal-tab is-active" data-tab="filter" type="button">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18l-7 8v6l-4-2v-4z"></path></svg>
                        Filter
                    </button>
                    <button class="pa-modal-tab" data-tab="sort" type="button">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M6 3v18"></path><path d="M6 3l-3 3"></path><path d="M6 3l3 3"></path>
                            <path d="M18 21V3"></path><path d="M18 21l-3-3"></path><path d="M18 21l3-3"></path>
                        </svg>
                        Sort
                    </button>
                </div>
                <div class="pa-modal-body">
                    <div class="pa-tab-content is-active" data-content="filter">
                        <div class="pa-toggle-list">
                            <label class="pa-toggle-row"><span>In Stock Only</span><input type="checkbox" id="pa-instock-only"><i></i></label>
                            <label class="pa-toggle-row"><span>Kits Only</span><input type="checkbox" id="pa-kits-only"><i></i></label>
                            <label class="pa-toggle-row"><span>Blends Only</span><input type="checkbox" id="pa-blends-only"><i></i></label>
                            <label class="pa-toggle-row"><span>Likes Only</span><input type="checkbox" id="pa-likes-only"><i></i></label>
                        </div>
                        <div class="pa-modal-divider"></div>
                        <div class="pa-section-head">
                            <h3>Categories</h3>
                            <div class="pa-section-tools">
                                <button class="pa-link-btn" data-action="toggle-category-search" type="button">Search</button>
                                <span class="pa-dot"></span>
                                <button class="pa-link-btn" data-action="cat-select-all" type="button">Select All</button>
                                <span class="pa-dot"></span>
                                <button class="pa-link-btn pa-danger" data-action="cat-clear-all" type="button">Clear All</button>
                            </div>
                        </div>
                        <div id="pa-category-search-wrap" class="pa-search-inline-wrap is-hidden">
                            <input id="pa-category-search" class="pa-search-inline" type="search" placeholder="Search categories..." />
                        </div>
                        <div id="pa-category-list" class="pa-check-list"></div>
                        <div class="pa-section-head">
                            <h3>Suppliers</h3>
                            <div class="pa-section-tools">
                                <button class="pa-link-btn" data-action="toggle-supplier-search" type="button">Search</button>
                                <span class="pa-dot"></span>
                                <label class="pa-inline-check"><input type="checkbox" id="pa-us-only"> US Only</label>
                                <span class="pa-dot"></span>
                                <button class="pa-link-btn" data-action="sup-select-all" type="button">Select All</button>
                                <span class="pa-dot"></span>
                                <button class="pa-link-btn pa-danger" data-action="sup-clear-all" type="button">Clear All</button>
                            </div>
                        </div>
                        <div id="pa-supplier-search-wrap" class="pa-search-inline-wrap is-hidden">
                            <input id="pa-supplier-search" class="pa-search-inline" type="search" placeholder="Search suppliers..." />
                        </div>
                        <div id="pa-supplier-list" class="pa-check-list"></div>
                        <div class="pa-section-head">
                            <h3>Price Range</h3>
                            <div class="pa-section-tools">
                                <button class="pa-link-btn" data-action="price-select-all" type="button">Select All</button>
                                <span class="pa-dot"></span>
                                <button class="pa-link-btn pa-danger" data-action="price-clear-all" type="button">Clear All</button>
                            </div>
                        </div>
                        <div id="pa-price-range-grid" class="pa-price-grid"></div>
                    </div>
                    <div class="pa-tab-content" data-content="sort">
                        <div id="pa-sort-list" class="pa-sort-list"></div>
                    </div>
                </div>
                <div class="pa-modal-foot">
                    <button id="pa-modal-cancel" class="pa-foot-btn is-cancel" type="button">Cancel</button>
                    <button id="pa-modal-apply" class="pa-foot-btn is-apply" type="button">Apply</button>
                </div>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function render_about_shortcode($atts) {
        $atts = shortcode_atts(array(
            'title' => 'About AminoPrices',
            'lead' => 'AminoPrices helps you compare research peptide prices and suppliers in one place, so you can spend less time searching and more time evaluating options.',
            'products_value' => '60+',
            'products_label' => 'Products covered',
            'suppliers_value' => '50+',
            'suppliers_label' => 'Suppliers tracked',
            'free_value' => '100%',
            'free_label' => 'Free to use',
            'speed_value' => 'Quick',
            'speed_label' => 'Compare in minutes',
            'suppliers_url' => home_url('/suppliers/'),
            'prices_url' => home_url('/'),
            'contact_title' => 'Questions or feedback?',
            'contact_lead' => 'If you spot missing data, have a supplier suggestion, or want to share product feedback, reach out and we will take a look.',
            'contact_label' => 'Email',
            'contact_email' => 'contact@aminoprices.com',
        ), $atts, 'peptide_about_dashboard');

        $stats = $this->api->request('GET', '/api/stats');
        if (!empty($stats['ok']) && is_array($stats['data'])) {
            $data = $stats['data'];
            if (isset($data['product_count']) && is_numeric($data['product_count'])) {
                $atts['products_value'] = number_format_i18n((int) $data['product_count']);
            }
            if (isset($data['vendor_count']) && is_numeric($data['vendor_count'])) {
                $atts['suppliers_value'] = number_format_i18n((int) $data['vendor_count']);
            }
        } else {
            $vendors = $this->api->request('GET', '/api/vendors');
            if (!empty($vendors['ok']) && is_array($vendors['data'])) {
                $atts['suppliers_value'] = number_format_i18n(count($vendors['data']));
            }
            $products = $this->api->request('GET', '/api/products');
            if (!empty($products['ok']) && is_array($products['data'])) {
                $atts['products_value'] = number_format_i18n(count($products['data']));
            }
        }

        wp_enqueue_style('pa-dashboard-css');
        wp_enqueue_script('pa-about-js');

        ob_start();
        ?>
        <script>
        window.PA_ABOUT_UI = {
            api_base: <?php echo json_encode($this->api->base_url()); ?>
        };
        </script>
        <div class="pa-shell pa-about-shell">
            <section class="pa-about-card">
                <div class="pa-about-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="50" height="50" fill="none" stroke="currentColor" stroke-width="1.8">
                        <rect x="7" y="6" width="10" height="14" rx="2"></rect>
                        <path d="M9 6V4h6v2"></path>
                        <circle cx="12" cy="13" r="3"></circle>
                    </svg>
                </div>
                <h1 class="pa-about-title"><?php echo esc_html($atts['title']); ?></h1>
                <p class="pa-about-lead"><?php echo esc_html($atts['lead']); ?></p>
                <div class="pa-about-stats">
                    <div class="pa-about-stat">
                        <span class="pa-about-stat-icon is-teal" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M12 2l8 4v12l-8 4-8-4V6l8-4z"></path>
                                <path d="M12 22V12"></path>
                                <path d="M20 6l-8 4-8-4"></path>
                            </svg>
                        </span>
                        <div class="pa-about-stat-value" data-about-count="products"><?php echo esc_html($atts['products_value']); ?></div>
                        <div class="pa-about-stat-label"><?php echo esc_html($atts['products_label']); ?></div>
                    </div>
                    <div class="pa-about-stat">
                        <span class="pa-about-stat-icon is-blue" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M16 11a4 4 0 1 0-8 0"></path>
                                <path d="M4 20a8 8 0 0 1 16 0"></path>
                                <circle cx="12" cy="6" r="3"></circle>
                            </svg>
                        </span>
                        <div class="pa-about-stat-value" data-about-count="suppliers"><?php echo esc_html($atts['suppliers_value']); ?></div>
                        <div class="pa-about-stat-label"><?php echo esc_html($atts['suppliers_label']); ?></div>
                    </div>
                    <div class="pa-about-stat">
                        <span class="pa-about-stat-icon is-green" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M12 2v20"></path>
                                <path d="M16 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H8"></path>
                            </svg>
                        </span>
                        <div class="pa-about-stat-value"><?php echo esc_html($atts['free_value']); ?></div>
                        <div class="pa-about-stat-label"><?php echo esc_html($atts['free_label']); ?></div>
                    </div>
                    <div class="pa-about-stat">
                        <span class="pa-about-stat-icon is-violet" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
                                <circle cx="12" cy="12" r="8"></circle>
                                <path d="M12 8v4l3 2"></path>
                            </svg>
                        </span>
                        <div class="pa-about-stat-value"><?php echo esc_html($atts['speed_value']); ?></div>
                        <div class="pa-about-stat-label"><?php echo esc_html($atts['speed_label']); ?></div>
                    </div>
                </div>
                <div class="pa-about-actions">
                    <a class="pa-about-btn is-outline" href="<?php echo esc_url($atts['suppliers_url']); ?>">Compare Suppliers</a>
                    <a class="pa-about-btn is-primary" href="<?php echo esc_url($atts['prices_url']); ?>">View Prices</a>
                </div>
            </section>
            <section class="pa-about-panels-section">
                                <div class="pa-about-panels">
                    <div class="pa-about-panel">
                        <h2 class="pa-about-panel-title">How AminoPrices helps</h2>
                        <p class="pa-about-panel-lead">Compare products and suppliers faster with consistent data.</p>
                        <div class="pa-about-list">
                            <div class="pa-about-list-item">
                                <span class="pa-about-list-icon is-blue" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="11" cy="11" r="6"></circle>
                                        <line x1="20" y1="20" x2="16.5" y2="16.5"></line>
                                    </svg>
                                </span>
                                <span>Search products quickly</span>
                            </div>
                            <div class="pa-about-list-item">
                                <span class="pa-about-list-icon is-teal" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M5 6h14"></path>
                                        <path d="M7 6l3 11"></path>
                                        <path d="M17 6l-3 11"></path>
                                        <path d="M9 17h6"></path>
                                    </svg>
                                </span>
                                <span>Compare suppliers side-by-side</span>
                            </div>
                            <div class="pa-about-list-item">
                                <span class="pa-about-list-icon is-green" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 3l7 3v6c0 4-2.5 7-7 9-4.5-2-7-5-7-9V6l7-3z"></path>
                                    </svg>
                                </span>
                                <span>Keep the process transparent</span>
                            </div>
                        </div>
                    </div>
                    <div class="pa-about-panel">
                        <h2 class="pa-about-panel-title">What you can review</h2>
                        <p class="pa-about-panel-lead">Supplier profiles surface the essentials at a glance, including reviews and ratings.</p>
                        <div class="pa-about-grid">
                            <div class="pa-about-mini">
                                <span class="pa-about-mini-icon is-amber" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 3l3 6 6 .5-4.5 4 1.2 6.5L12 17l-5.7 3 1.2-6.5L3 9.5 9 9l3-6z"></path>
                                    </svg>
                                </span>
                                <span>Reviews &amp; ratings</span>
                            </div>
                            <div class="pa-about-mini">
                                <span class="pa-about-mini-icon is-blue" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 2l8 4v12l-8 4-8-4V6l8-4z"></path>
                                        <path d="M12 22V12"></path>
                                        <path d="M20 6l-8 4-8-4"></path>
                                    </svg>
                                </span>
                                <span>Product coverage</span>
                            </div>
                            <div class="pa-about-mini">
                                <span class="pa-about-mini-icon is-green" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 2v20"></path>
                                        <path d="M16 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H8"></path>
                                    </svg>
                                </span>
                                <span>Price snapshots</span>
                            </div>
                            <div class="pa-about-mini">
                                <span class="pa-about-mini-icon is-teal" aria-hidden="true">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 3l7 3v6c0 4-2.5 7-7 9-4.5-2-7-5-7-9V6l7-3z"></path>
                                    </svg>
                                </span>
                                <span>Supplier details</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section class="pa-about-contact">
                <div class="pa-about-contact-card">
                    <h2 class="pa-about-contact-title"><?php echo esc_html($atts['contact_title']); ?></h2>
                    <p class="pa-about-contact-lead"><?php echo esc_html($atts['contact_lead']); ?></p>
                    <div class="pa-about-contact-pill">
                        <!-- <span class="pa-about-contact-label"><?php echo esc_html($atts['contact_label']); ?></span> -->
                        <span class="pa-about-contact-email" data-copy-email="<?php echo esc_attr($atts['contact_email']); ?>"><?php echo esc_html($atts['contact_email']); ?></span>
                        <button class="pa-about-copy-btn" type="button" data-copy-email="<?php echo esc_attr($atts['contact_email']); ?>" aria-label="Copy email">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </section>
        </div>
        <?php
        return ob_get_clean();
    }

    public function render_suppliers_shortcode($atts) {
        $atts = shortcode_atts(array(
            'prices_url' => home_url('/'),
        ), $atts, 'peptide_suppliers_dashboard');

        wp_enqueue_style('pa-dashboard-css');
        wp_enqueue_script('pa-suppliers-js');

        ob_start();
        ?>
        <script>
        window.PA_SUPPLIERS_UI = {
            api_base:   <?php echo json_encode($this->api->base_url()); ?>,
            prices_url: <?php echo json_encode(esc_url($atts['prices_url'])); ?>
        };
        </script>
        <div id="pas-shell" class="pa-shell">

            <!-- Search panel -->
            <section class="pa-search-panel">
                <div class="pa-search-row">
                    <div class="pa-search-input-wrap">
                        <span class="pa-search-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.5" y2="16.5"></line>
                            </svg>
                        </span>
                        <input id="pas-search" type="search" placeholder="Search suppliers..." />
                    </div>
                    <button id="pas-filter-btn" class="pa-filter-btn" type="button" aria-label="Open filters">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 5h18l-7 8v6l-4-2v-4z"></path>
                        </svg>
                    </button>
                </div>
                <div class="pa-popular-row">
                    <span class="pa-label">Popular:</span>
                    <div id="pas-popular" class="pa-chip-list"></div>
                </div>
                <div class="pa-divider"></div>
                <div id="pas-active-row" class="pa-active-row">
                    <div id="pas-active-filters" class="pa-active-list"></div>
                    <button id="pas-clear-all" class="pa-clear-all" type="button">Clear All</button>
                </div>
            </section>

            <!-- Results bar -->
            <div id="pas-results-bar" class="pa-results-bar">
                <div class="pa-results-left">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#f4c842" stroke-width="2.5" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <span id="pas-count" class="pa-results-count"></span>
                </div>
                <div class="pa-results-right">
                    <label class="pa-sort-label">Sort by:
                        <select id="pas-sort" class="pa-grid-sort-select">
                            <option value="name">Name</option>
                            <option value="products">Product Count</option>
                        </select>
                    </label>
                    <div class="pa-sort-dir-btns">
                        <button id="pas-sort-asc" class="pa-sort-dir is-active" type="button" title="Ascending">&#8593;</button>
                        <button id="pas-sort-desc" class="pa-sort-dir" type="button" title="Descending">&#8595;</button>
                    </div>
                    <div class="pa-bar-icons">
                        <button id="pas-filter-coupon" class="pa-bar-icon" type="button" title="Has coupon">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                        </button>
                        <button id="pas-filter-crypto" class="pa-bar-icon" type="button" title="Accepts crypto"><span style="font-weight:800;font-size:13px">&#8383;</span></button>
                        <button id="pas-filter-favs" class="pa-bar-icon" type="button" title="Favourites">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                        </button>
                        <button id="pas-filter-us" class="pa-bar-icon" type="button" title="US vendors only"><span class="pa-flag-us">US</span></button>
                    </div>
                    <div class="pa-view-toggle">
                        <button id="pas-view-grid" class="pa-view-btn is-active" type="button" title="Grid view"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
                        <button id="pas-view-list" class="pa-view-btn" type="button" title="List view"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
                    </div>
                </div>
            </div>

            <!-- Supplier grid -->
            <div id="pas-grid" class="pa-supplier-grid">
                <p class="pa-loading">Loading suppliers&#8230;</p>
            </div>

            <!-- Payment methods modal -->
            <div id="pa-pm-modal" class="pa-modal pa-pm-modal" aria-hidden="true">
                <div class="pa-modal-backdrop" data-pm-close="1"></div>
                <div class="pa-modal-card" role="dialog" aria-modal="true" aria-labelledby="pa-pm-modal-title">
                    <div class="pa-modal-grip" aria-hidden="true"></div>
                    <div class="pa-modal-head">
                        <h2 id="pa-pm-modal-title">Payment Methods</h2>
                        <div class="pa-modal-head-actions">
                            <button class="pa-modal-close" type="button" data-pm-close="1" aria-label="Close">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="pa-modal-body">
                        <div id="pa-pm-modal-list" class="pa-pm-modal-list"></div>
                    </div>
                    <div class="pa-modal-foot">
                        <a id="pa-pm-modal-cta" class="pa-pm-modal-cta" href="#" target="_blank" rel="noopener noreferrer">Continue to Vendor</a>
                    </div>
                </div>
            </div>

        </div><!-- /#pas-shell -->
        <?php
        return ob_get_clean();
    }
}











