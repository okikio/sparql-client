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

The authored Window entry must expose the required callable `run`,
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

Conditional document reloads now use the same HTTP error boundary as native response
events: status 400 or above. Playwright's `Response.ok()` covers only 200–299;
HTTP 304 instead revalidates the cached representation, which still must install the
required callable API. A real loopback server regression observes 200 plus ETag, the
browser's actual reload request and completed response, then verifies a fresh realm
and the same body/API. A conditional request receives 304; an unconditional request
correctly receives a fresh 200. A separate pure control checks the shared classifier's
304 and error-status boundaries independently of the browser's reload policy. It does not route requests or disable the HTTP cache. Browser
telemetry may expose 200 or 304; server observations remain independent. The failed
Firefox RDF persistence reload stays recorded as prior-source evidence. No cache
workaround, larger deadline or production protocol behavior was added.

Fixture capability admission also permits additive methods and metadata. Its consumers
require callable `run`, `worker` and `storage`; no complete-key schema reserves the
object against independent extensions. A separate native extension control proves
those additions remain usable while malformed required fields still reject. The cache
control keeps the original three-field API so the two regressions stay independent.
