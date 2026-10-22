import type { AxiosResponse } from 'axios';

/**
 * AWS WAF answers a request it wants to challenge with an interstitial instead
 * of the resource: HTTP 202 (or 405 for a CAPTCHA), the response header
 * `x-amzn-waf-action`, and a small HTML page that loads the challenge script
 * from `*.token.awswaf.com`. To a client that only checks for a 2xx status the
 * page looks like a successful, if short, document.
 *
 * Any one signal is enough: the header is the documented contract, the body
 * markers catch an intermediary that strips headers.
 */
export function isAwsWafChallenge(response: Pick<AxiosResponse<unknown>, 'headers' | 'data'>): boolean {
  if (headerValue(response.headers, 'x-amzn-waf-action') !== undefined) return true;
  if (typeof response.data !== 'string') return false;
  // A real document can mention none of these; scanning the head of the body
  // keeps a multi-megabyte text from being searched end to end.
  const head = response.data.slice(0, 16 * 1024);
  return head.includes('awsWafCookieDomainList')
    || head.includes('window.gokuProps')
    || /\.token\.awswaf\.com\//.test(head);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  const value: unknown = typeof getter === 'function'
    ? Reflect.apply(getter, headers, [name])
    : (headers as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
