---
description: "Registry, order-intent and autofill calls: the base module REST routes, the proxy flag and the deprecated browser fallbacks"
---

# Registry, order-intent and autofill calls

**Registry and order-intent calls go through the base module's own REST routes**
(`rest/V1/two/company-search`, `.../company`, `.../order-intent`), never straight
at the API: the merchant API key authenticates them server-side, and a merchant
whose network traffic passes through a firewall appliance can have a token
attached there without it ever reaching a buyer's browser. Each answers a
`{ok, status, body}` envelope — `ok: false` means the upstream call failed and
must produce exactly what a failed direct call used to. Paging and client
identification are the server's to set, so nothing here sends them.

**What decides that is `CheckoutConfig::getIsProxyAvailable()`, not the
`^2.3.0` floor in `composer.json`** — the reasoning is written once, in that
method's docblock, and everything else points at it. Its answer reaches every
mount as `isProxyAvailable`. `twoGatewayProxyPost()` deliberately has no
runtime fallback for the 404 a stale route cache produces: a fallback that
reopened the direct browser-to-API path would make a missed cache flush
invisible instead of loud.

`false` — and, the flag being read by identity, anything that is not exactly
`true` — takes the registry routes back to the **direct
browser-to-API call they made before the routes existed** — query-string client
identification and merchant name restored, and no firewall token on any of
it. That is not a new exposure: it is precisely what ran on that base already,
and it is the only path on which those fallbacks are reachable.

**Order intent has no browser fallback** (TWO-26092). The base composes its
amounts and lines from the quote and the tile sends the buyer only, so intent
runs only while `CheckoutConfig::getIsServerIntentAvailable()` finds the base's
`OrderPostprocessingInterface`; on an older base no intent is sent at all.

Those fallback branches are **deprecated on arrival**. Delete them, and the
flag threading them, once a base release is confirmed BY INSPECTION OF THAT
RELEASE to carry the routes — never by raising the floor high enough to look
safe.

The one exception is `/autofill/v1/buyer/current`, which is authenticated by
the buyer's own cookie on the API's domain and so cannot be proxied at all; it
carries the merchant's configured custom headers instead
(`CheckoutConfig::getCustomHeaders()`, e.g. `X-WAF-TOKEN`), and only where a
merchant enabled them for the browser. A rejection of that call is reported
rather than swallowed: 404 is its documented "no buyer" answer, so any OTHER
status is logged, which is what keeps an appliance rejecting a tokenless
request distinguishable from a buyer who simply has no account.
