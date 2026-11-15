/**
 * Elements that hold nothing: no text and no child element. Decorative parts (aria-hidden),
 * live regions, inputs, svg internals and the custom elements that fill themselves are fine.
 */
export function emptyElements(root: ShadowRoot): string[] {
  const skip = new Set(['STYLE', 'SCRIPT', 'SLOT', 'INPUT', 'SELECT', 'OPTION', 'DATALIST', 'HR', 'BR', 'IMG', 'DIALOG', 'HA-ICON', 'LIQUID-CLIMATE-SHEET', 'CIRCLE', 'PATH', 'LINE', 'RECT', 'G']);
  const found: string[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (skip.has(el.tagName.toUpperCase()) || el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
    if (el.closest('[aria-live]') || ['status', 'alert'].includes(el.getAttribute('role') ?? '')) continue;
    if (!el.textContent!.trim() && !el.children.length) found.push(`${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`);
  }
  return found;
}
