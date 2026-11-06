import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [gate, upstream = 'success'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const rows = [];
const add = (test, expected, actual, status, evidence, reason = '') =>
    rows.push({ gate, test, expected, actual, status, evidence, commit, reason });

mkdirSync('gate-evidence', { recursive: true });
if (upstream !== 'success') {
    add('prerequisite', 'Previous gate passed', upstream, 'BLOCKED', 'GitHub Actions dependency', 'Previous gate did not pass');
} else if (gate === '0') {
    const files = git('ls-files');
    const refs = git('for-each-ref', '--format=%(objectname) %(refname)');
    const commits = git('log', '--all', '--format=%H');
    const inventory = { files: files.split('\n'), refs: refs.split('\n'), commits: commits.split('\n') };
    writeFileSync('gate-evidence/repository-inventory.json', JSON.stringify(inventory, null, 2));
    let operations = '';
    try {
        operations = git('grep', '-lEi', '(ssh|scp|sftp|sysupgrade|/dev/mtd|reboot|flash)', '--', '.github', 'scripts', 'openwrt');
    } catch (err) {
        if (err.status !== 1) throw err;
    }
    writeFileSync('gate-evidence/operation-paths.txt', operations + '\n');
    add('inventory', 'List tracked files, refs and commits', 'Inventory generated', 'PASS', 'repository-inventory.json');
    add('operations', 'List tracked deployment and flash references', 'Candidate files enumerated', 'PASS', 'operation-paths.txt');
    add('audit', 'Review all historical refs, dependencies and secret exposure', 'Complete review evidence unavailable', 'NOT TESTED', 'repository-inventory.json');
} else {
    add('acceptance', 'All mandatory criteria have executable evidence', 'Full evidence unavailable', 'NOT TESTED', 'RECOVERY.md');
}
writeFileSync('gate-evidence/result.json', JSON.stringify(rows, null, 2) + '\n');
if (rows.some(row => row.status !== 'PASS')) process.exitCode = 1;
