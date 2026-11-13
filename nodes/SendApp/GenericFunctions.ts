import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
	ResourceMapperField,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

/** One call to the SendApp REST API, with the key of the «SendApp API» credential. */
export async function sendAppRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('sendAppApi');
	const base = String(credentials.baseUrl || 'https://app.sendapp.ai').replace(/\/+$/, '');
	const options = {
		method,
		url: `${base}/api/${path.replace(/^\/+/, '')}`,
		qs,
		json: true,
		...(method === 'GET' || (method === 'DELETE' && Object.keys(body).length === 0) ? {} : { body }),
	};
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'sendAppApi', options)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** "+39 333 123-4567", "0039…", "393331234567" → "393331234567" (what the WhatsApp and SMS endpoints want). */
export function cleanNumber(value: unknown): string {
	let digits = String(value ?? '').replace(/\D+/g, '');
	if (digits.startsWith('00')) {
		digits = digits.slice(2);
	}
	return digits;
}

/** Tags from a comma separated text. */
export function tagList(value: unknown): string[] {
	const out: string[] = [];
	String(value ?? '')
		.split(',')
		.forEach((t) => {
			const tag = t.trim();
			if (tag && !out.includes(tag)) out.push(tag);
		});
	return out;
}

/** Only the fields that were filled in. */
export function filled(obj: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
	);
}

/** A contact as a workflow wants it: never `metadata`, dates as ISO 8601 (SendApp keeps Unix seconds). */
export function cleanContact(c: IDataObject = {}): IDataObject {
	const iso = (v: unknown) =>
		v === null || v === undefined || v === ''
			? null
			: /^\d{9,11}$/.test(String(v))
				? new Date(Number(v) * 1000).toISOString()
				: String(v);
	const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
	return {
		...(c.custom_fields && typeof c.custom_fields === 'object' ? { custom_fields: c.custom_fields } : {}),
		id: c.id,
		name: c.name || '',
		first_name: c.first_name || '',
		last_name: c.last_name || '',
		phone: c.phone || '',
		email: c.email || '',
		tags,
		created_at: iso(c.created_at),
		updated_at: iso(c.updated_at),
	};
}

/** The answer of a call that may fail with a status the caller wants to explain itself. */
export async function sendAppRequestFull(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body: IDataObject = {},
): Promise<{ statusCode: number; body: IDataObject; headers: IDataObject }> {
	const credentials = await this.getCredentials('sendAppApi');
	const base = String(credentials.baseUrl || 'https://app.sendapp.ai').replace(/\/+$/, '');
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'sendAppApi', {
		method,
		url: `${base}/api/${path.replace(/^\/+/, '')}`,
		body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	})) as { statusCode: number; body: unknown; headers: IDataObject };
	const parsed = response.body && typeof response.body === 'object' ? (response.body as IDataObject) : {};
	return { statusCode: response.statusCode, body: parsed, headers: response.headers ?? {} };
}

// ------------------------------------------------------------------ Custom fields

/** A custom contact field as GET /api/contact-fields answers it. */
export interface CustomField extends IDataObject {
	id: number;
	name: string;
	type: string;
	options?: string[] | null;
}

export async function getCustomFields(this: Context): Promise<CustomField[]> {
	const data = await sendAppRequest.call(this, 'GET', 'contact-fields');
	return Array.isArray(data.fields) ? (data.fields as CustomField[]) : [];
}

const choicesOf = (f: CustomField) =>
	Array.isArray(f.options) ? f.options.map((o) => String(o ?? '').trim()).filter((o) => o !== '') : [];

/**
 * One resource-mapper field per custom field, keyed by its id so a renamed field keeps working.
 * Type `ai` is computed by SendApp: never an input (it comes back in the contact's `custom_fields`).
 */
export function customFieldColumns(fields: CustomField[]): ResourceMapperField[] {
	return fields
		.filter((f) => f.type !== 'ai')
		.map((f) => {
			const column: ResourceMapperField = {
				id: String(f.id),
				displayName: f.name,
				required: false,
				defaultMatch: false,
				display: true,
				canBeUsedToMatch: false,
				type: 'string',
			};
			const choices = choicesOf(f);
			if (f.type === 'number') column.type = 'number';
			else if (f.type === 'boolean') column.type = 'boolean';
			else if (f.type === 'date') column.type = 'dateTime';
			else if (f.type === 'url') column.type = 'url';
			else if (f.type === 'select') {
				column.type = 'options';
				column.options = choices.map((c) => ({ name: c, value: c }));
			} else if (f.type === 'multiselect') {
				// n8n has no multiple-choice column: the choices are named, several separated by commas
				column.displayName = `${f.name} (several of: ${choices.join(', ')}; separate with commas)`;
			}
			return column;
		});
}

const TRUE = ['1', 'true', 'yes', 'y', 'on', 'si', 'sì'];
const FALSE = ['0', 'false', 'no', 'n', 'off'];

/** One value in the form SendApp's contact page stores, or undefined when nothing was given. */
export function customFieldValue(f: CustomField, raw: unknown): unknown {
	if (raw === undefined || raw === null || raw === '') return undefined;
	if (Array.isArray(raw) && raw.length === 0) return undefined;
	switch (f.type) {
		case 'boolean': {
			const s = String(raw).trim().toLowerCase();
			if (raw === true || TRUE.includes(s)) return '1';
			if (raw === false || FALSE.includes(s)) return '0';
			return undefined;
		}
		case 'number': {
			const n = Number(String(raw).trim().replace(',', '.'));
			return Number.isFinite(n) ? n : undefined;
		}
		case 'date':
			return String(raw).trim().slice(0, 10);
		case 'multiselect': {
			const list = (Array.isArray(raw) ? raw : String(raw).split(','))
				.map((v) => String(v ?? '').trim())
				.filter((v) => v !== '');
			return list.length ? Array.from(new Set(list)) : undefined;
		}
		default:
			return String(raw);
	}
}

/** `custom_fields` {name: value} from the mapped values (keyed by field id). Unknown ids are skipped. */
export function customFieldsByName(fields: CustomField[], mapped: IDataObject | null | undefined): IDataObject {
	const out: IDataObject = {};
	if (!mapped) return out;
	const byId = new Map(fields.filter((f) => f.type !== 'ai').map((f) => [String(f.id), f]));
	Object.entries(mapped).forEach(([id, raw]) => {
		const f = byId.get(String(id));
		if (!f) return;
		const v = customFieldValue(f, raw);
		if (v !== undefined) out[f.name] = v as IDataObject[keyof IDataObject];
	});
	return out;
}

// ------------------------------------------------------------------ Automations

/** {"order.id": "1"} → {order: {id: "1"}}: the start endpoint refuses a dot inside a field name. */
export function nest(flat: IDataObject): IDataObject {
	const out: IDataObject = {};
	Object.entries(flat).forEach(([path, value]) => {
		const parts = String(path)
			.split('.')
			.map((p) => p.trim())
			.filter((p) => p !== '');
		if (!parts.length) return;
		let node = out;
		for (let i = 0; i < parts.length - 1; i++) {
			const p = parts[i];
			if (node[p] === undefined || node[p] === null || typeof node[p] !== 'object') node[p] = {};
			node = node[p] as IDataObject;
		}
		const last = parts[parts.length - 1];
		if (!(node[last] && typeof node[last] === 'object')) node[last] = value;
	});
	return out;
}
