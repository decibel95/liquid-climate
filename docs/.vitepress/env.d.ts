declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// The docs config runs in Node, but the repository carries no @types/node: declare what it uses.
// readFileSync is for vite.config.ts (the font assets): this declaration is the program's only node:fs.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string | URL): Uint8Array;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
