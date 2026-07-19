# Decision: `match` blocks

Status: shipped. The normative rules live in the language reference
(docs/pets-language-spec.md); this note keeps the design rationale, grammar
sketch, and lowering strategy.

`match` dispatches on one or more enum- or boolean-valued discriminators,
replacing nested `where ... otherwise:` cascades with a flat table. It is
purely syntactic sugar — `match` lowers to the existing cascade form and adds
no runtime concept. Numeric and string discriminators were deliberately left
out of the first version.

### Grammar sketch

```
MatchStatement {
  kw<"match"> Expression ("," Expression)* ":" lineEnd MatchArm+
}

AgentMatchBlockHeader {
  AgentSet WhereClause? kw<"match"> Expression ("," Expression)* ":" lineEnd MatchArm+
}

MatchArm {
  ArmPattern ":" lineEnd AgentUpdateBlock
  | OtherwiseBlockHeader AgentUpdateBlock
}

ArmPattern {
  ArmPosition ("," ArmPosition)*
}

ArmPosition {
  EnumLiteral ("|" EnumLiteral)*
  | BooleanLiteral ("|" BooleanLiteral)?
  | "_"
}
```

### Lowering

`match` is implemented by the emitter as a cascade of `where (...) otherwise:`
blocks. Each arm condition inlines the discriminator expression, so an arm
pattern `wandering, true` lowers to a single `where (state = wandering and
patch.has-chip = true):` block. Since exactly one arm fires per agent, the
discriminator is only read once at dispatch. There is no runtime cost relative
to the hand-written cascade.

If a discriminator's value needs to be captured before the match (e.g. to
reference the pre-dispatch value after an arm body mutates the source), use a
`let` before the `match`:

```pet
termites:
  let entry-chip = patch.has-chip
  match state, entry-chip:
    ...
```

## Coexistence

The pre-existing `where state-name: ... otherwise: ...` cascade form continues
to work. `match` is additive sugar — old models did not need porting, and a
model may use both forms in the same step block.
