---
'@okikio/rdf': patch
---

### Give browser setup its own native fixture owner

The browser gate previously spent its ordinary 30 second test clock navigating
and loading the RDF/SPARQL consumer before it could assert parser, query or
storage behavior. A slow module load could therefore report a behavioral timeout
without reaching the first library operation.

The test-owned page now has a 90 second native Playwright fixture timeout. Document
and selected module admission share at most 60 seconds, reserving framework time for
fixture retirement. The pinned runner shares this fixture slot across setup and
teardown while the ordinary body has its own clock. Native page creation and
close do not expose cancellation options; their observed completion remains
with the framework and outer runner, without a claimed hard close deadline.

The authored Window entry must expose the exact `run`,
`worker` and `storage` function family. Markup comparisons admit `parseMarkup`
before comparing native output to DOMParser. The optional storage lane admits
its storage and selected OPFS module graph before the persistence body starts.
The parent context stays borrowed; the fixture creates and closes only its own
page. The existing 30 second behavioral deadline, assertions, retries and explicit
capability exclusions remain unchanged.

```sh
deno task browser:install
# Select the inspected source for the optional browser OPFS/RDF composition.
OPFS_SOURCE=../opfs deno task browser
```

A failed authored document/module load now records bounded native error,
request-failure or HTTP-status observations during admission. These listeners
stop before scenario operations; an unrelated failed image or external request
is not a readiness authority. The runner retains the acquisition attachment in
its existing `.tmp/reports/browser/artifacts/` directory, along with normal
Playwright diagnostics. A setup failure still retires its page, and a separate
attachment or close failure remains visible.

Reload is still an asserted storage operation inside the ordinary test clock.
Its native acquisition receives only the monotonic time remaining after the earlier writes.
It checks the new document's exact entrypoints before reconstructing the persisted
RDF identity. Window/Worker parser, fetch, cancellation, canonicalization and
storage algorithms are unchanged. No Worker readiness message or production
initialization side effect was added. Native controls exercise delayed module
publication, malformed entrypoints, real script/request failures and finite
missing-publication expiry; their passes require actual browser execution.

Load faults observed during `goto` or reload now latch until the finite native navigation
transaction settles. A response event can arrive before document commit; cancelling at that
event left Chromium page close pending until outer teardown in a retained control trace.
The failed document is rejected before API use, and independent native/load failures remain
visible. A required-document HTTP404 control observes the owned page close and the borrowed
context's continued usability. API wait faults still use native cancellation; no retry or
larger deadline was introduced. Script404 controls require completed authored404 fulfillment and native HTTP or request failure
for that selected script, rather than assuming every engine emits an HTTP response. The returned
main-response status is recorded independently before rejecting any earlier load observation.
