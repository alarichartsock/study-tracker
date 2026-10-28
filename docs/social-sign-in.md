# Social sign-in (Apple, Google, GitHub, Microsoft)

Sign-in with Apple, Google, GitHub and Microsoft is built in, with no extra dependencies (`lib/oauth.js`).
Each button stays hidden until that provider is fully configured **and** `OAUTH_BASE_URL` is set.

## Requirements

- A real domain served over **HTTPS**. Every provider requires HTTPS redirect URIs, and Apple rejects IP addresses and `localhost`.
  The Tailscale address `http://100.96.98.48:3000` can't be used.
- `OAUTH_BASE_URL` is the public origin users see, for example `https://studyhertz.example`, with no trailing slash.
- After changing the configuration, restart the server.

## Where to put credentials

Use environment variables, or a gitignored `oauth.config.json` in the repo root with the same keys. Environment variables take precedence.

```json
{
  "OAUTH_BASE_URL": "https://studyhertz.example",
  "GOOGLE_CLIENT_ID": "", "GOOGLE_CLIENT_SECRET": "",
  "GITHUB_CLIENT_ID": "", "GITHUB_CLIENT_SECRET": "",
  "MICROSOFT_CLIENT_ID": "", "MICROSOFT_CLIENT_SECRET": "", "MICROSOFT_TENANT": "common",
  "APPLE_SERVICES_ID": "", "APPLE_TEAM_ID": "", "APPLE_KEY_ID": "", "APPLE_PRIVATE_KEY_FILE": "C:/path/AuthKey_XXXXXXXXXX.p8"
}
```

`oauth.config.json` and `*.p8` are in `.gitignore`. Never commit them.

## Exact redirect URIs

Replace `<BASE>` with `OAUTH_BASE_URL`.

| Provider  | Redirect / callback URI                  | Method |
|-----------|------------------------------------------|--------|
| Google    | `<BASE>/api/oauth/google/callback`       | GET |
| GitHub    | `<BASE>/api/oauth/github/callback`       | GET |
| Microsoft | `<BASE>/api/oauth/microsoft/callback`    | GET |
| Apple     | `<BASE>/api/oauth/apple/callback`        | POST (`form_post`) |

## Google

1. Open Google Cloud Console, then **APIs & Services**, then **OAuth consent screen**. Choose **External**. Set the app name, support email, privacy policy URL and authorized domain, and add the scopes `openid`, `email` and `profile`. Publish the app; while it's in testing, only listed test users can sign in.
2. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**, and choose **Web application**.
3. Under **Authorized redirect URIs**, add `<BASE>/api/oauth/google/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## GitHub

1. Go to GitHub, then **Settings**, then **Developer settings**, then **OAuth Apps**, then **New OAuth App**. This can be under an organization.
2. Set the homepage URL to `<BASE>`, and the **Authorization callback URL** to `<BASE>/api/oauth/github/callback`.
3. Generate a client secret, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
4. The scopes requested are `read:user user:email`. The app links accounts only with a **verified** address from `/user/emails`.

## Microsoft (Entra ID / personal accounts)

1. Go to the Microsoft Entra admin center, then **App registrations**, then **New registration**.
2. Supported account types: choose **Accounts in any organizational directory and personal Microsoft accounts** to match `MICROSOFT_TENANT=common`.
3. Under Redirect URI, choose the **Web** platform and enter `<BASE>/api/oauth/microsoft/callback`.
4. Go to **Certificates & secrets**, then **New client secret**. Copy the **Value**, not the ID. Note the expiry date and set a reminder to rotate it.
5. Under **Token configuration**, add the optional claims `email` and `xms_edov` to the ID token. Microsoft only counts an email as verified for personal accounts, or when `xms_edov` is true, so other work accounts don't link by email.
6. Set `MICROSOFT_CLIENT_ID` (the Application (client) ID), `MICROSOFT_CLIENT_SECRET`, and optionally `MICROSOFT_TENANT`.

## Apple

This needs a paid Apple Developer Program membership.

1. Go to **Certificates, Identifiers & Profiles**, then **Identifiers**. Create an **App ID** with **Sign in with Apple** enabled, or use an existing one.
2. Create a **Services ID**, for example `com.studyhertz.web`. This becomes `APPLE_SERVICES_ID`, the `client_id`. Enable **Sign in with Apple**, click **Configure**, choose the primary App ID, and add:
   - **Domains and Subdomains**: the bare domain of `<BASE>`, such as `studyhertz.example`.
   - **Return URLs**: `<BASE>/api/oauth/apple/callback`.
3. Go to **Keys**, then **+**, and enable **Sign in with Apple** for the same App ID. Download the `.p8` file; it can be downloaded only once. Note the **Key ID**.
4. Set `APPLE_TEAM_ID` (top right of the developer portal), `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY_FILE` (the path to the `.p8`). Alternatively, set `APPLE_PRIVATE_KEY` to the PEM text, with `\n` escapes allowed.
5. If users choose "Hide My Email", Apple gives them a private relay address. To email them, register your sending domain under **Services**, then **Sign in with Apple for Email Communication**.

How the app handles Apple:
- The client secret is an ES256 JWT minted per request from the `.p8` key.
- The callback is an HTTPS POST (`form_post`). Because of that, the short-lived binding cookie is `SameSite=None; Secure` when `OAUTH_BASE_URL` is HTTPS.
- Apple sends the user's name **only on the first** authorization. The app saves it as the display name and never overwrites it.
- Private relay addresses (`@privaterelay.appleid.com`) are never used as usernames.

## Security behaviour

- Each sign-in uses PKCE (S256) where the provider supports it, a single-use `state` that expires after 10 minutes and is bound to the browser by a cookie, and an OIDC `nonce`.
- ID tokens are verified against the provider's JWKS. The checks cover the signature (RS256/ES256 only, never `none`), `iss`, `aud`, `exp`, `iat` and `nonce`. Keys are cached for an hour and refetched once when a key rotates.
- **Account linking happens only by verified email**: an identity's verified email has to match an existing account's verified email. Unverified emails always create a separate account.
- New social accounts follow the same rules as password sign-up: registration has to be open, sign-ups are rate limited per IP, and new users get the welcome tour. Ready Room is unlocked by finishing the tour.
- Social-only accounts have no password; password login for them always fails.
