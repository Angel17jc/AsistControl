import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The first render of a test file loads its modules cold. With every file running in
// parallel, that alone can exceed Testing Library's default 1 s wait for `findBy*`, so the
// first test of a file failed now and then under load. Waiting longer only costs time
// when something is actually missing.
configure({ asyncUtilTimeout: 4_000 });

afterEach(() => cleanup());
