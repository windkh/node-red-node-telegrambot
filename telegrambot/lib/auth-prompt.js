// Created by Karl-Heinz Wind
'use strict';

// The interactive login needs a phone code and possibly a 2FA password that only arrive later,
// through a separate admin request from the config node's editor dialog. Each `create*Promise`
// hands the pending promise to the login while parking its resolve/reject here, so the matching
// `settle*` call from that later request can complete it.
//
// The resolvers are module state on purpose: a login and its follow-up requests are separate
// HTTP calls, and only one login runs at a time.
let getPhoneCodeResolve;
let getPhoneCodeReject;
let getPasswordResolve;
let getPasswordReject;

function createPhoneCodePromise() {
    const getPhoneCode = new Promise((resolve, reject) => {
        getPhoneCodeResolve = resolve;
        getPhoneCodeReject = reject;
    });

    return getPhoneCode;
}

function createPasswordPromise() {
    const getPassword = new Promise((resolve, reject) => {
        getPasswordResolve = resolve;
        getPasswordReject = reject;
    });

    return getPassword;
}

// An empty value means the user dismissed the prompt: reject so the login aborts.
function settlePhoneCode(phoneCode) {
    if (getPhoneCodeResolve !== undefined && getPhoneCodeResolve !== null) {
        if (phoneCode !== '') {
            getPhoneCodeResolve(phoneCode);
        } else {
            getPhoneCodeReject(phoneCode);
        }
    }
}

function settlePassword(password) {
    if (getPasswordResolve !== undefined && getPasswordResolve !== null) {
        if (password !== '') {
            getPasswordResolve(password);
        } else {
            getPasswordReject(password);
        }
    }
}

module.exports = {
    createPhoneCodePromise,
    createPasswordPromise,
    settlePhoneCode,
    settlePassword,
};
