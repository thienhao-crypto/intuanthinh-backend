import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRootDir = path.resolve(currentDir, '..');

export const uploadsRootDir = path.join(serverRootDir, 'uploads');
export const productUploadsDir = path.join(uploadsRootDir, 'products');

function normalizeManagedUploadPath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveManagedUploadPath(value) {
  const normalized = normalizeManagedUploadPath(value);

  if (!normalized.startsWith('/uploads/products/')) {
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  const absolutePath = path.resolve(serverRootDir, relativePath);
  const rootWithSeparator = `${path.resolve(uploadsRootDir)}${path.sep}`;

  if (!absolutePath.startsWith(rootWithSeparator)) {
    return null;
  }

  return absolutePath;
}

export function isManagedUploadPath(value) {
  return Boolean(resolveManagedUploadPath(value));
}

export function createProductUploadFilename(originalName = 'image') {
  const extension = (path.extname(originalName) || '.jpg').toLowerCase();
  const basename = path
    .basename(originalName, path.extname(originalName))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);

  return `${basename || 'image'}-${crypto.randomUUID()}${extension}`;
}

export function toProductUploadPublicPath(filename) {
  return `/uploads/products/${filename}`;
}

export async function ensureUploadDirectories() {
  await fs.mkdir(productUploadsDir, { recursive: true });
}

export function collectManagedUploadPaths(images = []) {
  return [
    ...new Set(
      images
        .flatMap((image) => [image?.src, image?.thumbnail])
        .map((value) => normalizeManagedUploadPath(value))
        .filter((value) => isManagedUploadPath(value))
    )
  ];
}

export async function deleteManagedUploadFiles(paths) {
  const uniquePaths = [...new Set((Array.isArray(paths) ? paths : [paths]).map((value) => normalizeManagedUploadPath(value)).filter(Boolean))];

  await Promise.all(
    uniquePaths.map(async (value) => {
      const absolutePath = resolveManagedUploadPath(value);

      if (!absolutePath) {
        return;
      }

      await fs.unlink(absolutePath).catch((error) => {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      });
    })
  );
}
