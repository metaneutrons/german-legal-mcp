import { describe, expect, it } from 'vitest';
import { AxiosHeaders } from 'axios';
import { isAwsWafChallenge } from './aws-waf.js';

describe('isAwsWafChallenge', () => {
  it('recognizes the documented response header, also on AxiosHeaders', () => {
    expect(isAwsWafChallenge({ headers: { 'x-amzn-waf-action': 'challenge' }, data: '' })).toBe(true);
    const headers = new AxiosHeaders();
    headers.set('X-Amzn-Waf-Action', 'captcha');
    expect(isAwsWafChallenge({ headers, data: '' })).toBe(true);
  });

  it('recognizes the interstitial page when the header is missing', () => {
    for (const data of [
      '<script>window.awsWafCookieDomainList = [];</script>',
      '<script>window.gokuProps = {"key":"x"};</script>',
      '<script src="https://abc.def.eu-west-1.token.awswaf.com/abc/challenge.js"></script>',
    ]) {
      expect(isAwsWafChallenge({ headers: {}, data })).toBe(true);
    }
  });

  it('leaves ordinary documents alone', () => {
    expect(isAwsWafChallenge({ headers: {}, data: '<p>Artikel 1 – Gegenstand</p>' })).toBe(false);
    expect(isAwsWafChallenge({ headers: { 'content-type': 'text/html' }, data: { json: true } })).toBe(false);
    expect(isAwsWafChallenge({ headers: undefined as unknown as Record<string, string>, data: '' })).toBe(false);
  });
});
