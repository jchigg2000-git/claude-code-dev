# Lanternfish

Lanternfish turns a pile of shipping manifests into one ledger you can ask questions of.

## What it measured

- It read 412 manifests from 9 ports in one pass.
- 0 model calls were needed for the structured files.
- About $0.03 per new manifest once the ledger exists.
- A full rebuild takes 38 seconds on a laptop.

## Limits

- It does not read handwritten notes.
- Port codes outside the 9 known ports are skipped, on purpose.
