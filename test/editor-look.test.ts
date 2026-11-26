// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/editor-look-0.12.0.json';
import { EDITORS, LANGUAGES, VARIANTS, editorHandlers, editorLook, type HandlerRecord, type LookSnapshot } from './editor-look-snapshot';

// Patch B moves the editors' Look section to liquid-core's lookFields. This snapshot was captured once from the
// unmodified 0.12.0 code (see the fixture's `source`) and is never regenerated: the Look section and the History
// button switch of every editor, in English and Dutch, must keep the same normalised DOM, and each of those controls
// must send the same config.
const recorded = fixture.editors as unknown as Record<string, Record<string, Record<string, LookSnapshot>>>;
const recordedHandlers = fixture.handlers as unknown as Record<string, HandlerRecord[]>;

describe('editor Look section equals Liquid Climate 0.12.0', async () => {
  const now = await editorLook();
  const handlers = await editorHandlers();

  it('covers every editor, language and variant', () => {
    expect(Object.keys(now)).toEqual(Object.keys(EDITORS));
    expect(Object.keys(recorded)).toEqual(Object.keys(EDITORS));
    expect(Object.keys(recordedHandlers)).toEqual(Object.keys(EDITORS));
    for (const editor of Object.keys(EDITORS)) {
      expect(Object.keys(recorded[editor])).toEqual([...LANGUAGES]);
      expect(handlers[editor].map((h) => h.action)).toEqual(recordedHandlers[editor].map((h) => h.action));
      for (const lang of LANGUAGES) expect(Object.keys(recorded[editor][lang])).toEqual(Object.keys(VARIANTS));
    }
  });

  for (const editor of Object.keys(EDITORS)) {
    for (const lang of LANGUAGES) {
      for (const variant of Object.keys(VARIANTS)) {
        it(`${editor} ${lang} ${variant}: Look section`, () => {
          expect(now[editor][lang][variant].look).toEqual(recorded[editor][lang][variant].look);
        });
        it(`${editor} ${lang} ${variant}: History button switch`, () => {
          expect(now[editor][lang][variant].history).toEqual(recorded[editor][lang][variant].history);
        });
      }
    }
    it(`${editor}: the Look controls and the History switch send the same config`, () => {
      expect(handlers[editor]).toEqual(recordedHandlers[editor]);
    });
  }
});
