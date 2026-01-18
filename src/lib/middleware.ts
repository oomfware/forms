import type { Middleware } from '@oomfware/fetch-router';

import { convertFormData } from './form-utils.ts';
import {
	FORM_STORE_KEY,
	kForm,
	processForm,
	setFormState,
	type Form,
	type FormConfig,
	type InternalForm,
} from './form.ts';

// #region types

/**
 * a record of form instances to register with the middleware.
 */
export type FormDefinitions = Record<string, Form<any, any>>;

// #endregion

// #region helpers

/**
 * checks if a value is a form instance created by form().
 */
function isForm(value: unknown): value is Form<any, any> {
	return value !== null && typeof value === 'object' && kForm in value;
}

/**
 * checks if the request is a cross-origin request based on Sec-Fetch-Site header.
 * used for CSRF protection.
 */
function isCrossOrigin(request: Request): boolean {
	const secFetchSite = request.headers.get('sec-fetch-site');
	return secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none';
}

// #endregion

// #region middleware

/**
 * creates a forms middleware that registers forms and handles form submissions.
 *
 * @example
 * ```ts
 * import { form, forms } from '@oomfware/forms';
 * import * as v from 'valibot';
 *
 * const createUserForm = form(
 *   v.object({ name: v.string(), password: v.string() }),
 *   async (input, issue) => {
 *     // handle form submission
 *   },
 * );
 *
 * router.map(routes.admin, {
 *   middleware: [forms({ createUserForm })],
 *   action() {
 *     return render(
 *       <form {...createUserForm}>
 *         <input {...createUserForm.fields.name.as('text')} required />
 *       </form>
 *     );
 *   },
 * });
 * ```
 */
export function forms(definitions: FormDefinitions): Middleware {
	const formConfigs = new Map<InternalForm<any, any>, FormConfig>();
	const formsById = new Map<string, InternalForm<any, any>>();

	for (const [name, formInstance] of Object.entries(definitions)) {
		if (!isForm(formInstance)) {
			continue;
		}

		const f = formInstance as InternalForm<any, any>;
		formConfigs.set(f, { id: name });
		formsById.set(name, f);
	}

	return async ({ request, url, store }, next) => {
		// get or create form store for this request
		// this allows multiple forms() middlewares to compose
		let formStore = store.inject(FORM_STORE_KEY);
		if (!formStore) {
			formStore = {
				configs: new WeakMap(),
				state: new WeakMap(),
				processedActions: new Set(),
			};
			store.provide(FORM_STORE_KEY, formStore);
		}

		// merge this middleware's forms into the store
		for (const [form, config] of formConfigs) {
			formStore.configs.set(form, config);
		}

		// check if this is a form submission
		const action = url.searchParams.get('__action');

		if (action && request.method === 'POST' && !formStore.processedActions.has(action)) {
			// find the form
			const formInstance = formsById.get(action);

			if (formInstance) {
				// mark as processed (first middleware wins on name conflicts)
				formStore.processedActions.add(action);

				// reject cross-origin form submissions
				if (isCrossOrigin(request)) {
					return new Response(null, { status: 403 });
				}
				// parse form data
				const formData = await request.formData();
				const data = convertFormData(formData as unknown as FormData);

				// process the form
				const state = await processForm(formInstance, data as any);

				// store the state
				setFormState(formInstance, state);
			}
		}

		return next();
	};
}

// #endregion
