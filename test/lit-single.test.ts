import { describe, expect, it } from 'vitest';
import lock from '../package-lock.json';

// Two copies of Lit in one bundle break `instanceof` checks and double the size. package-lock.json must hold exactly
// one installed entry for each Lit package, so liquid-core (peer lit 3.2.1) and this project share one copy.
const LIT_PACKAGES = ['lit', 'lit-html', 'lit-element', '@lit/reactive-element'];

describe('single Lit install', () => {
  const entries = Object.keys((lock as { packages: Record<string, unknown> }).packages);
  for (const name of LIT_PACKAGES) {
    it(`${name} is installed once`, () => {
      expect(entries.filter((p) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`))).toEqual([`node_modules/${name}`]);
    });
  }
});
