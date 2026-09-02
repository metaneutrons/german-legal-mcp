export interface InputBudgetLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
  readonly maxTotalCharacters: number;
}

export const DEFAULT_INPUT_BUDGET: InputBudgetLimits = {
  maxDepth: 16,
  maxNodes: 4_096,
  maxArrayLength: 256,
  maxObjectKeys: 256,
  maxStringLength: 65_536,
  maxTotalCharacters: 262_144,
};

export class InputBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputBudgetError';
  }
}

/**
 * Bound JSON-shaped MCP arguments before a schema or provider walks them.
 * This protects every transport and every provider from deep, cyclic or very
 * large values without duplicating generic resource limits in 42 tool schemas.
 */
export function assertInputBudget(
  value: unknown,
  limits: InputBudgetLimits = DEFAULT_INPUT_BUDGET,
): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let characters = 0;

  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) throw new InputBudgetError('too many values');
    if (depth > limits.maxDepth) throw new InputBudgetError('nesting is too deep');

    if (typeof candidate === 'string') {
      if (candidate.length > limits.maxStringLength) {
        throw new InputBudgetError('a string value is too long');
      }
      characters += candidate.length;
    } else if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new InputBudgetError('numbers must be finite');
    } else if (candidate === null || typeof candidate === 'boolean') {
      return;
    } else if (typeof candidate !== 'object') {
      throw new InputBudgetError('arguments must contain JSON values only');
    } else {
      if (seen.has(candidate)) throw new InputBudgetError('cyclic values are not supported');
      seen.add(candidate);

      if (Array.isArray(candidate)) {
        if (candidate.length > limits.maxArrayLength) {
          throw new InputBudgetError('an array contains too many values');
        }
        for (const entry of candidate) visit(entry, depth + 1);
      } else {
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new InputBudgetError('arguments must be plain JSON objects');
        }
        const keys = Reflect.ownKeys(candidate);
        if (keys.some((key) => typeof key === 'symbol')) {
          throw new InputBudgetError('arguments must not contain symbol properties');
        }
        if (keys.length > limits.maxObjectKeys) {
          throw new InputBudgetError('an object contains too many properties');
        }
        for (const key of keys as string[]) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
          if (!descriptor || !('value' in descriptor)) {
            throw new InputBudgetError('arguments must not contain property accessors');
          }
          characters += key.length;
          visit(descriptor.value, depth + 1);
        }
      }
    }
    if (characters > limits.maxTotalCharacters) {
      throw new InputBudgetError('the total argument payload is too large');
    }
  };

  visit(value, 0);
}
