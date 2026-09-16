import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export type StoredDocument = {
  storageKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
};

/**
 * Development-grade private storage. Files are never mounted as static assets;
 * callers must authenticate through the document endpoint. An S3/R2 adapter can
 * implement this same boundary without changing the talent API.
 */
export class PrivateDocumentStorage {
  constructor(
    private readonly root = resolve(
      process.env.DOCUMENT_STORAGE_ROOT ?? join(process.cwd(), 'private-documents'),
    ),
  ) {}

  async put(
    input: Omit<StoredDocument, 'storageKey'> & {
      bytes: Buffer;
      extension: 'pdf' | 'jpg' | 'png' | 'webp';
    },
  ) {
    await mkdir(this.root, { recursive: true });
    const { extension, bytes: _bytes, ...document } = input;
    const storageKey = `${randomUUID()}.${extension}`;
    const destination = this.pathFor(storageKey);
    const temporary = `${destination}.uploading`;
    await writeFile(temporary, input.bytes, { flag: 'wx' });
    await rename(temporary, destination);
    return { ...document, storageKey };
  }

  read(storageKey: string) {
    return readFile(this.pathFor(storageKey));
  }

  async remove(storageKey: string) {
    await rm(this.pathFor(storageKey), { force: true });
  }

  private pathFor(storageKey: string) {
    const safeName = basename(storageKey);
    if (
      safeName !== storageKey ||
      !/\.(pdf|jpg|png|webp)$/.test(safeName)
    ) {
      throw new Error('INVALID_DOCUMENT_STORAGE_KEY');
    }
    return join(this.root, safeName);
  }
}
