import type { PersistedServer } from '@seerial/domain';

export const CENTRAL_SERVER = 'api.seerial.es';
// The web client is served by the server itself (or proxied to it by the dev server), so the
// server is always on the page's own origin. A fixed `localhost` URL only worked on the computer
// running the server: from any other device `localhost` is that device, not the server.
export const LOCAL_SERVER_URL =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:34200';
export const LOCAL_SERVER: PersistedServer = {
    name: 'Local Server',
    url: LOCAL_SERVER_URL,
};

export enum ImageType {
    POSTER = 'poster',
    BACKDROP = 'backdrop',
    LOGO = 'logo',
    SQUARE = 'square',
}

export enum UserType {
    NORMAL = 'normal',
    ADMIN = 'admin',
}

export const SIDEBAR_MARGIN = 56;
export const SIDEBAR_MARGIN_COLLAPSED = 14;
