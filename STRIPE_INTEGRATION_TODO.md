# Stripe Checkout integration

StudyHertz already creates Stripe Checkout Sessions from `POST /api/billing/checkout` in `server.js` (raw HTTP through the existing `stripe()` helper in `lib/billing.js`). Hosted Checkout is wired. No new route, success page, sample server, or secret key was added.

API version: `2026-09-30.endive` (`lib/billing.js`). Current Checkout examples use the `*_page` form (`embedded_page`), so both creates send `ui_mode=hosted_page`. If Stripe rejects that enum, change both creates to `hosted` and update this file.

## Values to Replace

None. `success_url`, `cancel_url`, `line_items`, and `mode` are already real StudyHertz values, not Checkout Studio placeholders.

| Field | Lifetime (`mode: payment`) | Monthly / yearly (`mode: subscription`) |
| --- | --- | --- |
| `mode` | `payment` | `subscription` |
| `success_url` | `{base}/?billing=success` | `{base}/?billing=success` |
| `cancel_url` | `{base}/?billing=cancel` | `{base}/?billing=cancel` |
| `line_items` | `bcfg.prices.lifetime` | `bcfg.prices[plan]` (`monthly` or `yearly`) |

`{base}` is the request origin from `baseUrl(req)`. Those four fields stay the live app values above. Secret keys stay in the environment (`GROK_FULL_ACCESS` / `STRIPE_SECRET_KEY` and the price env vars).

## Configured Parameters

Both creates are the `stripe('POST', '/checkout/sessions', …)` calls in `server.js` (lifetime near the `plan === 'lifetime'` branch, subscription immediately after).

Applied on **both** sessions:

- `ui_mode`: `hosted_page`
- `billing_address_collection`: `auto`
- `phone_number_collection.enabled`: `false` (encoded as `phone_number_collection[enabled]=false` by `billing.form`)
- `automatic_tax.enabled`: `true`
- `allow_promotion_codes`: `false`
- `submit_type`: `auto`
- `integration_identifier`: `hosted_web_0001` (replaces `studyhertz-lifetime-qhxmzpta` and `studyhertz-subscribe-qhxmzpta`)
- `origin_context`: `web`

Applied on the **subscription** session only:

- `payment_method_collection`: `always`

The lifetime payment session omits `payment_method_collection`.

Preserved (not Checkout Studio placeholders, required by StudyHertz):

- `customer`, `client_reference_id`, `metadata` on both
- `payment_intent_data.metadata` on the lifetime / payment session
- `subscription_data.metadata` on the subscription session

`payment_method_types` stays omitted so dynamic payment methods stay on.

## Setup and next steps

Hosted Checkout is already the billing UI: the app posts to `/api/billing/checkout` and redirects to the session `url`. The existing signed webhook still grants access. Do not add a second checkout route or a static success page; `success_url` stays `/?billing=success`.

`automatic_tax` is on in code only. Stripe collects no tax, and returns no error, until Dashboard → Tax → Settings has a head office address (settings status `active`) and there is an active registration in the customer’s jurisdiction. These sessions pass an existing Customer, so Checkout uses that customer’s saved address when one exists. `billing_address_collection: auto` lets Checkout ask for an address when it needs one. Confirm registrations before treating tax as live. Product tax codes belong on the Price’s Product in the Dashboard, not in this file.

Test with [Stripe test cards](https://docs.stripe.com/testing) (success card `4242 4242 4242 4242`, any future expiry, any CVC) against the test key. Sandbox tax settings do not copy to live mode.

- Docs: https://docs.stripe.com
- Support: https://support.stripe.com
