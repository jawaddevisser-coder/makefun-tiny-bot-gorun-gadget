// Tiny trend bot: beat buy-and-hold on hourly Solana bars.
//
// Design (written from scratch): ride each symbol's trend with a fast/slow
// EMA crossover and let winners run, but cap every loss. No shorts, no
// leverage, no clock, no randomness: every decision is a pure function of
// the bars the harness has sent, so the two replay runs agree exactly.
//
// Per symbol, over its own closes:
//   - fast EMA(8) and slow EMA(21), each seeded as the mean of its first
//     span of closes, then stepping 2/(span+1) toward each new close.
//   - entry: fast crosses above slow, on a symbol with no position.
//     A bar with zero volume signals nothing.
//   - exit, whole position: fast crosses back below slow (the sell signal
//     holds while slow stays above fast, so a refused sell is retried),
//     or the position is worth >= 1.5x its cost (take the win), or
//     <= 0.9x its cost (cut the loss).
//   - stake: equity split over 7 slots, capped by the 25% weight limit
//     and by the cash left in this reply. Slippage is capped tight at
//     1% so a fill into a gap is refused rather than taken.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_SPAN = 8;
const SLOW_SPAN = 21;
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const ROI_NUM = 3n; // exit at 3/2 of cost
const ROI_DEN = 2n;
const STOP_NUM = 9n; // exit at 9/10 of cost
const STOP_DEN = 10n;

interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Trend {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the previous bar, once both EMAs exist. */
  prevGap: number | null;
  /** fast - slow after this bar. */
  gap: number | null;
  /** Sell signal held while slow stays above fast. */
  down: boolean;
  /** Recent closes, oldest first, for the 24-bar momentum filter. */
  closes: number[];
}

const MOMENTUM_BARS = 24;

const trends = new Map<string, Trend>();

function emaStep(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

function trendFor(symbol: string): Trend {
  let t = trends.get(symbol);
  if (t === undefined) {
    t = {
      fast: { span: FAST_SPAN, warm: [], value: null },
      slow: { span: SLOW_SPAN, warm: [], value: null },
      prevGap: null,
      gap: null,
      down: false,
      closes: [],
    };
    trends.set(symbol, t);
  }
  return t;
}

/** Exit if the sell signal holds, the win is big, or the loss is big. */
function shouldExit(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, down: boolean): boolean {
  if (down) return true;
  const value = state.value(symbol, held.qty);
  if (value * ROI_DEN >= held.cost * ROI_NUM) return true;
  if (value * STOP_DEN <= held.cost * STOP_NUM) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    const crossUp = new Set<string>();
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      const t = trendFor(bar.symbol);
      const closeNum = Number(bar.c);
      emaStep(t.fast, closeNum);
      emaStep(t.slow, closeNum);
      t.closes.push(closeNum);
      if (t.closes.length > MOMENTUM_BARS + 1) t.closes.shift();
      t.prevGap = t.gap;
      t.gap = t.fast.value !== null && t.slow.value !== null ? t.fast.value - t.slow.value : null;
      if (t.gap === null || t.gap >= 0) t.down = false;
      fresh.add(bar.symbol);
      if (t.prevGap === null || t.gap === null || bar.v === '0') continue;
      if (t.gap > 0 && t.prevGap <= 0) crossUp.add(bar.symbol);
      if (t.gap < 0 && t.prevGap >= 0) t.down = true;
    }
    // While warming up every order would be rejected: keep building the
    // indicators, send nothing.
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (shouldExit(state, symbol, held, trends.get(symbol)!.down)) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (crossUp.has(symbol)) {
        // Momentum filter: only chase a cross-up when the symbol is
        // actually up over the last 24 bars — skip falling knives that
        // briefly cross while still trending down.
        const t = trends.get(symbol)!;
        const old = t.closes.length > MOMENTUM_BARS ? t.closes[t.closes.length - 1 - MOMENTUM_BARS] : undefined;
        if (old !== undefined && Number(state.close(symbol)) > old) entries.push(symbol);
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room -= 1;
    }
    return orders;
  },
});
