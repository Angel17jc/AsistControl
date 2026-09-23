import { describe, expect, it } from 'vitest';
import {
  type DigestChallenge,
  digestAuthorization,
  digestResponse,
  parseAuthChallenge,
  parseDigestAuthorization,
} from './digest-auth';

describe('digest authentication', () => {
  it('matches the RFC 2617 §3.5 example (MD5, qop=auth)', () => {
    const challenge = parseAuthChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", ' +
        'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    ) as DigestChallenge;

    expect(challenge).toMatchObject({ scheme: 'Digest', algorithm: 'MD5', qop: 'auth' });
    expect(
      digestResponse(challenge, {
        method: 'GET',
        uri: '/dir/index.html',
        username: 'Mufasa',
        password: 'Circle Of Life',
        nonceCount: 1,
        cnonce: '0a4f113b',
      }),
    ).toBe('6629fae49393a05397450978507c4ef1');
  });

  it('matches the RFC 7616 §3.9.1 examples (SHA-256 and MD5)', () => {
    const request = {
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle of Life',
      nonceCount: 1,
      cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
    };
    const base = {
      scheme: 'Digest',
      realm: 'http-auth@example.org',
      nonce: '7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v',
      qop: 'auth',
      opaque: 'FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS',
      stale: false,
    } as const;

    expect(digestResponse({ ...base, algorithm: 'SHA-256' }, request)).toBe(
      '753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1',
    );
    expect(digestResponse({ ...base, algorithm: 'MD5' }, request)).toBe(
      '8ca523f5e9506fed4657c9700eebdbec',
    );
  });

  it('prefers SHA-256 when the device offers several challenges in one header', () => {
    const challenge = parseAuthChallenge(
      'Digest realm="DS-K1T", nonce="n1", qop="auth", algorithm=MD5, ' +
        'Digest realm="DS-K1T", nonce="n2", qop="auth", algorithm=SHA-256, Basic realm="DS-K1T"',
    );
    expect(challenge).toMatchObject({ algorithm: 'SHA-256', nonce: 'n2' });
  });

  it('falls back to Basic only when nothing better is offered', () => {
    expect(parseAuthChallenge('Basic realm="DS-K1T"')).toEqual({
      scheme: 'Basic',
      realm: 'DS-K1T',
    });
    expect(parseAuthChallenge(null)).toBeNull();
    expect(parseAuthChallenge('Negotiate abc')).toBeNull();
  });

  it('detects an expired nonce', () => {
    expect(parseAuthChallenge('Digest realm="r", nonce="n", stale=TRUE')).toMatchObject({
      stale: true,
    });
  });

  it('builds a header the server can parse back, escaping quotes', () => {
    const challenge = parseAuthChallenge(
      'Digest realm="r", nonce="n", qop="auth", opaque="o"',
    ) as DigestChallenge;
    const header = digestAuthorization(challenge, {
      method: 'POST',
      uri: '/ISAPI/AccessControl/AcsEvent?format=json',
      username: 'ad"min',
      password: 'secret',
      nonceCount: 26,
      cnonce: 'c',
    });

    expect(parseDigestAuthorization(header)).toMatchObject({
      username: 'ad"min',
      uri: '/ISAPI/AccessControl/AcsEvent?format=json',
      nc: '0000001a',
      qop: 'auth',
      opaque: 'o',
      algorithm: 'MD5',
    });
    expect(header).not.toContain('secret');
  });
});
