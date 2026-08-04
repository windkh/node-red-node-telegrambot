// Created by Karl-Heinz Wind
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { loadConfigDialog } = require('../test-helpers/editor-dialog');

const LOGIN = 'node-red-node-telegrambot-login';
const SET_CODE = 'node-red-node-telegrambot-setphonecode';
const SET_PASSWORD = 'node-red-node-telegrambot-setpassword';
const LOGIN_QR = 'node-red-node-telegrambot-loginqr';

// A dialog with the api credentials filled in and no session, which is what someone about to log in has.
// The login route is left unanswered on purpose: the real one holds its response open until a session
// exists, so an unanswered request is the accurate model of a login in progress.
function readyToLogIn() {
    const { dom } = loadConfigDialog();
    dom.set('apiid', '12345');
    dom.set('apihash', 'hash');
    dom.set('phonenumber', '+490000000');

    return dom;
}

describe('the login dialog asks for one thing at a time', () => {
    it('shows no password field before a login is running', () => {
        const dom = readyToLogIn();

        // The complaint this fixes: the password field sat next to the code field from the start, so
        // there was nothing to say which to fill or when.
        assert.strictEqual(dom.visible('twofapassword'), false);
        assert.strictEqual(dom.visible('loginpanel'), true, 'no session means the panel is open');
    });

    it('asks for the code first, and says how to submit it', () => {
        const dom = readyToLogIn();
        dom.click('loginbutton');

        assert.deepStrictEqual(dom.routes(), [LOGIN]);
        assert.strictEqual(dom.visible('twofapassword'), false, 'nothing is waiting for a password yet');
        // Leaving the field is what submits, and nothing on the panel says so unless the tip does.
        assert.match(dom.tip('loginbuttontip'), /Step 1 of 2/);
        assert.match(dom.tip('loginbuttontip'), /click outside the field/);
    });

    it('offers the password only once the code is in', () => {
        const dom = readyToLogIn();
        dom.click('loginbutton');
        dom.edit('phonecode', '54321');

        assert.deepStrictEqual(dom.routes(), [LOGIN, SET_CODE]);
        assert.deepStrictEqual(dom.lastBody(SET_CODE), { phoneCode: '54321' });
        assert.strictEqual(dom.visible('twofapassword'), true);
        assert.match(dom.tip('loginbuttontip'), /Step 2 of 2/);
        // Offered, not demanded: whether Telegram asks is up to the account, and the editor is not told.
        assert.match(dom.tip('loginbuttontip'), /If it has none, you are done/);
    });

    it('posts the password once the code has been accepted', () => {
        const dom = readyToLogIn();
        dom.click('loginbutton');
        dom.edit('phonecode', '54321');
        dom.edit('twofapassword', 'the-password');

        assert.deepStrictEqual(dom.routes(), [LOGIN, SET_CODE, SET_PASSWORD]);
        assert.deepStrictEqual(dom.lastBody(SET_PASSWORD), { password: 'the-password' });
    });

    it('says the stored password is being used instead of asking again', () => {
        // The case that used to cancel the login outright: Node-RED fills a stored password field with
        // __PWRD__ itself, so this is the normal state of a re-login, not something the user did.
        const dom = readyToLogIn();
        dom.set('twofapassword', '__PWRD__');
        dom.click('loginbutton');

        assert.strictEqual(dom.lastBody(LOGIN).password, '__PWRD__', 'it travels with the login request');

        dom.edit('phonecode', '54321');

        assert.strictEqual(dom.visible('twofapassword'), false, 'there is nothing left to ask for');
        assert.match(dom.tip('loginbuttontip'), /password you entered/);
    });

    it('ignores a password typed before anything asked for one', () => {
        const dom = readyToLogIn();
        dom.click('loginbutton');
        dom.edit('twofapassword', 'too-early');

        // Settles nothing on the server, so the "signing in using password" tip would have been a lie.
        assert.deepStrictEqual(dom.routes(), [LOGIN], 'no password may be posted while the code is due');
        assert.match(dom.tip('loginbuttontip'), /Step 1 of 2/);
    });

    it('ignores a code typed with no login running', () => {
        const dom = readyToLogIn();
        dom.edit('phonecode', '54321');

        assert.deepStrictEqual(dom.routes(), [], 'there is no pending prompt to settle');
    });
});

describe('the login dialog reports how it ended', () => {
    it('fills in the session and closes the panel', () => {
        const dom = readyToLogIn();
        dom.answer(LOGIN, { session: 'the-session-string' });
        dom.click('loginbutton');

        assert.strictEqual(dom.value('session'), 'the-session-string');
        assert.strictEqual(dom.visible('loginpanel'), false);
        assert.strictEqual(dom.visible('twofapassword'), false);
        assert.strictEqual(dom.value('phonecode'), '', 'a used code must not sit in the dialog');
    });

    it('says what failed and that a retry starts over', () => {
        const dom = readyToLogIn();
        dom.answer(LOGIN, { error: 'PHONE_CODE_INVALID' });
        dom.click('loginbutton');

        assert.match(dom.tip('loginbuttontip'), /PHONE_CODE_INVALID/);
        assert.match(dom.tip('loginbuttontip'), /Click Login to start over/);
        assert.strictEqual(dom.value('session'), '', 'a failed login must leave no session behind');
        assert.strictEqual(dom.visible('twofapassword'), false);
    });

    it('takes no code or password after it has ended', () => {
        const dom = readyToLogIn();
        dom.answer(LOGIN, { error: 'PHONE_NUMBER_INVALID' });
        dom.click('loginbutton');
        dom.edit('phonecode', '54321');
        dom.edit('twofapassword', 'the-password');

        assert.deepStrictEqual(dom.routes(), [LOGIN]);
    });
});

// The QR login has no code step - the scan replaces it - but it shares the password prompt, and so the
// same field. Hiding that field by default would have broken it silently.
describe('the QR login still gets to the password', () => {
    it('shows the password field as soon as it starts', () => {
        const dom = readyToLogIn();
        dom.click('loginqrbutton');

        assert.deepStrictEqual(dom.routes(), [LOGIN_QR]);
        assert.strictEqual(dom.visible('twofapassword'), true);
        assert.match(dom.tip('loginqrtip'), /Starting QR login/);
    });

    it('posts a password typed while the code is being scanned', () => {
        const dom = readyToLogIn();
        dom.click('loginqrbutton');
        dom.edit('twofapassword', 'the-password');

        assert.deepStrictEqual(dom.routes(), [LOGIN_QR, SET_PASSWORD]);
        assert.deepStrictEqual(dom.lastBody(SET_PASSWORD), { password: 'the-password' });
    });

    it('does not start without the api credentials', () => {
        const { dom } = loadConfigDialog();
        dom.click('loginqrbutton');

        assert.deepStrictEqual(dom.routes(), []);
        assert.match(dom.tip('loginqrtip'), /API ID and API Hash/);
    });
});
