# Pinned upstream parser cases

Run `deno task test:upstream`, or run the parser suite alone:

```sh
deno test --no-check --allow-read --allow-write --allow-env=READABLE_STREAM conformance/upstream_test.ts
```

These are implementation regressions, separate from the official W3C profiles in
`support.json`. The selected fixtures are maintained test inputs outside published
package roots. Downloads and adaptation experiments live in ignored `.tmp/`.

`corpus.json` is the adoption manifest. Every source has a repository, immutable
Git revision, chosen license and retained notice. Every copied file records its
original path, exact byte length and SHA-256. Every adopted case records its
source, upstream identity or source line, input, format, base IRI and oracle.
The suite verifies all copied bytes before entering any negative syntax oracle.
A missing or changed file is an acquisition failure, never a successful rejection.

| Source | Adopted group | Cases | License |
| --- | --- | ---: | --- |
| N3.js | Static `shouldParse` / `shouldNotParse` vectors in the default and four core-format groups | 304 | MIT |
| Serd | Entire extra good, bad and EOF manifest lists, apart from two named-blank extensions and one identifier-collision policy | 177 | ISC |
| Oxigraph/oxttl | Strict parser and parser-error manifests, excluding XML cases | 28 | MIT or Apache-2.0 |
| Raptor | Complete N-Triples/N-Quads Makefile groups, excluding four legacy compatibility cases | 19 | Apache-2.0, chosen from upstream alternatives |
| RDF4J | N-Triples/N-Quads resource acceptance and the long-literal expected graph pair | 4 | BSD-3-Clause / Eclipse Distribution License 1.0 |
| Apache Jena | Complete RIOT Turtle2 group: three 10,000-triple fixtures and recorded outputs | 3 | Local W3C notice for vectors, Apache-2.0 for manifest |

The exact commits and source links are in the manifest. N3.js vectors were copied
as declarative data using its JavaScript syntax tree: constant input strings and
expected term identifiers were read without running its framework, callbacks,
prototype modifications or setup. Its `mapToQuad` expected-identifier convention
was adapted into complete structural term records. Each vector retains the source
file SHA-256 and original line, which identifies the upstream test declaration.
Nonliteral declarations, custom factory/callback cases and N3 reasoning dialects
are individually listed under `excluded`; they are not silently reported as passes.

N3's unspecified default parser also accepts TriG graph blocks. Those graph vectors
are routed through the public TriG parser, with the adaptation recorded. Its four
compact fourth-term extensions are excluded because they are neither standard
TriG nor N-Quads. Serd's `==` named-blank extension is excluded. Its legacy rejection
of legal distinct blank labels `b1` and `B1` is not a native syntax requirement.
Raptor's vocabulary validation of `rdf:_abc`, underscore-language recovery,
UTF-16 surrogate escape output and IRI control-character compatibility are outside
our selected strict RDF profile. Original expectations remain unmodified.

For evaluation vectors, pinned N3 2.1.1 reads recorded expected N-Triples/N-Quads
files independently of the candidate parser. Inline N3 expectations already contain
complete term records. Positive-syntax vectors retain their upstream acceptance-only
contract; they do not invent expected graphs. Every adopted case runs once as a whole
UTF-8 byte array and once as deterministic uneven byte chunks, including splits inside
Unicode scalars and escape sequences. The 299 valid-UTF-8 negative cases require `SyntaxError`, rather than upstream
diagnostic prose or a generic internal error. Ten Serd cases deliberately contain
invalid or truncated UTF-8 bytes. They carry `error: "utf8"` in the manifest and
require the fatal decoder's `TypeError`. An independent fatal `TextDecoder` checks
each negative input's classification before the parser assertion; swapped metadata
is an acquisition/oracle failure. Plain internal `Error` and `TypeError` cannot
count as successful valid-UTF-8 syntax rejection. Oxigraph error-text files are therefore not the oracle.

Evaluation compares full term multisets, including predicate, graph, language,
direction, datatype, lexical values and duplicate event counts. A consistent blank
renaming is allowed. No-blank fixtures use sorted framed semantic records; fixtures
with blanks use counted statement reification and the existing isomorphism oracle.
This protects multiplicity without comparing incidental object layout or generated
blank labels. Wrong predicate, graph, datatype, language, direction, missing statement,
duplicate counts and inconsistent blank relationships have independent controls.
The 15-second test deadline protects against hangs; it is not a throughput budget.

To update a source, fetch the declared canonical repository and review the exact
commit diff, relevant manifests/test declarations and license notices. Copy the
chosen fixture bytes unchanged, update their provenance hashes and review every
case mapping and exclusion. Regenerate declarative expectations from the upstream
recorded expectations, never from candidate output. Rerun the upstream suite and
relevant official syntax profiles. A passing case count does not establish blanket
conformance for any implementation or every possible parser input.
