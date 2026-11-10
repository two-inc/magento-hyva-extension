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
a field the buyer has changed since stays. A registry pick keeps the rules above,
blanks included, and retracts no address field. Neither ever writes the country,
the email or the buyer's names.

**Every field this module writes, the phone included, is marked with
`data-two-autofilled-value`** holding what was written (TWO-27212), so a country
switch or a new pick clears only what still holds this module's value. The same
value is also kept per field node in `twoGatewayAutofillWrites`, and
`twoGatewayAutofillMarkOf()` reads the mark first and that record second. The
record is there because a Magewire morph keeps a field's node but patches its
attributes back to the server markup, which strips the mark while the value
stays. A node the morph replaces loses both, and its value reads as the buyer's.

**A registry pick also writes the company's registered phone and a fitted
postcode** (TWO-27160). The base module's company relay fits each `postal_code`
to its country's written format before it reaches the browser, so the postcode is
written as it arrives. `addressLookup()` passes the address's `phone_number` to
`applyRegistryTelephone()`, which writes it into the telephone field of the same
form, replacing what the field holds. A pick with no phone, or one whose lookup
fills nothing (no address, a failure, a rate limit), leaves the address as it was,
says "We could not fetch this company's address. Please enter it below." under
the company field (TWO-27211, see company-search.md), and clears only a
registry phone an earlier pick wrote into that field and the field still holds;
a number the buyer typed or edited stays. The registry phone is recorded per
telephone node in `twoGatewayRegistryPhoneWrites`, so each address form has its
own. A pick with no lookup id clears that phone the same way (TWO-27212). With
address search off a pick looks nothing up and clears nothing, as on Luma: no
registry phone can have been written that way. A sole trader's verified phone
(`captureApplyTelephone()`) is marked but drops that record, so no later pick and
no country switch clears it. Only the latest lookup for an address role writes
anything: a reply to an earlier pick is ignored, and so is one that arrives
after a sole trader's address or phone was written into that form. The lookups
are tracked per role (`twoGatewayAddressLookups`), not per form node, because the
notice belongs to the role and a morph may rebuild the form between two picks.

**A country switch takes the autofill back out of the form whose country
changed, and no other** (TWO-27212). The capture controller calls
`revertAutofilledAddress()`, which retires a lookup still on the wire, empties
each address line, city, postcode and region control that still holds this
module's write, drops the mark on every one of those fields, and clears the
registry phone as a pick with no phone would. What the buyer typed or edited
stays, and so does a sole trader's verified phone. The telephone keeps its mark
in exactly those two cases: a registry phone the buyer edited, and a sole
trader's phone. The address-book modal's country is heard by the shipping
controller, but a switch there reverts the modal's own form, never the address
step's. The other panel is never touched. The controller makes the same call,
on the surface's own form, when the buyer leaves sole-trader mode after an
adoption, so the sole trader's address does not go out under the next company,
as on Luma.

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
