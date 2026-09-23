// `npm test` entry (Node 18+): runs the same suite through node:test.
import { test } from 'node:test';
import { tests } from './engine.test.js';
for (const t of tests) test(t.name, t.fn);
