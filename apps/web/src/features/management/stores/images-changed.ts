import { seerialQueryClient } from '@seerial/api';

let changed = false;

/** An image was replaced while editing */
export const markImagesChanged = () => {
  changed = true;
};

/**
 * Reloads what shows the replaced images. Done when the editor closes: doing it while it is open
 * would reset the fields the user is editing.
 */
export const refreshChangedImages = () => {
  if (!changed) return;
  changed = false;
  seerialQueryClient.invalidateQueries();
};
