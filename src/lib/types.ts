// #region utility types

export type MaybePromise<T> = T | Promise<T>;

type MaybeArray<T> = T | T[];

// #endregion

// #region form input types

/**
 * valid structure for form input data
 */
export interface FormInput {
	[key: string]: MaybeArray<string | number | boolean | File | FormInput>;
}

/**
 * a validation issue with path information
 */
export interface FormIssue {
	message: string;
	path: (string | number)[];
}

/**
 * internal representation of a form validation issue with computed path info
 */
export interface InternalFormIssue {
	/** dot/bracket notation path string (e.g., "user.emails[0]") */
	name: string;
	/** path segments as array */
	path: (string | number)[];
	/** error message */
	message: string;
	/** whether this issue came from server validation */
	server: boolean;
}

// #endregion

// #region input type mapping

/**
 * maps input types to their corresponding value types
 */
export type InputTypeMap = {
	text: string;
	email: string;
	password: string;
	url: string;
	tel: string;
	search: string;
	number: number;
	range: number;
	date: string;
	'datetime-local': string;
	time: string;
	month: string;
	week: string;
	color: string;
	checkbox: boolean | string[];
	radio: string;
	file: File;
	'file multiple': File[];
	hidden: string;
	submit: string;
	button: string;
	reset: string;
	image: string;
	select: string;
	'select multiple': string[];
};

/**
 * all valid input type strings
 */
export type InputType = keyof InputTypeMap;

/**
 * valid input types for a given value type
 */
export type FieldInputType<T> = {
	[K in keyof InputTypeMap]: T extends InputTypeMap[K] ? K : never;
}[keyof InputTypeMap];

/**
 * value argument for the `as()` method based on input type.
 * returns `[value]` tuple for types that require a value, or `[]` otherwise.
 *
 * note: separating `type` from `value` in the `.as()` signature ensures TypeScript
 * can properly infer the type parameter before resolving the value constraint.
 * using `...args: [type, value?]` with a union of tuple types causes inference issues.
 */
export type AsValueArgs<Type extends keyof InputTypeMap, Value> = Type extends 'checkbox'
	? Value extends string[]
		? [value: Value[number] | (string & {})]
		: []
	: Type extends 'radio' | 'submit' | 'hidden'
		? [value: Value | (string & {})]
		: [];

// #endregion

// #region input element props

interface CheckboxRadioProps<T extends 'checkbox' | 'radio'> {
	name: string;
	type: T;
	value: string;
	'aria-invalid'?: 'true';
	readonly checked: boolean;
}

interface FileProps {
	name: string;
	type: 'file';
	'aria-invalid'?: 'true';
}

interface FileMultipleProps {
	name: string;
	type: 'file';
	multiple: true;
	'aria-invalid'?: 'true';
}

interface SelectProps {
	name: string;
	multiple: false;
	'aria-invalid'?: 'true';
	readonly value: string;
}

interface SelectMultipleProps {
	name: string;
	multiple: true;
	'aria-invalid'?: 'true';
	readonly value: string[];
}

interface TextProps {
	name: string;
	'aria-invalid'?: 'true';
	readonly value: string;
}

interface TypedInputProps<T extends string> {
	name: string;
	type: T;
	'aria-invalid'?: 'true';
	readonly value: string;
}

/**
 * input element properties based on input type
 */
export type InputElementProps<T extends keyof InputTypeMap> = T extends 'checkbox' | 'radio'
	? CheckboxRadioProps<T>
	: T extends 'file'
		? FileProps
		: T extends 'file multiple'
			? FileMultipleProps
			: T extends 'select'
				? SelectProps
				: T extends 'select multiple'
					? SelectMultipleProps
					: T extends 'text'
						? TextProps
						: TypedInputProps<T>;

// #endregion

// #region field types

/** valid leaf value types for form fields */
export type FormFieldValue = string | string[] | number | boolean | File | File[];

/** guard to prevent infinite recursion when T is unknown or has an index signature */
type WillRecurseIndefinitely<T> = unknown extends T ? true : string extends keyof T ? true : false;

/** base methods available on all form fields */
interface FieldMethods<T> {
	/** get the current value */
	value(): T | undefined;
	/** set the value */
	set(value: T): T;
	/** get validation issues for this field */
	issues(): FormIssue[] | undefined;
}

/**
 * leaf field type for primitive values with `.as()` method
 */
export type FormFieldLeaf<T extends FormFieldValue> = FieldMethods<T> & {
	/**
	 * get props for binding to an input element.
	 * returns an object with `name`, `aria-invalid`, and type-specific props.
	 *
	 * @example
	 * ```ts
	 * <input {...fields.name.as('text')} />
	 * <input {...fields.age.as('number')} />
	 * <input {...fields.agreed.as('checkbox')} />
	 * <input {...fields.color.as('radio', 'red')} />
	 * ```
	 */
	as<K extends FieldInputType<T>>(type: K, ...value: AsValueArgs<K, T>): InputElementProps<K>;
};

/**
 * container field type for objects/arrays with `.allIssues()` method
 */
export type FormFieldContainer<T> = FieldMethods<T> & {
	/** get all issues for this field and descendants */
	allIssues(): FormIssue[] | undefined;
};

/**
 * fallback field type when recursion would be infinite
 */
type UnknownField<T> = FieldMethods<T> & {
	/** get all issues for this field and descendants */
	allIssues(): FormIssue[] | undefined;
	/** get props for an input element */
	as<K extends FieldInputType<FormFieldValue>>(
		type: K,
		...value: AsValueArgs<K, FormFieldValue>
	): InputElementProps<K>;
} & {
	[key: string | number]: UnknownField<any>;
};

// by breaking this out into its own type, we avoid the TS recursion depth limit
type RecursiveFormFields = FormFieldContainer<any> & {
	[key: string | number]: UnknownField<any>;
};

/**
 * recursive type to build form fields structure with proxy access.
 * preserves type information through the object hierarchy.
 */
export type FormFields<T> =
	WillRecurseIndefinitely<T> extends true
		? RecursiveFormFields
		: NonNullable<T> extends string | number | boolean | File
			? FormFieldLeaf<NonNullable<T>>
			: T extends string[] | File[]
				? FormFieldLeaf<T> & { [K in number]: FormFieldLeaf<T[number]> }
				: T extends Array<infer U>
					? FormFieldContainer<T> & { [K in number]: FormFields<U> }
					: FormFieldContainer<T> & { [K in keyof T]-?: FormFields<T[K]> };

// #endregion
