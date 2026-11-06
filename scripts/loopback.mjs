import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import http2 from 'node:http2';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const binary = process.argv[2] || './dist/xray-lite-host';
const run = promisify(execFile);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'vless-lite-'));
const children = [];
let decoy;
let server;
const local = '127.0.0.1';
const template = 'openwrt/package/files/etc/vless-lite/config.json';
const base = JSON.parse(await readFile(template));
const id = base.outbounds[0].settings.vnext[0].users[0].id;

async function listen(socket) {
    socket.listen(0, local);
    await once(socket, 'listening');
    return socket.address().port;
}

async function reservePort() {
    const socket = net.createServer();
    const port = await listen(socket);
    socket.close();
    await once(socket, 'close');
    return port;
}

async function start(name, config) {
    const file = path.join(tmp, name + '.json');
    await writeFile(file, JSON.stringify(config));
    const runner = process.env.VLESS_TEST_EMULATOR;
    const child = spawn(runner || binary, [...(runner ? [binary] : []), 'run', '-config', file]);
    children.push(child);
    child.stderr.pipe(process.stderr);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(name + ' did not start')), 5000);
        child.once('error', reject);
        child.once('exit', code => reject(new Error(name + ' exited with ' + code)));
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.includes(' started')) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
    return child;
}

try {
    const keyPath = path.join(tmp, 'key.pem');
    const certPath = path.join(tmp, 'cert.pem');
    await run('go', ['run', './scripts/test-cert.go', certPath, keyPath]);
    const cert = await readFile(certPath);
    const key = await readFile(keyPath);
    server = https.createServer({ key, cert }, (_, response) => response.end('vless-lite-loopback'));
    const target = await listen(server);
    const pin = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
    decoy = http2.createSecureServer({ key, cert, allowHTTP1: true });
    decoy.on('request', (_, response) => response.end('decoy'));
    const decoyPort = await listen(decoy);
    const keys = generateKeyPairSync('x25519');
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64url');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    const shortId = '0123456789abcdef';
    const combinations = ['raw', 'xhttp'].flatMap(network =>
        ['none', 'tls', 'reality'].map(security => [network, security]));
    for (const [network, security] of combinations) {
        const inbound = await reservePort();
        const socks = await reservePort();
        const proxy = await reservePort();
        const streamSettings = { network, security };
        const parameters = new URLSearchParams({ type: network, security });
        if (network === 'xhttp') {
            streamSettings.xhttpSettings = { path: '/test' };
            parameters.set('path', '/test');
        }
        const serverStream = { ...streamSettings };
        if (security === 'tls') {
            serverStream.tlsSettings = { certificates: [{ certificateFile: certPath, keyFile: keyPath }] };
        }
        if (security === 'reality') {
            for (const [key, value] of Object.entries({ sni: 'localhost', pbk: publicKey, sid: shortId })) {
                parameters.set(key, value);
            }
            serverStream.realitySettings = { target: local + ':' + decoyPort, serverNames: ['localhost'], privateKey, shortIds: [shortId] };
        }
        const upstream = await start('upstream', {
            inbounds: [{
                listen: local, port: inbound, protocol: 'vless',
                settings: { clients: [{ id }], decryption: 'none' }, streamSettings: serverStream,
            }],
            outbounds: [{ protocol: 'freedom', settings: { finalRules: [{ action: 'allow', ip: [local], port: target }] } }],
        });
        const runner = process.env.VLESS_TEST_EMULATOR;
        const link = `vless://${id}@${local}:${inbound}?${parameters}`;
        const rendered = await run(runner || binary, [
            ...(runner ? [binary] : []), 'manager', 'render', template, '1.1.1.1', '',
        ], { env: { ...process.env, VLESS_LITE_LINK: link } });
        const config = JSON.parse(rendered.stdout);
        config.inbounds = config.inbounds.filter(({ protocol }) => protocol === 'socks' || protocol === 'http');
        for (const entry of config.inbounds) entry.port = entry.protocol === 'socks' ? socks : proxy;
        if (security === 'tls') {
            const tls = config.outbounds[0].streamSettings.tlsSettings;
            assert.equal(tls.serverName, local);
            tls.pinnedPeerCertSha256 = pin;
        }
        const client = await start('client', config);
        for (const url of [`socks5h://${local}:${socks}`, `http://${local}:${proxy}`]) {
            for (let connection = 0; connection < 10; connection++) {
                const result = await run('curl', ['-fsS', '--max-time', '5', '--noproxy', '', '--proxy', url, '--cacert', certPath, `https://${local}:${target}/`]);
                assert.equal(result.stdout, 'vless-lite-loopback');
            }
        }
        client.kill();
        upstream.kill();
        console.log(network + '/' + security + ' VLESS via SOCKS5 and HTTP passed');
    }
} finally {
    for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await once(child, 'close').catch(() => {});
        }
    }
    if (decoy) decoy.close();
    if (server) server.close();
    await rm(tmp, { recursive: true, force: true });
}

