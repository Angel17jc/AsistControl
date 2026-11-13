import { describe, expect, it } from 'vitest';
import { splitDeviceName } from './names';

describe('splitDeviceName', () => {
  it.each([
    ['MELANIE ZAMBRANO', 'Melanie', 'Zambrano'],
    ['ANA RUIZ PÉREZ', 'Ana', 'Ruiz Pérez'],
    ['MELANIE ANDREA ZAMBRANO PÉREZ', 'Melanie Andrea', 'Zambrano Pérez'],
    ['JOSÉ DE LA CRUZ', 'José', 'de la Cruz'],
    ['  pedro   alcívar  ', 'Pedro', 'Alcívar'],
    ['VALERIA', 'Valeria', ''],
    ['', '', ''],
  ])('reads %j as %j / %j', (raw, firstName, lastName) => {
    expect(splitDeviceName(raw)).toEqual({ firstName, lastName });
  });

  it('keeps a name already written in mixed case as it is', () => {
    expect(splitDeviceName('Luis McGregor')).toEqual({ firstName: 'Luis', lastName: 'McGregor' });
  });
});
