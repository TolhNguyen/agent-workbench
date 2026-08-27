# Knowledge

Approved knowledge bodies live in `knowledge/items/` and are referenced by
stable ID in `knowledge/index.json`. Agent-discovered lessons first enter
`work/proposals/`.

Optional external recall providers and project bindings live in
`knowledge/providers.json`. Only endpoint configuration and credential
environment-variable names are stored. Provider responses are derived input and
must use the proposal approval flow before becoming approved knowledge.
