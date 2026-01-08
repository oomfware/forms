import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * error thrown when form validation fails imperatively
 */
export class ValidationError extends Error {
	issues: StandardSchemaV1.Issue[];

	constructor(issues: StandardSchemaV1.Issue[]) {
		super('Validation failed');
		this.name = 'ValidationError';
		this.issues = issues;
	}
}

/**
 * use this to throw a validation error to imperatively fail form validation.
 * can be used in combination with `issue` passed to form actions to create field-specific issues.
 *
 * @example
 * ```ts
 * import { invalid, form } from '@oomfware/forms';
 * import * as v from 'valibot';
 *
 * export const login = form(
 *   v.object({ name: v.string(), _password: v.string() }),
 *   async ({ name, _password }, issue) => {
 *     const success = tryLogin(name, _password);
 *     if (!success) {
 *       invalid('Incorrect username or password');
 *     }
 *
 *     // ...
 *   }
 * );
 * ```
 */
export function invalid(...issues: (StandardSchemaV1.Issue | string)[]): never {
	throw new ValidationError(issues.map((issue) => (typeof issue === 'string' ? { message: issue } : issue)));
}

/**
 * checks whether this is a validation error thrown by {@link invalid}.
 */
export function isValidationError(e: unknown): e is ValidationError {
	return e instanceof ValidationError;
}
