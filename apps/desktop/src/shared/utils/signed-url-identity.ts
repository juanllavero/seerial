/**
 * The file a signed stream URL points to (the `path` in its token). Two URLs signed for the same file
 * differ (new token every time) but share it: e.g. two seasons that both use the theme of the series.
 */
export function getSignedUrlFileIdentity(signedUrl: string): string | null {
  try {
    const parsed = new URL(signedUrl, 'http://localhost');
    const token = parsed.searchParams.get('token');
    if (!token) {
      return null;
    }

    const tokenParts = token.split('.');
    if (tokenParts.length < 2) {
      return null;
    }

    const payloadPart = tokenParts[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payloadPart) {
      return null;
    }

    const paddedPayload = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, '=');
    const payload = JSON.parse(atob(paddedPayload)) as { path?: string };

    return payload.path ?? null;
  } catch {
    return null;
  }
}
