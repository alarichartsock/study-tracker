# Lifetime plan

- One-time **$100 USD** price on the StudyHertz product (live: `price_1UW48QFkBRzI3yuBJLDweBbm`, env `STRIPE_LIVE_PRICE_LIFETIME`, test fallback `STRIPE_PRICE_LIFETIME`). Not offered anywhere unless the price is configured.
- `POST /api/billing/checkout {plan:'lifetime'}` creates a `mode: payment` Checkout Session (metadata `plan=lifetime`). Refused if the user already has lifetime.
- Webhook `checkout.session.completed` with `mode=payment`, `payment_status=paid`, `metadata.plan=lifetime` sets `user.billing.lifetime = {at, txn, amount, currency}`; `billing.status()` then returns `active, lifetime` forever. If the user had an active monthly/yearly subscription it is set to `cancel_at_period_end` (never refunded). If that Stripe call fails the webhook returns 500 so Stripe retries; the grant itself is idempotent.
- GA4 `purchase`: item `studyhertz_lifetime`, value 100. Admin stats count lifetime users as paid (`subscriptions.lifetime`).
- Not refundable (stated in the account-deletion text). The Terms page doesn't mention the lifetime plan yet.
