# Function catalog compatibility fixtures

These fixtures were captured from the existing `FunctionCatalog` on 2026-09-22, before separating its responsibilities. They preserve all 432 entries in API order, including descriptions, snippets, support flags and origins. `arity.json` records accepted argument-count ranges measured from -1 through 257, covering the boundaries of the current maximum arity of 255.

Intentional function additions or metadata changes should update the corresponding entries explicitly. Do not regenerate the fixtures merely to make a refactor pass; catalog text and snippets are also consumed by the graph editor and Monaco.
