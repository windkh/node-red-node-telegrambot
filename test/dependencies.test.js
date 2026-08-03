// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');

// The move off GramJS is a find-and-replace across eighteen require sites, and a missed one is not
// necessarily loud: `telegram` may still be lying around in node_modules on a developer's machine, or
// be hoisted in from something else, in which case the stale path resolves and two MTProto libraries
// end up in the same process. These two checks are what make that a test failure rather than a
// mystery. See doc/architecture/adr/0013-migrate-to-teleproto.md.
const SOURCE_ROOT = path.join(__dirname, '..', 'telegrambot');

function collectSources(directory) {
    const found = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectSources(full));
        } else if (entry.name.endsWith('.js')) {
            found.push(full);
        }
    }

    return found;
}

const SOURCES = collectSources(SOURCE_ROOT);

describe('MTProto dependency', () => {
    it('finds the source files it is about to check', () => {
        // Without this the two tests below pass vacuously if the layout ever moves.
        assert.ok(SOURCES.length >= 10, `expected the nodes and lib modules, found ${SOURCES.length}`);
    });

    it('is teleproto, and GramJS is not a dependency of any kind', () => {
        const declared = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.peerDependencies,
        };

        assert.ok(declared.teleproto, 'teleproto must be a declared dependency');
        assert.ok(!('telegram' in declared), 'the archived GramJS package must not be declared');
    });

    it('is what every source file requires', () => {
        for (const file of SOURCES) {
            const source = fs.readFileSync(file, 'utf8');
            const paths = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
            const stale = paths.filter((required) => required === 'telegram' || required.startsWith('telegram/'));

            assert.deepStrictEqual(stale, [], `${path.relative(SOURCE_ROOT, file)} still requires GramJS`);
        }
    });

    it('loads every module, so no require path is merely unvisited', () => {
        // The node modules export `function (RED)` and register nothing until called, so requiring
        // them is side effect free — but it does resolve their imports, which is the point.
        for (const file of SOURCES) {
            assert.doesNotThrow(() => require(file), `${path.relative(SOURCE_ROOT, file)} does not load`);
        }
    });
});
