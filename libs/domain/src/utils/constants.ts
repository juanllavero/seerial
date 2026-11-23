export const MAX_COOKIE_AGE = 90;

export const DESKTOP_PADDING_LEFT = '4rem';

/** Machine-readable codes sent by the server in the `data.code` field of error responses. */
export const API_ERROR_CODES = {
  /** The item comes from a local folder/file and can only be removed from the file system. */
  LOCAL_SOURCE_DELETE_FORBIDDEN: 'LOCAL_SOURCE_DELETE_FORBIDDEN',
} as const;