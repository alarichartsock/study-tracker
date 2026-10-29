# Referral program

"Give a friend a free month, get one yourself."

## How it works

- Every account has a unique 8-character referral code (created the first time the Settings page is opened) and a link `https://studyhertz.com/?ref=CODE`. Settings shows the link with a **Copy link** button.
- A visitor who opens a `?ref=` link has the code saved in the browser (`localStorage.shRef`). The URL is left as-is, so UTM/gclid attribution is unchanged. If the code is valid, the landing page offers a 60-day trial.
- **Friend:** an account created with a valid code (username sign-up or a new Google/other social sign-up) gets `billing.trialBonusDays = 30`, so the trial is 30 + 30 = 60 days. Nothing is charged and no card is needed.
- **Referrer:** when the referred friend logs their **first study session** (manual entry or timer), the referrer earns one credit of 30 days:
  - On a trial: the trial is extended by 30 days. If the trial had already ended, it restarts as 30 days from now (the account leaves read-only mode).
  - Paying subscriber: the credit is recorded as `stripe_pending` and **not applied automatically**. Nothing touches Stripe.
  - Admin, comped or early (legacy) accounts: the credit is recorded but there is nothing to extend.
- Imports do not count as a first session.

## Abuse protection

- A code can't be used by the account that owns it, by an account sharing any email with the referrer (including unverified provider emails), or by an account sharing an OAuth identity.
- A social sign-in that matches an existing account signs in to that account instead of creating a new one, so it never earns a referral.
- Referral codes are only accepted when an account is **created**. One referral per new account and one credit per referred account.
- Each referrer can earn at most `REFERRAL_CAP` credits (default 12). Friends referred after the cap still get their 60-day trial.
- The referrer is only rewarded once the friend actually logs a study session.
- Known gap: username-only accounts have no email, so one person could create a second username account. That is limited by the cap, the first-session requirement, and the existing per-IP sign-up rate limit (10 per hour).

## Applying subscriber credits in Stripe (test mode first)

These options are recommended but not implemented:

1. Extend the subscription's next billing date. Call `POST /v1/subscriptions/{id}` with `trial_end=<current_period_end + 30 days>` and `proration_behavior=none`. This works for monthly and yearly plans and skips one month's charge.
2. Use a coupon. Create a test-mode coupon (`duration=once`, `amount_off=499`, `currency=usd`) and attach it to the subscription's next invoice with `discounts[0][coupon]`. This doesn't fit yearly plans well.

Option 1 is recommended. A small admin action or webhook could apply each `stripe_pending` credit and mark it `applied` with the Stripe request id. It would run in test mode first, and `STRIPE_ALLOW_LIVE` would be left alone.

## Analytics (GA4)

- `referral_link_copied` fires when the Copy link button is pressed.
- `referral_signup` fires after `sign_up`/`begin_trial` when the server accepted a code.
- `referral_reward` fires in the referrer's app the next time they open it after earning a credit. Its `value` is the days earned.

The existing `sign_up`, `begin_trial` and Google Ads sign-up conversion still fire as before.

## Data

The new fields are additive and need no migration: `user.refCode`, `user.referral {by, code, at, status}`, `user.referralCredits[]` and `user.billing.trialBonusDays`. Back up `data.json` / the Render disk before deploying anyway.
