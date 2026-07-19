# Decision: implicit centers for `in-radius`, explicit `around` for aggregates

Status: shipped.

`patches in-radius r` and `patches in-square r` inside an agent update block
default their center to the current agent's position. Before this change the
missing `around (...)` clause was a compile error, so the default collides
with nothing.

The aggregate family (`count`, `any`, `sum`, `mean`, `min`, `max` over an
agentset with an optional `around (x, y)` clause) keeps `around` explicit.
An implicit variant was tried and reverted: `count cells where alive` already
meant the breed-wide count in every context, and making it mean "the eight
patches around me" inside agent blocks silently changed the meaning of
existing global reads (rumour-mill's perception of the global top prestige,
Life's neighbor counts). A form that means different things in different
contexts is exactly the silent-wrong-answer class the language is trying to
eliminate, so the collision was resolved in favour of the established
meaning.

Rule of thumb: region selectors (`in-radius`, `in-square`) are agent-relative
by default; aggregate reporters are global unless you say `around (...)`.
