---
description: "Registry, order-intent and autofill calls: the base module REST routes, the server-intent flag and the composer floor"
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

**There is no browser-to-API fallback for registry calls** (TWO-27237). The
4.0.0 base release carries the routes, confirmed by inspecting that release,
and this module's composer floor is above it, so the browser never calls the
registry directly and never without the merchant's key.
`twoGatewayProxyPost()` deliberately has no runtime fallback for the 404 a
stale route cache produces either: one would make a missed cache flush
invisible instead of loud.

**A non-ok answer carries its status.** `twoGatewayProxyPost()` throws an error
with `status` and the `Retry-After` header (the base's own rate limit refuses
with a raw 429 before the route runs), and company search reads an envelope's
`status` the same way, so a 429 from either place parks the calling surface
rather than reading as an ordinary failure (TWO-27211, see company-search.md).

**Order intent has no browser fallback** (TWO-26092). The base composes its
amounts and lines from the quote and the tile sends the buyer only, so intent
runs only while `CheckoutConfig::getIsServerIntentAvailable()` finds the base's
`OrderPostprocessingInterface`; on an older base no intent is sent at all. That
method's docblock carries the floor note: a runtime check, not the base version
floor in `composer.json`, because a version is not proof the code shipped.

The one exception is `/autofill/v1/buyer/current`, which is authenticated by
the buyer's own cookie on the API's domain and so cannot be proxied at all; it
carries the merchant's configured custom headers instead
(`CheckoutConfig::getCustomHeaders()`, e.g. `X-WAF-TOKEN`), and only where a
merchant enabled them for the browser. A rejection of that call is reported
rather than swallowed: 404 is its documented "no buyer" answer, so any OTHER
status is logged, which is what keeps an appliance rejecting a tokenless
request distinguishable from a buyer who simply has no account.
