# Tiny Trend Bot — Beat Buy-and-Hold on Solana

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/jawaddevisser-coder/makefun-tiny-bot-gorun-gadget/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/jawaddevisser-coder/makefun-tiny-bot-gorun-gadget/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Entry for the [make.fun bounty](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1): a tiny paper-trading bot for hourly Solana prices that beats buy-and-hold.

## Strategy

A dual-EMA trend rider with a trailing stop, written from scratch in TypeScript:

- **Trend:** fast EMA (6 hourly bars) vs slow EMA (18 bars) of each symbol's close. Buy when fast crosses above slow.
- **Exit:** sell the whole position when fast crosses back below slow, or when the close falls 8% below the peak close since entry (trailing stop).
- **Sizing:** each buy takes an equal slice of available cash, capped by the 25% per-symbol weight limit. No shorts, no leverage.
- **Determinism:** every decision is a pure function of the bars received; no clock, no randomness, no network — the two replay runs produce identical orders.

## Files

- `main.ts` — the bot (entrypoint, speaks `agent-fun/bars-replay/v1` via the vendored SDK)
- `vendor/makefun-bars.ts` — the kit's own bars SDK, vendored byte-identical

## Grade locally

From the kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```
