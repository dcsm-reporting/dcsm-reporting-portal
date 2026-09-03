# Verifying the Cloudflare Access token (optional hardening)

## What the portal trusts today

Cloudflare Access sits in front of the Worker and adds a
`Cf-Access-Authenticated-User-Email` header to every request that passed the
login. The Worker reads that header and treats it as the signed-in user.

That is safe **only while every path to the Worker goes through Access**. Two
things would quietly break it:

- someone attaches a second hostname (a custom domain, a new `workers.dev`
  route) without putting an Access application in front of it;
- the Access application is deleted or its policy is changed to "Bypass".

In either case, anyone could send that header by hand and be whoever they
claim, including an admin.

## Turning on the signed-token check

Access also adds a `Cf-Access-Jwt-Assertion` header: a signed token that
carries the same email, the application it was issued for, and an expiry.
The Worker can verify that signature against the team's published keys. Once
verified, a spoofed header is worthless.

Set two variables in `wrangler.toml` under `[vars]` and redeploy:

```toml
[vars]
PORTAL_ENV = "production"
ACCESS_TEAM_DOMAIN = "late-fire-fa86.cloudflareaccess.com"
ACCESS_AUD = "<paste the Application Audience (AUD) tag>"
```

Where to find the AUD tag: Zero Trust dashboard → **Access → Applications** →
open the portal's application → **Overview** → *Application Audience (AUD)
Tag* (a 64-character hex string).

Both variables must be set together. With exactly one set, every API call
fails with a clear 500 so a half-configured deploy is noticed immediately
rather than silently running unverified.

## What changes once it is on

- Every `/api/*` request (except `/api/health`, the sheet webhook
  `/api/friends/sync`, and the Slides feed `/api/slides/*`, which use their
  own bearer secrets) must carry a valid
  token. The email in the token becomes the signed-in user; the header must
  match it.
- Keys are fetched from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
  and cached for an hour (in the Worker and in KV). A token signed by a key
  that is not cached triggers one forced refresh, so key rotation is handled.
- Local `wrangler dev` is unaffected as long as the two vars are not in
  `.dev.vars` (it keeps using `DEV_USER`).

## If it locks everyone out

The only likely cause is a wrong `ACCESS_AUD` (or an Access application that
was recreated, which changes the tag). Remove both vars from `wrangler.toml`,
run `npm run deploy`, and the portal is back on header trust while you find the
right tag.

Implementation: `src/server/auth.ts`, wired in the auth middleware in
`src/server/index.ts`.
