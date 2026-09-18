export const IS_LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === 'true';
export const IS_LOCAL_AUTH = process.env.NEXT_PUBLIC_AUTH_MODE === 'local_password';

export function resolveApiUrl(configured: string | undefined, localMode: boolean): string {
  const value = configured || (localMode ? 'http://localhost:8000' : 'https://workspace-endpoint.openagents.org');
  if (localMode) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Local mode requires a loopback NEXT_PUBLIC_API_URL');
    }
  }
  return value.replace(/\/+$/, '');
}

export const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL, IS_LOCAL_MODE || IS_LOCAL_AUTH);
