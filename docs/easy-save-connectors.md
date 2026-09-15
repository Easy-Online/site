# Easy Save storage connectors

Easy Save uses the existing EasyFile Azure Functions app as a provider-neutral storage gateway. The browser never stores OAuth access/refresh tokens, SFTP/FTPS passwords, WebDAV passwords, or S3 secret keys.

## Routes

- `GET /api/easy-save/providers` — connector health and OAuth configuration status.
- `POST /api/easy-save/connect/{provider}` — start OAuth or create a short-lived encrypted protocol connector session.
- `GET /api/easy-save/oauth/callback/{provider}` — OAuth callback for Google Drive, OneDrive, Dropbox and Box.
- `POST /api/easy-save/upload` — multipart upload to the selected provider.
- `POST /api/easy-save/disconnect/{provider}` — delete a short-lived connector session.

Supported providers: `google-drive`, `onedrive`, `dropbox`, `box`, `ftp` (SFTP or FTPS mode), `sftp`, `webdav`, and `s3` (AWS S3, MinIO or another S3-compatible service).

## Security model

A cryptographically random connector session ID is kept in browser `sessionStorage` only. Provider credentials and OAuth tokens are encrypted with AES-256-GCM before storage in Azure Table Storage. The encryption key is derived from `EASYFILE_STORAGE_ENCRYPTION_KEY`; if that setting is absent, the service derives an isolated storage key from the existing `EASYFILE_EMAIL_HMAC_SECRET`. Connector sessions expire automatically after eight hours by default.

OAuth `state` contains only a short-lived signed nonce. The opaque browser connector session and return URL are stored server-side while authorization is in progress, so storage-session capabilities are not exposed in provider redirect URLs or logs.

CORS is restricted by `EASYFILE_STORAGE_ALLOWED_ORIGINS`. User-supplied SFTP/FTPS, WebDAV and custom S3 endpoints are DNS-resolved and rejected when they point at loopback, private, link-local, local/internal hostnames or reserved network ranges. WebDAV and custom S3 endpoints require HTTPS unless `EASYFILE_ALLOW_INSECURE_STORAGE=true` is explicitly enabled for development. FTPS uses TLS; SFTP uses SSH. Plain unencrypted FTP is intentionally not exposed in the UI.

## OAuth app registrations required

Create one OAuth web application for each provider and add the callback URL shown below. Store client IDs and secrets as Azure Function App settings; never put them in JavaScript or GitHub source.

| Provider | Function App settings | Redirect URI |
|---|---|---|
| Google Drive | `EASYFILE_GOOGLE_CLIENT_ID`, `EASYFILE_GOOGLE_CLIENT_SECRET` | `https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save/oauth/callback/google-drive` |
| Microsoft OneDrive | `EASYFILE_MICROSOFT_CLIENT_ID`, `EASYFILE_MICROSOFT_CLIENT_SECRET` | `https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save/oauth/callback/onedrive` |
| Dropbox | `EASYFILE_DROPBOX_CLIENT_ID`, `EASYFILE_DROPBOX_CLIENT_SECRET` | `https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save/oauth/callback/dropbox` |
| Box | `EASYFILE_BOX_CLIENT_ID`, `EASYFILE_BOX_CLIENT_SECRET` | `https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save/oauth/callback/box` |

Google requests `drive.file`. Microsoft requests `Files.ReadWrite`, `User.Read`, and `offline_access`. Dropbox requests file-content read/write with offline refresh-token access. Box uses the application permissions enabled in the Box developer console.

## Protocol connectors

SFTP/FTPS, WebDAV and S3/MinIO credentials are entered in the Easy Save connection dialog and sent directly to the Azure Function over HTTPS. They are encrypted immediately and are not written to the website repository or browser local storage.

For S3-compatible systems, provide endpoint, region, bucket, optional prefix and credentials. AWS S3 can omit the endpoint. MinIO generally uses a custom HTTPS endpoint with path-style addressing.

For WebDAV, Easy Save creates missing path collections with `MKCOL` before uploading the file with `PUT`, which supports common Nextcloud, ownCloud and standards-based WebDAV deployments.

## Production settings

Recommended Function App settings:

```text
EASYFILE_STORAGE_TABLE=EasyFileStorageConnections
EASYFILE_STORAGE_SESSION_TTL_MINUTES=480
EASYFILE_STORAGE_MAX_UPLOAD_BYTES=52428800
EASYFILE_STORAGE_ALLOWED_ORIGINS=https://www.easyfile.co.za,https://easyfile.co.za
EASYFILE_STORAGE_RETURN_URL=https://www.easyfile.co.za/easy-save.html
EASYFILE_STORAGE_CALLBACK_BASE=https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save/oauth/callback
EASYFILE_STORAGE_ENCRYPTION_KEY=<32+ character independent random secret>
```

The frontend defaults to `https://easyfile-referrals-prod-za.azurewebsites.net/api/easy-save`. To move the gateway behind APIM or a custom hostname, set `window.EASYFILE_SAVE_API_BASE` before loading `assets/js/easy-save.js` and register the same callback paths with each OAuth provider.

## Deployment readiness

The storage connector code itself can deploy without OAuth provider credentials. In that state, `GET /api/easy-save/providers` reports OAuth providers as `configured: false`, while SFTP/FTPS, WebDAV and S3/MinIO remain available because their connection details are supplied per browser session. Google Drive, OneDrive, Dropbox and Box become operational after their respective Azure app settings and provider redirect URIs are configured.
