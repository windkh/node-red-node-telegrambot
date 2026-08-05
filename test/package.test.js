// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readdirSync, readFileSync } = require('node:fs');
const { join, posix } = require('node:path');

// What gets published. Without a `files` field npm ships everything not ignored, which was 109 files and
// 209 kB of tests, ADRs and editor settings; with one, the risk flips — a path left out is a package that
// installs and then does not work. These are the invariants that decide which.
//
// A real `npm pack` would be the direct check, but it shells out to npm and takes seconds. The rules below
// are what packing would prove, and they run in milliseconds.

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// True when `path` is inside one of the `files` entries. A directory entry ships the whole subtree.
function isShipped(path) {
    return pkg.files.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

describe('what npm publishes', () => {
    it('declares a files list at all', () => {
        assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'without one, everything ships');
    });

    it('ships the entry point Node-RED loads', () => {
        // The path in `node-red.nodes` is what the registry hands to Node-RED. Missing, the package
        // installs cleanly and contributes no nodes.
        const entry = pkg['node-red'].nodes.telegrambot;

        assert.strictEqual(entry, 'telegrambot/telegrambot.js');
        assert.ok(isShipped(entry), `${entry} is not covered by files`);
    });

    it('ships the examples, which Node-RED reads from the module', () => {
        // Only a module in node_modules gets its examples/ scanned — that is why this package is installed
        // rather than pointed at with nodesDir. Left out, the Import dialog shows nothing.
        assert.ok(isShipped('examples/'), 'examples/ must be published');
        assert.ok(readdirSync(join(root, 'examples')).length >= 8);
    });

    it('ships the documents the README links to', () => {
        for (const document of ['MIGRATION.md', 'CHANGELOG.md']) {
            assert.ok(isShipped(document), `${document} is linked from the README`);
        }
    });

    it('leaves out what only the repository needs', () => {
        // npm adds README, LICENSE and package.json whatever the list says, so they are deliberately absent
        // from `files`; these are the ones that would bloat the tarball.
        for (const directory of ['test/', 'test-helpers/', 'doc/', 'dev/', '.vscode/', '.github/']) {
            assert.ok(!isShipped(directory), `${directory} does not belong in the package`);
        }
    });

    it('has no runtime require reaching outside the package', () => {
        // The one thing that would turn a slimmer package into a broken one: a `require` that resolves in
        // the repository and not in the tarball. package.json is the single permitted escape — npm always
        // ships it — and telegrambot.js reads the version from it.
        const escapes = [];

        for (const directory of ['', 'lib', 'nodes']) {
            const from = join(root, 'telegrambot', directory);

            for (const name of readdirSync(from).filter((file) => file.endsWith('.js'))) {
                const source = readFileSync(join(from, name), 'utf8');

                for (const match of source.matchAll(/require\('(\.[^']*)'\)/g)) {
                    const target = posix.normalize(posix.join('telegrambot', directory, match[1]));

                    if (!target.startsWith('telegrambot/') && target !== 'package.json') {
                        escapes.push(`${directory}/${name} requires ${match[1]}`);
                    }
                }
            }
        }

        assert.deepStrictEqual(escapes, [], 'these would be missing from the published package');
    });
});
