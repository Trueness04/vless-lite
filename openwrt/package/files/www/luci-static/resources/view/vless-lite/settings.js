'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';

var calls = {};
[ 'status', 'logs', 'connect', 'disconnect', 'probe' ].forEach(function(method) {
	calls[method] = rpc.declare({ object: 'vless-lite', method: method });
});

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
	load: function() {
		return uci.load('vless-lite');
	},

	render: function() {
		var map = new form.Map('vless-lite', _('VLESS Lite'),
			_('Add and save a profile, select it, then save and connect. The connection test uses the running profile.'));
		var service = map.section(form.NamedSection, 'main', 'service');
		var active = service.option(form.ListValue, 'active', _('Selected profile'));
		active.value('', _('Select a profile'));
		uci.sections('vless-lite', 'profile', function(profile) {
			active.value(profile['.name'], profile.label || profile['.name']);
		});
		var boot = service.option(form.Flag, 'boot', _('Connect at boot'));
		boot.rmempty = false;
		var resolver = service.option(form.Value, 'resolver', _('DNS resolver through VLESS'));
		resolver.datatype = 'ip4addr';
		resolver.rmempty = false;
		var rules = service.option(form.TextValue, 'rules', _('IPv4 routing rules'));
		rules.rows = 4;
		rules.description = _('First match wins. Enter one action and CIDR per line, such as block 203.0.113.0/24. Default is proxy.');

		var profiles = map.section(form.TypedSection, 'profile', _('Server profiles'));
		profiles.anonymous = true;
		profiles.addremove = true;
		var label = profiles.option(form.Value, 'label', _('Name'));
		label.rmempty = false;
		var link = profiles.option(form.Value, 'link', _('VLESS share link'));
		link.password = true;
		link.rmempty = false;
		link.validate = function(section, value) {
			return /^vless:\/\/[^\s]+$/.test(value) && value.length <= 4096
				? true : _('Enter a VLESS share link');
		};

		var status = E('p', {}, _('Loading status'));
		var result = E('p', { 'aria-live': 'polite' });
		var log = E('pre', { style: 'white-space:pre-wrap' });
		function refresh() {
			return calls.status().then(function(s) {
				status.textContent = s.pid
					? _('Running profile %s, PID %d, RSS %d KiB, system available %d KiB').format(s.profile || '?', s.pid, s.rss_kib, s.available_kib)
					: _('Stopped, system available %d KiB').format(s.available_kib || 0);
			});
		}
		function button(title, action) {
			return E('button', { 'class': 'cbi-button', 'click': ui.createHandlerFn(this, function() {
				result.textContent = _('Working…');
				return action().catch(function(e) { result.textContent = String(e); });
			}) }, title);
		}
		function control(method) {
			return calls[method]().then(function(r) {
				result.textContent = r.ok ? _('Request accepted') : (r.error || _('Operation failed'));
				return refresh();
			});
		}

		return Promise.all([ map.render(), refresh().catch(function() {
			status.textContent = _('Could not load status');
		}) ]).then(function(nodes) {
			return E('div', {}, [ nodes[0], status, E('div', {}, [
				button(_('Save profiles and settings'), function() {
					return map.save().then(function() { return uci.apply(); }).then(function() { window.location.reload(); });
				}), ' ',
				button(_('Save and connect'), function() {
					return map.save().then(function() { return uci.apply(); }).then(function() { return control('connect'); });
				}), ' ',
				button(_('Disconnect'), function() { return control('disconnect'); }), ' ',
				button(_('Test active connection'), function() {
					return calls.probe().then(function(r) {
						result.textContent = r.ok ? _('HTTPS round trip %d ms').format(r.latency_ms) : r.error;
					});
				}), ' ',
				button(_('Refresh status and logs'), function() {
					return Promise.all([ refresh(), calls.logs() ]).then(function(data) {
						log.textContent = data[1].logs || _('No log entries');
						result.textContent = '';
					});
				})
			]), result, log ]);
		});
	}
});

