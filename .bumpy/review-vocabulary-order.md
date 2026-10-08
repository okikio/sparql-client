---
'@okikio/rdf': patch
'@okikio/vocab': patch
---

### Generate the same vocabulary under different host locales

Two ontology resources can compete for the same generated symbol. Locale-aware
IRI ordering previously let a Swedish process and an English process choose
different collision owners. Symbol planning, inherited properties, ontology
projection and shape projection now use ordinal ordering independent of the
host's collation rules.

For resources `urn:z` and `urn:ä` both labeled `Thing`, `urn:z` owns the plain
symbol in every locale. The independent regression launches separate localized
processes, confirms their actual ICU locales differ, and compares the complete
generated source and manifest.

Regenerate checked-in vocabularies to adopt this stable ordering. The generated
source order and collision suffixes can change from earlier locale-dependent
output. RDF canonicalization retains its separate standards-defined Unicode
scalar ordering; human-facing localized sorting remains an application concern.
