---
description: "Text-reading tests, mutation checks, what jsdom cannot verify, and who reviews a test"
---

# Testing pitfalls

### Tests that read a file as TEXT, and mutants that check them

Two rules, both learned the same way — six times on TWO-25503, every one a check
that ran cleanly and proved nothing:

- **Any assertion that reads a stylesheet or a template as text matches against
  a COMMENT-STRIPPED copy.** Prose explaining a declaration contains the same
  tokens as the declaration, so a regex written to find the code matches the
  explanation instead. Worse, comments here quote selectors — braces and all —
  so a `[^}]*\}` pattern terminates at a comment's brace and silently stops
  covering everything below it. `order-intent-spinner`,
  `company-search-focus-scope` and `company-search-spinner` all strip at the
  point the file is read, which is the place to do it: stripping per-assertion
  leaves the next one in the same file exposed.
  For a TEMPLATE the mitigation is different — its comments are the same
  language as its code, and stripping PHP/HTML/JS comment forms is a bigger job
  than `/* … */`. Anchor on syntax prose cannot reproduce instead: a call form
  (`__('Checking availability')`, not the bare sentence, which the tile's own
  comments do contain) or a whole statement. Those assertions are safe by anchor
  tightness, not by stripping, and a loosened anchor is all it takes.
- **A mutant is verified by WHAT IT REMOVED, never by the diff being
  non-empty.** A non-empty diff only proves something changed. It does not
  prove the anchor hit the rule you meant (`String.replace` takes the FIRST
  match, and identical declarations are common), nor that what it replaced was
  a statement rather than a comment beside one. Read the mutated region back,
  or anchor through enough surrounding text to be unique.

And the reason those two rules need writing down at all:

- **Agreement between a test and the thing it tests is worth nothing when one
  person wrote both.** TWO-25503's worst defect was a test double that diverged
  from the real component in exactly the direction that hid the leak the test
  existed to catch — with a comment confidently explaining why the divergence
  was correct. Both halves were mine and they agreed, so nothing about writing
  them more carefully would have surfaced it. When a test and its subject were
  authored together, the thing to hunt is the divergence that would make the
  test agree with a bug, and **the person to hunt it is not the author** — which
  is what adversarial review is for, not a formality before merge.

### Keyboard behaviour is not verifiable in jsdom

jsdom implements no sequential focus navigation: a dispatched `Tab` keydown moves
focus nowhere, so no Jest suite here can observe a focus trap, a wrong tab order or
a reverse-Tab dead end, however many cases it carries and however green it is. This
is the same class of empty check as the two rules above — a suite that runs cleanly
and proves nothing. Assert the observable proxies (the parts are one contiguous run
in document order, a closed panel carries `hidden`, the handler leaves the `Tab`
event undefaulted) and verify the keyboard behaviour itself in a real browser. Never
present a jsdom Tab test as evidence that a trap is absent.

Two more of the same class:

- **jsdom's `getElementById` answers with the first-REGISTERED node, not the
  tree-first one**, so a fixture carrying a duplicate id silently resolves to the
  wrong element while reading as though it found the right one.
- **A mutation proves NEW coverage only when re-run against the base ref.** One the
  existing suite already catches proves the suite is sensitive, not that the case
  added covers anything.
