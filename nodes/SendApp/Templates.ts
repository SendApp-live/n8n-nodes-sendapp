import type { IDataObject, ResourceMapperField } from 'n8n-workflow';

/**
 * From the components of an approved WhatsApp template (as Meta describes them) to the fields the workflow fills in,
 * and back to the `components` Meta wants when the template is sent (the same rules as SendApp's Zapier app):
 *   header TEXT {{1}} / {{name}} → one field per variable · header IMAGE / VIDEO / DOCUMENT → the link of the file
 *   body {{1}}, {{2}}… or {{first_name}} → one field per variable · URL button with {{1}} → the end of the link
 *   COPY_CODE button → the coupon code
 * A URL button approved as https://<SendApp>/px/c/{{1}} counts the clicks with SendApp Pixel: the API cannot fill it
 * yet, so such a template is refused with a clear message instead of sending a broken link.
 */

export interface Template extends IDataObject {
	name: string;
	language: string;
	components?: IDataObject[];
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const up = (v: unknown) => String(v ?? '').toUpperCase();

const isTrackedUrl = (url: unknown) => /\/px\/c\/\{\{\s*1\s*\}\}/.test(String(url ?? ''));

/** How a template is chosen: name + language (the same name can exist in several languages). */
export const templateId = (t: Template) => `${t.name}|${t.language}`;

/** Variables in order: numbers ascending, names as they appear. */
export function variablesOf(text: unknown): string[] {
	const found: string[] = [];
	String(text ?? '').replace(PLACEHOLDER, (m: string, v: string) => {
		if (!found.includes(v)) found.push(v);
		return m;
	});
	const numeric = found.filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(a) - Number(b));
	const named = found.filter((v) => !/^\d+$/.test(v));
	return numeric.length ? numeric : named;
}

const buttons = (c: IDataObject) => (Array.isArray(c.buttons) ? (c.buttons as IDataObject[]) : []);

/** The fields of one template. */
export function fieldsFor(template: Template): ResourceMapperField[] {
	const fields: ResourceMapperField[] = [];
	const field = (id: string, displayName: string, required = true): ResourceMapperField => ({
		id,
		displayName,
		required,
		defaultMatch: false,
		display: true,
		type: 'string',
		canBeUsedToMatch: false,
	});
	(template.components ?? []).forEach((c) => {
		const type = up(c.type);
		if (type === 'HEADER') {
			const format = up(c.format || 'TEXT');
			if (format === 'TEXT') {
				variablesOf(c.text).forEach((v) => fields.push(field(`header__${v}`, `Header {{${v}}}`)));
			} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
				fields.push(field('header__media', `Header ${format.toLowerCase()} (https link)`));
				if (format === 'DOCUMENT') fields.push(field('header__filename', 'Document file name', false));
			}
		} else if (type === 'BODY') {
			variablesOf(c.text).forEach((v) => fields.push(field(`body__${v}`, `Text {{${v}}}`)));
		} else if (type === 'BUTTONS') {
			buttons(c).forEach((b, i) => {
				const btype = up(b.type);
				if (btype === 'URL' && /\{\{/.test(String(b.url ?? '')) && !isTrackedUrl(b.url)) {
					fields.push(field(`button__${i}`, `Button «${String(b.text)}»: end of the link`));
				} else if (btype === 'COPY_CODE') {
					fields.push(field(`button__${i}`, `Button «${String(b.text || 'Copy code')}»: coupon code`));
				}
			});
		}
	});
	return fields;
}

const textParam = (v: string, value: unknown): IDataObject =>
	/^\d+$/.test(v)
		? { type: 'text', text: String(value ?? '') }
		: { type: 'text', parameter_name: v, text: String(value ?? '') };

/** The `components` to send, from the values the workflow filled in. */
export function componentsFor(template: Template, values: IDataObject): IDataObject[] {
	const out: IDataObject[] = [];
	(template.components ?? []).forEach((c) => {
		const type = up(c.type);
		if (type === 'HEADER') {
			const format = up(c.format || 'TEXT');
			if (format === 'TEXT') {
				const params = variablesOf(c.text).map((v) => textParam(v, values[`header__${v}`]));
				if (params.length) out.push({ type: 'header', parameters: params });
			} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
				const kind = format.toLowerCase();
				const media: IDataObject = { link: String(values.header__media ?? '') };
				if (kind === 'document' && values.header__filename) media.filename = String(values.header__filename);
				out.push({ type: 'header', parameters: [{ type: kind, [kind]: media }] });
			}
		} else if (type === 'BODY') {
			const params = variablesOf(c.text).map((v) => textParam(v, values[`body__${v}`]));
			if (params.length) out.push({ type: 'body', parameters: params });
		} else if (type === 'BUTTONS') {
			buttons(c).forEach((b, i) => {
				const btype = up(b.type);
				if (btype === 'URL' && /\{\{/.test(String(b.url ?? ''))) {
					out.push({
						type: 'button',
						sub_type: 'url',
						index: String(i),
						parameters: [{ type: 'text', text: String(values[`button__${i}`] ?? '') }],
					});
				} else if (btype === 'COPY_CODE') {
					out.push({
						type: 'button',
						sub_type: 'copy_code',
						index: String(i),
						parameters: [{ type: 'coupon_code', coupon_code: String(values[`button__${i}`] ?? '') }],
					});
				}
			});
		}
	});
	return out;
}

/** Why this template cannot be sent from n8n, or null. */
export function refusal(template: Template): string | null {
	const comps = template.components ?? [];
	if (comps.some((c) => up(c.type) === 'CAROUSEL')) {
		return 'Carousel templates cannot be sent from n8n yet. Choose another template.';
	}
	const tracked = comps.some(
		(c) => up(c.type) === 'BUTTONS' && buttons(c).some((b) => up(b.type) === 'URL' && isTrackedUrl(b.url)),
	);
	return tracked
		? 'This template has a button that counts clicks with SendApp Pixel: it cannot be sent from n8n yet. Choose another template.'
		: null;
}
