import { describe, expect, it } from 'vitest';
import { assertInputBudget, InputBudgetError } from './input-budget.js';

describe('MCP input budget', () => {
  it('accepts ordinary JSON tool arguments', () => {
    expect(() => assertInputBudget({ query: 'BGB § 823', page: 1, filters: ['BGH'] }))
      .not.toThrow();
  });

  it('rejects cycles, non-JSON objects and non-finite numbers', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'secret', { enumerable: true, get: () => 'value' });
    for (const value of [
      cyclic,
      accessor,
      { date: new Date() },
      { limit: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => assertInputBudget(value)).toThrow(InputBudgetError);
    }
  });

  it('rejects excessive depth, width and character volume', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < 18; index++) deep = { child: deep };
    for (const value of [
      deep,
      { values: Array.from({ length: 257 }, () => 1) },
      { query: 'x'.repeat(65_537) },
    ]) {
      expect(() => assertInputBudget(value)).toThrow(InputBudgetError);
    }
  });
});
