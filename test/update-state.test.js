// Created by Karl-Heinz Wind
'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helper = require('node-red-node-test-helper');
const telegramBotNode = require('../telegrambot/telegrambot.js');
const {
    STATE_DIRECTORY,
    updateStatePath,
    isUsableState,
    readUpdateState,
    writeUpdateState,
} = require('../telegrambot/lib/update-state');

helper.init(require.resolve('node-red'));

const A_POSITION = { pts: 4242, qts: 7, date: 1785700000, seq: 91 };

describe('updateStatePath', () => {
    it('puts one file per config node next to Node-RED’s own data', () => {
        const first = updateStatePath('/data', 'aaa');
        const second = updateStatePath('/data', 'bbb');

        assert.strictEqual(first, path.join('/data', STATE_DIRECTORY, 'aaa.json'));
        assert.notStrictEqual(first, second, 'two config nodes must not share a position');
    });
});

describe('isUsableState', () => {
    it('accepts a complete position', () => {
        assert.strictEqual(isUsableState(A_POSITION), true);
    });

    it('rejects a partial one, which would make the library ask for a difference from nowhere', () => {
        for (const missing of ['pts', 'qts', 'date', 'seq']) {
            const partial = { ...A_POSITION };
            delete partial[missing];

            assert.strictEqual(isUsableState(partial), false, `a state without ${missing} is not usable`);
        }
    });

    it('rejects values that are not finite numbers', () => {
        assert.strictEqual(isUsableState({ ...A_POSITION, pts: '4242' }), false, 'a string is not a sequence number');
        assert.strictEqual(isUsableState({ ...A_POSITION, qts: NaN }), false);
        assert.strictEqual(isUsableState({ ...A_POSITION, seq: Infinity }), false);
    });

    it('rejects nothing at all', () => {
        for (const value of [undefined, null, 'state', 42, []]) {
            assert.strictEqual(isUsableState(value), false, JSON.stringify(value));
        }
    });
});

describe('reading and writing the position', () => {
    let temporary;

    before(() => {
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'telegrambot-updates-'));
    });

    after(() => {
        fs.rmSync(temporary, { recursive: true, force: true });
    });

    it('round trips a position', () => {
        const file = path.join(temporary, 'round', 'trip.json');
        const warnings = [];

        writeUpdateState(file, A_POSITION, (message) => warnings.push(message));

        assert.deepStrictEqual(
            readUpdateState(file, (message) => warnings.push(message)),
            A_POSITION
        );
        assert.deepStrictEqual(warnings, [], 'a clean round trip has nothing to report');
    });

    it('creates the directory it needs', () => {
        const file = path.join(temporary, 'a', 'b', 'c.json');
        writeUpdateState(file, A_POSITION, () => {});

        assert.ok(fs.existsSync(file));
    });

    it('leaves no temporary file behind', () => {
        // The write goes through a temporary file and a rename so a crash part way cannot leave a
        // truncated one — which would lose the position, the exact thing this is for.
        const file = path.join(temporary, 'clean.json');
        writeUpdateState(file, A_POSITION, () => {});

        assert.strictEqual(fs.existsSync(file + '.tmp'), false);
    });

    it('says nothing about a first run, where there is simply no file', () => {
        const warnings = [];
        const state = readUpdateState(path.join(temporary, 'never-written.json'), (message) => warnings.push(message));

        assert.strictEqual(state, undefined);
        // A first run is normal, not a problem: warning about it would cry wolf on every fresh install.
        assert.deepStrictEqual(warnings, []);
    });

    it('reports a truncated file instead of throwing, and starts from now', () => {
        const file = path.join(temporary, 'truncated.json');
        fs.writeFileSync(file, '{"pts":4242,"qts":');

        const warnings = [];
        const state = readUpdateState(file, (message) => warnings.push(message));

        assert.strictEqual(state, undefined, 'an unreadable position must not stop the flow starting');
        assert.strictEqual(warnings.length, 1);
    });

    it('reports a file that parses but is not a position', () => {
        const file = path.join(temporary, 'wrong-shape.json');
        fs.writeFileSync(file, JSON.stringify({ pts: 1 }));

        const warnings = [];

        assert.strictEqual(
            readUpdateState(file, (message) => warnings.push(message)),
            undefined
        );
        assert.match(warnings[0], /not usable/);
    });

    it('keeps only the four numbers, whatever else the file holds', () => {
        const file = path.join(temporary, 'extra.json');
        fs.writeFileSync(file, JSON.stringify({ ...A_POSITION, somethingElse: 'ignored' }));

        assert.deepStrictEqual(
            readUpdateState(file, () => {}),
            A_POSITION
        );
    });
});

// The config node is what decides whether to catch up at all, and the option existing is not the same as
// the option being obeyed.
describe('catching up', () => {
    let temporary;
    let previousUserDir;

    before(async () => {
        await new Promise((resolve) => helper.startServer(resolve));
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'telegrambot-catchup-'));
        previousUserDir = helper.settings().userDir;
    });

    afterEach(async () => {
        await helper.unload();
    });

    after(async () => {
        await new Promise((resolve) => helper.stopServer(resolve));
        fs.rmSync(temporary, { recursive: true, force: true });
    });

    // The helper's RED.settings is what the config node reads userDir from.
    function withUserDir() {
        const settings = helper.settings();
        settings.userDir = temporary;

        return settings;
    }

    async function loadConfig(extra) {
        withUserDir();
        await helper.load(telegramBotNode, [{ id: 'c1', type: 'telegram client config', botname: 'test', ...extra }]);

        const c1 = helper.getNode('c1');
        const seeded = [];
        const client = {
            updateManager: {
                state: { pts: 5000, qts: 9, date: 1785800000, seq: 100 },
                refreshFromState: (state) => seeded.push(state),
            },
            catchUp: async () => seeded.push('catchUp'),
            addEventHandler: () => {},
            destroy: async () => {},
        };
        c1.createTelegramClient = async () => client;

        return { c1: c1, client: client, seeded: seeded };
    }

    it('does nothing at all when the option is off', async () => {
        const file = updateStatePath(temporary, 'c1');
        writeUpdateState(file, A_POSITION, () => {});

        const { c1, seeded } = await loadConfig({ catchup: false });
        await c1.getTelegramClient(c1);

        assert.deepStrictEqual(seeded, [], 'nothing may be replayed unless it was asked for');
    });

    it('seeds the saved position and then catches up', async () => {
        writeUpdateState(updateStatePath(temporary, 'c1'), A_POSITION, () => {});

        const { c1, seeded } = await loadConfig({ catchup: true });
        await c1.getTelegramClient(c1);

        // The order is the point: seeding after catchUp would fetch the difference from the server's
        // current position, which is the same as skipping the gap.
        assert.deepStrictEqual(seeded, [A_POSITION, 'catchUp']);
    });

    it('does not ask for a difference when there is no saved position', async () => {
        const { c1, seeded } = await loadConfig({ catchup: true });
        await c1.getTelegramClient(c1);

        // A first run has nothing to catch up on; the library initialises from the server itself.
        assert.deepStrictEqual(seeded, []);
    });

    it('writes the reached position on close, which is what the next start resumes from', async () => {
        const { c1 } = await loadConfig({ catchup: true });
        await c1.getTelegramClient(c1);

        await c1.closeTelegramClient();

        assert.deepStrictEqual(
            readUpdateState(updateStatePath(temporary, 'c1'), () => {}),
            {
                pts: 5000,
                qts: 9,
                date: 1785800000,
                seq: 100,
            }
        );
    });

    it('writes nothing on close when the option is off, and says nothing either', async () => {
        const { c1 } = await loadConfig({ catchup: false });
        const warnings = [];
        c1.warn = (message) => warnings.push(message);

        await c1.getTelegramClient(c1);
        await c1.closeTelegramClient();

        assert.strictEqual(fs.existsSync(updateStatePath(temporary, 'c1')), false);
        // Without the guard there is no file either — but every redeploy warns about failing to write
        // one, which is noise for a feature the user never switched on.
        assert.deepStrictEqual(warnings, []);
    });

    it('starts anyway when catching up fails', async () => {
        writeUpdateState(updateStatePath(temporary, 'c1'), A_POSITION, () => {});

        const { c1, client } = await loadConfig({ catchup: true });
        client.catchUp = async () => {
            throw new Error('CHANNEL_INVALID');
        };
        const warnings = [];
        c1.warn = (message) => warnings.push(message);

        const returned = await c1.getTelegramClient(c1);

        // The live stream still works, so a failed replay must not cost the deploy.
        assert.strictEqual(returned, client);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /catch up/);
    });

    afterEach(() => {
        const settings = helper.settings();
        settings.userDir = previousUserDir;
        const file = updateStatePath(temporary, 'c1');
        fs.rmSync(file, { force: true });
    });
});
