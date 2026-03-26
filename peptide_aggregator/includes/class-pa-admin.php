<?php

if (!defined('ABSPATH')) {
    exit;
}

class PA_Admin {
    private $api;

    public function __construct(PA_Api_Client $api) {
        $this->api = $api;
        add_action('admin_menu', array($this, 'register_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('wp_ajax_pa_toggle_product_status', array($this, 'ajax_toggle_product_status'));
        add_action('wp_ajax_pa_delete_product', array($this, 'ajax_delete_product'));
        add_action('wp_ajax_pa_delete_vendor', array($this, 'ajax_delete_vendor'));
        add_action('wp_ajax_pa_save_dose_labels', array($this, 'ajax_save_dose_labels'));
        add_action('wp_ajax_pa_save_product_tags', array($this, 'ajax_save_product_tags'));
    }

    public function register_menu() {
        add_menu_page('Peptide Aggregator', 'Peptide Aggregator', 'manage_options', 'pa-dashboard', array($this, 'render_settings_page'), 'dashicons-chart-line');
        add_submenu_page('pa-dashboard', 'Settings', 'Settings', 'manage_options', 'pa-dashboard', array($this, 'render_settings_page'));
        add_submenu_page('pa-dashboard', 'Vendors', 'Vendors', 'manage_options', 'pa-vendors', array($this, 'render_vendors_page'));
        add_submenu_page('pa-dashboard', 'Products', 'Products', 'manage_options', 'pa-products', array($this, 'render_products_page'));
        add_submenu_page('pa-dashboard', 'Monitoring', 'Monitoring', 'manage_options', 'pa-monitoring', array($this, 'render_monitoring_page'));
    }

    public function register_settings() {
        register_setting('pa_settings_group', PA_Api_Client::OPT_BASE_URL);
        register_setting('pa_settings_group', PA_Api_Client::OPT_API_TOKEN);
    }

    private function render_notice($type, $message) {
        printf('<div class="notice notice-%s"><p>%s</p></div>', esc_attr($type), esc_html($message));
    }

    private function admin_get($path) {
        return $this->api->request('GET', $path, null, true);
    }

    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        ?>
        <div class="wrap">
            <h1>Peptide Aggregator Settings</h1>
            <form method="post" action="options.php">
                <?php settings_fields('pa_settings_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="<?php echo esc_attr(PA_Api_Client::OPT_BASE_URL); ?>">FastAPI Base URL</label></th>
                        <td><input name="<?php echo esc_attr(PA_Api_Client::OPT_BASE_URL); ?>" id="<?php echo esc_attr(PA_Api_Client::OPT_BASE_URL); ?>" type="url" class="regular-text" value="<?php echo esc_attr(get_option(PA_Api_Client::OPT_BASE_URL, 'http://localhost:8000')); ?>" /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="<?php echo esc_attr(PA_Api_Client::OPT_API_TOKEN); ?>">API Bearer Token (optional)</label></th>
                        <td><input name="<?php echo esc_attr(PA_Api_Client::OPT_API_TOKEN); ?>" id="<?php echo esc_attr(PA_Api_Client::OPT_API_TOKEN); ?>" type="text" class="regular-text" value="<?php echo esc_attr(get_option(PA_Api_Client::OPT_API_TOKEN, '')); ?>" /></td>
                    </tr>
                </table>
                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public function render_vendors_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        // ── Load data ─────────────────────────────────────────────────────────
        $vendors_resp = $this->admin_get('/api/admin/vendors');
        $vendors = $vendors_resp['ok'] && is_array($vendors_resp['data']) ? $vendors_resp['data'] : array();

        $worker_resp = $this->admin_get('/api/admin/worker-status');
        $worker_alive = !empty($worker_resp['data']['worker_alive']);
        $queue_depth  = (int) ($worker_resp['data']['queue_depth'] ?? 0);

        // Fetch scrape configs for all vendors (for JS population)
        $scrape_configs = array();
        foreach ($vendors as $v) {
            $sc_resp = $this->admin_get('/api/admin/vendors/' . $v['id'] . '/scrape-config');
            if ($sc_resp['ok'] && !empty($sc_resp['data']['scrape_config'])) {
                $scrape_configs[$v['id']] = $sc_resp['data']['scrape_config'];
            }
        }

        $pm_options = array(
            'Credit Card'       => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/><line x1="5" y1="15" x2="9" y2="15" stroke-linecap="round"/></svg>',
            'Crypto'            => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h5a2 2 0 0 1 0 4H8m5 0h1a2 2 0 0 1 0 4H8M8 7V5m0 2v10m0 0v2m3-14v2m2 8v2"/></svg>',
            'Apple Pay'         => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>',
            'Bank / ACH'        => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M3 21h18M3 10h18M5 6l7-3 7 3"/><rect x="5" y="10" width="3" height="8"/><rect x="10.5" y="10" width="3" height="8"/><rect x="16" y="10" width="3" height="8"/></svg>',
            'Cash App'          => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="4"/><path stroke-linecap="round" d="M12 7v10M9.5 9.5A2.5 2.5 0 0 1 12 8a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 0 0 5 2.5 2.5 0 0 0 2.5-1.5"/></svg>',
            'Zelle'             => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 8h8l-8 8h8"/></svg>',
            'PayPal'            => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M6.5 20H4l2-13h6c3 0 5 1.5 4.5 4.5-.5 3-3 4.5-6 4.5H8L6.5 20z"/><path stroke-linecap="round" d="M9.5 16H7.2l1.5-9h5c2.5 0 4 1.2 3.8 3.8-.4 2.5-2.5 3.7-5 3.7H10L9.5 16z" opacity=".5"/></svg>',
            'Venmo'             => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="4"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 8c.5 1.5 1 4 1.5 5.5L13 8"/></svg>',
            'Google Pay'        => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M20.5 12.2H13v2.6h4.3c-.4 2-2.1 3.2-4.3 3.2a5 5 0 0 1 0-10c1.3 0 2.4.5 3.3 1.2l1.9-1.9A8 8 0 1 0 12 20c4.4 0 8-3.2 8-8 0-.6-.07-1.2-.2-1.8H20.5"/></svg>',
            'ACH/Bank Transfer' => '<svg class="pa-pm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" d="M3 12h18M3 6h18M3 18h18"/><path stroke-linecap="round" d="M17 9l3 3-3 3"/><path stroke-linecap="round" d="M7 9l-3 3 3 3"/></svg>',
        );
        ?>
        <div class="wrap">
            <h1>Vendors</h1>

            <style>
            #pa-vendor-form-wrap{background:#fff;border:1px solid #c3c4c7;border-radius:4px;padding:20px 24px;margin-bottom:20px}
            #pa-vendor-form-wrap h2{margin-top:0}
            .pa-form-mode-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-left:8px;vertical-align:middle}
            .pa-mode-create{background:#e6f4ea;color:#1a7f37}
            .pa-mode-edit{background:#fff3cd;color:#856404}
            .pa-pm-grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}
            .pa-pm-item{display:flex;flex-direction:column;align-items:center;gap:5px;border:2px solid #ddd;border-radius:10px;padding:10px 14px;cursor:pointer;min-width:82px;text-align:center;font-size:11px;font-weight:500;color:#444;transition:border-color .15s,background .15s,color .15s;user-select:none}
            .pa-pm-item:hover{border-color:#2271b1}
            .pa-pm-item.pa-pm-on{border-color:#2271b1;background:#f0f6fc;color:#2271b1}
            .pa-pm-item input[type=checkbox]{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
            .pa-pm-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px}
            .pa-pm-cell-icon{width:18px;height:18px;display:inline-block;vertical-align:middle;color:#555;margin-right:2px}
            .pa-vendor-row{cursor:pointer}
            .pa-vendor-row:hover td{background:#f0f6fc !important}
            </style>

            <?php if ($worker_alive) : ?>
                <div class="notice notice-success inline" style="margin:0 0 12px;padding:6px 12px;">
                    <strong>&#9679; Worker online</strong> &mdash; <?php echo esc_html($queue_depth); ?> job(s) in queue.
                </div>
            <?php else : ?>
                <div class="notice notice-error inline" style="margin:0 0 12px;padding:6px 12px;">
                    <strong>&#9679; Worker offline</strong> &mdash; Start the worker with <code>venv/Scripts/python.exe run_worker.py</code>
                </div>
            <?php endif; ?>

            <!-- ── Unified vendor form ───────────────────────────────────────── -->
            <div id="pa-vendor-form-wrap">
                <h2 id="pa-form-title">
                    Add Vendor
                    <span class="pa-form-mode-badge pa-mode-create" id="pa-mode-badge">New</span>
                </h2>
                <form id="pa-vendor-form">
                    <input type="hidden" name="vendor_id" id="pa_vendor_id" value="0" />
                    <table class="form-table">
                        <tr><th colspan="2" style="padding-bottom:4px"><strong>Basic Info</strong></th></tr>
                        <tr><th>Name <span style="color:red">*</span></th><td><input name="vendor_name" id="pa_f_name" class="regular-text" required /></td></tr>
                        <tr><th>Base URL <span style="color:red">*</span></th><td><input name="base_url" id="pa_f_base_url" type="url" class="regular-text" required /></td></tr>
                        <tr><th>Enabled</th><td><label><input type="checkbox" name="enabled" id="pa_f_enabled" checked /> Enabled</label></td></tr>

                        <tr><th colspan="2" style="padding-top:16px;padding-bottom:4px"><hr/><strong>Display Info</strong></th></tr>
                        <tr><th>Logo URL</th><td><input name="logo_url" id="pa_f_logo_url" type="url" class="regular-text" placeholder="https://example.com/logo.png" /></td></tr>
                        <tr><th>Country</th><td><input name="country" id="pa_f_country" class="small-text" placeholder="US" maxlength="8" /></td></tr>
                        <tr><th>Coupon Code</th><td><input name="coupon_code" id="pa_f_coupon_code" class="regular-text" placeholder="SAVE10" /></td></tr>
                        <tr><th>Affiliate URL</th><td><input name="affiliate_template" id="pa_f_affiliate" class="regular-text" placeholder="/ref/your-id" /><p class="description">Enter a path suffix (e.g. <code>/ref/amino</code>) to append after the product URL, or a full redirect template using <code>{url}</code> as a placeholder for the encoded product URL.</p></td></tr>
                        <tr>
                            <th>Payment Methods</th>
                            <td>
                                <div class="pa-pm-grid" id="pa-pm-grid">
                                <?php foreach ($pm_options as $pm_value => $pm_icon) : ?>
                                    <label class="pa-pm-item">
                                        <input type="checkbox" name="payment_methods[]" value="<?php echo esc_attr($pm_value); ?>" />
                                        <?php echo $pm_icon; ?>
                                        <span><?php echo esc_html($pm_value); ?></span>
                                    </label>
                                <?php endforeach; ?>
                                </div>
                            </td>
                        </tr>

                        <tr><th colspan="2" style="padding-top:16px;padding-bottom:4px"><hr/><strong>Crawl Config</strong></th></tr>
                        <tr><th>Target URLs</th><td><textarea name="target_urls" id="pa_f_target_urls" rows="4" class="large-text" placeholder="One URL per line (added on update, not replaced)"></textarea></td></tr>
                        <tr><th>Product Link Selector</th><td><input name="product_link_selector" id="pa_f_pls" class="regular-text" placeholder="a.product-link" /></td></tr>
                        <tr><th>Product Link Pattern</th><td><input name="product_link_pattern" id="pa_f_plp" class="regular-text" placeholder="/product/|/shop/" /></td></tr>
                        <tr><th>Price Selector</th><td><input name="price_selector" id="pa_f_ps" class="regular-text" placeholder="span.price" /></td></tr>
                        <tr><th>Price Attr</th><td><input name="price_attr" id="pa_f_pa" class="regular-text" placeholder="content" /></td></tr>
                        <tr><th>Name Selector</th><td><input name="name_selector" id="pa_f_ns" class="regular-text" placeholder="h1.product-title" /></td></tr>
                        <tr><th>Dosage Selector</th><td><input name="dosage_selector" id="pa_f_ds" class="regular-text" placeholder="ul[data-attribute_name] li" /><p class="description">CSS selector for variant/dosage option elements.</p></td></tr>
                        <tr><th>Dosage Attribute</th><td><input name="dosage_attribute" id="pa_f_da" class="regular-text" placeholder="attribute_mg" /><p class="description">WooCommerce data-attribute_name value (e.g. attribute_mg).</p></td></tr>
                        <tr><th>Popup Close Selector</th><td><input name="popup_close_selector" id="pa_f_pcs" class="regular-text" placeholder=".klaviyo-close-form" /></td></tr>
                        <tr><th>Max Discovered URLs</th><td><input name="max_discovered_urls" id="pa_f_mdu" type="number" value="120" min="1" /></td></tr>
                        <tr><th>Max Discovery Pages</th><td><input name="max_discovery_pages" id="pa_f_mdp" type="number" value="8" min="1" /></td></tr>

                        <tr><th colspan="2" style="padding-top:16px;padding-bottom:4px"><hr/><strong>Data Source</strong> <small style="font-weight:normal">Priority: &#9312; WC API (key+secret) → &#9313; Public WC API → &#9314; Web Crawl</small></th></tr>
                        <tr><th colspan="2"><strong>&#9312; WooCommerce REST API</strong></th></tr>
                        <tr><th>WC Consumer Key</th><td><input name="wc_consumer_key" id="pa_f_wck" class="regular-text" placeholder="ck_xxxxxxxxxxxx" /></td></tr>
                        <tr><th>WC Consumer Secret</th><td><input name="wc_consumer_secret" id="pa_f_wcs" type="password" class="regular-text" placeholder="cs_xxxxxxxxxxxx" /><p class="description">Leave blank to keep existing value.</p></td></tr>
                        <tr><th colspan="2"><strong>&#9313; Public WooCommerce API</strong></th></tr>
                        <tr><th>Public WC API Base URL</th><td><input name="wc_api_url" id="pa_f_wca" type="url" class="regular-text" placeholder="https://example.com" /></td></tr>
                        <tr><th colspan="2"><strong>&#9314; Web Crawl Login</strong> <small style="font-weight:normal">(only if site requires login)</small></th></tr>
                        <tr><th>Login Email</th><td><input name="login_email" id="pa_f_le" type="email" class="regular-text" placeholder="user@example.com" /></td></tr>
                        <tr><th>Login Password</th><td><input name="login_password" id="pa_f_lp" type="password" class="regular-text" /><p class="description">Leave blank to keep existing password.</p></td></tr>
                        <tr><th>Login URL Path</th><td><input name="login_url_path" id="pa_f_lup" class="regular-text" placeholder="/my-account" /></td></tr>
                    </table>
                    <p>
                        <button type="submit" class="button button-primary" id="pa-save-btn">Create Vendor</button>
                        <button type="button" class="button" id="pa-cancel-btn" style="display:none;margin-left:8px">Cancel Edit</button>
                    </p>
                </form>
            </div>

            <!-- ── Vendors list (JS-rendered) ──────────────────────────────── -->
            <h2>Current Vendors <span style="font-size:13px;font-weight:normal;color:#666">(click a row to edit)</span></h2>
            <table class="widefat striped">
                <thead><tr><th>ID</th><th>Name</th><th>Country</th><th>Coupon</th><th>Payment Methods</th><th>Base URL</th><th>Enabled</th><th>Actions</th></tr></thead>
                <tbody id="pa-vendors-tbody"></tbody>
            </table>
            <div id="pa-vendors-pagination" class="tablenav bottom" style="margin-top:8px"></div>
        </div>

        <script>
        (function(){
            var PA_VENDORS = <?php echo wp_json_encode(array_values($vendors)); ?>;
            var PA_SCRAPE  = <?php echo wp_json_encode($scrape_configs); ?>;
            var PA_API_BASE = <?php echo wp_json_encode($this->api->base_url()); ?>;
            var PA_DELETE_NONCE = '<?php echo wp_create_nonce('pa_vendor_delete_action'); ?>';
            var PA_AFFILIATE_TEMPLATES = <?php echo wp_json_encode((object) get_option('pa_affiliate_templates', array())); ?>;
            var PA_WP_REST = '<?php echo esc_js(rest_url('pa/v1/')); ?>';
            var PA_WP_NONCE = '<?php echo wp_create_nonce('wp_rest'); ?>';
            var PM_ICONS = <?php echo wp_json_encode(array_map(function($svg) {
                return str_replace('class="pa-pm-icon"', 'class="pa-pm-cell-icon"', $svg);
            }, $pm_options)); ?>;
            var PER_PAGE = 20;
            var currentPage = 1;

            function esc(str) {
                var d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }

            // PM checkbox toggle
            document.querySelectorAll('.pa-pm-item input[type=checkbox]').forEach(function(cb){
                cb.addEventListener('change', function(){
                    this.closest('.pa-pm-item').classList.toggle('pa-pm-on', this.checked);
                });
            });

            function setVal(id, val) {
                var el = document.getElementById(id);
                if (el) el.value = val || '';
            }
            function setCheck(id, val) {
                var el = document.getElementById(id);
                if (el) el.checked = !!val;
            }
            function setPM(selected) {
                selected = selected || [];
                document.querySelectorAll('.pa-pm-item input[type=checkbox]').forEach(function(cb){
                    var on = selected.indexOf(cb.value) !== -1;
                    cb.checked = on;
                    cb.closest('.pa-pm-item').classList.toggle('pa-pm-on', on);
                });
            }

            // ── Table rendering ─────────────────────────────────────────────
            function renderTable() {
                var totalItems = PA_VENDORS.length;
                var totalPages = Math.max(1, Math.ceil(totalItems / PER_PAGE));
                if (currentPage > totalPages) currentPage = totalPages;
                var start = (currentPage - 1) * PER_PAGE;
                var paged = PA_VENDORS.slice(start, start + PER_PAGE);

                var tbody = document.getElementById('pa-vendors-tbody');
                if (!paged.length) {
                    tbody.innerHTML = '<tr><td colspan="8">No vendors yet.</td></tr>';
                } else {
                    var html = '';
                    paged.forEach(function(v) {
                        var vid = v.id || 0;
                        // Payment methods
                        var pmList = Array.isArray(v.payment_methods) ? v.payment_methods : [];
                        var pmHtml = '';
                        if (!pmList.length) {
                            pmHtml = '<em style="color:#999">&mdash;</em>';
                        } else {
                            pmList.forEach(function(pm) {
                                var icon = PM_ICONS[pm];
                                if (icon) {
                                    pmHtml += icon.replace('class="pa-pm-cell-icon"', 'class="pa-pm-cell-icon" title="' + esc(pm) + '"');
                                } else {
                                    pmHtml += '<span style="font-size:11px;margin-right:3px">' + esc(pm) + '</span>';
                                }
                            });
                        }
                        // Logo + name
                        var nameHtml = '';
                        if (v.logo_url) {
                            nameHtml += '<img src="' + esc(v.logo_url) + '" alt="" style="height:18px;vertical-align:middle;margin-right:5px;" />';
                        }
                        nameHtml += esc(v.name || '');

                        html += '<tr class="pa-vendor-row" data-vid="' + vid + '">'
                            + '<td>' + esc(String(vid)) + '</td>'
                            + '<td>' + nameHtml + '</td>'
                            + '<td>' + esc(v.country || '') + '</td>'
                            + '<td>' + esc(v.coupon_code || '') + '</td>'
                            + '<td>' + pmHtml + '</td>'
                            + '<td><a href="' + esc(v.base_url || '') + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">' + esc(v.base_url || '') + '</a></td>'
                            + '<td>' + (v.enabled ? '<span style="color:green">&#10003;</span>' : '<span style="color:#999">&#10005;</span>') + '</td>'
                            + '<td onclick="event.stopPropagation()">'
                            +   '<button type="button" class="button button-small pa-edit-btn" data-vid="' + vid + '">Edit</button> '
                            +   '<button type="button" class="button button-small pa-delete-btn" data-vid="' + vid + '" data-vname="' + esc(v.name || '') + '" style="color:#b32d2e;border-color:#b32d2e">Delete</button>'
                            + '</td>'
                            + '</tr>';
                    });
                    tbody.innerHTML = html;
                }

                // Pagination
                var pagDiv = document.getElementById('pa-vendors-pagination');
                if (totalPages > 1) {
                    var ph = '<div class="tablenav-pages"><span class="displaying-num">' + totalItems + ' vendors</span> <span class="pagination-links">';
                    if (currentPage > 1) {
                        ph += '<a class="first-page button pa-vpage-btn" data-page="1">&#171;</a> ';
                        ph += '<a class="prev-page button pa-vpage-btn" data-page="' + (currentPage - 1) + '">&#8249;</a> ';
                    }
                    ph += '<span class="paging-input">' + currentPage + ' / ' + totalPages + '</span>';
                    if (currentPage < totalPages) {
                        ph += ' <a class="next-page button pa-vpage-btn" data-page="' + (currentPage + 1) + '">&#8250;</a>';
                        ph += ' <a class="last-page button pa-vpage-btn" data-page="' + totalPages + '">&#187;</a>';
                    }
                    ph += '</span></div>';
                    pagDiv.innerHTML = ph;
                    pagDiv.style.display = '';
                } else {
                    pagDiv.innerHTML = '';
                    pagDiv.style.display = 'none';
                }

                bindTableEvents();
            }

            function bindTableEvents() {
                // Row click
                document.querySelectorAll('.pa-vendor-row').forEach(function(row) {
                    row.addEventListener('click', function() { loadVendor(this.dataset.vid); });
                });
                // Edit button
                document.querySelectorAll('.pa-edit-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) { e.stopPropagation(); loadVendor(this.dataset.vid); });
                });
                // Delete button (AJAX)
                document.querySelectorAll('.pa-delete-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var vid = this.dataset.vid;
                        var vname = this.dataset.vname;
                        if (!confirm('Delete vendor "' + vname + '" and ALL its products? This cannot be undone.')) return;
                        var xhr = new XMLHttpRequest();
                        xhr.open('POST', ajaxurl);
                        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                        xhr.onload = function() {
                            try {
                                var r = JSON.parse(xhr.responseText);
                                if (r.success) {
                                    PA_VENDORS = PA_VENDORS.filter(function(v) { return v.id != vid; });
                                    delete PA_SCRAPE[vid];
                                    renderTable();
                                    if (document.getElementById('pa_vendor_id').value == vid) resetForm();
                                    showNotice('success', 'Vendor deleted.');
                                } else {
                                    showNotice('error', 'Delete failed: ' + (r.data || 'unknown error'));
                                }
                            } catch(ex) { showNotice('error', 'Error deleting vendor'); }
                        };
                        xhr.send('action=pa_delete_vendor&vid=' + vid + '&_wpnonce=' + PA_DELETE_NONCE);
                    });
                });
                // Pagination
                document.querySelectorAll('.pa-vpage-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        currentPage = parseInt(this.dataset.page) || 1;
                        renderTable();
                    });
                });
            }

            // ── Load vendor into form ───────────────────────────────────────
            function loadVendor(vid) {
                var v = null;
                for (var i = 0; i < PA_VENDORS.length; i++) {
                    if (PA_VENDORS[i].id == vid) { v = PA_VENDORS[i]; break; }
                }
                if (!v) return;
                var sc = PA_SCRAPE[vid] || {};

                document.getElementById('pa_vendor_id').value = vid;
                document.getElementById('pa-form-title').childNodes[0].textContent = 'Edit Vendor: ' + v.name + ' ';
                document.getElementById('pa-mode-badge').textContent = 'Edit';
                document.getElementById('pa-mode-badge').className = 'pa-form-mode-badge pa-mode-edit';
                document.getElementById('pa-save-btn').textContent = 'Save Changes';
                document.getElementById('pa-cancel-btn').style.display = '';

                setVal('pa_f_name', v.name);
                setVal('pa_f_base_url', v.base_url);
                setCheck('pa_f_enabled', v.enabled);
                setVal('pa_f_logo_url', v.logo_url);
                setVal('pa_f_country', v.country);
                setVal('pa_f_coupon_code', v.coupon_code);
                setVal('pa_f_affiliate', PA_AFFILIATE_TEMPLATES[v.name.toLowerCase()] || '');
                setPM(v.payment_methods);
                document.getElementById('pa_f_target_urls').value = '';
                document.getElementById('pa_f_target_urls').placeholder = 'Add new target URLs (one per line). Existing URLs are kept.';
                setVal('pa_f_pls', sc.product_link_selector);
                setVal('pa_f_plp', sc.product_link_pattern);
                setVal('pa_f_ps',  sc.price_selector);
                setVal('pa_f_pa',  sc.price_attr);
                setVal('pa_f_ns',  sc.name_selector);
                setVal('pa_f_ds',  sc.dosage_selector);
                setVal('pa_f_da',  sc.dosage_attribute);
                setVal('pa_f_pcs', sc.popup_close_selector);
                document.getElementById('pa_f_mdu').value = sc.max_discovered_urls || 120;
                document.getElementById('pa_f_mdp').value = sc.max_discovery_pages || 8;
                setVal('pa_f_wck', v.wc_consumer_key);
                setVal('pa_f_wcs', v.wc_consumer_secret);
                setVal('pa_f_wca', v.wc_api_url);
                setVal('pa_f_le', v.login_email);
                setVal('pa_f_lp', ''); // encrypted — leave blank to keep existing
                setVal('pa_f_lup', v.login_url_path);

                document.getElementById('pa-vendor-form-wrap').scrollIntoView({behavior:'smooth', block:'start'});
            }

            function resetForm() {
                document.getElementById('pa_vendor_id').value = '0';
                document.getElementById('pa-form-title').childNodes[0].textContent = 'Add Vendor ';
                document.getElementById('pa-mode-badge').textContent = 'New';
                document.getElementById('pa-mode-badge').className = 'pa-form-mode-badge pa-mode-create';
                document.getElementById('pa-save-btn').textContent = 'Create Vendor';
                document.getElementById('pa-cancel-btn').style.display = 'none';
                document.getElementById('pa-vendor-form').reset();
                setPM([]);
                document.getElementById('pa_f_mdu').value = '120';
                document.getElementById('pa_f_mdp').value = '8';
                document.getElementById('pa_f_enabled').checked = true;
                document.getElementById('pa_f_target_urls').placeholder = 'One URL per line';
            }

            document.getElementById('pa-cancel-btn').addEventListener('click', resetForm);

            // ── AJAX form submit (create / update) ──────────────────────────
            document.getElementById('pa-vendor-form').addEventListener('submit', function(e) {
                e.preventDefault();
                var vendorId = parseInt(document.getElementById('pa_vendor_id').value) || 0;
                var name = document.getElementById('pa_f_name').value.trim();
                var baseUrl = document.getElementById('pa_f_base_url').value.trim();
                if (!name) { alert('Vendor name is required.'); return; }
                if (!baseUrl) { alert('Base URL is required.'); return; }

                var enabled = document.getElementById('pa_f_enabled').checked;
                var logoUrl = document.getElementById('pa_f_logo_url').value.trim();
                var country = document.getElementById('pa_f_country').value.trim().toUpperCase();
                var couponCode = document.getElementById('pa_f_coupon_code').value.trim();
                var affiliate = document.getElementById('pa_f_affiliate').value.trim();
                var paymentMethods = [];
                document.querySelectorAll('.pa-pm-item input[type=checkbox]:checked').forEach(function(cb) {
                    paymentMethods.push(cb.value);
                });

                var targetUrlsRaw = document.getElementById('pa_f_target_urls').value.trim();
                var targetUrls = targetUrlsRaw ? targetUrlsRaw.split(/\r\n|\r|\n/).map(function(u) { return u.trim(); }).filter(Boolean) : [];

                var sc = {
                    product_link_selector: document.getElementById('pa_f_pls').value.trim(),
                    product_link_pattern:  document.getElementById('pa_f_plp').value.trim(),
                    price_selector:        document.getElementById('pa_f_ps').value.trim(),
                    price_attr:            document.getElementById('pa_f_pa').value.trim(),
                    name_selector:         document.getElementById('pa_f_ns').value.trim(),
                    dosage_selector:       document.getElementById('pa_f_ds').value.trim(),
                    dosage_attribute:      document.getElementById('pa_f_da').value.trim(),
                    popup_close_selector:  document.getElementById('pa_f_pcs').value.trim(),
                    max_discovered_urls:   parseInt(document.getElementById('pa_f_mdu').value) || 120,
                    max_discovery_pages:   parseInt(document.getElementById('pa_f_mdp').value) || 8
                };

                var wcKey = document.getElementById('pa_f_wck').value.trim();
                var wcSecret = document.getElementById('pa_f_wcs').value;
                var wcApiUrl = document.getElementById('pa_f_wca').value.trim();
                var loginEmail = document.getElementById('pa_f_le').value.trim();
                var loginPassword = document.getElementById('pa_f_lp').value;
                var loginUrlPath = document.getElementById('pa_f_lup').value.trim();

                var btn = document.getElementById('pa-save-btn');
                btn.disabled = true;
                btn.textContent = 'Saving...';

                if (vendorId === 0) {
                    // ── CREATE ────────────────────────────────────────────────
                    var auth = {};
                    if (wcKey) auth.wc_consumer_key = wcKey;
                    if (wcSecret) auth.wc_consumer_secret = wcSecret;
                    if (wcApiUrl) auth.wc_api_url = wcApiUrl;
                    if (loginEmail) auth.login_email = loginEmail;
                    if (loginPassword) auth.login_password = loginPassword;
                    if (loginUrlPath) auth.login_url_path = loginUrlPath;

                    var payload = {
                        name: name,
                        base_url: baseUrl,
                        enabled: enabled,
                        target_urls: targetUrls,
                        logo_url: logoUrl || null,
                        country: country || null,
                        coupon_code: couponCode || null,
                        payment_methods: paymentMethods.length ? paymentMethods : null,
                        scrape_config: sc,
                        auth: Object.keys(auth).length ? auth : {}
                    };
                    apiCall('POST', '/api/admin/vendors', payload, function(ok, data) {
                        btn.disabled = false;
                        btn.textContent = 'Create Vendor';
                        if (ok) {
                            saveAffiliateTemplate(name, affiliate);
                            var newVid = data && data.vendor_id ? data.vendor_id : null;
                            var notice = data && data.crawl_error
                                ? 'Vendor created, but crawl could not be queued (Redis error: ' + data.crawl_error + '). Click "Crawl Now" once Redis is available.'
                                : 'Vendor created. Crawl queued.';
                            var noticeType = data && data.crawl_error ? 'error' : 'success';
                            reloadVendors(function() {
                                resetForm();
                                showNotice(noticeType, notice);
                            }, newVid);
                        } else {
                            showNotice('error', 'Create failed: ' + (data || 'unknown error'));
                        }
                    });
                } else {
                    // ── UPDATE (multiple API calls) ──────────────────────────
                    var errors = [];
                    var pending = 3; // basic + meta + scrape config

                    // Save affiliate template to WP options (fire-and-forget).
                    saveAffiliateTemplate(name, affiliate);

                    function checkDone() {
                        pending--;
                        if (pending > 0) return;
                        btn.disabled = false;
                        btn.textContent = 'Save Changes';
                        if (errors.length) {
                            showNotice('error', errors.join(' | '));
                        } else {
                            reloadVendors(function() {
                                loadVendor(vendorId);
                                showNotice('success', 'Vendor updated.');
                            }, vendorId);
                        }
                    }

                    // 1. Basic
                    apiCall('PATCH', '/api/admin/vendors/' + vendorId, {name: name, base_url: baseUrl, enabled: enabled}, function(ok, data) {
                        if (!ok) errors.push('Basic: ' + data);
                        checkDone();
                    });

                    // 2. Meta
                    apiCall('PATCH', '/api/admin/vendors/' + vendorId + '/meta', {
                        logo_url: logoUrl || null,
                        country: country || null,
                        coupon_code: couponCode || null,
                        payment_methods: paymentMethods.length ? paymentMethods : null
                    }, function(ok, data) {
                        if (!ok) errors.push('Meta: ' + data);
                        checkDone();
                    });

                    // 3. Scrape config
                    apiCall('PATCH', '/api/admin/vendors/' + vendorId + '/scrape-config', sc, function(ok, data) {
                        if (!ok) errors.push('Scrape config: ' + data);
                        checkDone();
                    });

                    // 4. Auth (only if any credential field has a value)
                    var authParams = [];
                    if (loginEmail) authParams.push('login_email=' + encodeURIComponent(loginEmail));
                    if (loginUrlPath) authParams.push('login_url_path=' + encodeURIComponent(loginUrlPath));
                    if (wcKey) authParams.push('wc_consumer_key=' + encodeURIComponent(wcKey));
                    if (wcApiUrl) authParams.push('wc_api_url=' + encodeURIComponent(wcApiUrl));
                    if (loginPassword) authParams.push('login_password=' + encodeURIComponent(loginPassword));
                    if (wcSecret) authParams.push('wc_consumer_secret=' + encodeURIComponent(wcSecret));
                    if (authParams.length) {
                        pending++;
                        apiCall('POST', '/api/admin/vendors/' + vendorId + '/auth?' + authParams.join('&'), {}, function(ok, data) {
                            if (!ok) errors.push('Auth: ' + data);
                            checkDone();
                        });
                    }

                    // 5. Target URLs
                    if (targetUrls.length) {
                        pending++;
                        apiCall('POST', '/api/admin/vendors/' + vendorId + '/targets/import', {urls: targetUrls, enabled: true, crawl_now: false}, function(ok, data) {
                            if (!ok) errors.push('Target URLs: ' + data);
                            checkDone();
                        });
                    }
                }
            });

            // ── WP affiliate template helper ────────────────────────────────
            function saveAffiliateTemplate(vendorName, tpl) {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', PA_WP_REST + 'affiliate-templates');
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('X-WP-Nonce', PA_WP_NONCE);
                xhr.send(JSON.stringify({vendor: vendorName.toLowerCase(), template: tpl || ''}));
                // Update local cache so subsequent vendor loads reflect the change.
                if (tpl) {
                    PA_AFFILIATE_TEMPLATES[vendorName.toLowerCase()] = tpl;
                } else {
                    delete PA_AFFILIATE_TEMPLATES[vendorName.toLowerCase()];
                }
            }

            // ── API helper ──────────────────────────────────────────────────
            function apiCall(method, path, payload, callback) {
                var xhr = new XMLHttpRequest();
                xhr.open(method, PA_API_BASE + path);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onload = function() {
                    var respData = null;
                    try { respData = JSON.parse(xhr.responseText); } catch(e) {}
                    if (xhr.status >= 200 && xhr.status < 300) {
                        callback(true, respData);
                    } else {
                        var msg = 'HTTP ' + xhr.status;
                        if (respData) msg = respData.detail || respData.error || msg;
                        callback(false, msg);
                    }
                };
                xhr.onerror = function() { callback(false, 'Network error'); };
                xhr.send(payload !== null ? JSON.stringify(payload) : null);
            }

            // ── Reload vendors from API ─────────────────────────────────────
            // vendorId: if provided, only refresh that vendor's scrape config; otherwise skip scrape reload
            function reloadVendors(callback, vendorId) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', PA_API_BASE + '/api/admin/vendors');
                xhr.onload = function() {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (Array.isArray(data)) PA_VENDORS = data;
                    } catch(e) {}
                    if (vendorId) {
                        // Only reload scrape config for the changed vendor
                        var xhr2 = new XMLHttpRequest();
                        xhr2.open('GET', PA_API_BASE + '/api/admin/vendors/' + vendorId + '/scrape-config');
                        xhr2.onload = function() {
                            try {
                                var d = JSON.parse(xhr2.responseText);
                                if (d && d.scrape_config) PA_SCRAPE[vendorId] = d.scrape_config;
                            } catch(e) {}
                            renderTable();
                            if (callback) callback();
                        };
                        xhr2.onerror = function() { renderTable(); if (callback) callback(); };
                        xhr2.send();
                    } else {
                        renderTable();
                        if (callback) callback();
                    }
                };
                xhr.onerror = function() { renderTable(); if (callback) callback(); };
                xhr.send();
            }

            // ── Flash notice ────────────────────────────────────────────────
            function showNotice(type, msg) {
                var existing = document.querySelector('.pa-ajax-notice');
                if (existing) existing.remove();
                var div = document.createElement('div');
                div.className = 'pa-ajax-notice notice notice-' + type + ' is-dismissible';
                div.style.cssText = 'margin:8px 0;padding:8px 12px';
                div.innerHTML = '<p>' + esc(msg) + '</p>';
                var wrap = document.querySelector('.wrap');
                var formWrap = document.getElementById('pa-vendor-form-wrap');
                wrap.insertBefore(div, formWrap);
                setTimeout(function() { if (div.parentNode) div.remove(); }, 5000);
            }

            // ── Initial render ──────────────────────────────────────────────
            renderTable();
        })();
        </script>
        <?php
    }

    public function render_products_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $meta_resp = $this->admin_get('/api/admin/product-meta');
        $meta_data = ($meta_resp['ok'] ?? false) ? ($meta_resp['data'] ?? array()) : array();
        $categories = $meta_data['categories'] ?? array();
        $all_tags   = $meta_data['tags'] ?? array();

        // ── Load data ─────────────────────────────────────────────────────────
        $products_resp = $this->admin_get('/api/admin/products');
        $products = $products_resp['ok'] && is_array($products_resp['data']) ? $products_resp['data'] : array();

        // Apply admin tag overrides — stored in WordPress so they survive scraper re-runs
        // that re-assign tags on the backend.
        $tag_overrides = (array) get_option('pa_product_tag_overrides', array());
        $dosage_re_admin = '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i';
        foreach ($products as &$product) {
            $pid  = (string) ($product['id'] ?? '');
            $base = strtolower(trim(preg_replace($dosage_re_admin, '', $product['name'] ?? '')));
            if ($pid !== '' && array_key_exists($pid, $tag_overrides)) {
                $product['tags'] = $tag_overrides[$pid];
            } elseif ($base !== '' && array_key_exists($base, $tag_overrides)) {
                if (preg_match($dosage_re_admin, $product['name'] ?? '')) {
                    $product['tags'] = $tag_overrides[$base];
                }
            }
        }
        unset($product);

        $vendors_resp = $this->admin_get('/api/admin/vendors');
        $vendors = $vendors_resp['ok'] && is_array($vendors_resp['data']) ? $vendors_resp['data'] : array();

        // All data passed to JS for client-side filtering/pagination
        ?>
        <div class="wrap">
            <h1>Products</h1>

            <style>
            #pa-product-form-wrap{background:#fff;border:1px solid #c3c4c7;border-radius:4px;padding:20px 24px;margin-bottom:20px}
            #pa-product-form-wrap h2{margin-top:0}
            .pa-prod-mode-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-left:8px;vertical-align:middle}
            .pa-mode-create{background:#e6f4ea;color:#1a7f37}
            .pa-mode-edit{background:#fff3cd;color:#856404}
            .pa-product-row{cursor:pointer}
            .pa-product-row:hover td{background:#f0f6fc !important}
            </style>

            <!-- ── Unified product form ──────────────────────────────────────── -->
            <div id="pa-product-form-wrap">
                <h2 id="pa-prod-form-title">
                    Add Product
                    <span class="pa-prod-mode-badge pa-mode-create" id="pa-prod-mode-badge">New</span>
                </h2>
                <form id="pa-product-form">
                    <input type="hidden" name="product_id" id="pa_prod_id" value="0" />
                    <input type="hidden" name="listing_id" id="pa_listing_id" value="0" />
                    <table class="form-table">
                        <tr><th colspan="2" style="padding-bottom:4px"><strong>Product Info</strong></th></tr>
                        <tr><th>Name <span style="color:red">*</span></th><td><input name="product_name" id="pa_pf_name" class="regular-text" required /></td></tr>
                        <tr>
                            <th>Category</th>
                            <td>
                                <input name="category" id="pa_pf_category" class="regular-text" list="pa_category_list" placeholder="Type or select category" autocomplete="off" />
                                <datalist id="pa_category_list">
                                    <?php foreach ($categories as $cat) : ?>
                                        <option value="<?php echo esc_attr($cat); ?>"></option>
                                    <?php endforeach; ?>
                                </datalist>
                            </td>
                        </tr>
                        <tr>
                            <th>Tags</th>
                            <td>
                                <div id="pa_pf_tags_list" style="margin-bottom:6px"></div>
                                <div style="display:flex;gap:6px;align-items:center">
                                    <input id="pa_pf_tag_input" class="regular-text" list="pa_tag_list" placeholder="Type or select tag" autocomplete="off" />
                                    <button type="button" class="button button-small" id="pa_pf_tag_add">Add</button>
                                </div>
                                <datalist id="pa_tag_list">
                                    <?php foreach ($all_tags as $tag) : ?>
                                        <option value="<?php echo esc_attr($tag); ?>"></option>
                                    <?php endforeach; ?>
                                </datalist>
                                <input type="hidden" name="tags" id="pa_pf_tags_hidden" value="" />
                            </td>
                        </tr>
                        <tr><th>Description</th><td><textarea name="description" id="pa_pf_desc" rows="3" class="large-text"></textarea></td></tr>

                        <tr><th colspan="2" style="padding-top:16px;padding-bottom:4px"><hr/><strong>Pricing &amp; Availability</strong></th></tr>
                        <tr>
                            <th>Vendor <span style="color:red" id="pa_pf_vendor_req">*</span></th>
                            <td>
                                <select name="vendor_id" id="pa_pf_vendor">
                                    <option value="0">-- Select vendor --</option>
                                    <?php foreach ($vendors as $v) : ?>
                                        <option value="<?php echo esc_attr($v['id']); ?>"><?php echo esc_html($v['name']); ?></option>
                                    <?php endforeach; ?>
                                </select>
                                <p class="description" id="pa_pf_vendor_hint">Required for new products.</p>
                            </td>
                        </tr>
                        <tr>
                            <th>Price</th>
                            <td>
                                <input name="price" id="pa_pf_price" type="number" step="0.01" min="0" style="width:100px" />
                                <select name="currency" id="pa_pf_currency" style="margin-left:6px">
                                    <option value="USD">USD</option>
                                    <option value="EUR">EUR</option>
                                    <option value="GBP">GBP</option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th>Dosage</th>
                            <td>
                                <input name="amount_mg" id="pa_pf_amount_mg" type="number" step="0.001" min="0" style="width:100px" placeholder="e.g. 5" />
                                <select name="amount_unit" id="pa_pf_amount_unit" style="margin-left:4px">
                                    <?php foreach (array('mg','mcg','g','IU','mL') as $u) : ?>
                                        <option value="<?php echo $u; ?>"><?php echo $u; ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th>Dose Labels</th>
                            <td>
                                <p class="description" style="margin:0 0 8px 0">Override how each dose is shown on the front end. Leave blank to use the original value.</p>
                                <div id="pa_dose_labels_list" style="margin-bottom:8px"></div>
                                <button type="button" class="button button-small" id="pa_dose_labels_save" style="display:none">Save Dose Labels</button>
                            </td>
                        </tr>
                        <tr><th>In Stock</th><td><label><input type="checkbox" name="in_stock" id="pa_pf_in_stock" checked /> In Stock</label></td></tr>
                        <tr><th>Product URL</th><td><input name="product_url" id="pa_pf_url" type="url" class="regular-text" placeholder="https://vendor.com/product-page" /><p class="description">Used as the "Buy" link on the dashboard.</p></td></tr>
                    </table>
                    <p>
                        <button type="submit" class="button button-primary" id="pa-prod-save-btn">Create Product</button>
                        <button type="button" class="button" id="pa-prod-cancel-btn" style="display:none;margin-left:8px">Cancel Edit</button>
                    </p>
                </form>
            </div>

            <!-- ── Search & Filter (JS-driven) ─────────────────────────────── -->
            <div id="pa-filter-bar" style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
                <input type="search" id="pa-search-input" placeholder="Search by name or category..." class="regular-text" />
                <select id="pa-vendor-filter" style="min-width:160px">
                    <option value="0">All Vendors</option>
                    <?php foreach ($vendors as $v) : ?>
                        <option value="<?php echo esc_attr($v['id']); ?>"><?php echo esc_html($v['name']); ?></option>
                    <?php endforeach; ?>
                </select>
                <button type="button" class="button" id="pa-filter-btn">Filter</button>
                <button type="button" class="button" id="pa-kit-filter-btn" title="Show only products tagged as kits">Kits Only</button>
                <button type="button" class="button" id="pa-clear-btn" style="display:none">Clear</button>
                <span id="pa-product-count" style="color:#666;font-size:13px"></span>
            </div>

            <!-- ── Products list (JS-rendered) ─────────────────────────────── -->
            <h2>Products <span style="font-size:13px;font-weight:normal;color:#666">(click a row to edit)</span></h2>
            <table class="widefat striped">
                <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Price</th><th>Dosage</th><th>In Stock</th><th>Status</th><th>Visible</th><th>Actions</th></tr></thead>
                <tbody id="pa-products-tbody"></tbody>
            </table>
            <div id="pa-pagination" class="tablenav bottom" style="margin-top:8px"></div>
        </div>

        <script>
        (function(){
            var PA_PRODUCTS = <?php echo wp_json_encode(array_values($products)); ?>;
            var PA_VENDORS = <?php echo wp_json_encode(array_values($vendors)); ?>;
            var PA_NONCE = '<?php echo wp_create_nonce('pa_toggle_status'); ?>';
            var PA_DELETE_NONCE = '<?php echo wp_create_nonce('pa_product_delete_action'); ?>';
            var PA_DOSE_LABELS_NONCE = '<?php echo wp_create_nonce('pa_dose_labels_action'); ?>';
            var PA_API_BASE = <?php echo wp_json_encode($this->api->base_url()); ?>;
            var PA_DOSE_LABELS = <?php echo wp_json_encode((array) get_option('pa_dose_labels', array())); ?>;
            var PA_TAG_OVERRIDES = <?php echo wp_json_encode($tag_overrides); ?>;
            var PA_TAGS_NONCE = '<?php echo wp_create_nonce('pa_save_product_tags'); ?>';
            var PER_PAGE = 25;
            var currentPage = 1;
            var currentSearch = '';
            var currentVendor = 0;
            var currentKitFilter = false;
            var currentDoseLabelProductName = '';
            var currentDoseLabels = {};
            // Must match the DOSAGE_RE in dashboard.js so admin keys align with frontend keys
            var ADMIN_DOSAGE_RE = /\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?)$/i;
            function stripDosageSuffix(name) {
                var m = (name || '').match(ADMIN_DOSAGE_RE);
                return m ? name.slice(0, name.length - m[0].length).trim() : name;
            }

            function esc(str) {
                var d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }

            function setVal(id, val) {
                var el = document.getElementById(id);
                if (el) el.value = val !== null && val !== undefined ? val : '';
            }
            function setCheck(id, val) {
                var el = document.getElementById(id);
                if (el) el.checked = !!val;
            }
            function setSelect(id, val) {
                var el = document.getElementById(id);
                if (!el || val === null || val === undefined) return;
                for (var i = 0; i < el.options.length; i++) {
                    if (el.options[i].value == val) { el.selectedIndex = i; return; }
                }
            }

            // ── Filtering & rendering ───────────────────────────────────────
            function getFiltered() {
                var list = PA_PRODUCTS;
                if (currentSearch) {
                    var q = currentSearch.toLowerCase();
                    list = list.filter(function(p) {
                        return (p.name || '').toLowerCase().indexOf(q) !== -1
                            || (p.category || '').toLowerCase().indexOf(q) !== -1;
                    });
                }
                if (currentVendor) {
                    list = list.filter(function(p) {
                        return (p.vendor_ids || []).map(Number).indexOf(currentVendor) !== -1;
                    });
                }
                if (currentKitFilter) {
                    list = list.filter(function(p) {
                        var tags = (p.tags || []).map(function(t) { return t.toLowerCase(); });
                        return tags.indexOf('kit') !== -1 || tags.indexOf('kits') !== -1 || tags.indexOf('kit_auto') !== -1;
                    });
                }
                return list;
            }

            function renderTable() {
                var filtered = getFiltered();
                var totalItems = filtered.length;
                var totalPages = Math.max(1, Math.ceil(totalItems / PER_PAGE));
                if (currentPage > totalPages) currentPage = totalPages;
                var start = (currentPage - 1) * PER_PAGE;
                var paged = filtered.slice(start, start + PER_PAGE);

                // Count
                document.getElementById('pa-product-count').textContent = totalItems + ' product(s)';

                // Clear button visibility
                document.getElementById('pa-clear-btn').style.display = (currentSearch || currentVendor || currentKitFilter) ? '' : 'none';

                // Tbody
                var tbody = document.getElementById('pa-products-tbody');
                if (!paged.length) {
                    tbody.innerHTML = '<tr><td colspan="9">' + ((currentSearch || currentVendor || currentKitFilter) ? 'No products match your filter.' : 'No products yet.') + '</td></tr>';
                } else {
                    var html = '';
                    paged.forEach(function(p) {
                        var pid = p.id || 0;
                        // Price
                        var priceHtml = '--';
                        if (p.price_min !== null && p.price_min !== undefined) {
                            if (p.price_max !== null && p.price_max !== undefined && p.price_max != p.price_min) {
                                priceHtml = '$' + Number(p.price_min).toFixed(2) + ' &ndash; $' + Number(p.price_max).toFixed(2);
                            } else {
                                priceHtml = '$' + Number(p.price_min).toFixed(2);
                            }
                        }
                        // Dosage
                        var dosageHtml = (p.dosages && p.dosages.length) ? esc(p.dosages.join(', ')) : '--';
                        // Stock
                        var stockHtml = '<em style="color:#999">--</em>';
                        if (p.in_stock === true) stockHtml = '<span style="color:green">&#10003;</span>';
                        else if (p.in_stock === false) stockHtml = '<span style="color:#c00">&#10005;</span>';
                        // Status
                        var status = p.status || 'unreviewed';
                        var statusHtml;
                        if (status === 'approved') {
                            statusHtml = '<span class="pa-status-toggle" data-pid="'+pid+'" data-status="approved" style="color:green;font-weight:bold;cursor:pointer" title="Click to mark as unreviewed">&#10003; Approved</span>';
                        } else {
                            statusHtml = '<span class="pa-status-toggle" data-pid="'+pid+'" data-status="unreviewed" style="color:#e67e22;font-weight:bold;cursor:pointer" title="Click to approve">&#9679; Unreviewed</span>';
                        }

                        var isVisible = (p.is_visible !== false);
                        var visHtml = isVisible
                            ? '<span class="pa-vis-toggle" data-pid="'+pid+'" data-vis="1" style="color:green;cursor:pointer;font-weight:bold" title="Click to hide">&#9679; On</span>'
                            : '<span class="pa-vis-toggle" data-pid="'+pid+'" data-vis="0" style="color:#999;cursor:pointer;font-weight:bold" title="Click to show">&#9675; Off</span>';

                        html += '<tr class="pa-product-row" data-pid="'+pid+'">'
                            + '<td>'+esc(String(pid))+'</td>'
                            + '<td><strong>'+esc(p.name || '')+'</strong>'+(p.original_name && p.original_name !== p.name ? '<br><small style="color:#888;font-weight:normal">'+esc(p.original_name)+'</small>' : '')+'</td>'
                            + '<td>'+esc(p.category || '--')+'</td>'
                            + '<td>'+priceHtml+'</td>'
                            + '<td>'+dosageHtml+'</td>'
                            + '<td>'+stockHtml+'</td>'
                            + '<td onclick="event.stopPropagation()">'+statusHtml+'</td>'
                            + '<td onclick="event.stopPropagation()">'+visHtml+'</td>'
                            + '<td onclick="event.stopPropagation()">'
                            +   '<button type="button" class="button button-small pa-prod-edit-btn" data-pid="'+pid+'">Edit</button> '
                            +   '<button type="button" class="button button-small pa-prod-delete-btn" data-pid="'+pid+'" style="color:#b32d2e;border-color:#b32d2e">Delete</button>'
                            + '</td>'
                            + '</tr>';
                    });
                    tbody.innerHTML = html;
                }

                // Pagination
                var pagDiv = document.getElementById('pa-pagination');
                if (totalPages > 1) {
                    var ph = '<div class="tablenav-pages"><span class="displaying-num">' + totalItems + ' items</span> <span class="pagination-links">';
                    if (currentPage > 1) {
                        ph += '<a class="first-page button pa-page-btn" data-page="1">&#171;</a> ';
                        ph += '<a class="prev-page button pa-page-btn" data-page="'+(currentPage-1)+'">&#8249;</a> ';
                    }
                    ph += '<span class="paging-input">' + currentPage + ' / ' + totalPages + '</span>';
                    if (currentPage < totalPages) {
                        ph += ' <a class="next-page button pa-page-btn" data-page="'+(currentPage+1)+'">&#8250;</a>';
                        ph += ' <a class="last-page button pa-page-btn" data-page="'+totalPages+'">&#187;</a>';
                    }
                    ph += '</span></div>';
                    pagDiv.innerHTML = ph;
                    pagDiv.style.display = '';
                } else {
                    pagDiv.innerHTML = '';
                    pagDiv.style.display = 'none';
                }

                bindTableEvents();
            }

            function bindTableEvents() {
                // Row click → edit
                document.querySelectorAll('.pa-product-row').forEach(function(row) {
                    row.addEventListener('click', function() { loadProduct(this.dataset.pid); });
                });
                // Edit button
                document.querySelectorAll('.pa-prod-edit-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) { e.stopPropagation(); loadProduct(this.dataset.pid); });
                });
                // Delete button (AJAX)
                document.querySelectorAll('.pa-prod-delete-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var pid = this.dataset.pid;
                        if (!confirm('Delete product and ALL its data? This cannot be undone.')) return;
                        var xhr = new XMLHttpRequest();
                        xhr.open('POST', ajaxurl);
                        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                        xhr.onload = function() {
                            try {
                                var r = JSON.parse(xhr.responseText);
                                if (r.success) {
                                    PA_PRODUCTS = PA_PRODUCTS.filter(function(p) { return p.id != pid; });
                                    renderTable();
                                    // If editing this product, reset form
                                    if (document.getElementById('pa_prod_id').value == pid) resetForm();
                                } else {
                                    alert('Delete failed: ' + (r.data || 'unknown error'));
                                }
                            } catch(ex) { alert('Error deleting product'); }
                        };
                        xhr.send('action=pa_delete_product&pid=' + pid + '&_wpnonce=' + PA_DELETE_NONCE);
                    });
                });
                // Status toggle
                document.querySelectorAll('.pa-status-toggle').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var pid = this.dataset.pid;
                        var cur = this.dataset.status;
                        var next = (cur === 'approved') ? 'unreviewed' : 'approved';
                        var span = this;
                        span.style.opacity = '0.5';
                        var xhr = new XMLHttpRequest();
                        xhr.open('POST', ajaxurl);
                        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                        xhr.onload = function() {
                            try {
                                var r = JSON.parse(xhr.responseText);
                                if (r.success) {
                                    span.dataset.status = next;
                                    if (next === 'approved') {
                                        span.innerHTML = '&#10003; Approved';
                                        span.style.color = 'green';
                                        span.title = 'Click to mark as unreviewed';
                                    } else {
                                        span.innerHTML = '&#9679; Unreviewed';
                                        span.style.color = '#e67e22';
                                        span.title = 'Click to approve';
                                    }
                                    for (var i = 0; i < PA_PRODUCTS.length; i++) {
                                        if (PA_PRODUCTS[i].id == pid) { PA_PRODUCTS[i].status = next; break; }
                                    }
                                } else { alert('Failed to update status'); }
                            } catch(e) { alert('Error updating status'); }
                            span.style.opacity = '1';
                        };
                        xhr.send('action=pa_toggle_product_status&pid=' + pid + '&status=' + next + '&_wpnonce=' + PA_NONCE);
                    });
                });
                // Visibility toggle
                document.querySelectorAll('.pa-vis-toggle').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var pid = this.dataset.pid;
                        var curVis = this.dataset.vis === '1';
                        var nextVis = !curVis;
                        var span = this;
                        span.style.opacity = '0.5';
                        var xhr = new XMLHttpRequest();
                        xhr.open('PATCH', PA_API_BASE + '/api/admin/products/' + pid);
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        xhr.onload = function() {
                            try {
                                var r = JSON.parse(xhr.responseText);
                                if (r.ok) {
                                    span.dataset.vis = nextVis ? '1' : '0';
                                    if (nextVis) {
                                        span.innerHTML = '&#9679; On';
                                        span.style.color = 'green';
                                        span.title = 'Click to hide';
                                    } else {
                                        span.innerHTML = '&#9675; Off';
                                        span.style.color = '#999';
                                        span.title = 'Click to show';
                                    }
                                    for (var i = 0; i < PA_PRODUCTS.length; i++) {
                                        if (PA_PRODUCTS[i].id == pid) { PA_PRODUCTS[i].is_visible = nextVis; break; }
                                    }
                                } else { alert('Failed to update visibility'); }
                            } catch(e) { alert('Error updating visibility'); }
                            span.style.opacity = '1';
                        };
                        xhr.send(JSON.stringify({is_visible: nextVis}));
                    });
                });
                // Pagination
                document.querySelectorAll('.pa-page-btn').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        currentPage = parseInt(this.dataset.page) || 1;
                        renderTable();
                    });
                });
            }

            // ── Filter controls ─────────────────────────────────────────────
            document.getElementById('pa-filter-btn').addEventListener('click', function() {
                currentSearch = document.getElementById('pa-search-input').value.trim();
                currentVendor = parseInt(document.getElementById('pa-vendor-filter').value) || 0;
                currentPage = 1;
                renderTable();
            });
            document.getElementById('pa-kit-filter-btn').addEventListener('click', function() {
                currentKitFilter = !currentKitFilter;
                this.style.background = currentKitFilter ? '#2271b1' : '';
                this.style.color = currentKitFilter ? '#fff' : '';
                this.style.borderColor = currentKitFilter ? '#2271b1' : '';
                currentPage = 1;
                renderTable();
            });
            document.getElementById('pa-clear-btn').addEventListener('click', function() {
                document.getElementById('pa-search-input').value = '';
                document.getElementById('pa-vendor-filter').value = '0';
                currentSearch = '';
                currentVendor = 0;
                currentKitFilter = false;
                var kitBtn = document.getElementById('pa-kit-filter-btn');
                kitBtn.style.background = '';
                kitBtn.style.color = '';
                kitBtn.style.borderColor = '';
                currentPage = 1;
                renderTable();
            });
            // Search on Enter
            document.getElementById('pa-search-input').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('pa-filter-btn').click();
                }
            });

            // ── Tag management ──────────────────────────────────────────────
            var currentTags = [];

            function renderTags(tags) {
                currentTags = tags.slice();
                var list = document.getElementById('pa_pf_tags_list');
                list.innerHTML = '';
                document.getElementById('pa_pf_tags_hidden').value = currentTags.join(', ');
                if (!tags.length) {
                    list.innerHTML = '<em style="color:#999;font-size:12px">No tags</em>';
                    return;
                }
                tags.forEach(function(t) {
                    var tag = document.createElement('span');
                    tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#e8f0fe;border:1px solid #a8c7fa;border-radius:3px;padding:2px 8px;margin:2px 4px 2px 0;font-size:13px';
                    tag.textContent = t;
                    var x = document.createElement('button');
                    x.type = 'button';
                    x.textContent = '\u00d7';
                    x.title = 'Remove tag';
                    x.style.cssText = 'border:none;background:none;cursor:pointer;color:#b32d2e;font-size:15px;padding:0 2px;line-height:1';
                    x.addEventListener('click', function() {
                        currentTags = currentTags.filter(function(v) { return v !== t; });
                        renderTags(currentTags);
                    });
                    tag.appendChild(x);
                    list.appendChild(tag);
                });
            }

            function addTag() {
                var input = document.getElementById('pa_pf_tag_input');
                var val = input.value.trim();
                if (!val) return;
                if (currentTags.indexOf(val) === -1) {
                    currentTags.push(val);
                    renderTags(currentTags);
                }
                input.value = '';
            }

            document.getElementById('pa_pf_tag_add').addEventListener('click', addTag);
            document.getElementById('pa_pf_tag_input').addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            });

            // ── Dose label management ───────────────────────────────────────
            function renderDoseLabelsSection(dosages) {
                var section = document.getElementById('pa_dose_labels_list');
                var saveBtn = document.getElementById('pa_dose_labels_save');
                section.innerHTML = '';
                if (!dosages || !dosages.length) {
                    section.innerHTML = '<em style="color:#999;font-size:12px">No dosages found for this product.</em>';
                    saveBtn.style.display = 'none';
                    return;
                }
                dosages.forEach(function(dose) {
                    // Keys in currentDoseLabels are normalized (lowercase, no spaces).
                    // Try normalized key first so existing labels pre-populate correctly.
                    var normKey = (dose || '').toLowerCase().replace(/\s+/g, '');
                    var customLabel = currentDoseLabels[normKey] || currentDoseLabels[dose] || '';
                    var row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
                    var origSpan = document.createElement('span');
                    origSpan.style.cssText = 'min-width:90px;font-size:13px;color:#444;font-weight:600';
                    origSpan.textContent = dose;
                    var arrow = document.createElement('span');
                    arrow.textContent = '\u2192';
                    arrow.style.color = '#888';
                    var input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'regular-text';
                    input.placeholder = 'Custom label (leave blank to use original)';
                    input.value = customLabel;
                    input.setAttribute('data-dose', dose);
                    input.style.width = '220px';
                    row.appendChild(origSpan);
                    row.appendChild(arrow);
                    row.appendChild(input);
                    section.appendChild(row);
                });
                saveBtn.style.display = '';
            }

            document.getElementById('pa_dose_labels_save').addEventListener('click', function() {
                var inputs = document.querySelectorAll('#pa_dose_labels_list input[data-dose]');
                var labels = {};
                inputs.forEach(function(inp) {
                    var dose = inp.getAttribute('data-dose');
                    // Normalize key: lowercase + no spaces so "5 mg" and "5mg" both resolve
                    var normDose = dose.toLowerCase().replace(/\s+/g, '');
                    var val = inp.value.trim();
                    if (val) labels[normDose] = val;
                });
                var btn = document.getElementById('pa_dose_labels_save');
                btn.disabled = true;
                btn.textContent = 'Saving\u2026';
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ajaxurl);
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                xhr.onload = function() {
                    btn.disabled = false;
                    btn.textContent = 'Save Dose Labels';
                    try {
                        var r = JSON.parse(xhr.responseText);
                        if (r.success) {
                            PA_DOSE_LABELS[currentDoseLabelProductName] = labels;
                            currentDoseLabels = labels;
                            showNotice('success', 'Dose labels saved.');
                        } else {
                            showNotice('error', 'Failed to save: ' + (r.data || 'unknown error'));
                        }
                    } catch(e) { showNotice('error', 'Error saving dose labels'); }
                };
                xhr.onerror = function() {
                    btn.disabled = false;
                    btn.textContent = 'Save Dose Labels';
                    showNotice('error', 'Network error');
                };
                xhr.send('action=pa_save_dose_labels&_wpnonce=' + PA_DOSE_LABELS_NONCE
                    + '&product_name=' + encodeURIComponent(currentDoseLabelProductName)
                    + '&labels=' + encodeURIComponent(JSON.stringify(labels)));
            });

            // ── Load product into form ──────────────────────────────────────
            function loadProduct(pid) {
                var p = null;
                for (var i = 0; i < PA_PRODUCTS.length; i++) {
                    if (PA_PRODUCTS[i].id == pid) { p = PA_PRODUCTS[i]; break; }
                }
                if (!p) return;

                document.getElementById('pa_prod_id').value = pid;
                document.getElementById('pa_listing_id').value = 0;
                document.getElementById('pa-prod-form-title').childNodes[0].textContent = 'Edit Product: ' + p.name + ' ';
                document.getElementById('pa-prod-mode-badge').textContent = 'Edit';
                document.getElementById('pa-prod-mode-badge').className = 'pa-prod-mode-badge pa-mode-edit';
                document.getElementById('pa-prod-save-btn').textContent = 'Save Changes';
                document.getElementById('pa-prod-cancel-btn').style.display = '';
                document.getElementById('pa_pf_vendor_req').style.display = 'none';
                document.getElementById('pa_pf_vendor_hint').textContent = 'Vendor cannot be changed after creation.';
                document.getElementById('pa_pf_vendor').disabled = true;

                setVal('pa_pf_name', p.name);
                setVal('pa_pf_category', p.category);
                renderTags(p.tags || []);
                setVal('pa_pf_desc', p.description);
                setVal('pa_pf_price', p.price_min);
                setSelect('pa_pf_currency', 'USD');

                var dosageMg = null;
                var dosageUnit = 'mg';
                if (p.dosages && p.dosages.length > 0) {
                    var dm = p.dosages[0].match(/^([\d.]+)\s*(.+)$/);
                    if (dm) { dosageMg = parseFloat(dm[1]); dosageUnit = dm[2]; }
                }
                setVal('pa_pf_amount_mg', dosageMg);
                setSelect('pa_pf_amount_unit', dosageUnit);
                setCheck('pa_pf_in_stock', p.in_stock === true);
                setVal('pa_pf_url', p.product_url);

                // ── Dose labels ─────────────────────────────────────────────
                // Strip dosage suffix from product name so the key matches the
                // base-name key that groupByDosage() produces on the frontend.
                currentDoseLabelProductName = stripDosageSuffix(p.name || '').toLowerCase().trim();
                currentDoseLabels = PA_DOSE_LABELS[currentDoseLabelProductName] || {};
                // Collect dosages: prefer explicit dosages array, fall back to
                // available_dosages objects (extract label), then empty.
                var doseLabelList = [];
                if (p.dosages && p.dosages.length) {
                    doseLabelList = p.dosages;
                } else if (p.available_dosages && p.available_dosages.length) {
                    doseLabelList = p.available_dosages.map(function(d) { return d.label || d; });
                }
                renderDoseLabelsSection(doseLabelList);

                document.getElementById('pa-product-form-wrap').scrollIntoView({behavior:'smooth', block:'start'});
            }

            function resetForm() {
                document.getElementById('pa_prod_id').value = '0';
                document.getElementById('pa_listing_id').value = '0';
                document.getElementById('pa-prod-form-title').childNodes[0].textContent = 'Add Product ';
                document.getElementById('pa-prod-mode-badge').textContent = 'New';
                document.getElementById('pa-prod-mode-badge').className = 'pa-prod-mode-badge pa-mode-create';
                document.getElementById('pa-prod-save-btn').textContent = 'Create Product';
                document.getElementById('pa-prod-cancel-btn').style.display = 'none';
                document.getElementById('pa_pf_vendor_req').style.display = '';
                document.getElementById('pa_pf_vendor_hint').textContent = 'Required for new products.';
                document.getElementById('pa_pf_vendor').disabled = false;
                document.getElementById('pa-product-form').reset();
                document.getElementById('pa_pf_in_stock').checked = true;
                renderTags([]);
                document.getElementById('pa_pf_tag_input').value = '';
                currentDoseLabelProductName = '';
                currentDoseLabels = {};
                document.getElementById('pa_dose_labels_list').innerHTML = '';
                document.getElementById('pa_dose_labels_save').style.display = 'none';
            }

            document.getElementById('pa-prod-cancel-btn').addEventListener('click', resetForm);

            // ── AJAX form submit (create / update) ──────────────────────────
            document.getElementById('pa-product-form').addEventListener('submit', function(e) {
                e.preventDefault();
                var productId = parseInt(document.getElementById('pa_prod_id').value) || 0;
                var listingId = parseInt(document.getElementById('pa_listing_id').value) || 0;
                var name = document.getElementById('pa_pf_name').value.trim();
                if (!name) { alert('Product name is required.'); return; }

                var vendorId = parseInt(document.getElementById('pa_pf_vendor').value) || 0;
                var priceStr = document.getElementById('pa_pf_price').value;
                var price = priceStr ? parseFloat(priceStr) : null;
                var currency = document.getElementById('pa_pf_currency').value || 'USD';
                var inStock = document.getElementById('pa_pf_in_stock').checked;
                var amountStr = document.getElementById('pa_pf_amount_mg').value;
                var amountMg = amountStr ? parseFloat(amountStr) : null;
                var amountUnit = document.getElementById('pa_pf_amount_unit').value || 'mg';
                var productUrl = document.getElementById('pa_pf_url').value.trim();
                var category = document.getElementById('pa_pf_category').value.trim();
                var description = document.getElementById('pa_pf_desc').value.trim();
                var tags = currentTags.slice();

                var btn = document.getElementById('pa-prod-save-btn');
                btn.disabled = true;
                btn.textContent = 'Saving...';

                if (productId === 0) {
                    // ── CREATE via API ────────────────────────────────────────
                    if (!vendorId) { alert('Please select a vendor.'); btn.disabled = false; btn.textContent = 'Create Product'; return; }
                    var payload = {
                        product_name: name,
                        vendor_id: vendorId,
                        price: price || 0,
                        currency: currency,
                        in_stock: inStock,
                        amount_mg: amountMg,
                        amount_unit: amountUnit || null,
                        url: productUrl || null,
                        category: category || null,
                        description: description || null,
                        tags: tags
                    };
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', PA_API_BASE + '/api/admin/manual-listings');
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.onload = function() {
                        btn.disabled = false;
                        btn.textContent = 'Create Product';
                        if (xhr.status >= 200 && xhr.status < 300) {
                            // Reload products from API to get fresh data
                            reloadProducts(function() {
                                resetForm();
                                showNotice('success', 'Product created.');
                            });
                        } else {
                            var errMsg = 'Create failed';
                            try { var r = JSON.parse(xhr.responseText); errMsg = r.detail || r.error || errMsg; } catch(e) {}
                            showNotice('error', errMsg);
                        }
                    };
                    xhr.onerror = function() { btn.disabled = false; btn.textContent = 'Create Product'; showNotice('error', 'Network error'); };
                    xhr.send(JSON.stringify(payload));
                } else {
                    // ── UPDATE via API ────────────────────────────────────────
                    var errors = [];
                    var pending = 1; // canonical product PATCH

                    function checkDone() {
                        pending--;
                        if (pending > 0) return;
                        btn.disabled = false;
                        btn.textContent = 'Save Changes';
                        if (errors.length) {
                            showNotice('error', errors.join(' | '));
                        } else {
                            // Persist the tag change in WordPress so it survives page
                            // reloads and scraper re-runs that re-assign tags on the backend.
                            var xhrTags = new XMLHttpRequest();
                            xhrTags.open('POST', ajaxurl);
                            xhrTags.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                            xhrTags.onload = function() {
                                try {
                                    var r = JSON.parse(xhrTags.responseText);
                                    if (!r.success) {
                                        showNotice('error', 'Tag override save failed: ' + JSON.stringify(r.data));
                                    }
                                } catch(e) {
                                    showNotice('error', 'Tag override save failed (bad response): ' + xhrTags.responseText.slice(0, 200));
                                }
                            };
                            xhrTags.onerror = function() {
                                showNotice('error', 'Tag override save failed: network error');
                            };
                            xhrTags.send('action=pa_save_product_tags&_wpnonce=' + PA_TAGS_NONCE
                                + '&product_name=' + encodeURIComponent(name)
                                + '&product_id=' + encodeURIComponent(String(productId))
                                + '&tags=' + encodeURIComponent(JSON.stringify(tags)));
                            PA_TAG_OVERRIDES[String(productId)] = tags.slice();
                            reloadProducts(function() {
                                loadProduct(productId);
                                showNotice('success', 'Product updated.');
                            });
                        }
                    }

                    // PATCH canonical product
                    var xhr = new XMLHttpRequest();
                    xhr.open('PATCH', PA_API_BASE + '/api/admin/products/' + productId);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.onload = function() {
                        if (xhr.status < 200 || xhr.status >= 300) {
                            var m = 'Product update failed';
                            try { m = JSON.parse(xhr.responseText).detail || m; } catch(e) {}
                            errors.push(m);
                        }
                        checkDone();
                    };
                    xhr.onerror = function() { errors.push('Network error'); checkDone(); };
                    xhr.send(JSON.stringify({name: name, category: category || null, description: description || null, tags: tags}));

                    // PUT manual listing if exists
                    if (listingId > 0) {
                        pending++;
                        var xhr2 = new XMLHttpRequest();
                        xhr2.open('PUT', PA_API_BASE + '/api/admin/manual-listings/' + listingId);
                        xhr2.setRequestHeader('Content-Type', 'application/json');
                        xhr2.onload = function() {
                            if (xhr2.status < 200 || xhr2.status >= 300) {
                                var m = 'Listing update failed';
                                try { m = JSON.parse(xhr2.responseText).detail || m; } catch(e) {}
                                errors.push(m);
                            }
                            checkDone();
                        };
                        xhr2.onerror = function() { errors.push('Network error (listing)'); checkDone(); };
                        xhr2.send(JSON.stringify({
                            price: price, currency: currency, in_stock: inStock,
                            amount_mg: amountMg, amount_unit: amountUnit || null,
                            url: productUrl || null, category: category || null,
                            description: description || null, tags: tags
                        }));
                    }
                }
            });

            // ── Reload products from API ────────────────────────────────────
            function reloadProducts(callback) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', PA_API_BASE + '/api/admin/products');
                xhr.onload = function() {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (Array.isArray(data)) {
                            // Apply admin tag overrides so scraper-assigned tags don't
                            // revert changes made in the admin.
                            data.forEach(function(p) {
                                var pid = String(p.id);
                                if (PA_TAG_OVERRIDES.hasOwnProperty(pid)) {
                                    p.tags = PA_TAG_OVERRIDES[pid].slice();
                                }
                            });
                            PA_PRODUCTS = data;
                        }
                    } catch(e) {}
                    renderTable();
                    if (callback) callback();
                };
                xhr.onerror = function() { renderTable(); if (callback) callback(); };
                xhr.send();
            }

            // ── Flash notice ────────────────────────────────────────────────
            function showNotice(type, msg) {
                var existing = document.querySelector('.pa-ajax-notice');
                if (existing) existing.remove();
                var div = document.createElement('div');
                div.className = 'pa-ajax-notice notice notice-' + type + ' is-dismissible';
                div.style.cssText = 'margin:8px 0;padding:8px 12px';
                div.innerHTML = '<p>' + esc(msg) + '</p>';
                var wrap = document.querySelector('.wrap');
                var formWrap = document.getElementById('pa-product-form-wrap');
                wrap.insertBefore(div, formWrap);
                setTimeout(function() { if (div.parentNode) div.remove(); }, 5000);
            }

            // ── Initial render ──────────────────────────────────────────────
            renderTable();
        })();
        </script>
        <?php
    }

    public function ajax_toggle_product_status() {
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        check_ajax_referer('pa_toggle_status', '_wpnonce');
        $pid    = (int) ($_POST['pid'] ?? 0);
        $status = sanitize_text_field($_POST['status'] ?? '');
        if (!$pid || !in_array($status, array('approved', 'unreviewed'), true)) {
            wp_send_json_error('Invalid parameters');
        }
        $resp = $this->api->request('PATCH', '/api/admin/products/' . $pid, array('status' => $status), true);
        if ($resp['ok']) {
            wp_send_json_success();
        } else {
            wp_send_json_error($resp['error'] ?? 'API error');
        }
    }

    public function ajax_delete_product() {
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        check_ajax_referer('pa_product_delete_action', '_wpnonce');
        $pid = (int) ($_POST['pid'] ?? 0);
        if (!$pid) {
            wp_send_json_error('Invalid product ID');
        }
        $resp = $this->api->request('DELETE', '/api/admin/products/' . $pid, null, true);
        if ($resp['ok']) {
            wp_send_json_success();
        } else {
            wp_send_json_error($resp['error'] ?? 'API error');
        }
    }

    public function ajax_delete_vendor() {
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        check_ajax_referer('pa_vendor_delete_action', '_wpnonce');
        $vid = (int) ($_POST['vid'] ?? 0);
        if (!$vid) {
            wp_send_json_error('Invalid vendor ID');
        }
        $resp = $this->api->request('DELETE', '/api/admin/vendors/' . $vid, null, true);
        if ($resp['ok']) {
            wp_send_json_success();
        } else {
            wp_send_json_error($resp['error'] ?? 'API error');
        }
    }

    public function ajax_save_dose_labels() {
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        check_ajax_referer('pa_dose_labels_action', '_wpnonce');
        $product_name = sanitize_text_field(wp_unslash($_POST['product_name'] ?? ''));
        // Strip dosage suffix (e.g. " 5mg") so the key matches the base-name
        // key that groupByDosage() produces on the frontend dashboard.
        $product_name = preg_replace('/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i', '', $product_name);
        $product_name = trim($product_name);
        $labels_json  = wp_unslash($_POST['labels'] ?? '{}');
        $labels       = json_decode($labels_json, true);
        if (!is_array($labels)) {
            $labels = array();
        }
        $labels = array_map('sanitize_text_field', $labels);

        $all_labels = get_option('pa_dose_labels', array());
        if (!is_array($all_labels)) {
            $all_labels = array();
        }
        if (empty($labels)) {
            unset($all_labels[$product_name]);
        } else {
            $all_labels[$product_name] = $labels;
        }
        update_option('pa_dose_labels', $all_labels, false);
        wp_send_json_success();
    }

    public function ajax_save_product_tags() {
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Unauthorized');
        }
        check_ajax_referer('pa_save_product_tags', '_wpnonce');
        $raw_name = sanitize_text_field(wp_unslash($_POST['product_name'] ?? ''));
        if ($raw_name === '') {
            wp_send_json_error('Invalid product name');
            return;
        }
        // Strip dosage suffix and normalise to lowercase so "BPC-157 5mg" and
        // "BPC-157 10mg" both resolve to the same key "bpc-157".
        $base_name = strtolower(trim(preg_replace(
            '/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|u)(?:\/(?:ml|vial))?$/i', '', $raw_name
        )));
        if ($base_name === '') {
            wp_send_json_error('Invalid product name');
            return;
        }
        $tags_raw = wp_unslash($_POST['tags'] ?? '[]');
        $tags     = json_decode($tags_raw, true);
        if (!is_array($tags)) {
            wp_send_json_error('Invalid tags');
            return;
        }
        $tags = array_values(array_map('sanitize_text_field', $tags));

        $overrides = (array) get_option('pa_product_tag_overrides', array());
        // Key by product ID only so tags apply to exactly this product and not
        // every dosage variant sharing the same base name.
        $product_id = sanitize_text_field(wp_unslash($_POST['product_id'] ?? ''));
        if ($product_id !== '') {
            $overrides[$product_id] = $tags;
            // Remove any stale base-name key so the ID key takes sole authority.
            unset($overrides[$base_name]);
        } else {
            // Fallback for products that genuinely have no ID yet.
            $overrides[$base_name] = $tags;
        }
        update_option('pa_product_tag_overrides', $overrides, false);
        delete_transient('pa_products_cache');
        wp_send_json_success(array('tags' => $tags));
    }

    public function render_monitoring_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        $status_resp    = $this->admin_get('/api/dashboard/crawl-status');
        $alerts_resp    = $this->admin_get('/api/dashboard/alerts');
        $vendors_resp   = $this->admin_get('/api/admin/vendors');
        $schedules_resp = $this->admin_get('/api/admin/schedules');
        $worker_resp    = $this->admin_get('/api/admin/worker-status');
        $crawl_sum_resp = $this->admin_get('/api/admin/crawl-summary');

        $rows      = $status_resp['ok'] && is_array($status_resp['data']) ? $status_resp['data'] : array();
        $alerts    = $alerts_resp['ok'] && is_array($alerts_resp['data']) ? $alerts_resp['data'] : array();
        $vendors   = $vendors_resp['ok'] && is_array($vendors_resp['data']) ? $vendors_resp['data'] : array();
        $schedules = $schedules_resp['ok'] && is_array($schedules_resp['data']) ? $schedules_resp['data'] : array();
        $worker_alive = !empty($worker_resp['data']['worker_alive']);
        $queue_depth  = (int) ($worker_resp['data']['queue_depth'] ?? 0);
        $crawl_summary = $crawl_sum_resp['ok'] && is_array($crawl_sum_resp['data']) ? $crawl_sum_resp['data'] : array();

        // Index schedules by vendor_id for easy lookup
        $sched_by_vendor = array();
        foreach ($schedules as $s) {
            $sched_by_vendor[(int) $s['vendor_id']] = $s;
        }
        ?>
        <div class="wrap">
            <h1>Monitoring</h1>

            <style>
            .pa-crawl-btn{min-width:80px}
            .pa-crawl-btn:disabled{opacity:.5;cursor:not-allowed}
            .pa-interval-input{width:60px;text-align:center}
            .pa-sched-toggle{cursor:pointer;font-weight:bold}
            .pa-crawl-ok{color:#00a32a;font-weight:bold}
            .pa-crawl-err{color:#d63638;font-weight:bold}
            .pa-crawl-blocked{color:#dba617;font-weight:bold}
            .pa-crawl-detail{display:block;font-size:11px;color:#666;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .pa-crawl-detail:hover{white-space:normal;overflow:visible}
            </style>

            <!-- ── Worker Status ───────────────────────────────────────────── -->
            <?php if ($worker_alive) : ?>
                <div class="notice notice-success inline" style="margin:0 0 16px;padding:6px 12px;">
                    <strong>&#9679; Worker online</strong> &mdash; <?php echo esc_html($queue_depth); ?> job(s) in queue.
                </div>
            <?php else : ?>
                <div class="notice notice-error inline" style="margin:0 0 16px;padding:6px 12px;">
                    <strong>&#9679; Worker offline</strong> &mdash; Start the worker with <code>venv/Scripts/python.exe run_worker.py</code>
                </div>
            <?php endif; ?>

            <!-- ── Crawl Control ───────────────────────────────────────────── -->
            <h2>Crawl Control
                <button type="button" class="button button-primary" id="pa-crawl-all-btn" style="margin-left:12px;vertical-align:middle">Crawl All Vendors</button>
            </h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th>Vendor</th>
                        <th>Schedule</th>
                        <th>Interval (hours)</th>
                        <th>Last Crawled</th>
                        <th>Next Due</th>
                        <th>Crawl Results</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="pa-crawl-control-tbody"></tbody>
            </table>

            <!-- ── Crawl Status ────────────────────────────────────────────── -->
            <h2 style="margin-top:24px;">Crawl Status</h2>
            <table class="widefat striped">
                <thead><tr><th>Listing ID</th><th>Vendor</th><th>Status</th><th>Blocked</th><th>Last Fetch</th><th>URL</th></tr></thead>
                <tbody>
                <?php if (empty($rows)) : ?>
                    <tr><td colspan="6">No crawl status data.</td></tr>
                <?php else : foreach ($rows as $r) : ?>
                    <tr>
                        <td><?php echo esc_html((string) ($r['listing_id'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($r['vendor'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($r['last_status'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($r['blocked_count'] ?? 0)); ?></td>
                        <td><?php echo esc_html((string) ($r['last_fetched_at'] ?? '')); ?></td>
                        <td><a href="<?php echo esc_url((string) ($r['url'] ?? '')); ?>" target="_blank" rel="noopener noreferrer">Open</a></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>

            <h2 style="margin-top:24px;">Alerts</h2>
            <table class="widefat striped">
                <thead><tr><th>ID</th><th>Vendor ID</th><th>Severity</th><th>Message</th><th>Created</th></tr></thead>
                <tbody>
                <?php if (empty($alerts)) : ?>
                    <tr><td colspan="5">No alerts.</td></tr>
                <?php else : foreach ($alerts as $a) : ?>
                    <tr>
                        <td><?php echo esc_html((string) ($a['id'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($a['vendor_id'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($a['severity'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($a['message'] ?? '')); ?></td>
                        <td><?php echo esc_html((string) ($a['created_at'] ?? '')); ?></td>
                    </tr>
                <?php endforeach; endif; ?>
                </tbody>
            </table>
        </div>

        <script>
        (function(){
            var PA_API_BASE = <?php echo wp_json_encode($this->api->base_url()); ?>;
            var VENDORS = <?php echo wp_json_encode(array_values($vendors)); ?>;
            var SCHEDULES = <?php echo wp_json_encode($sched_by_vendor); ?>;
            var CRAWL_SUMMARY = <?php echo wp_json_encode($crawl_summary); ?>;

            function esc(str) {
                var d = document.createElement('div');
                d.textContent = str;
                return d.innerHTML;
            }

            function timeAgo(isoStr) {
                if (!isoStr) return '--';
                var d = new Date(isoStr + (isoStr.indexOf('Z') === -1 && isoStr.indexOf('+') === -1 ? 'Z' : ''));
                var diff = Math.floor((Date.now() - d.getTime()) / 1000);
                if (diff < 60) return diff + 's ago';
                if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
                if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
                return Math.floor(diff / 86400) + 'd ago';
            }

            function nextDue(isoStr, intervalH) {
                if (!isoStr) return 'Now';
                var d = new Date(isoStr + (isoStr.indexOf('Z') === -1 && isoStr.indexOf('+') === -1 ? 'Z' : ''));
                var due = new Date(d.getTime() + intervalH * 3600000);
                var diff = Math.floor((due.getTime() - Date.now()) / 1000);
                if (diff <= 0) return 'Overdue';
                if (diff < 3600) return Math.floor(diff / 60) + 'm';
                if (diff < 86400) return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
                return Math.floor(diff / 86400) + 'd ' + Math.floor((diff % 86400) / 3600) + 'h';
            }

            function refreshCrawlSummary(callback) {
                apiCall('GET', '/api/admin/crawl-summary', null, function(ok, data) {
                    if (ok && data) CRAWL_SUMMARY = data;
                    renderCrawlTable();
                    if (callback) callback();
                });
            }

            function renderCrawlTable() {
                var tbody = document.getElementById('pa-crawl-control-tbody');
                if (!VENDORS.length) {
                    tbody.innerHTML = '<tr><td colspan="7">No vendors.</td></tr>';
                    return;
                }
                var html = '';
                VENDORS.forEach(function(v) {
                    var vid = v.id;
                    var s = SCHEDULES[vid] || null;
                    var enabled = s ? s.enabled : false;
                    var interval = s ? (s.interval_hours || 24) : 24;
                    var lastCrawled = s ? s.last_enqueued_at : null;
                    var schedId = s ? s.id : null;

                    var enabledHtml = enabled
                        ? '<span class="pa-sched-toggle" data-sched-id="' + schedId + '" data-vid="' + vid + '" data-enabled="1" style="color:green" title="Click to pause">&#10003; Active</span>'
                        : '<span class="pa-sched-toggle" data-sched-id="' + schedId + '" data-vid="' + vid + '" data-enabled="0" style="color:#999" title="Click to enable">&#10005; Paused</span>';

                    var nextDueStr = enabled ? nextDue(lastCrawled, interval) : '<em style="color:#999">Paused</em>';

                    // Crawl results column
                    var cs = CRAWL_SUMMARY[String(vid)] || null;
                    var crawlResultHtml = '--';
                    if (cs) {
                        crawlResultHtml = '<span class="pa-crawl-ok">' + cs.ok + ' ok</span>';
                        if (cs.error > 0) crawlResultHtml += ' / <span class="pa-crawl-err">' + cs.error + ' err</span>';
                        if (cs.blocked > 0) crawlResultHtml += ' / <span class="pa-crawl-blocked">' + cs.blocked + ' blocked</span>';
                        if (cs.last_error_message) {
                            crawlResultHtml += '<span class="pa-crawl-detail" title="' + esc(cs.last_error_message) + '">'
                                + esc(cs.last_error_status || 'error') + ': ' + esc(cs.last_error_message.substring(0, 120))
                                + (cs.last_error_at ? ' (' + timeAgo(cs.last_error_at) + ')' : '')
                                + '</span>';
                        }
                    }

                    html += '<tr>'
                        + '<td>' + esc(v.name || '') + (v.enabled ? '' : ' <em style="color:#999">(disabled)</em>') + '</td>'
                        + '<td>' + enabledHtml + '</td>'
                        + '<td><input type="number" class="pa-interval-input" data-sched-id="' + schedId + '" data-vid="' + vid + '" value="' + interval + '" min="1" max="720" ' + (schedId ? '' : 'disabled') + ' /></td>'
                        + '<td>' + timeAgo(lastCrawled) + '</td>'
                        + '<td>' + nextDueStr + '</td>'
                        + '<td>' + crawlResultHtml + '</td>'
                        + '<td><button type="button" class="button button-small pa-crawl-btn pa-crawl-vendor-btn" data-vid="' + vid + '" data-vname="' + esc(v.name || '') + '">Crawl Now</button></td>'
                        + '</tr>';
                });
                tbody.innerHTML = html;
                bindCrawlEvents();
            }

            function bindCrawlEvents() {
                // Crawl Now per vendor
                document.querySelectorAll('.pa-crawl-vendor-btn').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var vid = this.dataset.vid;
                        var vname = this.dataset.vname;
                        var b = this;
                        b.disabled = true;
                        b.textContent = 'Queuing...';
                        apiCall('POST', '/api/admin/vendors/' + vid + '/crawl', null, function(ok, data) {
                            b.disabled = false;
                            b.textContent = 'Crawl Now';
                            if (ok) {
                                showNotice('success', 'Crawl queued for ' + vname);
                            } else {
                                showNotice('error', 'Failed to queue crawl for ' + vname + ': ' + (data || 'unknown'));
                            }
                        });
                    });
                });

                // Toggle schedule enabled/paused
                document.querySelectorAll('.pa-sched-toggle').forEach(function(el) {
                    el.addEventListener('click', function() {
                        var schedId = this.dataset.schedId;
                        var vid = this.dataset.vid;
                        var currentlyEnabled = this.dataset.enabled === '1';
                        var newEnabled = !currentlyEnabled;
                        var span = this;
                        span.style.opacity = '0.5';

                        if (schedId && schedId !== 'null') {
                            apiCall('PATCH', '/api/admin/schedules/' + schedId, {enabled: newEnabled}, function(ok) {
                                span.style.opacity = '1';
                                if (ok) {
                                    SCHEDULES[vid] = SCHEDULES[vid] || {};
                                    SCHEDULES[vid].enabled = newEnabled;
                                    renderCrawlTable();
                                } else {
                                    showNotice('error', 'Failed to update schedule');
                                }
                            });
                        } else {
                            // No schedule yet — create one
                            apiCall('POST', '/api/admin/schedules', {vendor_id: parseInt(vid), interval_hours: 24, enabled: newEnabled}, function(ok, data) {
                                span.style.opacity = '1';
                                if (ok && data) {
                                    SCHEDULES[vid] = {id: data.id, vendor_id: parseInt(vid), interval_hours: data.interval_hours, enabled: data.enabled, last_enqueued_at: null};
                                    renderCrawlTable();
                                } else {
                                    showNotice('error', 'Failed to create schedule');
                                }
                            });
                        }
                    });
                });

                // Interval change
                document.querySelectorAll('.pa-interval-input').forEach(function(input) {
                    var timer = null;
                    input.addEventListener('change', function() {
                        var schedId = this.dataset.schedId;
                        var vid = this.dataset.vid;
                        var val = parseInt(this.value) || 24;
                        if (val < 1) val = 1;
                        this.value = val;
                        if (!schedId || schedId === 'null') return;

                        var inp = this;
                        inp.style.borderColor = '#2271b1';
                        apiCall('PATCH', '/api/admin/schedules/' + schedId, {interval_hours: val}, function(ok) {
                            inp.style.borderColor = ok ? '#00a32a' : '#d63638';
                            setTimeout(function() { inp.style.borderColor = ''; }, 1500);
                            if (ok) {
                                SCHEDULES[vid] = SCHEDULES[vid] || {};
                                SCHEDULES[vid].interval_hours = val;
                                renderCrawlTable();
                            } else {
                                showNotice('error', 'Failed to update interval');
                            }
                        });
                    });
                });
            }

            // Crawl All
            document.getElementById('pa-crawl-all-btn').addEventListener('click', function() {
                var enabledVendors = VENDORS.filter(function(v) { return v.enabled; });
                if (!enabledVendors.length) { showNotice('error', 'No enabled vendors to crawl.'); return; }
                if (!confirm('Queue crawl jobs for all ' + enabledVendors.length + ' enabled vendor(s)?')) return;

                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Queuing...';
                var remaining = enabledVendors.length;
                var succeeded = 0;
                var failed = 0;

                enabledVendors.forEach(function(v) {
                    apiCall('POST', '/api/admin/vendors/' + v.id + '/crawl', null, function(ok) {
                        if (ok) succeeded++; else failed++;
                        remaining--;
                        if (remaining <= 0) {
                            btn.disabled = false;
                            btn.textContent = 'Crawl All Vendors';
                            var msg = succeeded + ' vendor(s) queued';
                            if (failed) msg += ', ' + failed + ' failed';
                            showNotice(failed ? 'warning' : 'success', msg);
                        }
                    });
                });
            });

            function apiCall(method, path, payload, callback) {
                var xhr = new XMLHttpRequest();
                xhr.open(method, PA_API_BASE + path);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onload = function() {
                    var respData = null;
                    try { respData = JSON.parse(xhr.responseText); } catch(e) {}
                    if (xhr.status >= 200 && xhr.status < 300) {
                        callback(true, respData);
                    } else {
                        var msg = 'HTTP ' + xhr.status;
                        if (respData) msg = respData.detail || respData.error || msg;
                        callback(false, msg);
                    }
                };
                xhr.onerror = function() { callback(false, 'Network error'); };
                xhr.send(payload !== null && payload !== undefined ? JSON.stringify(payload) : null);
            }

            function showNotice(type, msg) {
                var existing = document.querySelector('.pa-mon-notice');
                if (existing) existing.remove();
                var div = document.createElement('div');
                div.className = 'pa-mon-notice notice notice-' + type + ' is-dismissible';
                div.style.cssText = 'margin:8px 0;padding:8px 12px';
                div.innerHTML = '<p>' + esc(msg) + '</p>';
                var wrap = document.querySelector('.wrap');
                wrap.insertBefore(div, wrap.children[1]);
                setTimeout(function() { if (div.parentNode) div.remove(); }, 5000);
            }

            renderCrawlTable();
        })();
        </script>
        <?php
    }
}
