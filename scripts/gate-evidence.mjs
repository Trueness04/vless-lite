import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [gate, upstream = 'success'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const rows = [];
const add = (test, expected, actual, status, evidence, reason = '') =>
    rows.push({ gate, test, expected, actual, status, evidence, commit, reason });

const criteria = JSON.parse(readFileSync(new URL('./gate-criteria.json', import.meta.url), 'utf8'))[gate];
if (!criteria) throw new Error('Unknown gate');
mkdirSync('gate-evidence', { recursive: true });
if (upstream !== 'success') {
    for (const criterion of criteria) {
        add(criterion.test, criterion.expected, upstream, 'BLOCKED', 'GitHub Actions dependency', 'Previous gate did not pass');
    }
} else if (gate === '0') {
    const files = git('ls-files');
    const refs = git('for-each-ref', '--format=%(objectname) %(refname)');
    const commits = git('log', '--all', '--format=%H');
    const inventory = { files: files.split('\n'), refs: refs.split('\n'), commits: commits.split('\n') };
    writeFileSync('gate-evidence/repository-inventory.json', JSON.stringify(inventory, null, 2));
    const operations = git('log', '--all', '--format=%H', '--name-only', '-G',
        '(ssh|scp|sftp|sysupgrade|/dev/mtd|mtd write|reboot|flash)');
    writeFileSync('gate-evidence/operation-paths.txt', operations + '\n');
    add('inventory', 'List tracked files, refs and commits', 'Inventory generated', 'PASS', 'repository-inventory.json');
    add('operations', 'List tracked deployment and flash references', 'Candidate files enumerated', 'PASS', 'operation-paths.txt');
    const base = '299cf61dea884a50d6c27206a4ddac56afdd7d49';
    const check = async (id, artifact, inspect) => {
        const expected = criteria.find(row => row.test === id).expected;
        try {
            const { valid, details } = await inspect();
            writeFileSync('gate-evidence/' + artifact, JSON.stringify(details, null, 2) + '\n');
            add(id, expected, valid ? 'Evidence verified' : 'Evidence did not match',
                valid ? 'PASS' : 'FAIL', artifact);
        } catch (error) {
            add(id, expected, 'Evidence unavailable', 'NOT TESTED', artifact, error.message);
        }
    };
    const get = async url => {
        const reply = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!reply.ok) throw new Error('HTTP ' + reply.status + ' for ' + url);
        return reply;
    };
    const source = 'https://raw.githubusercontent.com/openwrt/openwrt/64900e756efa667774214f9c6b17c113222e01f7/target/linux/ath79/dts/';
    await check('0.5', 'target.json', async () => {
        const url = 'https://downloads.openwrt.org/releases/25.12.6/targets/ath79/tiny/profiles.json';
        const { target, arch_packages, profiles } = await (await get(url)).json();
        const profile = profiles?.['dlink_dir-869-a1'];
        const config = git('show', 'HEAD:openwrt/dir-869.config');
        return {
            valid: target === 'ath79/tiny' && arch_packages === 'mips_24kc' &&
                profile?.supported_devices.includes('dlink,dir-869-a1') &&
                config.includes('CONFIG_TARGET_DEVICE_ath79_tiny_DEVICE_dlink_dir-869-a1=y'),
            details: { url, target, arch_packages, profile },
        };
    });
    await check('0.6', 'partitions.json', async () => {
        const board = 'qca9563_dlink_dir-869-a1.dts';
        const common = 'qca9563_dlink_dir-8x9-a1.dtsi';
        const [dts, dtsi] = await Promise.all([board, common].map(async file => (await get(source + file)).text()));
        const partitions = [...dtsi.matchAll(/partition@[0-9a-f]+\s*\{\s*(?:compatible = "[^"]+";\s*)?label = "([^"]+)";\s*reg = <(0x[0-9a-f]+) (0x[0-9a-f]+)>;/g)]
            .map(([, name, start, size]) => ({ name, start, size }));
        return {
            valid: dts.includes('#include "' + common + '"') && partitions.some(({ name, start, size }) =>
                name === 'firmware' && Number(start) === 0x70000 && Number(size) === 0xf80000),
            details: { sources: [source + board, source + common], partitions },
        };
    });
    await check('0.8', 'baseline.json', () => {
        const ancestry = execFileSync('git', ['rev-list', '--ancestry-path', base + '..HEAD'], { encoding: 'utf8' }).trim();
        return { valid: commit === base || ancestry.split('\n').includes(commit),
            details: { base, commit, tree: git('rev-parse', 'HEAD^{tree}') } };
    });
    for (const criterion of criteria.filter(row => !rows.some(result => result.test === row.test))) {
        add(criterion.test, criterion.expected, 'See reviewed scope and remaining evidence', 'NOT TESTED', 'RECOVERY.md');
    }
} else {
    for (const criterion of criteria) add(criterion.test, criterion.expected, 'Complete evidence unavailable', 'NOT TESTED', 'RECOVERY.md');
}
writeFileSync('gate-evidence/result.json', JSON.stringify(rows, null, 2) + '\n');
if (rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
