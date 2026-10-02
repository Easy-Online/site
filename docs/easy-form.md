# Easy Form

Easy Form is the EasyFile AI-assisted form builder and response-review module.

## Product scope

Easy Form is designed to cover four jobs in one workflow:

1. **Build** forms from scratch with common business field types.
2. **Assist** authors with AI-generated drafts and structural review.
3. **Collect** submissions in the current browser immediately, with a production API contract for central/public collection.
4. **Review** responses with New, Reviewed and Flagged states, reviewer notes, filtering and export.

## Current browser implementation

The browser module stores:
- forms in `easy.form.forms.v1`
- draft state in `easy.form.draft.v1`
- responses in `easy.form.responses.v1`

This local-first mode is suitable for demonstrations, internal single-device workflows, prototypes and offline usage. It must not be described as central public collection because browser LocalStorage does not synchronize between respondents.

## Recommended production architecture

Use the EasyFile backend pattern and keep provider keys and database credentials server-side.

Suggested routes:

- `POST /api/easy-form/generate` — generate a form definition from a natural-language prompt.
- `POST /api/easy-form/review` — review a form for ambiguity, missing fields and risky data collection.
- `POST /api/easy-form/forms` — create/publish a form.
- `GET /api/easy-form/forms/{formId}` — load a published public form definition.
- `POST /api/easy-form/forms/{formId}/responses` — submit a public response.
- `GET /api/easy-form/forms/{formId}/responses` — authenticated reviewer retrieval.
- `PATCH /api/easy-form/responses/{responseId}` — update review status/notes.
- `DELETE /api/easy-form/responses/{responseId}` — controlled deletion.
- `GET /api/easy-form/forms/{formId}/export?format=csv|json` — export responses.

## Data/security requirements

- TLS for all network calls.
- Authentication and role-based access for form authors/reviewers.
- Public submission endpoints should use rate limiting, bot protection and abuse controls.
- Encrypt sensitive server-side response data at rest.
- Keep an audit trail for form publication, schema changes and reviewer actions.
- Add retention/deletion controls aligned with POPIA and customer policy.
- Never embed LLM/API keys in the HTML or browser JavaScript.
- AI output must remain a draft until the form author reviews it.

## Included field types

Short text, long text, email, phone, number, date, dropdown, multiple choice, checkboxes, 1–5 rating and consent.

## Demo

Seed Demo creates a Microsoft 365 / Google Workspace customer discovery form and three response examples so Builder, Preview, Review, Flag and export paths can be exercised immediately.
