import { t } from '../src/i18n';

/** The English strings of the status menu and its editor part, for tests that assert on visible text. */
export const MENU_STRINGS = {
  details: t(null, 'menu.details'),
  editLabel: (name: string) => t(null, 'menu.editLabel', { name }),
  scripts: t(null, 'menu.scripts'),
  automations: t(null, 'menu.automations'),
  running: t(null, 'menu.running'),
  runningAnnounce: t(null, 'menu.runningAnnounce'),
  run: t(null, 'menu.run'),
  unavailable: t(null, 'menu.unavailable'),
  error: t(null, 'menu.error'),
  updating: t(null, 'menu.updating'),
  editorActions: t(null, 'editor.actions'),
  editorAddAction: t(null, 'editor.addAction'),
  editorRemove: t(null, 'editor.remove'),
  editorShowMenu: t(null, 'editor.showMenu'),
  editorActionPlaceholder: t(null, 'editor.actionPlaceholder'),
  editorInvalidAction: t(null, 'editor.invalidAction'),
  editorMissingEntity: t(null, 'editor.missingEntity'),
  editorMissingAction: t(null, 'editor.missingAction'),
};
