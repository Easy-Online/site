# EasyFile security and privacy release checklist

## Identity and access

- MFA is available for owners and administrators.
- Sessions expire and can be revoked.
- Privileged changes require recent authentication.
- Invitations expire and are single-use.
- Tests attempt cross-organisation access for every entity.

## Data protection

- TLS is required in transit and managed encryption is enabled at rest.
- Secrets remain outside source control.
- Uploaded documents use private storage and time-limited links.
- Retention periods cover documents, logs, backups and deleted accounts.
- Restore tests are recorded at least quarterly.

## POPIA operations

- Processing purposes and lawful bases are recorded.
- Operators and subprocessors are documented.
- Access, correction, export and deletion procedures are tested.
- Cross-border processing is assessed and disclosed.
- The Information Officer and escalation route are documented.
- Security-compromise response covers regulator and data-subject notification.

## Engineering and customer trust

- Protected production branch, reviewed changes, dependency and secret scanning.
- Content Security Policy, restrictive CORS and endpoint rate limits.
- Audit events for access, export, deletion, role and billing changes.
- Production errors exclude statement contents and personal data.
- Status page, support route and current subprocessor information.
- Accurate local-only versus cloud-backed labels.
