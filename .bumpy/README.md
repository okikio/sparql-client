# Authored release stories

Use `deno task bumpy add` to create a Markdown bump file, then write a useful
consumer explanation in its body. State the scenario, behavior change, why it
matters, migration, and limits. Complete examples and diagrams should teach the
actual shipped API. Keep one story per behavior and name only directly affected
packages; Bumpy propagates dependency versions.

`deno task release:plan` previews the pinned Bumpy plan.
`deno task release:version` renders the stories and synchronizes npm/Deno versions.
Read [the release workflow](../docs/releasing.md) before publication.

The formatter intentionally preserves authored Markdown. Do not flatten rich
entries into commit subjects, claim measurements without their workload/context,
or describe a subset as complete standards compliance.
