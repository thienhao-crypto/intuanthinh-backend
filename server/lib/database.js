import mysql from 'mysql2/promise';
import './loadEnv.js';

function parseDatabaseHost(inputHost, inputPort) {
  const fallbackHost = '127.0.0.1';
  const fallbackPort = 3306;
  const normalizedHost = String(inputHost || '').trim();
  const normalizedPort = Number(inputPort);

  if (!normalizedHost) {
    return {
      host: fallbackHost,
      port: Number.isInteger(normalizedPort) && normalizedPort > 0 ? normalizedPort : fallbackPort
    };
  }

  const hostWithPortMatch = normalizedHost.match(/^([^:]+):(\d+)$/);

  if (!hostWithPortMatch) {
    return {
      host: normalizedHost,
      port: Number.isInteger(normalizedPort) && normalizedPort > 0 ? normalizedPort : fallbackPort
    };
  }

  return {
    host: hostWithPortMatch[1],
    port: Number.isInteger(normalizedPort) && normalizedPort > 0 ? normalizedPort : Number(hostWithPortMatch[2])
  };
}

function normalizeDatabaseCharset(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'utf8') {
    return {
      charset: 'utf8',
      collation: 'utf8_general_ci'
    };
  }

  return {
    charset: 'utf8mb4',
    collation: 'utf8mb4_general_ci'
  };
}

const resolvedHost = parseDatabaseHost(process.env.DB_HOST, process.env.DB_PORT);
const resolvedCharset = normalizeDatabaseCharset(process.env.DB_CHARSET);

const databaseConfig = {
  host: resolvedHost.host,
  port: resolvedHost.port,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'intuanthinh',
  charset: resolvedCharset.charset
};

const tableCharacterSetSql = `ENGINE=InnoDB DEFAULT CHARSET=${resolvedCharset.charset} COLLATE=${resolvedCharset.collation}`;

const schema = `
  CREATE TABLE IF NOT EXISTS app_meta (
    meta_key VARCHAR(100) PRIMARY KEY,
    json_value LONGTEXT NOT NULL
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS company (
    id TINYINT UNSIGNED PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    headline TEXT NOT NULL,
    founded_year VARCHAR(10),
    about_json LONGTEXT NOT NULL,
    highlights_json LONGTEXT NOT NULL,
    contact_json LONGTEXT NOT NULL,
    clients_json LONGTEXT NOT NULL
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS pages (
    id BIGINT UNSIGNED PRIMARY KEY,
    sort_order INT NOT NULL DEFAULT 0,
    slug VARCHAR(191) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    link TEXT,
    excerpt MEDIUMTEXT,
    content LONGTEXT,
    plain_text LONGTEXT,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    KEY idx_pages_slug (slug)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS categories (
    id BIGINT UNSIGNED PRIMARY KEY,
    sort_order INT NOT NULL DEFAULT 0,
    slug VARCHAR(191) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    item_count INT NOT NULL DEFAULT 0,
    parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    children_json LONGTEXT NOT NULL,
    KEY idx_categories_slug (slug)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED PRIMARY KEY,
    sort_order INT NOT NULL DEFAULT 0,
    slug VARCHAR(191) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    permalink TEXT,
    summary MEDIUMTEXT,
    short_description LONGTEXT,
    description LONGTEXT,
    primary_category_id BIGINT UNSIGNED NULL,
    CONSTRAINT fk_products_primary_category
      FOREIGN KEY (primary_category_id) REFERENCES categories(id)
      ON DELETE SET NULL ON UPDATE CASCADE,
    KEY idx_products_slug (slug)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS product_images (
    id BIGINT UNSIGNED PRIMARY KEY,
    product_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    src TEXT NOT NULL,
    thumbnail TEXT,
    alt TEXT,
    CONSTRAINT fk_product_images_product
      FOREIGN KEY (product_id) REFERENCES products(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    KEY idx_product_images_product (product_id, sort_order)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS media_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(191) NOT NULL,
    byte_length INT UNSIGNED NOT NULL,
    binary_data LONGBLOB NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_media_assets_created (created_at)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS product_categories (
    product_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, category_id),
    CONSTRAINT fk_product_categories_product
      FOREIGN KEY (product_id) REFERENCES products(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_product_categories_category
      FOREIGN KEY (category_id) REFERENCES categories(id)
      ON DELETE CASCADE ON UPDATE CASCADE,
    KEY idx_product_categories_category (category_id, sort_order)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS contact_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    company_name VARCHAR(255),
    message LONGTEXT NOT NULL,
    source VARCHAR(100) NOT NULL DEFAULT 'website',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ${tableCharacterSetSql};

  CREATE TABLE IF NOT EXISTS pricing_options (
    code VARCHAR(191) PRIMARY KEY,
    sort_order INT NOT NULL DEFAULT 0,
    name VARCHAR(255) NOT NULL,
    unit_price INT NOT NULL,
    unit_label VARCHAR(80) NOT NULL,
    turnaround VARCHAR(255) NOT NULL
  ) ${tableCharacterSetSql};

`;

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

async function ensureDatabaseExists() {
  const connection = await mysql.createConnection({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    password: databaseConfig.password,
    charset: databaseConfig.charset,
    multipleStatements: true
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${databaseConfig.database}\` CHARACTER SET ${resolvedCharset.charset} COLLATE ${resolvedCharset.collation}`
    );
  } finally {
    await connection.end();
  }
}

async function ensureColumnExists(pool, tableName, columnName, definitionSql) {
  const [rows] = await pool.execute(
    `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [databaseConfig.database, tableName, columnName]
  );

  if (rows.length) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definitionSql}`);
}

export function getDatabaseConfig() {
  return {
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.user,
    database: databaseConfig.database,
    charset: databaseConfig.charset
  };
}

export async function openDatabase() {
  await ensureDatabaseExists();

  const pool = mysql.createPool({
    ...databaseConfig,
    charset: databaseConfig.charset,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true
  });

  await pool.query(schema);
  await ensureColumnExists(pool, 'pages', 'is_published', '`is_published` TINYINT(1) NOT NULL DEFAULT 1 AFTER `plain_text`');

  return pool;
}

export async function seedDatabase(pool, siteData) {
  if (!siteData || typeof siteData !== 'object') {
    throw new Error('siteData is required for seedDatabase.');
  }

  const pages = siteData.pages ?? [];
  const categories = siteData.categories ?? [];
  const products = siteData.products ?? [];

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(`
      DELETE FROM pricing_options;
      DELETE FROM product_categories;
      DELETE FROM product_images;
      DELETE FROM media_assets;
      DELETE FROM products;
      DELETE FROM categories;
      DELETE FROM pages;
      DELETE FROM company;
      DELETE FROM app_meta;
    `);

    await connection.execute(
      `INSERT INTO app_meta (meta_key, json_value) VALUES (?, ?), (?, ?)`,
      ['generatedAt', stringifyJson(siteData.generatedAt ?? null), 'source', stringifyJson(siteData.source ?? {})]
    );

    await connection.execute(
      `
        INSERT INTO company (
          id,
          name,
          headline,
          founded_year,
          about_json,
          highlights_json,
          contact_json,
          clients_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        1,
        siteData.company?.name ?? '',
        siteData.company?.headline ?? '',
        siteData.company?.foundedYear ?? '',
        stringifyJson(siteData.company?.about ?? []),
        stringifyJson(siteData.company?.highlights ?? []),
        stringifyJson(siteData.company?.contact ?? {}),
        stringifyJson(siteData.company?.clients ?? [])
      ]
    );

    for (const [index, option] of (siteData.pricingOptions ?? []).entries()) {
      await connection.execute(
        `
          INSERT INTO pricing_options (code, sort_order, name, unit_price, unit_label, turnaround)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          option.id,
          index,
          option.name,
          Number(option.unitPrice ?? 0),
          option.unitLabel ?? '',
          option.turnaround ?? ''
        ]
      );
    }

    for (const [index, page] of pages.entries()) {
      await connection.execute(
        `
          INSERT INTO pages (id, sort_order, slug, title, link, excerpt, content, plain_text, is_published)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          page.id,
          index,
          page.slug,
          page.title,
          page.link ?? '',
          page.excerpt ?? '',
          page.content ?? '',
          page.plainText ?? '',
          page.isPublished === false ? 0 : 1
        ]
      );
    }

    for (const [index, category] of categories.entries()) {
      await connection.execute(
        `
          INSERT INTO categories (id, sort_order, slug, name, item_count, parent_id, children_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          category.id,
          index,
          category.slug,
          category.name,
          category.count ?? 0,
          category.parent ?? 0,
          stringifyJson(category.children ?? [])
        ]
      );
    }

    for (const [productIndex, product] of products.entries()) {
      await connection.execute(
        `
          INSERT INTO products (
            id,
            sort_order,
            slug,
            name,
            permalink,
            summary,
            short_description,
            description,
            primary_category_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          product.id,
          productIndex,
          product.slug,
          product.name,
          product.permalink ?? '',
          product.summary ?? '',
          product.shortDescription ?? '',
          product.description ?? '',
          product.primaryCategory?.id ?? null
        ]
      );

      for (const [imageIndex, image] of (product.images ?? []).entries()) {
        await connection.execute(
          `
            INSERT INTO product_images (id, product_id, sort_order, src, thumbnail, alt)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
          [image.id, product.id, imageIndex, image.src ?? '', image.thumbnail ?? '', image.alt ?? '']
        );
      }

      for (const [categoryIndex, category] of (product.categories ?? []).entries()) {
        await connection.execute(
          `
            INSERT INTO product_categories (product_id, category_id, sort_order)
            VALUES (?, ?, ?)
          `,
          [product.id, category.id, categoryIndex]
        );
      }
    }

    await connection.commit();

    return {
      pages: pages.length,
      categories: categories.length,
      products: products.length,
      pricingOptions: (siteData.pricingOptions ?? []).length
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
