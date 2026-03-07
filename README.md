# TrueCatholic AI

**AI that teaches the Catholic faith without apology.**

TrueCatholic AI is a Catholic evangelization assistant built on a comprehensive 2,700-line doctrinal charter — not a prompt bolted onto a generic model. It is designed to guide people toward full communion with the Catholic Church while maintaining absolute doctrinal fidelity.

## What This Is

- A **doctrinal constitution** (the Charter) that governs how AI handles Catholic teaching
- A **system prompt** that transforms any major LLM into a faithful Catholic assistant
- A **benchmark** (the [Catholic Faithfulness Index](https://catholicfaithindex.com)) that measures AI faithfulness to Catholic doctrine

## The Problem

Every major AI model is trained to be neutral. When someone asks "Is the Eucharist really the Body of Christ?" — they get a comparative religion lecture. When someone asks about marriage — they get opinion polls. When someone asks the AI to hold the line — it folds.

Our [benchmark testing](https://catholicfaithindex.com) proves this: five leading models scored between F and C+ on Catholic faithfulness. They *know* the teaching (raw scores of 3.60-3.69 out of 5), but their RLHF training prevents them from presenting it as true.

## The Solution

The TrueCatholic Charter eliminates this problem entirely. In our testing:

| Model | Without Charter | With Charter | Violations |
|-------|----------------|--------------|------------|
| Claude Haiku 4.5 | 1.62 (F) | 4.99 (A) | 39 → 0 |
| Claude Sonnet 4.5 | 2.56 (C) | 5.00 (A) | 28 → 0 |

The cheapest AI model went from dead last to near-perfect with nothing but a system prompt.

## The Charter

The full charter is available at [truecatholicai.org/charter.html](https://truecatholicai.org/charter.html).

It covers nine articles:
1. **Mission** — Primary purpose, journey model, limitations
2. **Doctrinal Authority** — Source of truth, hierarchy of teaching
3. **Immovable Doctrinal Guardrails** — 34 sections covering the full scope of Catholic teaching
4. **Pastoral Approach and Tone** — Truth with charity
5. **What the AI Will Not Do** — Hard boundaries
6. **Open Source Governance** — License, forking, code vs. doctrine
7. **Stewardship and Succession** — Transfer to the Church
8. **Amendment** — What can and cannot change
9. **Declaration** — Founding commitment

## Key Principles

- **Unapologetically Catholic.** The AI presents Catholic teaching as true, not as one opinion among many.
- **Publicly auditable.** The charter, benchmark, and methodology are all published openly.
- **Anti-subversion.** Explicit defenses against prompt injection, hypothetical framing, and doctrinal erosion.
- **Subordinate to the Magisterium.** The charter explicitly subordinates itself to the teaching authority of the Catholic Church.
- **Transparent about conflicts.** We made the benchmark and the AI, and we say so.

## Project Structure

```
index.html          # Main landing page
charter.html        # Full charter viewer with navigation
```

## Links

- **Website:** [truecatholicai.org](https://truecatholicai.org)
- **Benchmark:** [catholicfaithindex.com](https://catholicfaithindex.com)
- **Contact:** truecatholicai@proton.me

---

*Ad Maiorem Dei Gloriam — For the Greater Glory of God*
