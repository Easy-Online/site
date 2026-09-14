# EasyFile SaaS architecture

## Domain model

Every durable record is owned by an organisation. A user accesses an organisation through a membership with an explicit role.

Core entities are users, organisations, memberships, company profiles, customers, suppliers, products, source documents, bank imports, transactions, categorisation rules, invoices, expenses, exports, audit events and subscriptions.

Every tenant-owned table includes organisation_id. Tenant filtering is enforced by the data layer and database policy, not by interface code.

## Trust boundaries

- Browser: form state, local drafts and client-side PDF parsing.
- Application API: authenticated commands, validation and tenant checks.
- Database: durable records, tenant policies and audit metadata.
- Object storage: encrypted source files and generated exports.
- Billing provider: customer, subscription and payment state.

Source documents are not uploaded unless the user explicitly chooses cloud storage. Local-only and cloud-backed states must be visually distinct.

## Roles

- Owner: billing, deletion, exports and membership administration.
- Admin: workspace settings and operational administration.
- Member: create and update business records.
- Reviewer: review, approve and export.
- Read only: view and download permitted records.

## Incremental migration

1. Introduce authentication, organisations and memberships.
2. Build shared company, customer and supplier records.
3. Move bank conversion into durable imports and transactions.
4. Connect expenses, cash flow and VAT.
5. Migrate document modules as customers require them.
6. Retain local-only tools during the transition.

## Platform capabilities

Managed authentication with MFA, a relational database with tenant controls, encrypted object storage, background jobs, transactional email, subscription billing, structured logs, error reporting, uptime monitoring, automated backups and restore exercises.
