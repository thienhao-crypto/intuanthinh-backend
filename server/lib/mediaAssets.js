import fs from 'node:fs/promises';
import path from 'node:path';
import { productUploadsDir } from './uploads.js';

const managedMediaPathPattern = /^\/api\/media\/(\d+)(?:[?#].*)?$/i;
const legacyUploadPrefix = '/uploads/products/';
const mimeTypesByExtension = new Map([
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
  ['.webp', 'image/webp']
]);

function normalizePath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toUniqueNumericIds(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ];
}

function getMimeTypeFromFilename(filename = '') {
  return mimeTypesByExtension.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream';
}

function resolveLegacyUploadPath(value) {
  const normalized = normalizePath(value);

  if (!normalized.startsWith(legacyUploadPrefix)) {
    return null;
  }

  const filename = normalized.slice(legacyUploadPrefix.length).split(/[?#]/, 1)[0];

  if (!filename || path.basename(filename) !== filename) {
    return null;
  }

  return path.join(productUploadsDir, filename);
}

export function createMediaAssetPublicPath(id) {
  return `/api/media/${Number(id)}`;
}

export function parseManagedMediaAssetId(value) {
  const match = normalizePath(value).match(managedMediaPathPattern);

  if (!match) {
    return null;
  }

  const assetId = Number(match[1]);
  return Number.isInteger(assetId) && assetId > 0 ? assetId : null;
}

export function isManagedMediaAssetPath(value) {
  return parseManagedMediaAssetId(value) !== null;
}

export function collectManagedMediaAssetIds(images = []) {
  return toUniqueNumericIds(
    images.flatMap((image) => [parseManagedMediaAssetId(image?.src), parseManagedMediaAssetId(image?.thumbnail)])
  );
}

export async function insertMediaAsset(db, { originalName = 'image', mimeType, buffer }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Image buffer is empty.');
  }

  const safeOriginalName = path.basename(originalName) || 'image';
  const safeMimeType = normalizePath(mimeType) || getMimeTypeFromFilename(safeOriginalName);
  const [result] = await db.execute(
    `
      INSERT INTO media_assets (original_name, mime_type, byte_length, binary_data)
      VALUES (?, ?, ?, ?)
    `,
    [safeOriginalName, safeMimeType, buffer.length, buffer]
  );

  return Number(result.insertId);
}

export async function getMediaAssetById(db, id) {
  const assetId = Number(id);

  if (!Number.isInteger(assetId) || assetId <= 0) {
    return null;
  }

  const [rows] = await db.execute(
    `
      SELECT id, original_name, mime_type, byte_length, binary_data
      FROM media_assets
      WHERE id = ?
      LIMIT 1
    `,
    [assetId]
  );

  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type || getMimeTypeFromFilename(row.original_name),
    byteLength: Number(row.byte_length ?? row.binary_data?.length ?? 0),
    binaryData: row.binary_data
  };
}

async function isMediaAssetReferenced(db, assetId) {
  const publicPath = createMediaAssetPublicPath(assetId);
  const [rows] = await db.execute(
    `
      SELECT COUNT(*) AS total
      FROM product_images
      WHERE src = ? OR thumbnail = ?
    `,
    [publicPath, publicPath]
  );

  return Number(rows[0]?.total ?? 0) > 0;
}

export async function deleteMediaAssetsIfUnreferenced(db, assetIds) {
  const uniqueIds = toUniqueNumericIds(assetIds);

  for (const assetId of uniqueIds) {
    if (await isMediaAssetReferenced(db, assetId)) {
      continue;
    }

    await db.execute('DELETE FROM media_assets WHERE id = ?', [assetId]);
  }
}

export async function deleteManagedMediaAssetsByPaths(db, paths) {
  const assetIds = toUniqueNumericIds(
    (Array.isArray(paths) ? paths : [paths]).map((value) => parseManagedMediaAssetId(value))
  );

  await deleteMediaAssetsIfUnreferenced(db, assetIds);
}

export async function migrateLegacyProductUploads(db) {
  const [rows] = await db.execute(
    `
      SELECT id, src, thumbnail
      FROM product_images
      ORDER BY id ASC
    `
  );

  if (!rows.length) {
    return {
      migratedFiles: 0,
      migratedRefs: 0,
      skippedFiles: 0
    };
  }

  const connection = await db.getConnection();
  const migratedPathMap = new Map();
  const removableFiles = new Set();
  const skippedFiles = new Set();
  let migratedFiles = 0;
  let migratedRefs = 0;

  try {
    await connection.beginTransaction();

    for (const row of rows) {
      const nextValues = {
        src: row.src,
        thumbnail: row.thumbnail
      };
      let didChange = false;

      for (const field of ['src', 'thumbnail']) {
        const currentValue = nextValues[field];
        const absolutePath = resolveLegacyUploadPath(currentValue);

        if (!absolutePath) {
          continue;
        }

        let nextPath = migratedPathMap.get(currentValue);

        if (!nextPath) {
          const buffer = await fs.readFile(absolutePath).catch(() => null);

          if (!buffer?.length) {
            skippedFiles.add(absolutePath);
            continue;
          }

          const assetId = await insertMediaAsset(connection, {
            originalName: path.basename(absolutePath),
            mimeType: getMimeTypeFromFilename(absolutePath),
            buffer
          });

          nextPath = createMediaAssetPublicPath(assetId);
          migratedPathMap.set(currentValue, nextPath);
          removableFiles.add(absolutePath);
          migratedFiles += 1;
        }

        if (nextValues[field] !== nextPath) {
          nextValues[field] = nextPath;
          migratedRefs += 1;
          didChange = true;
        }
      }

      if (didChange) {
        await connection.execute('UPDATE product_images SET src = ?, thumbnail = ? WHERE id = ?', [
          nextValues.src,
          nextValues.thumbnail,
          row.id
        ]);
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  await Promise.all(
    [...removableFiles].map(async (filePath) => {
      await fs.unlink(filePath).catch((error) => {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      });
    })
  );

  return {
    migratedFiles,
    migratedRefs,
    skippedFiles: skippedFiles.size
  };
}
