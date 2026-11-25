export const LH_VERSION: string;
export const LH_URL: string;
export const LH_SHA256: string;
export const LH_BYTES: number;
export function cacheDir(): string;
export function ensureLh(): Promise<string>;
