import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = 'openwrt/package/files/www/luci-static/resources/view/vless-lite/settings.js';
const source = readFileSync(file, 'utf8');
const operations = [];
const buttons = new Map();
let rejectCommit = false;
class FormMap {
    section() { return { option: () => ({ value() {} }) }; }
    render() { return Promise.resolve({}); }
    save() {
        operations.push('save');
        return Promise.resolve();
    }
}

const renderView = new Function('view', 'form', 'poll', 'rpc', 'uci', 'ui', 'E', '_', source);
const view = renderView(
    { extend: definition => definition },
    { Map: FormMap },
    { add: () => {} },
    { declare: ({ object, method }) => async (...args) => {
        operations.push([object, method, ...args]);
        if (method === 'commit' && rejectCommit) throw new Error('Commit failed');
        return { ok: true };
    } },
    { sections: () => {} },
    { createHandlerFn: (_, action) => action },
    (tag, attrs, content) => {
        if (tag === 'button') buttons.set(content, attrs.click);
        return { content, textContent: '' };
    },
    value => value,
);
await view.render();
operations.length = 0;
await buttons.get('Save and connect')();
assert.deepEqual(operations, [
    'save', ['uci', 'commit', 'vless-lite'], ['vless-lite', 'connect'], ['vless-lite', 'status'],
]);
rejectCommit = true;
operations.length = 0;
await buttons.get('Save and connect')();
assert.deepEqual(operations, ['save', ['uci', 'commit', 'vless-lite']]);
