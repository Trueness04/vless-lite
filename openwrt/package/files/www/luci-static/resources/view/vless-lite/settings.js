'use strict';
'require view';
'require form';
'require poll';
'require rpc';
'require uci';
'require ui';

var calls = {};
var commit = rpc.declare({ object: 'uci', method: 'commit', params: [ 'config' ], reject: true });
[ 'status', 'logs', 'connect', 'disconnect', 'probe' ].forEach(function(method) {
	calls[method] = rpc.declare({ object: 'vless-lite', method: method, reject: true });
});
calls.validate = rpc.declare({ object: 'vless-lite', method: 'validate',
	params: [ 'link', 'resolver', 'rules' ], reject: true });

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
		link.description = _('Supported transports: RAW (TCP) and XHTTP. Supported security: TLS and REALITY.');
		link.validate = function(section, value) {
			return /^vless:\/\/[^\s]+$/.test(value) && value.length <= 4096
				? true : _('Enter a VLESS share link');
		};

		var status = E('p', {}, _('Loading status'));
		var result = E('p', { 'aria-live': 'polite' });
		var log = E('pre', { style: 'white-space:pre-wrap' });
		var busy = false;
		function refresh() {
			return calls.status().then(function(s) {
				status.textContent = s.pid
					? _('Running profile %s, PID %d, RSS %d KiB, system available %d KiB').format(s.profile || '?', s.pid, s.rss_kib, s.available_kib)
					: _('Core not ready, system available %d KiB').format(s.available_kib || 0);
			}).catch(function() {
				status.textContent = _('Could not load status');
			});
		}
		function button(title, action) {
			return E('button', { 'class': 'cbi-button', 'click': ui.createHandlerFn(this, function() {
				if (busy) return;
				busy = true;
				result.textContent = _('Working…');
				return action().catch(function(e) { result.textContent = String(e); })
					.finally(function() { busy = false; });
			}) }, title);
		}
		function control(method) {
			return calls[method]().then(function(r) {
				result.textContent = r.ok
					? (method === 'connect' ? _('Start requested. Check core status, then test the connection.') : _('Stop requested.'))
					: (r.error || _('Operation failed'));
				return refresh();
			});
		}
		function save(connecting) {
			return map.save(function() {
				var selected = uci.get('vless-lite', 'main', 'active');
				if (!selected) {
					if (connecting || uci.get('vless-lite', 'main', 'boot') === '1')
						throw new Error(_('Select a profile first.'));
					return;
				}
				var shareLink = uci.get('vless-lite', selected, 'link');
				if (!shareLink)
					throw new Error(_('Select an existing profile or clear the selection before saving.'));
				return calls.validate(shareLink, uci.get('vless-lite', 'main', 'resolver'),
					uci.get('vless-lite', 'main', 'rules') || '').then(function(reply) {
					if (!reply.ok) throw new Error(reply.error || _('Profile validation failed.'));
				});
			}, true).then(function() { return commit('vless-lite'); });
		}

		return Promise.all([ map.render(), refresh() ]).then(function(nodes) {
			poll.add(refresh, 5);
			return E('div', {}, [ nodes[0], status, E('div', {}, [
				button(_('Save profiles and settings'), function() {
					return save().then(function() { window.location.reload(); });
				}), ' ',
				button(_('Save and connect'), function() {
					return save(true).then(function() { return control('connect'); });
				}), ' ',
				button(_('Disconnect'), function() { return control('disconnect'); }), ' ',
				button(_('Test active connection'), function() {
					return calls.probe().then(function(r) {
						result.textContent = r.ok ? _('Proxy test passed. HTTPS round trip %d ms').format(r.latency_ms) : r.error;
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

