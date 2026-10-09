# Plain words

`check.py` reads the first column of the table below. A term there (or any `/`-separated variant) may not appear in the page's visible text, diagram labels or `aria-label`s, **unless the page's glossary defines it**. The glossary is the table in `<section id="words">`, and the term has to be in its first column. Matching ignores case and only counts whole words. A plural `s` also counts.

Prefer the replacement. Keep the term and define it only when the reader will meet the word outside this page. For example, the product's UI uses it, or it is the system's own name for a step.

Add a row when a run finds a technical word that slipped through. Never delete a row to make a check pass: rewrite the sentence instead.

| Term | Say instead |
|---|---|
| API / endpoint | the door other programs use to ask it for things |
| hash / sha256 / checksum | fingerprint: a short code worked out from the exact contents |
| cache / cached / caching | keeps the answer so it does not have to work it out again |
| memoize / memoized / memoization | remembers the answer it already paid for |
| deterministic | fixed rules: the same input always gives the same answer |
| non-deterministic | can give a different answer each time |
| idempotent | doing it twice changes nothing |
| schema | layout (of a table or a form) |
| pipeline | the steps, in order |
| deploy / deployed / deployment | put live |
| async / asynchronous | later, in the background |
| LLM / language model | the AI |
| token | (drop it; say "the AI's usage" or give a cost) |
| inference | asking the AI |
| embedding / vector | (drop it; say what it is used for: "finds things that mean the same") |
| payload | what is sent |
| config / configuration | settings |
| query | question, or request |
| instance | copy, or one running copy |
| runtime | while it runs |
| backend / back end | the part you do not see |
| frontend / front end | the screen you use |
| middleware | a checkpoint every request passes through |
| microservice | a small separate program |
| repository / repo | the project's files |
| commit | a saved change |
| parse / parser / parsing | read (with fixed rules) |
| serialize / serialized | write out |
| JSON / YAML / XML | a structured file |
| SQL / DDL | database instructions |
| regex / regular expression | a text pattern |
| webhook / callback | a message sent back automatically when something happens |
| daemon | a program that runs in the background |
| cron | a timer that runs a job on a schedule |
| latency | delay |
| throughput | how much it handles at once |
| SDK / CLI | toolkit / typed commands |
| metadata | details about the file (name, date, size) |
| artifact | a stored file or record |
| upstream / downstream | before / after it (in the steps) |
| namespace | a named area that keeps things apart |
| invariant | a rule that always holds |
| heuristic | a rule of thumb |
| orchestrator / orchestration | the part that decides what runs next |
| materialize / materialized | build (the map, the list) |
| stateless / stateful | remembers nothing between requests / keeps a memory |
| timeout | gives up after a set time |
| fallback | what it does instead when the first way fails |
| edge case | an unusual case |
