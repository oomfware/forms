import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { FormIssue, InputType, InternalFormIssue } from './types.ts';

/**
 * sets a value in a nested object using a path string, mutating the original object
 */
export function setNestedValue(object: Record<string, unknown>, pathString: string, value: unknown): void {
	if (pathString.startsWith('n:')) {
		pathString = pathString.slice(2);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion
		value = value === '' ? undefined : parseFloat(value as string);
	} else if (pathString.startsWith('b:')) {
		pathString = pathString.slice(2);
		value = value === 'on';
	}

	deepSet(object, splitPath(pathString), value);
}

/**
 * convert `FormData` into a POJO
 */
export function convertFormData(data: FormData): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (let key of data.keys()) {
		const isArray = key.endsWith('[]');
		let values: unknown[] = data.getAll(key);

		if (isArray) {
			key = key.slice(0, -2);
		}

		if (values.length > 1 && !isArray) {
			throw new Error(`Form cannot contain duplicated keys — "${key}" has ${values.length} values`);
		}

		// an empty `<input type="file">` will submit a non-existent file, bizarrely
		values = values.filter(
			// eslint-disable-next-line typescript/no-unsafe-type-assertion
			(entry) => typeof entry === 'string' || (entry as File).name !== '' || (entry as File).size > 0,
		);

		if (key.startsWith('n:')) {
			key = key.slice(2);
			// eslint-disable-next-line typescript/no-unsafe-type-assertion
			values = values.map((v) => (v === '' ? undefined : parseFloat(v as string)));
		} else if (key.startsWith('b:')) {
			key = key.slice(2);
			values = values.map((v) => v === 'on');
		}

		setNestedValue(result, key, isArray ? values : values[0]);
	}

	return result;
}

const PATH_REGEX = /^[a-zA-Z_$]\w*(\.[a-zA-Z_$]\w*|\[\d+\])*$/;

/**
 * splits a path string like "user.emails[0].address" into ["user", "emails", "0", "address"]
 */
export function splitPath(path: string): string[] {
	if (!PATH_REGEX.test(path)) {
		throw new Error(`Invalid path ${path}`);
	}

	return path.split(/\.|\[|\]/).filter(Boolean);
}

/**
 * check if a property key is dangerous and could lead to prototype pollution
 */
function checkPrototypePollution(key: string): void {
	if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
		throw new Error(`Invalid key "${key}": This key is not allowed to prevent prototype pollution.`);
	}
}

/**
 * sets a value in a nested object using an array of keys, mutating the original object.
 */
export function deepSet(object: Record<string, unknown>, keys: string[], value: unknown): void {
	let current: Record<string, unknown> = object;

	for (let i = 0; i < keys.length - 1; i += 1) {
		const key = keys[i]!;

		checkPrototypePollution(key);

		const isArray = /^\d+$/.test(keys[i + 1]!);
		const exists = key in current;
		const inner = current[key];

		if (exists && isArray !== Array.isArray(inner)) {
			throw new Error(`Invalid array key ${keys[i + 1]}`);
		}

		if (!exists) {
			current[key] = isArray ? [] : {};
		}

		// eslint-disable-next-line typescript/no-unsafe-type-assertion
		current = current[key] as Record<string, unknown>;
	}

	const finalKey = keys[keys.length - 1]!;
	checkPrototypePollution(finalKey);
	current[finalKey] = value;
}

/**
 * gets a nested value from an object using a path array
 */
export function deepGet(object: Record<string, unknown>, path: (string | number)[]): unknown {
	let current: unknown = object;
	for (const key of path) {
		if (current == null || typeof current !== 'object') {
			return current;
		}
		// eslint-disable-next-line typescript/no-unsafe-type-assertion
		current = (current as Record<string | number, unknown>)[key];
	}
	return current;
}

/**
 * normalizes a Standard Schema issue into our internal format
 */
export function normalizeIssue(issue: StandardSchemaV1.Issue, server = false): InternalFormIssue {
	const normalized: InternalFormIssue = { name: '', path: [], message: issue.message, server };

	if (issue.path !== undefined) {
		let name = '';

		for (const segment of issue.path) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion
			const key = typeof segment === 'object' ? (segment.key as string | number) : segment;

			// eslint-disable-next-line typescript/no-unsafe-type-assertion
			normalized.path.push(key as string | number);

			if (typeof key === 'number') {
				name += `[${key}]`;
			} else if (typeof key === 'string') {
				name += name === '' ? key : '.' + key;
			}
		}

		normalized.name = name;
	}

	return normalized;
}

/**
 * flattens issues into a lookup object keyed by path
 * includes a special '$' key containing all issues
 */
export function flattenIssues(issues: InternalFormIssue[]): Record<string, InternalFormIssue[]> {
	const result: Record<string, InternalFormIssue[]> = {};

	for (const issue of issues) {
		(result.$ ??= []).push(issue);

		let name = '';

		if (issue.path !== undefined) {
			for (const key of issue.path) {
				if (typeof key === 'number') {
					name += `[${key}]`;
				} else if (typeof key === 'string') {
					name += name === '' ? key : '.' + key;
				}

				(result[name] ??= []).push(issue);
			}
		}
	}

	return result;
}

/**
 * builds a path string from an array of path segments
 */
export function buildPathString(path: (string | number)[]): string {
	let result = '';

	for (const segment of path) {
		if (typeof segment === 'number') {
			result += `[${segment}]`;
		} else {
			result += result === '' ? segment : '.' + segment;
		}
	}

	return result;
}

// #region field proxy

/**
 * creates a proxy-based field accessor for form data.
 * allows type-safe nested field access like `fields.user.emails[0].address.value()`.
 */
export function createFieldProxy<T>(
	target: unknown,
	getInput: () => Record<string, unknown>,
	setInput: (path: (string | number)[], value: unknown) => void,
	getIssues: () => Record<string, InternalFormIssue[]>,
	path: (string | number)[] = [],
): T {
	const getValue = () => {
		return deepGet(getInput(), path);
	};

	// eslint-disable-next-line typescript/no-unsafe-type-assertion
	return new Proxy(target as object, {
		get(_target, prop) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion
			if (typeof prop === 'symbol') return (_target as Record<symbol, unknown>)[prop];

			// handle array access like jobs[0]
			if (/^\d+$/.test(prop)) {
				return createFieldProxy({}, getInput, setInput, getIssues, [...path, parseInt(prop, 10)]);
			}

			const key = buildPathString(path);

			if (prop === 'set') {
				const setFunc = function (newValue: unknown) {
					setInput(path, newValue);
					return newValue;
				};
				return createFieldProxy(setFunc, getInput, setInput, getIssues, [...path, prop]);
			}

			if (prop === 'value') {
				return createFieldProxy(getValue, getInput, setInput, getIssues, [...path, prop]);
			}

			if (prop === 'issues' || prop === 'allIssues') {
				const issuesFunc = (): FormIssue[] | undefined => {
					const allIssues = getIssues()[key === '' ? '$' : key];

					if (prop === 'allIssues') {
						return allIssues?.map((issue) => ({
							path: issue.path,
							message: issue.message,
						}));
					}

					return allIssues
						?.filter((issue) => issue.name === key)
						?.map((issue) => ({
							path: issue.path,
							message: issue.message,
						}));
				};

				return createFieldProxy(issuesFunc, getInput, setInput, getIssues, [...path, prop]);
			}

			if (prop === 'as') {
				const asFunc = (type: InputType, inputValue?: string): Record<string, unknown> => {
					const isArray =
						type === 'file multiple' ||
						type === 'select multiple' ||
						(type === 'checkbox' && typeof inputValue === 'string');

					const prefix =
						type === 'number' || type === 'range' ? 'n:' : type === 'checkbox' && !isArray ? 'b:' : '';

					// base properties for all input types
					const baseProps: Record<string, unknown> = {
						name: prefix + key + (isArray ? '[]' : ''),
						get 'aria-invalid'() {
							const issues = getIssues();
							return key in issues ? 'true' : undefined;
						},
					};

					// add type attribute only for non-text inputs and non-select elements
					if (type !== 'text' && type !== 'select' && type !== 'select multiple') {
						baseProps.type = type === 'file multiple' ? 'file' : type;
					}

					// handle submit and hidden inputs
					if (type === 'submit' || type === 'hidden') {
						if (!inputValue) {
							throw new Error(`\`${type}\` inputs must have a value`);
						}

						return Object.defineProperties(baseProps, {
							value: { value: inputValue, enumerable: true },
						});
					}

					// handle select inputs
					if (type === 'select' || type === 'select multiple') {
						return Object.defineProperties(baseProps, {
							multiple: { value: isArray, enumerable: true },
							value: {
								enumerable: true,
								get() {
									return getValue();
								},
							},
						});
					}

					// handle checkbox inputs
					if (type === 'checkbox' || type === 'radio') {
						if (type === 'radio' && !inputValue) {
							throw new Error('Radio inputs must have a value');
						}

						if (type === 'checkbox' && isArray && !inputValue) {
							throw new Error('Checkbox array inputs must have a value');
						}

						return Object.defineProperties(baseProps, {
							value: { value: inputValue ?? 'on', enumerable: true },
							checked: {
								enumerable: true,
								get() {
									const value = getValue();

									if (type === 'radio') {
										return value === inputValue;
									}

									if (isArray) {
										// eslint-disable-next-line typescript/no-unsafe-type-assertion
										return ((value as string[] | undefined) ?? []).includes(inputValue!);
									}

									return value;
								},
							},
						});
					}

					// handle file inputs (can't persist value, just return name/type/multiple)
					if (type === 'file' || type === 'file multiple') {
						return Object.defineProperties(baseProps, {
							multiple: { value: isArray, enumerable: true },
						});
					}

					// handle all other input types (text, number, etc.)
					return Object.defineProperties(baseProps, {
						value: {
							enumerable: true,
							get() {
								const value = getValue();
								// eslint-disable-next-line typescript/no-unsafe-type-assertion
								return value != null ? String(value as string | number) : '';
							},
						},
					});
				};

				return createFieldProxy(asFunc, getInput, setInput, getIssues, [...path, 'as']);
			}

			// handle property access (nested fields)
			return createFieldProxy({}, getInput, setInput, getIssues, [...path, prop]);
		},
	}) as T;
}

// #endregion
