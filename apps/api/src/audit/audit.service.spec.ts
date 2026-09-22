import { diff, redact } from './audit.service';

describe('audit metadata helpers', () => {
  it('redacts secrets at any depth', () => {
    expect(
      redact({ email: 'a@b.c', password: 'x', nested: [{ refreshToken: 't', ok: 1 }] }),
    ).toEqual({
      email: 'a@b.c',
      password: '[REDACTED]',
      nested: [{ refreshToken: '[REDACTED]', ok: 1 }],
    });
  });

  it('drops prototype-polluting keys instead of copying them', () => {
    const malicious = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": 1, "name": "x"}',
    );
    const cleaned = redact(malicious) as Record<string, unknown>;
    expect(Object.keys(cleaned)).toEqual(['name']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('diffs only changed keys and ignores unsafe ones', () => {
    const after = JSON.parse('{"name": "new", "code": "A", "__proto__": {"x": 1}}');
    expect(diff({ name: 'old', code: 'A' }, after)).toEqual({ name: { from: 'old', to: 'new' } });
  });
});
