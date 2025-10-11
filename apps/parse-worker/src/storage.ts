import { readFile } from 'node:fs/promises';

async function fetchHttp(url: URL): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url.toString()}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function fetchFile(pathname: string): Promise<Buffer> {
  return readFile(pathname);
}

export async function fetchDocumentBytes(storagePath: string): Promise<Buffer> {
  if (!storagePath) {
    throw new Error('storagePath is required');
  }

  try {
    const url = new URL(storagePath);
    if (url.protocol === 'file:') {
      return fetchFile(url.pathname);
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return fetchHttp(url);
    }
  } catch (err) {
    // Not a valid URL — treat as local file path
    return fetchFile(storagePath);
  }

  return fetchFile(storagePath);
}
