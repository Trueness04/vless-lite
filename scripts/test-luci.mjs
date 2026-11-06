import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = readFileSync('openwrt/package/files/www/luci-static/resources/view/vless-lite/settings.js', 'utf8');

// The view and DOM event handling are exercised with isolated UCI and ubus doubles.
async function exercise(source, equal, document) {
    const options = {};
    const buttons = new Map();
    const profile = 'vless://11111111-1111-4111-8111-111111111111@example.test:443?security=tls';
    let saved = { main: { resolver: '1.1.1.1' } };
    let draft = structuredClone(saved);
    let staged;
    let running = false;
    let failure = '';
    let result;
    let pending;
    const operations = [];
    const node = document?.createElement('div');
    if (node) document.body.append(node);
    class FormMap {
        section() { return { option: name => (options[name] = { value() {} }) }; }
        render() { return Promise.resolve(document?.createElement('div') || {}); }
        async save(preflight) {
            await preflight();
            staged = structuredClone(draft);
        }
    }
    const view = new Function('view', 'form', 'poll', 'rpc', 'uci', 'ui', 'E', '_', 'window', source)(
        { extend: definition => definition },
        { Map: FormMap },
        { add: () => {} },
        { declare: ({ object, method, reject }) => async (...args) => {
            equal(reject, true);
            operations.push([object, method]);
            if (failure === method) throw new Error('RPC ' + method + ' failed');
            if (method === 'validate') return args[0] === profile ? { ok: true } : { ok: false, error: 'Invalid profile' };
            if (method === 'commit') {
                equal(args, ['vless-lite']);
                saved = staged;
            }
            if (method === 'connect') running = true;
            if (method === 'disconnect') running = false;
            if (method === 'probe') return { ok: false, error: 'Proxy unreachable' };
            return { ok: true };
        } },
        { sections: () => {}, get: (_, section, option) => draft[section]?.[option] },
        { createHandlerFn: (_, action) => () => { pending = action(); } },
        (tag, attrs, content) => {
            const element = document?.createElement(tag) || { textContent: '' };
            if (tag === 'button') {
                element.textContent = content;
                if (document) element.addEventListener('click', attrs.click);
                else element.click = attrs.click;
                buttons.set(content, element);
            } else if (attrs['aria-live']) result = element;
            if (document && Array.isArray(content)) element.append(...content);
            return element;
        },
        value => value,
        { location: { reload() {} } },
    );
    const click = async title => {
        buttons.get(title).click();
        await pending;
    };
    const rendered = await view.render();
    node?.append(rendered);
    draft.node1 = { link: profile };
    await click('Save profiles and settings');
    equal(saved.node1.link, profile);
    draft.main.active = 'node1';
    await click('Save and connect');
    equal(saved.main.active, 'node1');
    equal(running, true);
    equal(result.textContent, 'Start requested. Check core status, then test the connection.');
    await click('Test active connection');
    equal(result.textContent, 'Proxy unreachable');
    draft.node1.link = profile + '&type=grpc';
    await click('Save and connect');
    equal(result.textContent, 'Error: Invalid profile');
    equal(saved.node1.link, profile);
    equal(running, true);
    draft.node1.link = profile;
    failure = 'commit';
    operations.length = 0;
    await click('Save and connect');
    equal(operations, [['vless-lite', 'validate'], ['uci', 'commit']]);
    equal(result.textContent, 'Error: RPC commit failed');
    failure = '';
    delete draft.node1;
    await click('Save profiles and settings');
    equal(saved.node1.link, profile);
    delete draft.main.active;
    await click('Save profiles and settings');
    equal(saved.node1, undefined);
    await click('Disconnect');
    equal(running, false);
    failure = 'connect';
    draft.node1 = { link: profile };
    draft.main.active = 'node1';
    await click('Save and connect');
    equal(result.textContent, 'Error: RPC connect failed');
    equal(running, false);
}

await exercise(source, assert.deepEqual);
if (process.env.VLESS_TEST_CHROME) {
    const dir = mkdtempSync(join(tmpdir(), 'vless-luci-'));
    try {
        const html = join(dir, 'test.html');
        writeFileSync(html, '<!doctype html><body><script>(async () => {' +
            'const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(JSON.stringify([a, b])); };' +
            'await (' + exercise + ')(' + JSON.stringify(source).replaceAll('<', '\\u003c') + ', equal, document);' +
            'document.body.textContent = "VLESS_BROWSER_PASS";' +
            '})().catch(error => { document.body.textContent = String(error); });</script>');
        const dom = execFileSync(process.env.VLESS_TEST_CHROME, [
            '--headless', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(dir, 'profile'),
            '--dump-dom', pathToFileURL(html).href,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
        assert.match(dom, /<body>VLESS_BROWSER_PASS<\/body>/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
