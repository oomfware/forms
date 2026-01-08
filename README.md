# @oomfware/forms

form validation middleware.

```sh
npm install @oomfware/forms
```

## usage

### basic form

```tsx
import { asyncContext, createRouter, route } from '@oomfware/fetch-router';
import { form, forms } from '@oomfware/forms';
import { render } from '@oomfware/jsx';
import * as v from 'valibot';

const routes = route({
	login: '/login',
});

const router = createRouter({
	middleware: [asyncContext()],
});

const loginForm = form(
	v.object({
		email: v.pipe(v.string(), v.email()),
		_password: v.pipe(v.string(), v.minLength(8)),
	}),
	async (data, issue) => {
		const user = await findUserByEmail(data.email);

		if (!user || !(await verifyPassword(user, data._password))) {
			invalid(issue.email('Invalid email or password'));
		}

		return { userId: user.id };
	},
);

router.map(routes, {
	middleware: [forms({ loginForm })],
	actions: {
		login() {
			return render(
				<form {...loginForm}>
					{loginForm.fields.email.issues()?.[0] && (
						<p class="error">{loginForm.fields.email.issues()![0].message}</p>
					)}

					<label>
						Email
						<input {...loginForm.fields.email.as('email')} />
					</label>

					<label>
						Password
						<input {...loginForm.fields._password.as('password')} />
					</label>

					<button>Sign in</button>
				</form>,
			);
		},
	},
});
```

### imperative validation

use `invalid()` to add validation errors after schema validation passes:

```ts
import { form, invalid } from '@oomfware/forms';
import * as v from 'valibot';

export const registerForm = form(
	v.object({
		username: v.pipe(v.string(), v.minLength(3)),
		email: v.pipe(v.string(), v.email()),
		_password: v.pipe(v.string(), v.minLength(8)),
	}),
	async (data, issue) => {
		const issues = [];

		if (await isUsernameTaken(data.username)) {
			issues.push(issue.username('Username is already taken'));
		}

		if (await isEmailRegistered(data.email)) {
			issues.push(issue.email('Email is already registered'));
		}

		if (issues.length > 0) {
			invalid(...issues);
		}

		return await createUser(data);
	},
);
```

### nested and array fields

```tsx
const profileForm = form(
	v.object({
		user: v.object({
			name: v.string(),
			bio: v.optional(v.string()),
		}),
		socialLinks: v.array(
			v.object({
				platform: v.string(),
				url: v.pipe(v.string(), v.url()),
			}),
		),
	}),
	async (data) => {
		return await updateProfile(data);
	},
);

// in template:
<input {...profileForm.fields.user.name.as('text')} />
<textarea {...profileForm.fields.user.bio.as('text')} />

{socialLinks.map((_, i) => (
	<>
		<input {...profileForm.fields.socialLinks[i].platform.as('text')} />
		<input {...profileForm.fields.socialLinks[i].url.as('url')} />
	</>
))}
```

### input types

the `.as()` method generates appropriate props for different input types:

```tsx
// text inputs
<input {...form.fields.name.as('text')} />
<input {...form.fields.email.as('email')} />
<input {...form.fields.password.as('password')} />

// numeric inputs (auto-parsed via n: prefix)
<input {...form.fields.age.as('number')} />
<input {...form.fields.rating.as('range')} />

// boolean checkbox (auto-parsed via b: prefix)
<input {...form.fields.subscribe.as('checkbox')} />

// checkbox group (multiple values)
<input {...form.fields.tags.as('checkbox', 'javascript')} />
<input {...form.fields.tags.as('checkbox', 'typescript')} />

// radio buttons
<input {...form.fields.color.as('radio', 'red')} />
<input {...form.fields.color.as('radio', 'blue')} />

// select
<select {...form.fields.country.as('select')}>
	<option value="us">United States</option>
</select>

// hidden fields (for IDs, tokens, etc.)
<input {...form.fields.postId.as('hidden', postId)} />

// file uploads
<input {...form.fields.avatar.as('file')} />
<input {...form.fields.attachments.as('file multiple')} />
```

### accessing form result

```tsx
router.map(routes, {
	middleware: [forms({ messageForm })],
	messages() {
		if (messageForm.result) {
			return render(<p>Message sent! ID: {messageForm.result.messageId}</p>);
		}

		return render(<form {...messageForm}>{/* form fields */}</form>);
	},
});
```

### multiple submit actions

use `buttonProps` when a form has multiple submit buttons that trigger different actions:

```tsx
import { form, forms } from '@oomfware/forms';
import { render } from '@oomfware/jsx';
import * as v from 'valibot';

const draftSchema = v.object({
	title: v.string(),
	content: v.string(),
});

const saveDraft = form(draftSchema, async (data) => {
	return await saveDraftToDb(data);
});

const publishPost = form(draftSchema, async (data) => {
	return await publishToDb(data);
});

router.map(routes, {
	middleware: [forms({ saveDraft, publishPost })],
	actions: {
		editor() {
			return render(
				<form {...saveDraft}>
					<input {...saveDraft.fields.title.as('text')} placeholder="Title" />
					<textarea {...saveDraft.fields.content.as('text')} />

					<button>Save draft</button>
					<button {...publishPost.buttonProps}>Publish</button>
				</form>,
			);
		},
	},
});
```

### sensitive field redaction

fields prefixed with `_` are automatically redacted from form state on validation failure:

```tsx
const loginForm = form(
	v.object({
		email: v.pipe(v.string(), v.email()),
		_password: v.pipe(v.string(), v.minLength(8)), // redacted on error
	}),
	async (data) => {
		// data._password is available here
	},
);

// if validation fails, loginForm.fields._password.value() returns undefined
// this prevents passwords from being echoed back in the form
```
