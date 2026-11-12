# Easy Type — AI Writing & Form Assistant

## Product position

**Recommended name:** Easy Type  
**Subtitle:** AI Writing & Form Assistant

Easy Type should be the writing-assistance layer for EasyFile: a practical combination of Grammarly-style writing improvement, AI drafting, reusable snippets/templates, dictation, and smart form completion.

The first release should work deeply across EasyFile. A later browser extension can extend the same assistant to third-party websites with explicit user permission.

## Core user jobs

1. **Write for me** — generate emails, letters, proposals, descriptions, notices, reports, form answers and business copy from a prompt.
2. **Improve my writing** — spelling, grammar, punctuation, clarity, concision, professional tone, readability and structure.
3. **Rewrite selected text** — formal, friendly, concise, persuasive, technical, plain-English, South African/British English.
4. **Continue writing** — complete a sentence, paragraph or document from the existing context.
5. **Smart form fill** — map saved profile/company/customer data into compatible EasyFile forms and suggest answers for free-text fields.
6. **Reusable content** — snippets, signatures, standard clauses, company descriptions, payment text and frequently used answers.
7. **Review before applying** — show original vs suggested text and require user approval before replacing content.
8. **Seed demo data** — one-click sample profile, example form, draft email, customer enquiry and document so every feature can be tested immediately.

## Recommended UI

### A. Writing workspace
- Large editor with word/character count
- Prompt box: “What do you want to write?”
- Actions: Write, Improve, Fix grammar, Rewrite, Shorten, Expand, Continue
- Tone selector: Professional, Friendly, Formal, Persuasive, Concise, Technical, Plain English
- Language/locale: English (South Africa) default, UK/US variants and future multilingual support
- Output length control
- Original / Suggested / Final tabs
- Accept all / accept individual changes / undo

### B. AI review panel
- Spelling
- Grammar
- Punctuation
- Clarity
- Tone
- Readability
- Consistency
- Possible ambiguity
- Suggested rewrite
- Optional sensitive-data warning before cloud AI submission

### C. Smart Form Assistant
- Load a demo form or supported EasyFile form
- Detect fields and classify them: name, company, address, email, phone, VAT, registration, dates, references and free text
- Map known values from Easy Company Profile / CRM
- Suggest free-text responses with AI
- Show confidence and source for each proposed value
- “Fill selected” and “Fill all reviewed”
- Never submit a form automatically

### D. Snippets & templates
Examples:
- Company introduction
- Email signature
- Quote cover note
- Invoice reminder
- Customer follow-up
- Supplier enquiry
- Tender response paragraph
- Delivery instructions
- Standard business terms
- Meeting follow-up
- Custom user snippets

### E. Demo mode
Seed Demo should create:
- Demo user/contact profile
- Demo company profile
- Customer enquiry
- Partially completed supplier onboarding form
- Poorly written email for grammar correction
- Blank email generation prompt
- Saved snippets/templates
- Example AI review results

## EasyFile integration

### Immediate integrations
- **Easy Company Profile:** trusted source for company identity/autofill
- **Easy CRM:** customer/contact data for form filling and personalised correspondence
- **Easy Letterhead:** hand finished letters/documents to Letterhead
- **Easy Edit:** send generated or rewritten content into the document editor
- **Easy Capture:** consume extracted text as writing/form evidence
- **Easy Save:** export/save generated documents
- **Quotes / Invoices / PO / Sales Orders / Receipts:** provide context-aware notes, terms and descriptions

### Shared assistant integration
Add an optional “Easy Type” action beside suitable textareas/content-editable fields across EasyFile:
- Improve
- Rewrite
- Generate
- Insert snippet
- Smart fill

This should be implemented through a reusable shared script rather than duplicated per module.

## Proposed technical architecture

### Front end
- `easy-type.html`
- `assets/js/easy-type/app.js`
- `assets/js/easy-type/editor.js`
- `assets/js/easy-type/form-assistant.js`
- `assets/js/easy-type/rules.js`
- `assets/js/easy-type/storage.js`
- `assets/js/easy-type/ai-client.js`
- `assets/js/easyfile-type-assistant.js` for cross-module field assistance
- shared EasyFile navigation/theme/brand assets

### Local-first functions
Functions that should work without cloud AI:
- Browser spelling support
- deterministic punctuation/whitespace cleanup
- common typo rules
- word/character counts
- snippet/template management
- local profile/form mapping
- undo/history
- seed demo
- export/copy
- local draft autosave

### AI functions
Route AI requests through an EasyFile backend endpoint. **Do not embed provider API keys in browser JavaScript.**

Suggested API contract:
- `POST /api/easy-type/generate`
- `POST /api/easy-type/rewrite`
- `POST /api/easy-type/review`
- `POST /api/easy-type/form-suggest`

The server should support an AI-provider adapter so the implementation is not hard-wired to one model vendor.

Request should include only the minimum required text/context and a declared operation, tone, locale and length. Return structured JSON with suggestions rather than uncontrolled HTML.

## Privacy and security requirements

- Local-first drafts and snippets
- Explicit “Use AI” action before text leaves the browser
- Explain what context will be sent
- Never place API keys/secrets in page source or localStorage
- Strip or warn on likely passwords, card data and secrets
- Optional PII detection before submission
- No automatic third-party form submission
- No hidden keystroke collection
- Form autofill must show proposed values before application
- AI output treated as untrusted text; escape/sanitise rendered content
- Rate limiting and abuse controls on AI endpoints
- Audit metadata for AI operation type/time, not full sensitive prompt content by default
- POPIA-aligned privacy messaging

## Browser-extension phase

A website page cannot reliably inject writing help into arbitrary third-party websites. For Grammarly-style assistance outside EasyFile, create a separate optional browser extension after the native module is stable.

Extension capabilities:
- detect textarea/input/contenteditable fields
- small Easy Type action button
- selected-text rewrite
- grammar suggestions
- user-approved smart fill
- snippets
- per-site permissions and allow/deny list
- never read password/payment fields

Reuse the same Easy Type backend/API and user profile schema.

## MVP acceptance criteria

- [ ] Easy Type appears in EasyFile navigation and landing-page module directory
- [ ] Conforms to EasyFile global theme, mobile menu, favicon and responsive styling
- [ ] Editor can create, edit, undo, copy and download text
- [ ] Local spell/grammar baseline works without AI
- [ ] AI actions have clear loading/error/unavailable states
- [ ] Generate / rewrite / improve / shorten / expand / continue actions
- [ ] Tone and locale controls
- [ ] Side-by-side original/suggestion comparison
- [ ] User must explicitly accept replacement
- [ ] Snippet/template CRUD
- [ ] Smart form demo with field mapping and confidence/source display
- [ ] Company Profile integration
- [ ] CRM/contact lookup integration where available
- [ ] Seed Demo populates all major workflows
- [ ] Autosave and clear/reset
- [ ] Import plain text; export TXT/HTML/JSON
- [ ] Keyboard accessible and mobile responsive
- [ ] Dark/light theme support
- [ ] No secret/API key exposed client-side
- [ ] Automated quality tests for local rules, form mapping and seed demo

## Phase 2 recommendations

- Voice dictation / speech-to-text
- OCR-to-form via Easy Capture
- document context import from Easy Edit
- multilingual writing/translation
- brand voice profiles
- team/shared snippet library
- writing history/version comparison
- customer-aware CRM response drafting
- document/form schema templates
- browser extension
- Microsoft Word / Outlook / Gmail integrations
- optional enterprise policy controls for AI providers and retention

## Naming options

1. **Easy Type** — recommended; short, clear and matches EasyFile module naming.
2. Easy Write — clearer for long-form writing but weaker for form filling.
3. Easy Assist — broad but less explicit.
4. Easy Compose — good for drafting but less suitable for grammar/autofill.

**Recommendation:** keep **Easy Type** as the product name and describe it everywhere as **“AI Writing & Form Assistant.”**

## Proposed implementation sequence

1. UX shell + local editor + demo seed
2. Grammar/rules engine + compare/apply UX
3. Snippets/templates
4. Smart form mapping + Company Profile integration
5. CRM context integration
6. Secure Easy Type AI API and provider adapter
7. AI generate/rewrite/review/form-suggest
8. Cross-module Easy Type action button
9. Accessibility/mobile/quality automation
10. Optional browser extension as separate deliverable

This document is intentionally a reviewable product/architecture proposal. Implementation should begin after scope approval.
