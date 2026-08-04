// Created by Karl-Heinz Wind
'use strict';

// Loads the config node's editor script out of telegrambot.html and runs it against a stand-in for
// jQuery, so the login dialog's sequencing can be tested.
//
// The alternative was leaving it untested, and the login panel is exactly where that hurts: it is the
// one part of this package a user meets before anything works, its state lives in closures no other
// code can reach, and a browser is not available here. The script turns out to need only three things
// from its environment — `$`, `RED.nodes.registerType` and `RED.validators.number` — which is little
// enough to fake honestly.
//
// This deliberately fakes *nothing* about the dialog's own logic: the real script is executed, and the
// assertions read the visibility, values and posted requests it produced.
//
// Not in test/ because Node's test runner runs every .js under it, whatever the name.

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = join(__dirname, '..', 'telegrambot', 'telegrambot.html');

// One element per selector, created on first use. The dialog only ever addresses elements by id, so a
// map is a faithful model of what it can see.
function createElement(selector) {
    return {
        selector: selector,
        value: '',
        text: '',
        html: '',
        attributes: {},
        properties: {},
        // Rows in the login panel start hidden in the template; the script decides what to show.
        visible: !selector.includes('phonenumber') && !selector.includes('twofapassword'),
        handlers: { change: [], click: [] },
    };
}

function createDom() {
    const elements = new Map();
    const posted = [];
    // What the server would answer, keyed by route. A route with no answer queued leaves the request
    // pending, which is exactly what the held login response does while it waits for a code.
    const answers = new Map();

    const find = (selector) => {
        if (!elements.has(selector)) {
            elements.set(selector, createElement(selector));
        }

        return elements.get(selector);
    };

    const wrap = (element) => ({
        val(next) {
            let result = this;

            if (next === undefined) {
                result = element.value;
            } else {
                element.value = next;
            }

            return result;
        },
        text(next) {
            let result = this;

            if (next === undefined) {
                result = element.text;
            } else {
                element.text = next;
            }

            return result;
        },
        html(next) {
            let result = this;

            if (next === undefined) {
                result = element.html;
            } else {
                element.html = next;
            }

            return result;
        },
        attr(name, next) {
            let result = this;

            if (next === undefined) {
                result = element.attributes[name];
            } else {
                element.attributes[name] = next;
            }

            return result;
        },
        prop(name, next) {
            let result = this;

            if (next === undefined) {
                result = element.properties[name];
            } else {
                element.properties[name] = next;
            }

            return result;
        },
        empty() {
            element.html = '';

            return this;
        },
        show() {
            element.visible = true;

            return this;
        },
        hide() {
            element.visible = false;

            return this;
        },
        change(handler) {
            element.handlers.change.push(handler);

            return this;
        },
        click(handler) {
            element.handlers.click.push(handler);

            return this;
        },
    });

    const $ = (selector) => wrap(find(selector));

    // The script's postJson goes through this. Requests are recorded either way; a queued answer is
    // delivered synchronously, which is enough because the script only reads the response.
    $.ajax = (options) => {
        const request = { url: options.url, body: JSON.parse(options.data) };
        posted.push(request);

        if (answers.has(options.url)) {
            options.success(answers.get(options.url));
        }
    };

    return {
        $: $,
        posted: posted,
        // Reading and driving the dialog from a test.
        value: (id) => find('#node-config-input-' + id).value,
        set: (id, next) => {
            find('#node-config-input-' + id).value = next;
        },
        visible: (id) => find('#' + id).visible,
        tip: (id) => find('#' + id).text,
        answer: (route, data) => answers.set(route, data),
        routes: () => posted.map((request) => request.url),
        lastBody: (route) => {
            const matching = posted.filter((request) => request.url === route);

            return matching.length > 0 ? matching[matching.length - 1].body : undefined;
        },
        // Fires what the browser fires when a field is edited and then left.
        edit: (id, next) => {
            const element = find('#node-config-input-' + id);
            element.value = next;
            element.handlers.change.forEach((handler) => handler());
        },
        click: (id) => find('#' + id).handlers.click.forEach((handler) => handler()),
    };
}

// Runs the real script and returns the definition it registered, plus the DOM it acted on.
function loadConfigDialog() {
    const html = readFileSync(SOURCE, 'utf8');
    const blocks = [...html.matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)];
    const source = blocks.map((block) => block[1]).find((block) => block.includes("'telegram client config'"));

    const registered = {};
    const RED = {
        nodes: {
            registerType(type, definition) {
                registered[type] = definition;
            },
        },
        validators: {
            number: () => true,
        },
    };

    const dom = createDom();
    // Executing the shipped editor script as-is, which is the point: a copy of its logic here would
    // agree with itself forever while the real dialog drifted.
    new Function('RED', '$', source)(RED, dom.$);

    const definition = registered['telegram client config'];
    definition.oneditprepare.call({ id: 'c1' });

    return { definition: definition, dom: dom };
}

module.exports = {
    loadConfigDialog,
};
