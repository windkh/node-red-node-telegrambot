// Created by Karl-Heinz Wind
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Remembers where the update stream had got to, so messages that arrived while Node-RED was down can be
// fetched on the next start.
//
// MTProto is built for this: a client keeps `pts` / `qts` / `date` / `seq` and asks
// `updates.getDifference` for everything since. teleproto's UpdateManager does all of that — the
// sequencing, the difference loop, `differenceTooLong`, `updatesTooLong`, and even deduplication at the
// dispatch boundary. The one thing it cannot do is know where the stream was before the process existed:
// `ensureState()` initialises from the server's *current* state, which is precisely "skip what was
// missed". So the only missing piece is this file.
//
// `pts` and friends are sequence numbers, not credentials — nothing here is secret, unlike the session
// store in ./session-store.
// See doc/architecture/adr/0019-catch-up-on-missed-updates.md.

const STATE_DIRECTORY = 'telegram-updates';

// One file per config node, next to Node-RED's own data rather than in the working directory, for the
// same reason as the session store: the working directory depends on how Node-RED was started.
function updateStatePath(baseDirectory, nodeId) {
    return path.join(baseDirectory, STATE_DIRECTORY, nodeId + '.json');
}

// All four have to be real numbers before the state is worth seeding: handing teleproto a partial state
// would make it ask Telegram for a difference from nowhere.
//
// This is a boundary check, not defensive programming about our own code — the file can be absent on a
// first run, truncated by a crash, or hand-edited.
function isUsableState(state) {
    const numbers = ['pts', 'qts', 'date', 'seq'];

    return state !== null && typeof state === 'object' && numbers.every((key) => Number.isFinite(state[key]));
}

// The saved state, or undefined when there is nothing usable. Never throws: a missing or damaged file
// means "start from now", which is what every version before this did anyway.
function readUpdateState(filePath, warn) {
    let state;

    if (fs.existsSync(filePath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            if (isUsableState(parsed)) {
                state = { pts: parsed.pts, qts: parsed.qts, date: parsed.date, seq: parsed.seq };
            } else {
                warn('The saved update position in ' + filePath + ' is not usable, so catch-up starts from now.');
            }
        } catch (error) {
            warn('Could not read the saved update position from ' + filePath + ': ' + error.message);
        }
    }

    return state;
}

// Written through a temporary file and renamed, because a crash part way through a plain write would
// leave a truncated one — and then the position is lost, which is the exact thing this file exists to
// prevent. `rename` within a directory is atomic on both POSIX and Windows.
function writeUpdateState(filePath, state, warn) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        const temporary = filePath + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(state));
        fs.renameSync(temporary, filePath);
    } catch (error) {
        // Reported, not thrown: failing to remember the position must not take a flow down. The cost is
        // that the next start replays from an older point, or from now.
        warn('Could not save the update position to ' + filePath + ': ' + error.message);
    }
}

module.exports = {
    STATE_DIRECTORY,
    updateStatePath,
    isUsableState,
    readUpdateState,
    writeUpdateState,
};
