'use strict';

/**
 * Runs the built SendApp node (dist/) outside n8n: a minimal execution context with the node's
 * parameters, the «SendApp API» credential and an HTTP helper. `transport` decides where the
 * requests go: a list of fake answers (unit tests) or the real network (a local SendApp).
 *
 * The helper mirrors what n8n does for this credential: X-API-Key header from `authenticate`,
 * JSON body, `returnFullResponse` / `ignoreHttpStatusErrors` honoured, an error thrown on >= 400.
 */

const path = require('path');
const { SendApp } = require(path.join(__dirname, '..', 'dist', 'nodes', 'SendApp', 'SendApp.node.js'));

/** The real network, with the key in X-API-Key (what the credential's `authenticate` sets). */
function networkTransport() {
	return async (opts, credentials) => {
		const url = new URL(opts.url);
		Object.entries(opts.qs || {}).forEach(([k, v]) => url.searchParams.set(k, String(v)));
		const res = await fetch(url, {
			method: opts.method,
			headers: { 'X-API-Key': credentials.apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
			body: opts.body && opts.method !== 'GET' ? JSON.stringify(opts.body) : undefined,
		});
		const text = await res.text();
		let body;
		try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
		return { statusCode: res.status, body, headers: Object.fromEntries(res.headers.entries()) };
	};
}

/** Fake answers in order: each is {match(opts) → bool, status, body, headers}. Records every request. */
function fakeTransport(answers) {
	const calls = [];
	const t = async (opts) => {
		calls.push(opts);
		const a = answers.shift();
		if (!a) throw new Error(`unexpected request ${opts.method} ${opts.url}`);
		if (a.match && !a.match(opts)) throw new Error(`request did not match: ${opts.method} ${opts.url} ${JSON.stringify(opts.body)}`);
		return { statusCode: a.status || 200, body: a.body || {}, headers: a.headers || {} };
	};
	t.calls = calls;
	t.left = answers;
	return t;
}

function context(params, { transport, credentials, items = [{ json: {} }] }) {
	const helper = async function (credName, opts) {
		const r = await transport(opts, credentials);
		if (opts.returnFullResponse) return r;
		if (r.statusCode >= 400 && !opts.ignoreHttpStatusErrors) {
			const e = new Error((r.body && r.body.message) || `HTTP ${r.statusCode}`);
			e.httpCode = String(r.statusCode);
			e.description = r.body && r.body.message;
			throw e;
		}
		return r.body;
	};
	const get = (name, fallback) => (Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback);
	return {
		getInputData: () => items,
		getNodeParameter: (name, i, fallback) => get(name, fallback),
		getCurrentNodeParameter: (name) => get(name, undefined),
		getCredentials: async () => credentials,
		getNode: () => ({ name: 'SendApp', type: 'n8n-nodes-sendapp.sendApp', typeVersion: 1, parameters: params }),
		continueOnFail: () => false,
		helpers: { httpRequestWithAuthentication: helper },
	};
}

async function execute(params, opts) {
	const node = new SendApp();
	const out = await node.execute.call(context(params, opts));
	return out[0].map((x) => x.json);
}

async function loadOptions(method, params, opts) {
	const node = new SendApp();
	return node.methods.loadOptions[method].call(context(params, opts));
}

async function mapperFields(method, params, opts) {
	const node = new SendApp();
	return node.methods.resourceMapping[method].call(context(params, opts));
}

module.exports = { execute, loadOptions, mapperFields, fakeTransport, networkTransport };
