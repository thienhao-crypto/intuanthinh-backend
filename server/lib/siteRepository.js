import { collectManagedMediaAssetIds, deleteMediaAssetsIfUnreferenced } from './mediaAssets.js';

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function queryAll(db, sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function queryOne(db, sql, params = []) {
  const rows = await queryAll(db, sql, params);
  return rows[0] ?? null;
}

async function nextNumericId(db, tableName) {
  const row = await queryOne(db, `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ${tableName}`);
  return Number(row?.next_id ?? 1);
}

function mapPage(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    link: row.link,
    excerpt: row.excerpt,
    content: row.content,
    plainText: row.plain_text,
    isPublished: Boolean(row.is_published)
  };
}

function mapCategory(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    count: row.item_count,
    parent: row.parent_id,
    children: parseJson(row.children_json, [])
  };
}

function mapPricingOption(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.code,
    name: row.name,
    unitPrice: Number(row.unit_price),
    unitLabel: row.unit_label,
    turnaround: row.turnaround
  };
}

function stripHtml(value) {
  if (!value) {
    return '';
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPagePlainText(input) {
  return [input.title, input.excerpt, stripHtml(input.content)].filter(Boolean).join('\n\n').trim();
}

async function getProductImages(db, productId) {
  const rows = await queryAll(
    db,
    `
      SELECT id, src, thumbnail, alt
      FROM product_images
      WHERE product_id = ?
      ORDER BY sort_order ASC, id ASC
    `,
    [productId]
  );

  return rows.map((row) => ({
    id: row.id,
    src: row.src,
    thumbnail: row.thumbnail,
    alt: row.alt
  }));
}

async function getProductCategories(db, productId) {
  const rows = await queryAll(
    db,
    `
      SELECT c.id, c.slug, c.name
      FROM product_categories pc
      INNER JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = ?
      ORDER BY pc.sort_order ASC, c.sort_order ASC, c.id ASC
    `,
    [productId]
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name
  }));
}

async function mapProductRow(db, row) {
  if (!row) {
    return null;
  }

  const [images, categories] = await Promise.all([
    getProductImages(db, row.id),
    getProductCategories(db, row.id)
  ]);

  const primaryCategory =
    row.primary_category_id == null
      ? null
      : categories.find((category) => category.id === row.primary_category_id) ?? null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    permalink: row.permalink,
    summary: row.summary,
    shortDescription: row.short_description,
    description: row.description,
    images,
    categories,
    primaryCategory
  };
}

export async function getCompany(db) {
  const row = await queryOne(
    db,
    `
      SELECT name, headline, founded_year, about_json, highlights_json, contact_json, clients_json
      FROM company
      WHERE id = 1
    `
  );

  if (!row) {
    return null;
  }

  return {
    name: row.name,
    headline: row.headline,
    foundedYear: row.founded_year,
    about: parseJson(row.about_json, []),
    highlights: parseJson(row.highlights_json, []),
    contact: parseJson(row.contact_json, {}),
    clients: parseJson(row.clients_json, [])
  };
}

function normalizeBannerItem(item) {
  const src = typeof item?.src === 'string' ? item.src.trim() : '';
  const thumbnail = typeof item?.thumbnail === 'string' ? item.thumbnail.trim() : '';
  const alt = typeof item?.alt === 'string' ? item.alt.trim() : '';

  if (!src) {
    return null;
  }

  return {
    src,
    thumbnail: thumbnail || src,
    alt
  };
}

export async function getShowcaseBanners(db) {
  const row = await queryOne(db, 'SELECT json_value FROM app_meta WHERE meta_key = ?', ['showcaseBanners']);

  if (!row) {
    return null;
  }

  const items = parseJson(row?.json_value, []);

  if (!Array.isArray(items)) {
    return [];
  }

  return items.map(normalizeBannerItem).filter(Boolean);
}

export async function updateShowcaseBanners(db, banners) {
  const normalizedBanners = (Array.isArray(banners) ? banners : []).map(normalizeBannerItem).filter(Boolean);

  await db.execute(
    `
      INSERT INTO app_meta (meta_key, json_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE json_value = VALUES(json_value)
    `,
    ['showcaseBanners', JSON.stringify(normalizedBanners)]
  );

  return normalizedBanners;
}

export async function getBootstrapData(db) {
  const [generatedAtRow, sourceRow, company, showcaseBanners, pages, categories, products, pricingOptions] = await Promise.all([
    queryOne(db, 'SELECT json_value FROM app_meta WHERE meta_key = ?', ['generatedAt']),
    queryOne(db, 'SELECT json_value FROM app_meta WHERE meta_key = ?', ['source']),
    getCompany(db),
    getShowcaseBanners(db),
    listPages(db),
    listCategories(db),
    listProducts(db),
    listPricingOptions(db)
  ]);

  return {
    generatedAt: parseJson(generatedAtRow?.json_value, null),
    source: parseJson(sourceRow?.json_value, {}),
    company,
    showcaseBanners,
    pages,
    categories,
    products,
    pricingOptions
  };
}

export async function listPages(db, options = {}) {
  const includeUnpublished = options?.includeUnpublished === true;
  const rows = await queryAll(
    db,
    `
      SELECT id, slug, title, link, excerpt, content, plain_text, is_published
      FROM pages
      ${includeUnpublished ? '' : 'WHERE is_published = 1'}
      ORDER BY sort_order ASC, id ASC
    `
  );

  return rows.map(mapPage);
}

export async function getPageBySlug(db, slug, options = {}) {
  const includeUnpublished = options?.includeUnpublished === true;
  return mapPage(
    await queryOne(
      db,
      `
        SELECT id, slug, title, link, excerpt, content, plain_text, is_published
        FROM pages
        WHERE slug = ?
        ${includeUnpublished ? '' : 'AND is_published = 1'}
      `,
      [slug]
    )
  );
}

export async function upsertPageBySlug(db, slug, input) {
  const existing = await getPageBySlug(db, slug, { includeUnpublished: true });
  const plainText = buildPagePlainText(input);
  const isPublished = typeof input?.isPublished === 'boolean' ? input.isPublished : existing?.isPublished ?? true;

  if (existing) {
    await db.execute(
      `
        UPDATE pages
        SET title = ?, link = ?, excerpt = ?, content = ?, plain_text = ?, is_published = ?
        WHERE slug = ?
      `,
      [input.title, input.link ?? '', input.excerpt ?? '', input.content ?? '', plainText, isPublished ? 1 : 0, slug]
    );

    return await getPageBySlug(db, slug, { includeUnpublished: true });
  }

  const pageId = await nextNumericId(db, 'pages');
  const sortRow = await queryOne(db, 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM pages');
  const sortOrder = Number(sortRow?.next_sort ?? 0);

  await db.execute(
    `
      INSERT INTO pages (id, sort_order, slug, title, link, excerpt, content, plain_text, is_published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [pageId, sortOrder, slug, input.title, input.link ?? '', input.excerpt ?? '', input.content ?? '', plainText, isPublished ? 1 : 0]
  );

  return await getPageBySlug(db, slug, { includeUnpublished: true });
}

export async function updatePageVisibilityBySlug(db, slug, isPublished) {
  const existing = await getPageBySlug(db, slug, { includeUnpublished: true });

  if (!existing) {
    return null;
  }

  await db.execute(
    `
      UPDATE pages
      SET is_published = ?
      WHERE slug = ?
    `,
    [isPublished ? 1 : 0, slug]
  );

  return await getPageBySlug(db, slug, { includeUnpublished: true });
}

export async function ensureRecruitmentPage(db) {
  const existing = await getPageBySlug(db, 'tuyen-dung', { includeUnpublished: true });

  if (existing) {
    return {
      created: false,
      page: existing
    };
  }

  const company = await getCompany(db);
  const phone = company?.contact?.phone || '';
  const email = company?.contact?.email || '';
  const office = company?.contact?.office || '';
  const page = await upsertPageBySlug(db, 'tuyen-dung', {
    title: 'Tuyển dụng',
    link: '/tuyen-dung',
    excerpt: '',
    isPublished: true,
    content: `
      <h2>Vị trí đang nhận hồ sơ</h2>
      <ul>
        <li>Nhân viên kinh doanh dịch vụ in ấn</li>
        <li>Nhân viên thiết kế - chế bản</li>
        <li>Thợ vận hành máy in và gia công sau in</li>
      </ul>
      <h2>Yêu cầu chung</h2>
      <ul>
        <li>Tác phong làm việc nghiêm túc, chủ động và có trách nhiệm.</li>
        <li>Ưu tiên ứng viên đã có kinh nghiệm trong ngành in ấn hoặc sản xuất.</li>
        <li>Sẵn sàng phối hợp với đội ngũ để đảm bảo tiến độ đơn hàng.</li>
      </ul>
      <h2>Cách ứng tuyển</h2>
      <p>Gửi CV hoặc thông tin kinh nghiệm làm việc qua email ${email || 'của công ty'}${phone ? ` hoặc liên hệ hotline ${phone}` : ''} để được hướng dẫn thêm.</p>
      ${office ? `<p>Ứng viên cũng có thể nộp hồ sơ trực tiếp tại: ${office}.</p>` : ''}
    `.trim()
  });

  return {
    created: true,
    page
  };
}

export async function listCategories(db) {
  const rows = await queryAll(
    db,
    `
      SELECT id, slug, name, item_count, parent_id, children_json
      FROM categories
      ORDER BY sort_order ASC, id ASC
    `
  );

  return rows.map(mapCategory).filter(Boolean);
}

export async function getCategoryBySlug(db, slug) {
  return mapCategory(
    await queryOne(
      db,
      `
        SELECT id, slug, name, item_count, parent_id, children_json
        FROM categories
        WHERE slug = ?
      `,
      [slug]
    )
  );
}

export async function listProducts(db) {
  const rows = await queryAll(
    db,
    `
      SELECT id, slug, name, permalink, summary, short_description, description, primary_category_id
      FROM products
      ORDER BY sort_order ASC, id ASC
    `
  );

  const products = [];

  for (const row of rows) {
    products.push(await mapProductRow(db, row));
  }

  return products;
}

export async function getProductById(db, id) {
  const row = await queryOne(
    db,
    `
      SELECT id, slug, name, permalink, summary, short_description, description, primary_category_id
      FROM products
      WHERE id = ?
    `,
    [id]
  );

  return mapProductRow(db, row);
}

export async function getProductBySlug(db, slug) {
  const row = await queryOne(
    db,
    `
      SELECT id, slug, name, permalink, summary, short_description, description, primary_category_id
      FROM products
      WHERE slug = ?
    `,
    [slug]
  );

  return mapProductRow(db, row);
}

export async function listProductsByCategorySlug(db, categorySlug) {
  const category = await getCategoryBySlug(db, categorySlug);

  if (!category) {
    return [];
  }

  const relatedSlugs = [category.slug, ...(category.children ?? [])];
  const placeholders = relatedSlugs.map(() => '?').join(', ');
  const rows = await queryAll(
    db,
    `
      SELECT DISTINCT p.id, p.slug, p.name, p.permalink, p.summary, p.short_description, p.description, p.primary_category_id
      FROM products p
      INNER JOIN product_categories pc ON pc.product_id = p.id
      INNER JOIN categories c ON c.id = pc.category_id
      WHERE c.slug IN (${placeholders})
      ORDER BY p.sort_order ASC, p.id ASC
    `,
    relatedSlugs
  );

  const products = [];

  for (const row of rows) {
    products.push(await mapProductRow(db, row));
  }

  return products;
}

export async function listPricingOptions(db) {
  const rows = await queryAll(
    db,
    `
      SELECT code, name, unit_price, unit_label, turnaround
      FROM pricing_options
      ORDER BY sort_order ASC, code ASC
    `
  );

  return rows.map(mapPricingOption);
}

async function persistProductImages(connection, productId, images) {
  await connection.execute('DELETE FROM product_images WHERE product_id = ?', [productId]);

  let nextImageId = await nextNumericId(connection, 'product_images');

  for (const [index, image] of images.entries()) {
    await connection.execute(
      `
        INSERT INTO product_images (id, product_id, sort_order, src, thumbnail, alt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [nextImageId, productId, index, image.src, image.thumbnail ?? '', image.alt ?? '']
    );

    nextImageId += 1;
  }
}

async function persistProductCategories(connection, productId, categoryIds) {
  await connection.execute('DELETE FROM product_categories WHERE product_id = ?', [productId]);

  for (const [index, categoryId] of categoryIds.entries()) {
    await connection.execute(
      `
        INSERT INTO product_categories (product_id, category_id, sort_order)
        VALUES (?, ?, ?)
      `,
      [productId, categoryId, index]
    );
  }
}

export async function createProduct(db, input) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const productId = await nextNumericId(connection, 'products');
    const sortRow = await queryOne(connection, 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM products');
    const sortOrder = Number(sortRow?.next_sort ?? 0);

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
        productId,
        sortOrder,
        input.slug,
        input.name,
        input.permalink ?? '',
        input.summary ?? '',
        input.shortDescription ?? '',
        input.description ?? '',
        input.primaryCategoryId ?? null
      ]
    );

    await persistProductImages(connection, productId, input.images ?? []);
    await persistProductCategories(connection, productId, input.categoryIds ?? []);

    await connection.commit();
    return await getProductById(db, productId);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateProduct(db, id, input) {
  const existing = await getProductById(db, id);

  if (!existing) {
    return null;
  }

  const connection = await db.getConnection();
  const previousAssetIds = collectManagedMediaAssetIds(existing.images);
  const nextAssetIds = collectManagedMediaAssetIds(input.images);
  const removedAssetIds = previousAssetIds.filter((value) => !nextAssetIds.includes(value));

  try {
    await connection.beginTransaction();

    await connection.execute(
      `
        UPDATE products
        SET slug = ?, name = ?, permalink = ?, summary = ?, short_description = ?, description = ?, primary_category_id = ?
        WHERE id = ?
      `,
      [
        input.slug,
        input.name,
        input.permalink ?? '',
        input.summary ?? '',
        input.shortDescription ?? '',
        input.description ?? '',
        input.primaryCategoryId ?? null,
        id
      ]
    );

    await persistProductImages(connection, id, input.images ?? []);
    await persistProductCategories(connection, id, input.categoryIds ?? []);

    await connection.commit();

    if (removedAssetIds.length) {
      await deleteMediaAssetsIfUnreferenced(db, removedAssetIds).catch((error) => {
        console.error('Failed to delete replaced product images from database:', error);
      });
    }

    return await getProductById(db, id);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteProduct(db, id) {
  const existing = await getProductById(db, id);

  if (!existing) {
    return false;
  }

  await db.execute('DELETE FROM products WHERE id = ?', [id]);

  const assetIds = collectManagedMediaAssetIds(existing.images);

  if (assetIds.length) {
    await deleteMediaAssetsIfUnreferenced(db, assetIds).catch((error) => {
      console.error('Failed to delete removed product images from database:', error);
    });
  }

  return true;
}

export async function createPricingOption(db, input) {
  const sortRow = await queryOne(db, 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM pricing_options');
  const sortOrder = Number(sortRow?.next_sort ?? 0);

  await db.execute(
    `
      INSERT INTO pricing_options (code, sort_order, name, unit_price, unit_label, turnaround)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [input.id, sortOrder, input.name, input.unitPrice, input.unitLabel, input.turnaround]
  );

  return mapPricingOption(
    await queryOne(
      db,
      `
        SELECT code, name, unit_price, unit_label, turnaround
        FROM pricing_options
        WHERE code = ?
      `,
      [input.id]
    )
  );
}

export async function updatePricingOption(db, code, input) {
  const existing = await queryOne(db, 'SELECT code FROM pricing_options WHERE code = ?', [code]);

  if (!existing) {
    return null;
  }

  await db.execute(
    `
      UPDATE pricing_options
      SET code = ?, name = ?, unit_price = ?, unit_label = ?, turnaround = ?
      WHERE code = ?
    `,
    [input.id, input.name, input.unitPrice, input.unitLabel, input.turnaround, code]
  );

  return mapPricingOption(
    await queryOne(
      db,
      `
        SELECT code, name, unit_price, unit_label, turnaround
        FROM pricing_options
        WHERE code = ?
      `,
      [input.id]
    )
  );
}

export async function deletePricingOption(db, code) {
  const [result] = await db.execute('DELETE FROM pricing_options WHERE code = ?', [code]);
  return result.affectedRows > 0;
}

export async function createContactSubmission(db, input) {
  const [result] = await db.execute(
    `
      INSERT INTO contact_submissions (name, phone, email, company_name, message, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.name,
      input.phone ?? '',
      input.email ?? '',
      input.companyName ?? '',
      input.message,
      input.source ?? 'website',
      new Date()
    ]
  );

  const inserted = await queryOne(
    db,
    `
      SELECT id, name, phone, email, company_name, message, source, created_at
      FROM contact_submissions
      WHERE id = ?
    `,
    [result.insertId]
  );

  return {
    id: inserted.id,
    name: inserted.name,
    phone: inserted.phone,
    email: inserted.email,
    companyName: inserted.company_name,
    message: inserted.message,
    source: inserted.source,
    createdAt: inserted.created_at
  };
}
