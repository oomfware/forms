import { describe, expect, test } from 'bun:test';

import {
	buildPathString,
	convertFormData,
	createFieldProxy,
	deepGet,
	deepSet,
	flattenIssues,
	normalizeIssue,
	splitPath,
	type InternalFormIssue,
} from './form-utils.ts';

// #region splitPath

describe('splitPath', () => {
	const good = [
		{
			input: 'foo',
			output: ['foo'],
		},
		{
			input: 'foo.bar.baz',
			output: ['foo', 'bar', 'baz'],
		},
		{
			input: 'foo[0][1][2]',
			output: ['foo', '0', '1', '2'],
		},
	];

	const bad = ['[0]', 'foo.0', 'foo[bar]'];

	for (const { input, output } of good) {
		test(input, () => {
			expect(splitPath(input)).toEqual(output);
		});
	}

	for (const input of bad) {
		test(input, () => {
			expect(() => splitPath(input)).toThrowError(`Invalid path ${input}`);
		});
	}
});

// #endregion

// #region convertFormData

describe('convertFormData', () => {
	test('converts a FormData object', () => {
		const data = new FormData();

		data.append('foo', 'foo');

		data.append('object.nested.property', 'property');
		data.append('array[]', 'a');
		data.append('array[]', 'b');
		data.append('array[]', 'c');

		const converted = convertFormData(data);

		expect(converted).toEqual({
			foo: 'foo',
			object: {
				nested: {
					property: 'property',
				},
			},
			array: ['a', 'b', 'c'],
		});
	});

	test('handles multiple fields at the same nested level', () => {
		const data = new FormData();

		data.append('user.name.first', 'first');
		data.append('user.name.last', 'last');

		const converted = convertFormData(data);

		expect(converted).toEqual({
			user: {
				name: {
					first: 'first',
					last: 'last',
				},
			},
		});
	});

	test('converts number fields with n: prefix', () => {
		const data = new FormData();
		data.append('n:age', '25');
		data.append('n:score', '99.5');
		data.append('n:empty', '');

		expect(convertFormData(data)).toEqual({
			age: 25,
			score: 99.5,
			empty: undefined,
		});
	});

	test('converts boolean fields with b: prefix', () => {
		const data = new FormData();
		data.append('b:subscribe', 'on');
		data.append('b:terms', 'on');

		expect(convertFormData(data)).toEqual({
			subscribe: true,
			terms: true,
		});
	});

	test('throws on duplicate keys without array syntax', () => {
		const data = new FormData();
		data.append('foo', 'a');
		data.append('foo', 'b');

		expect(() => convertFormData(data)).toThrow(/duplicate/i);
	});

	const pollutionAttacks = [
		'__proto__.polluted',
		'constructor.polluted',
		'prototype.polluted',
		'user.__proto__.polluted',
		'user.constructor.polluted',
	];

	for (const attack of pollutionAttacks) {
		test(`prevents prototype pollution: ${attack}`, () => {
			const data = new FormData();
			data.append(attack, 'bad');
			expect(() => convertFormData(data)).toThrow(/Invalid key "/);
		});
	}
});

// #endregion

// #region deepSet / deepGet

describe('deepSet', () => {
	test('sets nested value', () => {
		const obj: Record<string, unknown> = {};
		deepSet(obj, ['user', 'name'], 'Alice');
		expect(obj).toEqual({ user: { name: 'Alice' } });
	});

	test('creates arrays for numeric keys', () => {
		const obj: Record<string, unknown> = {};
		deepSet(obj, ['items', '0', 'name'], 'first');
		expect(obj).toEqual({ items: [{ name: 'first' }] });
	});

	test('throws on invalid array key mismatch', () => {
		const obj: Record<string, unknown> = { items: { foo: 'bar' } };
		expect(() => deepSet(obj, ['items', '0'], 'value')).toThrow('Invalid array key');
	});
});

describe('deepGet', () => {
	test('gets nested value', () => {
		const obj = { user: { name: 'Alice' } };
		expect(deepGet(obj, ['user', 'name'])).toBe('Alice');
	});

	test('returns undefined for missing path', () => {
		const obj = { user: { name: 'Alice' } };
		expect(deepGet(obj, ['user', 'email'])).toBeUndefined();
	});

	test('handles array access', () => {
		const obj = { items: ['a', 'b', 'c'] };
		expect(deepGet(obj, ['items', 1])).toBe('b');
	});

	test('returns undefined when traversing null', () => {
		const obj = { user: null };
		expect(deepGet(obj, ['user', 'name'])).toBeNull();
	});
});

// #endregion

// #region normalizeIssue / flattenIssues

describe('normalizeIssue', () => {
	test('normalizes issue with path', () => {
		const issue = { message: 'Invalid', path: ['user', 'email'] };
		const result = normalizeIssue(issue);
		expect(result).toEqual({
			name: 'user.email',
			path: ['user', 'email'],
			message: 'Invalid',
			server: false,
		});
	});

	test('normalizes issue with numeric path', () => {
		const issue = { message: 'Invalid', path: ['items', 0, 'name'] };
		const result = normalizeIssue(issue);
		expect(result).toEqual({
			name: 'items[0].name',
			path: ['items', 0, 'name'],
			message: 'Invalid',
			server: false,
		});
	});

	test('normalizes issue with object segments', () => {
		const issue = { message: 'Invalid', path: [{ key: 'user' }, { key: 'name' }] };
		const result = normalizeIssue(issue);
		expect(result).toEqual({
			name: 'user.name',
			path: ['user', 'name'],
			message: 'Invalid',
			server: false,
		});
	});

	test('sets server flag', () => {
		const issue = { message: 'Invalid', path: ['field'] };
		const result = normalizeIssue(issue, true);
		expect(result.server).toBe(true);
	});
});

describe('flattenIssues', () => {
	test('creates lookup by path', () => {
		const issues: InternalFormIssue[] = [
			{ name: 'user.email', path: ['user', 'email'], message: 'Invalid', server: true },
		];

		const result = flattenIssues(issues);

		expect(result.$).toHaveLength(1);
		expect(result.user).toHaveLength(1);
		expect(result['user.email']).toHaveLength(1);
	});

	test('handles array paths', () => {
		const issues: InternalFormIssue[] = [
			{ name: 'items[0].name', path: ['items', 0, 'name'], message: 'Invalid', server: true },
		];

		const result = flattenIssues(issues);

		expect(result.$).toHaveLength(1);
		expect(result.items).toHaveLength(1);
		expect(result['items[0]']).toHaveLength(1);
		expect(result['items[0].name']).toHaveLength(1);
	});
});

// #endregion

// #region buildPathString

describe('buildPathString', () => {
	test('builds string path', () => {
		expect(buildPathString(['user', 'name'])).toBe('user.name');
	});

	test('handles numeric segments', () => {
		expect(buildPathString(['items', 0, 'name'])).toBe('items[0].name');
	});

	test('handles empty path', () => {
		expect(buildPathString([])).toBe('');
	});
});

// #endregion

// #region createFieldProxy

describe('createFieldProxy', () => {
	function createProxy(input: Record<string, unknown>, issues: Record<string, InternalFormIssue[]> = {}) {
		const state = { input };
		return createFieldProxy(
			{},
			() => state.input,
			(path, value) => {
				if (path.length === 0) {
					state.input = value as Record<string, unknown>;
				} else {
					deepSet(state.input, path.map(String), value);
				}
			},
			() => issues,
		);
	}

	describe('value()', () => {
		test('returns value for simple field', () => {
			const proxy = createProxy({ name: 'Alice' }) as { name: { value: () => string } };
			expect(proxy.name.value()).toBe('Alice');
		});

		test('returns value for nested field', () => {
			const proxy = createProxy({ user: { email: 'a@b.com' } }) as {
				user: { email: { value: () => string } };
			};
			expect(proxy.user.email.value()).toBe('a@b.com');
		});

		test('returns value for array field', () => {
			const proxy = createProxy({ items: ['a', 'b', 'c'] }) as {
				items: { 0: { value: () => string }; 1: { value: () => string } };
			};
			expect(proxy.items[0].value()).toBe('a');
			expect(proxy.items[1].value()).toBe('b');
		});

		test('returns undefined for missing field', () => {
			const proxy = createProxy({}) as { name: { value: () => string | undefined } };
			expect(proxy.name.value()).toBeUndefined();
		});
	});

	describe('set()', () => {
		test('sets value for simple field', () => {
			const proxy = createProxy({ name: 'Alice' }) as {
				name: { value: () => string; set: (v: string) => string };
			};
			proxy.name.set('Bob');
			expect(proxy.name.value()).toBe('Bob');
		});

		test('sets value for nested field', () => {
			const proxy = createProxy({ user: { name: 'Alice' } }) as {
				user: { name: { value: () => string; set: (v: string) => string } };
			};
			proxy.user.name.set('Bob');
			expect(proxy.user.name.value()).toBe('Bob');
		});

		test('sets value for array element', () => {
			const proxy = createProxy({ items: ['a', 'b'] }) as {
				items: { 0: { value: () => string; set: (v: string) => string } };
			};
			proxy.items[0].set('x');
			expect(proxy.items[0].value()).toBe('x');
		});

		test('returns the set value', () => {
			const proxy = createProxy({ name: 'Alice' }) as { name: { set: (v: string) => string } };
			expect(proxy.name.set('Bob')).toBe('Bob');
		});
	});

	describe('issues()', () => {
		test('returns undefined when no issues', () => {
			const proxy = createProxy({ name: 'Alice' }) as { name: { issues: () => unknown[] | undefined } };
			expect(proxy.name.issues()).toBeUndefined();
		});

		test('returns issues for exact field', () => {
			const issues: Record<string, InternalFormIssue[]> = {
				name: [{ name: 'name', path: ['name'], message: 'Required', server: true }],
			};
			const proxy = createProxy({ name: '' }, issues) as { name: { issues: () => unknown[] | undefined } };
			expect(proxy.name.issues()).toEqual([{ path: ['name'], message: 'Required' }]);
		});

		test('returns only exact field issues, not descendant issues', () => {
			const issues: Record<string, InternalFormIssue[]> = {
				user: [{ name: 'user.email', path: ['user', 'email'], message: 'Invalid email', server: true }],
				'user.email': [
					{ name: 'user.email', path: ['user', 'email'], message: 'Invalid email', server: true },
				],
			};
			const proxy = createProxy({ user: { email: '' } }, issues) as {
				user: { issues: () => unknown[] | undefined; email: { issues: () => unknown[] | undefined } };
			};
			// user.issues() should not include the user.email issue since issue.name !== 'user'
			expect(proxy.user.issues()).toEqual([]);
			expect(proxy.user.email.issues()).toEqual([{ path: ['user', 'email'], message: 'Invalid email' }]);
		});
	});

	describe('allIssues()', () => {
		test('returns undefined when no issues', () => {
			const proxy = createProxy({ user: {} }) as { user: { allIssues: () => unknown[] | undefined } };
			expect(proxy.user.allIssues()).toBeUndefined();
		});

		test('returns all issues for field and descendants', () => {
			const issues: Record<string, InternalFormIssue[]> = {
				user: [
					{ name: 'user', path: ['user'], message: 'User invalid', server: true },
					{ name: 'user.email', path: ['user', 'email'], message: 'Email required', server: true },
				],
			};
			const proxy = createProxy({ user: { email: '' } }, issues) as {
				user: { allIssues: () => unknown[] | undefined };
			};
			expect(proxy.user.allIssues()).toEqual([
				{ path: ['user'], message: 'User invalid' },
				{ path: ['user', 'email'], message: 'Email required' },
			]);
		});
	});

	describe('as()', () => {
		test('returns props for text input', () => {
			const proxy = createProxy({ name: 'Alice' }) as {
				name: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.name.as('text');
			expect(props.name).toBe('name');
			expect(props.type).toBeUndefined(); // text doesn't include type attribute
			expect(props.value).toBe('Alice');
		});

		test('returns props for number input with n: prefix', () => {
			const proxy = createProxy({ age: 25 }) as {
				age: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.age.as('number');
			expect(props.name).toBe('n:age');
			expect(props.type).toBe('number');
			expect(props.value).toBe('25');
		});

		test('returns props for checkbox with b: prefix', () => {
			const proxy = createProxy({ agree: true }) as {
				agree: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.agree.as('checkbox');
			expect(props.name).toBe('b:agree');
			expect(props.type).toBe('checkbox');
			expect(props.value).toBe('on');
			expect(props.checked).toBe(true);
		});

		test('returns props for checkbox array', () => {
			const proxy = createProxy({ colors: ['red', 'blue'] }) as {
				colors: { as: (type: string, value: string) => Record<string, unknown> };
			};
			const props = proxy.colors.as('checkbox', 'red');
			expect(props.name).toBe('colors[]');
			expect(props.value).toBe('red');
			expect(props.checked).toBe(true);

			const props2 = proxy.colors.as('checkbox', 'green');
			expect(props2.checked).toBe(false);
		});

		test('returns props for radio input', () => {
			const proxy = createProxy({ status: 'active' }) as {
				status: { as: (type: string, value: string) => Record<string, unknown> };
			};
			const props = proxy.status.as('radio', 'active');
			expect(props.checked).toBe(true);

			const props2 = proxy.status.as('radio', 'inactive');
			expect(props2.checked).toBe(false);
		});

		test('throws for radio without value', () => {
			const proxy = createProxy({ status: 'active' }) as {
				status: { as: (type: string) => Record<string, unknown> };
			};
			expect(() => proxy.status.as('radio')).toThrow('Radio inputs must have a value');
		});

		test('returns props for select', () => {
			const proxy = createProxy({ country: 'US' }) as {
				country: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.country.as('select');
			expect(props.name).toBe('country');
			expect(props.multiple).toBe(false);
			expect(props.value).toBe('US');
		});

		test('returns props for select multiple', () => {
			const proxy = createProxy({ countries: ['US', 'CA'] }) as {
				countries: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.countries.as('select multiple');
			expect(props.name).toBe('countries[]');
			expect(props.multiple).toBe(true);
			expect(props.value).toEqual(['US', 'CA']);
		});

		test('returns props for file input', () => {
			const proxy = createProxy({}) as {
				avatar: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.avatar.as('file');
			expect(props.name).toBe('avatar');
			expect(props.type).toBe('file');
			expect(props.multiple).toBe(false);
		});

		test('returns props for file multiple', () => {
			const proxy = createProxy({}) as {
				files: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.files.as('file multiple');
			expect(props.name).toBe('files[]');
			expect(props.type).toBe('file');
			expect(props.multiple).toBe(true);
		});

		test('returns props for hidden input', () => {
			const proxy = createProxy({}) as {
				id: { as: (type: string, value: string) => Record<string, unknown> };
			};
			const props = proxy.id.as('hidden', '123');
			expect(props.name).toBe('id');
			expect(props.type).toBe('hidden');
			expect(props.value).toBe('123');
		});

		test('throws for hidden without value', () => {
			const proxy = createProxy({}) as {
				id: { as: (type: string) => Record<string, unknown> };
			};
			expect(() => proxy.id.as('hidden')).toThrow('`hidden` inputs must have a value');
		});

		test('returns props for submit input', () => {
			const proxy = createProxy({}) as {
				action: { as: (type: string, value: string) => Record<string, unknown> };
			};
			const props = proxy.action.as('submit', 'save');
			expect(props.type).toBe('submit');
			expect(props.value).toBe('save');
		});

		test('includes aria-invalid when field has issues', () => {
			const issues: Record<string, InternalFormIssue[]> = {
				email: [{ name: 'email', path: ['email'], message: 'Invalid', server: true }],
			};
			const proxy = createProxy({ email: '' }, issues) as {
				email: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.email.as('text');
			expect(props['aria-invalid']).toBe('true');
		});

		test('value getter returns empty string for undefined', () => {
			const proxy = createProxy({}) as {
				missing: { as: (type: string) => Record<string, unknown> };
			};
			const props = proxy.missing.as('text');
			expect(props.value).toBe('');
		});

		test('nested field returns correct props', () => {
			const proxy = createProxy({ user: { email: 'a@b.com' } }) as {
				user: { email: { as: (type: string) => Record<string, unknown> } };
			};
			const props = proxy.user.email.as('email');
			expect(props.name).toBe('user.email');
			expect(props.type).toBe('email');
			expect(props.value).toBe('a@b.com');
		});

		test('array element returns correct props', () => {
			const proxy = createProxy({ items: [{ name: 'first' }] }) as {
				items: { 0: { name: { as: (type: string) => Record<string, unknown> } } };
			};
			const props = proxy.items[0].name.as('text');
			expect(props.name).toBe('items[0].name');
			expect(props.value).toBe('first');
		});
	});
});

// #endregion
