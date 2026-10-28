// Register jest-dom matchers against THIS runner's expect. The subpath form
// (`@testing-library/jest-dom/vitest`) imports `expect` from 'vitest' via
// jest-dom's own resolution, which lands on the workspace-root vitest@1.x
// instance instead of this package's 3.x runner — matchers then extend the
// wrong expect and every `toBeInTheDocument` throws "Invalid Chai property".
import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';
import { configure } from '@testing-library/react';

expect.extend(matchers);

// A test kernel is WebAssembly compiled in the test process: under a parallel run its first paint outlasts the 1 s default.
configure({ asyncUtilTimeout: 5000 });
