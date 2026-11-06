export default class VlessLite {
    constructor(app) {
        this.app = app;
    }

    init() {
        this.app.registerRoute('/vless-lite', () => this.render());
    }

    async call(object, method, params = {}) {
        const [status, result] = await this.app.ubusCall(object, method, params, { timeout: 45000 });
        if (status !== 0) throw new Error(method + ' failed (' + status + ')');
        if (result?.ok === false) throw new Error(result.error || method + ' failed');
        return result;
    }

    async render() {
        const page = document.getElementById('addon-vless-lite-page');
        if (!page) return;
        page.innerHTML = `
            <div class="card">
                <h2>VLESS Lite</h2>
                <p id="vless-status" role="status">Loading…</p>
                <form id="vless-form">
                    <p><label>Profile <select name="profile"></select></label></p>
                    <p><label>Name <input name="label" maxlength="100"></label></p>
                    <p><label>VLESS share link <input name="link" type="password" autocomplete="off"></label></p>
                    <p><label><input name="boot" type="checkbox"> Connect at boot</label></p>
                    <p><label>DNS resolver <input name="resolver"></label></p>
                    <p><label>IPv4 routing rules <textarea name="rules" rows="4"></textarea></label></p>
                    <button type="submit">Save profile and settings</button>
                    <button type="button" data-action="connect">Save and connect</button>
                    <button type="button" data-action="disconnect">Disconnect</button>
                    <button type="button" data-action="probe">Test connection</button>
                    <button type="button" data-action="logs">Logs</button>
                    <button type="button" data-action="delete">Delete profile</button>
                </form>
                <p id="vless-result" role="status"></p>
                <pre id="vless-logs" style="white-space:pre-wrap"></pre>
            </div>`;

        const form = page.querySelector('form');
        const { profile, label, link, boot, resolver, rules } = form.elements;
        const status = page.querySelector('#vless-status');
        const message = page.querySelector('#vless-result');
        const config = 'vless-lite';
        const uci = (method, params = {}) => this.call('uci', method, { config, ...params });
        let values = {};
        const selectProfile = () => {
            const selected = values[profile.value];
            label.value = selected?.label || '';
            link.value = selected?.link || '';
        };
        const refresh = async () => {
            const current = await this.call(config, 'status');
            status.textContent = current.pid
                ? 'Connected process · PID ' + current.pid + ' · RSS ' + current.rss_kib + ' KiB'
                : 'Disconnected · available RAM ' + current.available_kib + ' KiB';
        };
        const load = async () => {
            values = (await uci('get')).values;
            profile.replaceChildren(new Option('New profile', ''));
            for (const [id, entry] of Object.entries(values)) {
                if (entry['.type'] === 'profile') profile.add(new Option(entry.label || id, id));
            }
            profile.value = values.main.active || '';
            boot.checked = values.main.boot === '1';
            resolver.value = values.main.resolver || '1.1.1.1';
            rules.value = values.main.rules || '';
            selectProfile();
            await refresh();
        };
        const save = async () => {
            const entry = { label: label.value.trim(), link: link.value.trim() };
            if (!entry.label || !/^vless:\/\/[^\s]+$/.test(entry.link)) {
                throw new Error('Enter a name and a complete vless:// link.');
            }
            const section = profile.value || (await uci('add', { type: 'profile', values: entry })).section;
            if (profile.value) await uci('set', { section, values: entry });
            await uci('set', { section: 'main', values: {
                active: section, boot: boot.checked ? '1' : '0',
                resolver: resolver.value.trim() || '1.1.1.1', rules: rules.value
            } });
            await uci('commit');
        };
        let busy = false;
        const perform = async (action) => {
            if (busy) return;
            busy = true;
            message.textContent = 'Working…';
            try {
                if (action === 'save' || action === 'connect') await save();
                if (action === 'delete') {
                    if (!profile.value || !window.confirm('Delete this profile?')) {
                        message.textContent = '';
                        return;
                    }
                    if (values.main.active === profile.value) {
                        await this.call(config, 'disconnect');
                        await uci('set', { section: 'main', values: { active: '' } });
                    }
                    await uci('delete', { section: profile.value });
                    await uci('commit');
                }
                if (action === 'connect' || action === 'disconnect') await this.call(config, action);
                if (action === 'logs') {
                    const result = await this.call(config, 'logs');
                    page.querySelector('#vless-logs').textContent = result.logs || 'No recent logs.';
                }
                if (action === 'probe') {
                    const result = await this.call(config, 'probe');
                    message.textContent = 'HTTPS test passed' + (result.latency_ms ? ' · ' + result.latency_ms + ' ms' : '');
                    return;
                }
                if (['save', 'connect', 'delete'].includes(action)) await load();
                else await refresh();
                message.textContent = 'Done.';
            } catch (error) {
                message.textContent = error.message;
            } finally {
                busy = false;
            }
        };
        profile.onchange = selectProfile;
        form.onsubmit = event => {
            event.preventDefault();
            perform('save');
        };
        form.querySelectorAll('[data-action]').forEach(button => {
            button.onclick = () => perform(button.dataset.action);
        });
        try {
            await load();
        } catch (error) {
            status.textContent = error.message;
        }
    }
}
