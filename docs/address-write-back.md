---
description: "How setAddressData writes an external payload (company search result or autofill) into an address form"
---

# Writing an address from an external payload

### Writing an address from an external payload

`setAddressData()` routes one way for every payload it can receive — a
registered-company search result, an autofill — because special-casing the
source is how the two drift apart:

| payload                        | line 1                      | line 2             |
| ------------------------------ | --------------------------- | ------------------ |
| `building`/`apartment` present | the premises (both, joined) | `street`           |
| neither present                | `street`                    | **left untouched** |

No dedup between the lines even when the text is identical: some real addresses
legitimately repeat, and silently swallowing one is invisible to the buyer.
Line 2 is left alone rather than blanked when there is nothing for it, so an
autofill carrying no building cannot delete an apartment number the buyer typed.

`region` goes to a region select when the payload's `region_id` is one of
its options (the module's company relay adds the store's own id when it can
resolve the registry's region, TWO-26263) or else an option's TEXT matches (lossy
and known to be), else to a free-text `region` field, else it is appended to `city`
after a comma — the comma being a separator, so an address with no city gets
none. An unmatched value is never written onto a region select: that stores
an id the store does not have. A region the select took is never appended to the
city.

**Hyvä Checkout names its region control `region`, select or input alike**
(TWO-26265): `<select name="region" wire:model.defer="address.region">` of region
ids for a country with a list, a text input of the same name otherwise. Other
forms name the select `region_id`, so both names are looked for. A selection is
announced with `input` and `change`: `wire:model` on a select listens for
`change`, and without it the next round trip writes the old value back. It is
announced last, once city, postcode and street are written and announced, so
nothing listening for its `change` reads a half-written address. The
Jest fixtures in `address-payload-routing.test.js` are copied from the served
checkout for exactly this reason: they used to render a `region_id` select,
which Hyvä Checkout never serves, and passed while the province was never
selected on the real page.
