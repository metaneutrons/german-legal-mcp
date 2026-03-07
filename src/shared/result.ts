/**
 * Type-safe result type for error handling without exceptions.
 * @template T - Success value type
 * @template E - Error type (defaults to Error)
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// eslint-disable-next-line no-redeclare
export const Result = {
  /**
   * Create a successful result.
   * @example
   * const result = Result.ok(42);
   * if (result.ok) console.log(result.value); // 42
   */
  ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },

  /**
   * Create an error result.
   * @example
   * const result = Result.err(new Error('Failed'));
   * if (!result.ok) console.error(result.error);
   */
  err<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },

  /**
   * Type guard to check if result is successful.
   */
  isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
    return result.ok;
  },

  /**
   * Type guard to check if result is an error.
   */
  isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
    return !result.ok;
  },

  /**
   * Extract value or throw error.
   * @throws {E} If result is an error
   */
  unwrap<T, E>(result: Result<T, E>): T {
    if (result.ok) return result.value;
    throw (result as { ok: false; error: E }).error;
  },

  /**
   * Extract value or return default.
   */
  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
  },

  /**
   * Transform success value.
   * @example
   * const result = Result.ok(5);
   * const doubled = Result.map(result, x => x * 2); // Ok(10)
   */
  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? Result.ok(fn(result.value)) : (result as Result<never, E>);
  },

  /**
   * Transform error value.
   */
  mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return result.ok ? (result as Result<T, never>) : Result.err(fn((result as { ok: false; error: E }).error));
  },

  /**
   * Convert Promise to Result.
   * @example
   * const result = await Result.fromPromise(fetch('/api'));
   * if (result.ok) console.log(result.value);
   */
  async fromPromise<T>(promise: Promise<T>): Promise<Result<T, Error>> {
    try {
      return Result.ok(await promise);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  },
};
