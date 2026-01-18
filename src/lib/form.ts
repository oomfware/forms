import { createInjectionKey } from '@oomfware/fetch-router';
import { getContext } from '@oomfware/fetch-router/middlewares/async-context';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { ValidationError } from './errors.ts';
import { createFieldProxy, deepSet, flattenIssues, normalizeIssue } from './form-utils.ts';
import type { FormFields, FormInput, InternalFormIssue, MaybePromise } from './types.ts';

// #region types

/**
 * the issue creator proxy passed to form callbacks.
 * allows creating field-specific validation issues via property access.
 *
 * @example
 * ```ts
 * form(schema, async (data, issue) => {
 *   if (emailTaken(data.email)) {
 *     invalid(issue.email('Email already in use'));
 *   }
 *   // nested fields: issue.user.profile.name('Invalid name')
 *   // array fields: issue.items[0].name('Invalid item name')
 * });
 * ```
 */
export type InvalidField<T> = ((message: string) => StandardSchemaV1.Issue) & {
	[K in keyof T]-?: T[K] extends (infer U)[]
		? InvalidFieldArray<U>
		: T[K] extends object
			? InvalidField<T[K]>
			: (message: string) => StandardSchemaV1.Issue;
};

type InvalidFieldArray<T> = {
	[index: number]: T extends object ? InvalidField<T> : (message: string) => StandardSchemaV1.Issue;
} & ((message: string) => StandardSchemaV1.Issue);

/**
 * symbol used to identify form instances.
 */
export const kForm = Symbol.for('@oomfware/forms');

/**
 * internal info attached to a form instance.
 * used by the forms() middleware to identify and process forms.
 */
export interface FormInfo {
	/** the schema, if any */
	schema: StandardSchemaV1 | null;
	/** the handler function */
	fn: (data: any, issue: any) => MaybePromise<any>;
}

/**
 * form config stored by the forms() middleware.
 */
export interface FormConfig {
	/** the form id, derived from registration name */
	id: string;
}

/**
 * form state stored by the forms() middleware.
 */
export interface FormState<Input = unknown, Output = unknown> {
	/** the submitted input data (for repopulating form on error) */
	input?: Input;
	/** validation issues, flattened by path */
	issues?: Record<string, InternalFormIssue[]>;
	/** the handler result (if successful) */
	result?: Output;
}

/**
 * the form store holds registered forms, their configs, and state.
 */
export interface FormStore {
	/** map of form instance to config */
	configs: WeakMap<InternalForm<any, any>, FormConfig>;
	/** state for each form instance */
	state: WeakMap<InternalForm<any, any>, FormState>;
}

/**
 * injection key for the form store.
 */
export const FORM_STORE_KEY = createInjectionKey<FormStore>();

/**
 * options for configuring form behavior.
 */
export interface FormOptions {
	/**
	 * if true, preserves existing search params instead of replacing them.
	 * @default false
	 */
	preserveParams?: boolean;
}

/**
 * the return value of a form() function.
 * can be spread onto a <form> element.
 */
export interface Form<Input extends FormInput | void, Output> {
	/** HTTP method */
	readonly method: 'POST';
	/** the form action URL */
	readonly action: string;
	/** the handler result, if submission was successful */
	readonly result: Output | undefined;
	/** access form fields using object notation */
	readonly fields: FormFields<Input>;
	/**
	 * returns a configured form with the given options.
	 * @param options form configuration options
	 * @returns a new form object with the options applied
	 */
	with(options: FormOptions): ConfiguredForm;
}

/**
 * internal form type with metadata.
 * used internally by middleware; cast Form to this when accessing `__`.
 */
export interface InternalForm<Input extends FormInput | void, Output> extends Form<Input, Output> {
	/** internal form info, used by forms() middleware */
	readonly __: FormInfo;
}

// #region issue creator

/**
 * creates an issue creator proxy that builds up paths for field-specific issues.
 */
function createIssueCreator<T>(): InvalidField<T> {
	return new Proxy((message: string) => createIssue(message), {
		get(_target, prop) {
			if (typeof prop === 'symbol') return undefined;
			return createIssueProxy(prop, []);
		},
	}) as InvalidField<T>;

	function createIssue(message: string, path: (string | number)[] = []): StandardSchemaV1.Issue {
		return { message, path };
	}

	function createIssueProxy(
		key: string | number,
		path: (string | number)[],
	): (message: string) => StandardSchemaV1.Issue {
		const newPath = [...path, key];

		const issueFunc = (message: string) => createIssue(message, newPath);

		return new Proxy(issueFunc, {
			get(_target, prop) {
				if (typeof prop === 'symbol') return undefined;

				if (/^\d+$/.test(prop)) {
					return createIssueProxy(parseInt(prop, 10), newPath);
				}

				return createIssueProxy(prop, newPath);
			},
		});
	}
}

// #endregion

// #region form state access

/**
 * get the form store from the current request context.
 * @throws if called outside of a request context
 */
export function getFormStore(): FormStore {
	const context = getContext();
	const store = context.store.inject(FORM_STORE_KEY);

	if (!store) {
		throw new Error('form store not found. make sure the forms() middleware is installed.');
	}

	return store;
}

/**
 * get config for a specific form instance.
 * @throws if form is not registered with forms() middleware
 */
function getFormConfig(form: InternalForm<any, any>): FormConfig {
	const store = getFormStore();
	const config = store.configs.get(form);

	if (!config) {
		throw new Error('form not registered. make sure to pass it to the forms() middleware.');
	}

	return config;
}

/**
 * get state for a specific form instance.
 */
export function getFormState<Input, Output>(
	form: InternalForm<any, any>,
): FormState<Input, Output> | undefined {
	const store = getFormStore();
	return store.state.get(form) as FormState<Input, Output> | undefined;
}

/**
 * set state for a specific form instance.
 */
export function setFormState<Input, Output>(
	form: InternalForm<any, any>,
	state: FormState<Input, Output>,
): void {
	const store = getFormStore();
	store.state.set(form, state);
}

// #endregion

// #region action url helpers

/**
 * builds the form action URL, optionally preserving existing search params.
 */
function buildActionUrl(configId: string, preserveParams: boolean): string {
	if (!preserveParams) {
		return `?__action=${configId}`;
	}

	const context = getContext();
	const url = new URL(context.request.url);
	url.searchParams.set('__action', configId);
	return `?${url.searchParams.toString()}`;
}

// #endregion

// #region form function

/**
 * creates a form without validation.
 */
export function form<Output>(fn: () => MaybePromise<Output>): Form<void, Output>;

/**
 * creates a form with unchecked input (no validation).
 */
export function form<Input extends FormInput, Output>(
	validate: 'unchecked',
	fn: (data: Input, issue: InvalidField<Input>) => MaybePromise<Output>,
): Form<Input, Output>;

/**
 * creates a form with Standard Schema validation.
 */
export function form<Schema extends StandardSchemaV1<FormInput, Record<string, unknown>>, Output>(
	validate: Schema,
	fn: (
		data: StandardSchemaV1.InferOutput<Schema>,
		issue: InvalidField<StandardSchemaV1.InferInput<Schema>>,
	) => MaybePromise<Output>,
): Form<StandardSchemaV1.InferInput<Schema>, Output>;

export function form(
	validateOrFn: StandardSchemaV1 | 'unchecked' | (() => MaybePromise<unknown>),
	maybeFn?: (data: any, issue: any) => MaybePromise<unknown>,
): Form<any, any> {
	const fn = (maybeFn ?? validateOrFn) as (data: any, issue: any) => MaybePromise<unknown>;

	const schema: StandardSchemaV1 | null =
		!maybeFn || validateOrFn === 'unchecked' ? null : (validateOrFn as StandardSchemaV1);

	const instance = {} as InternalForm<any, any>;

	const info: FormInfo = {
		schema,
		fn,
	};

	// method
	Object.defineProperty(instance, 'method', {
		value: 'POST',
		enumerable: true,
	});

	// action - computed from form store, replaces search params by default
	Object.defineProperty(instance, 'action', {
		get() {
			const config = getFormConfig(instance);
			return buildActionUrl(config.id, false);
		},
		enumerable: true,
	});

	// result - from state store
	Object.defineProperty(instance, 'result', {
		get() {
			return getFormState(instance)?.result;
		},
	});

	// fields - proxy for field access
	Object.defineProperty(instance, 'fields', {
		get() {
			return createFieldProxy(
				{},
				() => (getFormState(instance)?.input as Record<string, unknown>) ?? {},
				(path, value) => {
					const currentState = getFormState(instance) ?? { input: {} };
					if (path.length === 0) {
						setFormState(instance, { ...currentState, input: value });
					} else {
						const input = (currentState.input as Record<string, unknown>) ?? {};
						deepSet(input, path.map(String), value);
						setFormState(instance, { ...currentState, input });
					}
				},
				() => getFormState(instance)?.issues ?? {},
			);
		},
	});

	// internal info
	Object.defineProperty(instance, '__', {
		value: info,
	});

	// brand symbol for identification
	Object.defineProperty(instance, kForm, {
		value: true,
		enumerable: false,
	});

	// with() - returns a configured form
	Object.defineProperty(instance, 'with', {
		value: (options: FormOptions) => createConfiguredForm(instance, options),
	});

	return instance;
}

/**
 * configured form props for spreading onto a form element.
 */
export interface ConfiguredForm {
	readonly method: 'POST';
	readonly action: string;
	with(options: FormOptions): ConfiguredForm;
}

/**
 * creates a configured form wrapper with custom options.
 */
function createConfiguredForm(source: InternalForm<any, any>, options: FormOptions): ConfiguredForm {
	const preserveParams = options.preserveParams ?? false;
	const configured = {} as ConfiguredForm;

	Object.defineProperty(configured, 'method', {
		value: 'POST',
		enumerable: true,
	});

	Object.defineProperty(configured, 'action', {
		get() {
			const config = getFormConfig(source);
			return buildActionUrl(config.id, preserveParams);
		},
		enumerable: true,
	});

	Object.defineProperty(configured, 'with', {
		value: (newOptions: FormOptions) => createConfiguredForm(source, { ...options, ...newOptions }),
	});

	return configured;
}

// #endregion

// #region form processing

/**
 * redacts sensitive fields (those starting with `_`) from form input.
 * this prevents passwords and other sensitive data from being returned in form state.
 */
function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const key of Object.keys(obj)) {
		if (key.startsWith('_')) continue;

		const value = obj[key];

		if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof File)) {
			result[key] = redactSensitiveFields(value as Record<string, unknown>);
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) =>
				item !== null && typeof item === 'object' && !(item instanceof File)
					? redactSensitiveFields(item as Record<string, unknown>)
					: item,
			);
		} else {
			result[key] = value;
		}
	}

	return result;
}

/**
 * process a form submission.
 * called by forms() middleware when a matching action is received.
 */
export async function processForm(formInstance: InternalForm<any, any>, data: FormInput): Promise<FormState> {
	const { schema, fn } = formInstance.__;

	let validatedData = data;

	// validate with schema if present
	if (schema) {
		const result = await schema['~standard'].validate(data);

		if (result.issues) {
			return {
				result: undefined,
				issues: flattenIssues(result.issues.map((issue) => normalizeIssue(issue, true))),
				input: redactSensitiveFields(data),
			};
		}
		validatedData = result.value as FormInput;
	}

	// run handler
	const issue = createIssueCreator();

	try {
		return {
			result: await fn(validatedData, issue),
			issues: undefined,
			input: undefined,
		};
	} catch (e) {
		if (e instanceof ValidationError) {
			return {
				result: undefined,
				issues: flattenIssues(e.issues.map((issue) => normalizeIssue(issue, true))),
				input: redactSensitiveFields(data),
			};
		}

		throw e;
	}
}

// #endregion
