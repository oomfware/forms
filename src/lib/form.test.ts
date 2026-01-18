import { describe, expect, test } from 'bun:test';

import { createRouter, route } from '@oomfware/fetch-router';
import { asyncContext } from '@oomfware/fetch-router/middlewares/async-context';
import * as v from 'valibot';

import { form, forms, invalid } from '../index.ts';

function createFormData(data: Record<string, string>): FormData {
	const formData = new FormData();
	for (const [key, value] of Object.entries(data)) {
		formData.append(key, value);
	}
	return formData;
}

describe('form submission', () => {
	test('basic form submission works', async () => {
		const messageForm = form(v.object({ message: v.string() }), async (data) => {
			return { received: data.message };
		});

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ messageForm })],
			actions: {
				index() {
					if (messageForm.result) {
						return Response.json(messageForm.result);
					}
					return new Response('form');
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=messageForm', {
				method: 'POST',
				body: createFormData({ message: 'hello' }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: 'hello' });
	});

	test('form without validation works', async () => {
		const simpleForm = form(async () => {
			return { success: true };
		});

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ simpleForm })],
			actions: {
				index() {
					if (simpleForm.result) {
						return Response.json(simpleForm.result);
					}
					return new Response('form');
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=simpleForm', {
				method: 'POST',
				body: new FormData(),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
	});

	test('unchecked form receives data without validation', async () => {
		const uncheckedForm = form<{ name: string }, { name: string }>('unchecked', async (data) => {
			return { name: data.name };
		});

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ uncheckedForm })],
			actions: {
				index() {
					if (uncheckedForm.result) {
						return Response.json(uncheckedForm.result);
					}
					return new Response('form');
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=uncheckedForm', {
				method: 'POST',
				body: createFormData({ name: 'test' }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: 'test' });
	});
});

describe('form validation', () => {
	test('schema validation returns issues', async () => {
		const validatedForm = form(
			v.object({
				email: v.pipe(v.string(), v.email()),
			}),
			async (data) => {
				return { email: data.email };
			},
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ validatedForm })],
			actions: {
				index() {
					const issues = validatedForm.fields.email.issues();
					if (issues) {
						return Response.json({ issues: issues.map((i) => i.message) });
					}
					if (validatedForm.result) {
						return Response.json(validatedForm.result);
					}
					return new Response('form');
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=validatedForm', {
				method: 'POST',
				body: createFormData({ email: 'not-an-email' }),
			}),
		);

		expect(response.status).toBe(200);
		const json: any = await response.json();
		expect(json.issues).toBeDefined();
		expect(json.issues.length).toBeGreaterThan(0);
	});

	test('imperative validation with invalid() works', async () => {
		const loginForm = form(
			v.object({
				username: v.string(),
				password: v.string(),
			}),
			async (data, issue) => {
				if (data.username !== 'admin') {
					invalid(issue.username('User not found'));
				}
				return { success: true };
			},
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ loginForm })],
			actions: {
				index() {
					const issues = loginForm.fields.username.issues();
					if (issues) {
						return Response.json({ issues: issues.map((i) => i.message) });
					}
					if (loginForm.result) {
						return Response.json(loginForm.result);
					}
					return new Response('form');
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=loginForm', {
				method: 'POST',
				body: createFormData({ username: 'wrong', password: 'pass' }),
			}),
		);

		expect(response.status).toBe(200);
		const json: any = await response.json();
		expect(json.issues).toContain('User not found');
	});
});

describe('underscore field redaction', () => {
	test('underscore-prefixed fields are redacted from input', async () => {
		const registerForm = form(
			v.object({
				username: v.pipe(v.string(), v.minLength(5)),
				_password: v.string(),
			}),
			async (data) => {
				return { username: data.username };
			},
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ registerForm })],
			actions: {
				index() {
					// trigger validation error by submitting short username
					const usernameValue = registerForm.fields.username.value();
					const passwordValue = registerForm.fields._password.value();

					return Response.json({
						username: usernameValue,
						_password: passwordValue,
					});
				},
			},
		});

		const response = await router.fetch(
			new Request('http://test/?__action=registerForm', {
				method: 'POST',
				body: createFormData({ username: 'ab', _password: 'secret123' }),
			}),
		);

		expect(response.status).toBe(200);
		const json: any = await response.json();
		expect(json.username).toBe('ab');
		expect(json._password).toBeUndefined();
	});
});

describe('form properties', () => {
	test('form has correct method and action', async () => {
		const testForm = form(v.object({ name: v.string() }), async () => ({ ok: true }));

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ testForm })],
			actions: {
				index() {
					return Response.json({
						method: testForm.method,
						action: testForm.action,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.method).toBe('POST');
		expect(json.action).toBe('?__action=testForm');
	});

	test('action replaces existing search params by default', async () => {
		const testForm = form(async () => 'ok');
		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ testForm })],
			actions: {
				index() {
					return Response.json({
						action: testForm.action,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/?page=2&filter=active'));
		const json: any = await response.json();

		expect(json.action).toBe('?__action=testForm');
	});

	test('with({ preserveParams: true }) preserves search params', async () => {
		const testForm = form(async () => 'ok');
		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ testForm })],
			actions: {
				index() {
					const configured = testForm.with({ preserveParams: true });
					return Response.json({
						action: configured.action,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/?page=2&filter=active'));
		const json: any = await response.json();

		expect(json.action).toBe('?page=2&filter=active&__action=testForm');
	});
});

describe('nested and array fields', () => {
	test('nested field values work', async () => {
		const profileForm = form(
			v.object({
				user: v.object({
					name: v.string(),
					email: v.pipe(v.string(), v.email()),
				}),
			}),
			async (data) => {
				return data;
			},
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ profileForm })],
			actions: {
				index() {
					if (profileForm.result) {
						return Response.json(profileForm.result);
					}

					// check field access
					const nameValue = profileForm.fields.user.name.value();
					const emailIssues = profileForm.fields.user.email.issues();

					return Response.json({
						nameValue,
						emailIssues: emailIssues?.map((i) => i.message),
					});
				},
			},
		});

		const formData = new FormData();
		formData.append('user.name', 'John');
		formData.append('user.email', 'invalid');

		const response = await router.fetch(
			new Request('http://test/?__action=profileForm', {
				method: 'POST',
				body: formData,
			}),
		);

		const json: any = await response.json();
		expect(json.nameValue).toBe('John');
		expect(json.emailIssues).toBeDefined();
		expect(json.emailIssues.length).toBeGreaterThan(0);
	});

	test('array field values work', async () => {
		const tagsForm = form(
			v.object({
				tags: v.array(v.string()),
			}),
			async (data) => {
				return { tags: data.tags };
			},
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ tagsForm })],
			actions: {
				index() {
					if (tagsForm.result) {
						return Response.json(tagsForm.result);
					}
					return new Response('form');
				},
			},
		});

		const formData = new FormData();
		formData.append('tags[]', 'javascript');
		formData.append('tags[]', 'typescript');
		formData.append('tags[]', 'bun');

		const response = await router.fetch(
			new Request('http://test/?__action=tagsForm', {
				method: 'POST',
				body: formData,
			}),
		);

		expect(await response.json()).toEqual({
			tags: ['javascript', 'typescript', 'bun'],
		});
	});
});

describe('middleware levels', () => {
	test('forms() works at router level (global middleware)', async () => {
		const globalForm = form(v.object({ name: v.string() }), async (data) => {
			return { name: data.name };
		});

		const routes = route({ index: '/', other: '/other' });
		const router = createRouter({
			middleware: [asyncContext(), forms({ globalForm })],
		});

		router.map(routes, {
			index() {
				if (globalForm.result) {
					return Response.json(globalForm.result);
				}
				return Response.json({ action: globalForm.action });
			},
			other() {
				// form should be accessible from other routes too
				return Response.json({ action: globalForm.action });
			},
		});

		// test form submission
		const submitResponse = await router.fetch(
			new Request('http://test/?__action=globalForm', {
				method: 'POST',
				body: createFormData({ name: 'global test' }),
			}),
		);
		expect(submitResponse.status).toBe(200);
		expect(await submitResponse.json()).toEqual({ name: 'global test' });

		// test form is available on other routes
		const otherResponse = await router.fetch(new Request('http://test/other'));
		expect(otherResponse.status).toBe(200);
		expect(await otherResponse.json()).toEqual({ action: '?__action=globalForm' });
	});

	test('forms() works at per-action level', async () => {
		const actionForm = form(v.object({ value: v.string() }), async (data) => {
			return { value: data.value };
		});

		const routes = route({ index: '/', special: '/special' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			index() {
				return new Response('index');
			},
			special: {
				middleware: [forms({ actionForm })],
				action() {
					if (actionForm.result) {
						return Response.json(actionForm.result);
					}
					return Response.json({ action: actionForm.action });
				},
			},
		});

		// test form submission on the specific action
		const submitResponse = await router.fetch(
			new Request('http://test/special?__action=actionForm', {
				method: 'POST',
				body: createFormData({ value: 'action test' }),
			}),
		);
		expect(submitResponse.status).toBe(200);
		expect(await submitResponse.json()).toEqual({ value: 'action test' });

		// index route should still work (no form middleware there)
		const indexResponse = await router.fetch(new Request('http://test/'));
		expect(indexResponse.status).toBe(200);
		expect(await indexResponse.text()).toBe('index');
	});

	test('forms() works with nested controller middleware', async () => {
		const controllerForm = form(v.object({ data: v.string() }), async (data) => {
			return { data: data.data };
		});

		const routes = route({
			admin: {
				dashboard: '/admin',
				settings: '/admin/settings',
			},
		});
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			admin: {
				middleware: [forms({ controllerForm })],
				actions: {
					dashboard() {
						if (controllerForm.result) {
							return Response.json(controllerForm.result);
						}
						return Response.json({ action: controllerForm.action });
					},
					settings() {
						// form should be accessible from sibling routes in same controller
						return Response.json({ action: controllerForm.action });
					},
				},
			},
		});

		// test form submission
		const submitResponse = await router.fetch(
			new Request('http://test/admin?__action=controllerForm', {
				method: 'POST',
				body: createFormData({ data: 'nested test' }),
			}),
		);
		expect(submitResponse.status).toBe(200);
		expect(await submitResponse.json()).toEqual({ data: 'nested test' });

		// test form is available on sibling route
		const settingsResponse = await router.fetch(new Request('http://test/admin/settings'));
		expect(settingsResponse.status).toBe(200);
		expect(await settingsResponse.json()).toEqual({ action: '?__action=controllerForm' });
	});

	test('conflicting form names: first middleware wins', async () => {
		const controllerForm = form(v.object({ x: v.string() }), async (data) => {
			return { from: 'controller', x: data.x };
		});

		const actionForm = form(v.object({ y: v.string() }), async (data) => {
			return { from: 'action', y: data.y };
		});

		const routes = route({ admin: { dashboard: '/admin' } });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			admin: {
				middleware: [forms({ myForm: controllerForm })],
				actions: {
					dashboard: {
						middleware: [forms({ myForm: actionForm })],
						action() {
							return Response.json({
								controllerResult: controllerForm.result,
								actionResult: actionForm.result,
							});
						},
					},
				},
			},
		});

		// submit with controller form's expected field
		const response = await router.fetch(
			new Request('http://test/admin?__action=myForm', {
				method: 'POST',
				body: createFormData({ x: 'test-value' }),
			}),
		);

		expect(response.status).toBe(200);
		const json: any = await response.json();
		// controller middleware runs first, so it handles the submission
		expect(json.controllerResult).toEqual({ from: 'controller', x: 'test-value' });
		expect(json.actionResult).toBeUndefined();
	});

	test('controller and action middleware compose (both forms accessible)', async () => {
		const controllerForm = form(v.object({ a: v.string() }), async (data) => {
			return { a: data.a };
		});

		const actionForm = form(v.object({ b: v.string() }), async (data) => {
			return { b: data.b };
		});

		const routes = route({
			admin: {
				dashboard: '/admin',
			},
		});
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			admin: {
				middleware: [forms({ controllerForm })],
				actions: {
					dashboard: {
						middleware: [forms({ actionForm })],
						action() {
							// both forms should be accessible here
							return Response.json({
								controllerAction: controllerForm.action,
								actionAction: actionForm.action,
								controllerResult: controllerForm.result,
								actionResult: actionForm.result,
							});
						},
					},
				},
			},
		});

		// test both forms are accessible
		const getResponse = await router.fetch(new Request('http://test/admin'));
		expect(getResponse.status).toBe(200);
		const getData: any = await getResponse.json();
		expect(getData.controllerAction).toBe('?__action=controllerForm');
		expect(getData.actionAction).toBe('?__action=actionForm');

		// test controller-level form submission
		const controllerSubmit = await router.fetch(
			new Request('http://test/admin?__action=controllerForm', {
				method: 'POST',
				body: createFormData({ a: 'from controller' }),
			}),
		);
		expect(controllerSubmit.status).toBe(200);
		const controllerData: any = await controllerSubmit.json();
		expect(controllerData.controllerResult).toEqual({ a: 'from controller' });
		expect(controllerData.actionResult).toBeUndefined();

		// test action-level form submission
		const actionSubmit = await router.fetch(
			new Request('http://test/admin?__action=actionForm', {
				method: 'POST',
				body: createFormData({ b: 'from action' }),
			}),
		);
		expect(actionSubmit.status).toBe(200);
		const actionData: any = await actionSubmit.json();
		expect(actionData.actionResult).toEqual({ b: 'from action' });
		expect(actionData.controllerResult).toBeUndefined();
	});
});

describe('field methods', () => {
	test('fields.*.set() updates input value', async () => {
		const editForm = form(v.object({ title: v.string() }), async (data) => {
			return { title: data.title };
		});

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ editForm })],
			actions: {
				index() {
					editForm.fields.title.set('New Title');
					const value = editForm.fields.title.value();
					return Response.json({ value });
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.value).toBe('New Title');
	});

	test('fields.*.as() returns correct props for text input', async () => {
		const textForm = form(v.object({ name: v.string() }), async () => ({ ok: true }));

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ textForm })],
			actions: {
				index() {
					const props = textForm.fields.name.as('text');
					return Response.json({
						name: props.name,
						hasAriaInvalid: 'aria-invalid' in props,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.name).toBe('name');
		expect(json.hasAriaInvalid).toBe(true);
	});

	test('fields.*.as() returns correct props for number input', async () => {
		const numForm = form(v.object({ age: v.number() }), async () => ({ ok: true }));

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ numForm })],
			actions: {
				index() {
					const props = numForm.fields.age.as('number');
					return Response.json({
						name: props.name,
						type: props.type,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.name).toBe('n:age');
		expect(json.type).toBe('number');
	});

	test('fields.*.as() returns correct props for checkbox', async () => {
		const checkForm = form(v.object({ subscribe: v.boolean() }), async () => ({ ok: true }));

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ checkForm })],
			actions: {
				index() {
					const props = checkForm.fields.subscribe.as('checkbox');
					return Response.json({
						name: props.name,
						type: props.type,
						value: props.value,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.name).toBe('b:subscribe');
		expect(json.type).toBe('checkbox');
		expect(json.value).toBe('on');
	});

	test('fields.*.as() returns correct props for hidden input', async () => {
		const hiddenForm = form(v.object({ postId: v.string() }), async () => ({ ok: true }));

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ hiddenForm })],
			actions: {
				index() {
					const props = hiddenForm.fields.postId.as('hidden', 'abc123');
					return Response.json({
						name: props.name,
						type: props.type,
						value: props.value,
					});
				},
			},
		});

		const response = await router.fetch(new Request('http://test/'));
		const json: any = await response.json();

		expect(json.name).toBe('postId');
		expect(json.type).toBe('hidden');
		expect(json.value).toBe('abc123');
	});

	test('fields.allIssues() returns issues for nested fields', async () => {
		const nestedForm = form(
			v.object({
				user: v.object({
					name: v.pipe(v.string(), v.minLength(3)),
					email: v.pipe(v.string(), v.email()),
				}),
			}),
			async (data) => data,
		);

		const routes = route({ index: '/' });
		const router = createRouter({ middleware: [asyncContext()] });

		router.map(routes, {
			middleware: [forms({ nestedForm })],
			actions: {
				index() {
					// get all issues for the user container
					const allIssues = nestedForm.fields.user.allIssues();
					const nameIssues = nestedForm.fields.user.name.issues();

					return Response.json({
						allIssuesCount: allIssues?.length ?? 0,
						nameIssuesCount: nameIssues?.length ?? 0,
					});
				},
			},
		});

		const formData = new FormData();
		formData.append('user.name', 'ab');
		formData.append('user.email', 'invalid');

		const response = await router.fetch(
			new Request('http://test/?__action=nestedForm', {
				method: 'POST',
				body: formData,
			}),
		);

		const json: any = await response.json();

		// allIssues should include issues from both name and email
		expect(json.allIssuesCount).toBeGreaterThanOrEqual(2);
		// nameIssues should only include issues for name
		expect(json.nameIssuesCount).toBe(1);
	});
});
