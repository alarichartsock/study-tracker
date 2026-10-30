# GA4 conversion insights

All events go through `public/consent.js` (Consent Mode v2: cookieless pings until Accept; personal data is stripped:
no strings containing `@`, no usernames). Every event also carries the visit's campaign (`campaign_*` from UTM) and the
browser's **first touch** (`first_source`, `first_medium`, `first_campaign`, `first_click` = `gclid` | `fbclid`).

## Events

| Event | When | Key params | Mark as Key event? |
|---|---|---|---|
| `view_item_list` | Pricing section scrolled into view (once per page load); in-app paywall shown (`item_list_id=paywall`) | `item_list_id`, `items[]` (monthly / yearly / lifetime) | no |
| `select_item` | A plan button is clicked on the landing pricing, the paywall or Settings | `item_list_id`, `items[0].item_id` (`studyhertz_monthly` …) | no |
| `cta_click` | Any of the 9 homepage CTAs | `cta_id` (`header_trial`, `hero_trial`, `tour_trial`, `how_trial`, `mid_trial`, `pricing_monthly`, `pricing_yearly`, `pricing_lifetime`, `final_trial`), `location` | no |
| `generate_lead` | First landing on an affiliate (`/?aff=CODE`) or referral (`/?ref=CODE`) link, once per code per browser | `lead_source` = `affiliate` / `referral`, `value` 0 | **yes** |
| `sign_up` | Account created | `method` = `email` / `google` | **yes** |
| `trial_start` (custom) | Same moment as sign_up (every account starts the 30-day trial) | `method`, `trial_days` | **yes** |
| `login` | Sign-in with password or Google | `method` | no |
| `begin_checkout` | Subscribe / Lifetime button → Stripe Checkout | `value`, `currency`, `items[]` | **yes** |
| `purchase` | Payment confirmed (server-side Measurement Protocol when `GA_API_SECRET` is set, otherwise browser once, de-duplicated by `transaction_id`) | `transaction_id`, `value`, `currency`, `items[]`, first-touch campaign | **yes** |

Signed-in users: `user_id` = `u<internal id>` (opaque, never the username), user properties `plan`
(`trial`, `monthly`, `yearly`, `lifetime`, `comped`, `expired`, `free`) and `language` (`en`, `es`, `zh-CN`, `ko`, `hi`, `vi`, `fr`).

First touch (UTM + gclid + fbclid from the first landing URL) is kept in the browser and stored on the user
(`attribution`) right after sign-up, so server-side purchases carry the campaign that originally brought the customer.

## Setup in GA4 (Admin)
1. **Key events**: mark `sign_up`, `trial_start`, `begin_checkout`, `purchase`, `generate_lead` (purchase is usually already a key event).
2. **Custom definitions** → event-scoped: `cta_id`, `location`, `method`, `lead_source`, `first_source`, `first_medium`, `first_campaign`, `first_click`; user-scoped: `plan`, `language`.
3. **User-ID**: Reporting identity "Blended" to use `user_id`.
4. Set `GA_API_SECRET` on Render (Admin → Data streams → Measurement Protocol API secrets) so purchases are sent server-side even with ad blockers.
5. Google Ads: import `sign_up` / `purchase` as conversions if you want GA4-based bidding signals.

## Suggested funnel exploration
Explore → Funnel exploration, open funnel, breakdown by `first_source` (or Session source / medium), segment by `language`:
1. `page_view` (landing, `page_path` = `/` or `/xx/`)
2. `cta_click` **or** `view_item_list`
3. `sign_up`
4. `begin_checkout`
5. `purchase`

Useful extra views: a free-form table of `cta_click` by `cta_id` (which CTA converts), `select_item` by `item_id`
(which plan people pick vs. buy), and `generate_lead` → `sign_up` → `purchase` filtered on `lead_source = affiliate`.
