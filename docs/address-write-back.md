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

**A sole trader's autofill record is written on the base plugin's terms for it**
(TWO-26775), selected by `{ buyerRules: true }`: every non-blank value is written
when the record arrives and a blank writes nothing, so a record missing a postcode
cannot wipe the one the buyer typed. The region goes only into a region control
that is empty or still holds this module's own write. A field the record leaves
out is cleared where it still holds this module's own earlier write, so an earlier
company's postcode or second line does not stand beside the sole trader's address;
a field the buyer has changed since stays. What this module wrote is kept per field
node in `twoGatewayAutofillWrites`, not as an attribute, because a Magewire morph
patches a kept node's attributes back to the server markup; a node the morph
replaces loses its entry and its value reads as the buyer's. A registry pick keeps
the rules above, blanks included, and retracts no address field. Neither ever
writes the country, the email or the buyer's names.

**A registry pick also writes the company's registered phone and a fitted
postcode** (TWO-27160). The base module's company relay fits each `postal_code`
to its country's written format before it reaches the browser, so the postcode is
written as it arrives. `addressLookup()` passes the address's `phone_number` to
`applyRegistryTelephone()`, which writes it into the telephone field of the same
form, replacing what the field holds. A pick with no phone, or one whose lookup
fills nothing (no address, a failure, a rate limit), leaves the address as it was
and clears only a registry phone an earlier pick wrote into that field and the
field still holds; a number the buyer typed or edited stays. The registry phone is
recorded per telephone node in `twoGatewayRegistryPhoneWrites`, so each address
form has its own. A sole trader's verified phone (`captureApplyTelephone()`)
drops that record, so no later pick clears it. Only the latest lookup for a form
writes anything: a reply to an earlier pick is ignored, and so is one that
arrives after a sole trader's address or phone was written into that form. A country switch retracts
nothing here, the phone included, because this checkout does not take an
autofilled address back on a country switch either.

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
