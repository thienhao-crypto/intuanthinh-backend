import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import {
  clearAdminSessionCookie,
  getAdminAuthConfig,
  isValidAdminCredentials,
  readAdminSession,
  requireAdminAuth,
  setAdminSessionCookie
} from './lib/adminAuth.js';
import { getDatabaseConfig, openDatabase } from './lib/database.js';
import {
  createMediaAssetPublicPath,
  deleteManagedMediaAssetsByPaths,
  getMediaAssetById,
  insertMediaAsset,
  migrateLegacyProductUploads
} from './lib/mediaAssets.js';
import { buildRobotsTxt, buildSitemapXml, resolveSiteUrl } from './lib/seo.js';
import {
  enforceSupportChatRateLimit,
  generateSupportChatReply,
  validateSupportChatPayload
} from './lib/supportChat.js';
import {
  createPricingOption,
  createProduct,
  createContactSubmission,
  deletePricingOption,
  deleteProduct,
  ensureRecruitmentPage,
  getBootstrapData,
  getCategoryBySlug,
  getCompany,
  getPageBySlug,
  getProductById,
  getProductBySlug,
  getShowcaseBanners,
  listCategories,
  listPages,
  listPricingOptions,
  listProducts,
  listProductsByCategorySlug,
  upsertPageBySlug,
  updatePageVisibilityBySlug,
  updateShowcaseBanners,
  updatePricingOption,
  updateProduct
} from './lib/siteRepository.js';
import { uploadsRootDir } from './lib/uploads.js';

const app = express();
const PORT = Number(process.env.PORT || 5000);
const PRODUCT_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DB_PACKET_SAFETY_MARGIN_BYTES = 64 * 1024;
const clientDistDir = fileURLToPath(new URL('../client/dist/', import.meta.url));
const clientDistIndexFile = fileURLToPath(new URL('../client/dist/index.html', import.meta.url));
const hasClientDist = existsSync(clientDistIndexFile);
const db = await openDatabase();
const mediaMigration = await migrateLegacyProductUploads(db);
const recruitmentPage = await ensureRecruitmentPage(db);
const allowedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif']);
const productImageUploadLimitBytes = await resolveProductImageUploadLimit(db, PRODUCT_IMAGE_UPLOAD_MAX_BYTES);
const productImageUploadLimitLabel = formatBinarySize(productImageUploadLimitBytes);
const siteBaseUrl = resolveSiteUrl(process.env);

if (mediaMigration.migratedFiles || mediaMigration.skippedFiles) {
  console.log('Media migration result:', mediaMigration);
}

if (recruitmentPage.created) {
  console.log('Created default recruitment page in database.');
}

if (!hasClientDist) {
  console.warn('Client build not found in client/dist. Run "npm run build" before starting the production server.');
}

if (productImageUploadLimitBytes < PRODUCT_IMAGE_UPLOAD_MAX_BYTES) {
  console.warn(
    `Image upload limit reduced to ${productImageUploadLimitLabel} because MySQL max_allowed_packet is too small for ${formatBinarySize(PRODUCT_IMAGE_UPLOAD_MAX_BYTES)} uploads.`
  );
}

const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: productImageUploadLimitBytes,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (!file.mimetype?.startsWith('image/') && !allowedImageExtensions.has(extension)) {
      const error = new Error('Chỉ chấp nhận file ảnh.');
      error.statusCode = 400;
      callback(error);
      return;
    }

    callback(null, true);
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsRootDir));

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatBinarySize(bytes) {
  const normalizedBytes = Number(bytes);

  if (!Number.isFinite(normalizedBytes) || normalizedBytes <= 0) {
    return '0B';
  }

  if (normalizedBytes >= 1024 * 1024) {
    const megabytes = normalizedBytes / (1024 * 1024);
    const formatted = megabytes >= 10 || Number.isInteger(megabytes) ? Math.round(megabytes).toString() : megabytes.toFixed(1);
    return `${formatted}MB`;
  }

  if (normalizedBytes >= 1024) {
    const kilobytes = normalizedBytes / 1024;
    const formatted = kilobytes >= 10 || Number.isInteger(kilobytes) ? Math.round(kilobytes).toString() : kilobytes.toFixed(1);
    return `${formatted}KB`;
  }

  return `${Math.round(normalizedBytes)}B`;
}

async function resolveProductImageUploadLimit(db, desiredLimitBytes) {
  try {
    const [rows] = await db.query('SELECT @@session.max_allowed_packet AS maxAllowedPacket');
    const packetLimitBytes = Number(rows?.[0]?.maxAllowedPacket ?? 0);

    if (!Number.isFinite(packetLimitBytes) || packetLimitBytes <= DB_PACKET_SAFETY_MARGIN_BYTES) {
      return desiredLimitBytes;
    }

    return Math.min(desiredLimitBytes, Math.max(256 * 1024, packetLimitBytes - DB_PACKET_SAFETY_MARGIN_BYTES));
  } catch (error) {
    console.warn('Failed to read MySQL max_allowed_packet. Falling back to configured upload limit.', error);
    return desiredLimitBytes;
  }
}

function isMaxAllowedPacketError(error) {
  const details = [error?.message, error?.sqlMessage].filter(Boolean).join(' ');
  return error?.code === 'ER_NET_PACKET_TOO_LARGE' || /max_allowed_packet/i.test(details);
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateContactPayload(payload) {
  const normalized = {
    name: normalizeText(payload?.name),
    phone: normalizeText(payload?.phone),
    email: normalizeText(payload?.email),
    companyName: normalizeText(payload?.companyName),
    message: normalizeText(payload?.message),
    source: normalizeText(payload?.source) || 'website'
  };

  const errors = [];

  if (!normalized.name) {
    errors.push('Thiếu tên người liên hệ.');
  }

  if (!normalized.message) {
    errors.push('Thiếu nội dung liên hệ.');
  }

  if (!normalized.phone && !normalized.email) {
    errors.push('Cần ít nhất số điện thoại hoặc email.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: normalized
  };
}

function validateProductPayload(payload) {
  const images = Array.isArray(payload?.images)
    ? payload.images
        .map((image) => ({
          src: normalizeText(image?.src),
          thumbnail: normalizeText(image?.thumbnail),
          alt: normalizeText(image?.alt)
        }))
        .filter((image) => image.src)
    : [];

  const rawCategoryIds = Array.isArray(payload?.categoryIds) ? payload.categoryIds : [];
  const categoryIds = [...new Set(rawCategoryIds.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
  const primaryCategoryId = Number(payload?.primaryCategoryId);

  if (Number.isInteger(primaryCategoryId) && primaryCategoryId > 0 && !categoryIds.includes(primaryCategoryId)) {
    categoryIds.unshift(primaryCategoryId);
  }

  const normalized = {
    name: normalizeText(payload?.name),
    slug: slugify(payload?.slug || payload?.name),
    permalink: normalizeText(payload?.permalink),
    summary: normalizeText(payload?.summary),
    shortDescription: normalizeText(payload?.shortDescription),
    description: normalizeText(payload?.description),
    primaryCategoryId: Number.isInteger(primaryCategoryId) && primaryCategoryId > 0 ? primaryCategoryId : null,
    categoryIds,
    images
  };

  if (!normalized.permalink && normalized.slug) {
    normalized.permalink = `${siteBaseUrl}/product/${normalized.slug}/`;
  }

  const errors = [];

  if (!normalized.name) {
    errors.push('Thiếu tên sản phẩm.');
  }

  if (!normalized.slug) {
    errors.push('Không thể tạo đường dẫn sản phẩm.');
  }

  if (!normalized.categoryIds.length) {
    errors.push('Chọn ít nhất một danh mục.');
  }

  if (!normalized.images.length) {
    errors.push('Thêm ít nhất một hình ảnh.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: normalized
  };
}

function validatePricingPayload(payload) {
  const normalized = {
    id: slugify(payload?.id || payload?.name),
    name: normalizeText(payload?.name),
    unitPrice: Number(payload?.unitPrice),
    unitLabel: normalizeText(payload?.unitLabel),
    turnaround: normalizeText(payload?.turnaround)
  };

  const errors = [];
  if (!normalized.name) {
    errors.push('Thi\u1ebfu t\u00ean b\u1ea3ng gi\u00e1.');
  } else if (!normalized.id) {
    errors.push('T\u00ean b\u1ea3ng gi\u00e1 ch\u01b0a h\u1ee3p l\u1ec7.');
  }

  if (!Number.isFinite(normalized.unitPrice) || normalized.unitPrice <= 0) {
    errors.push('Đơn giá phải lớn hơn 0.');
  }

  if (!normalized.unitLabel) {
    errors.push('Thiếu đơn vị tính.');
  }

  if (!normalized.turnaround) {
    errors.push('Thiếu thời gian hoàn thành.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: normalized
  };
}

function validatePagePayload(payload, slug) {
  const normalized = {
    slug,
    title: normalizeText(payload?.title),
    link: normalizeText(payload?.link) || `/${slug}`,
    excerpt: normalizeText(payload?.excerpt),
    content: typeof payload?.content === 'string' ? payload.content.trim() : '',
    isPublished: typeof payload?.isPublished === 'boolean' ? payload.isPublished : undefined
  };

  const errors = [];

  if (!normalized.title) {
    errors.push('Thiếu tiêu đề trang.');
  }

  if (!normalized.slug) {
    errors.push('Thiếu slug trang.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: normalized
  };
}

function validatePageVisibilityPayload(payload) {
  if (typeof payload?.isPublished !== 'boolean') {
    return {
      isValid: false,
      errors: ['Thiếu trạng thái hiển thị của trang.'],
      value: null
    };
  }

  return {
    isValid: true,
    errors: [],
    value: {
      isPublished: payload.isPublished
    }
  };
}

function validateShowcaseBannersPayload(payload) {
  const items = Array.isArray(payload?.items)
    ? payload.items
        .map((item) => ({
          src: normalizeText(item?.src),
          thumbnail: normalizeText(item?.thumbnail) || normalizeText(item?.src),
          alt: normalizeText(item?.alt)
        }))
        .filter((item) => item.src)
    : [];

  return {
    isValid: true,
    errors: [],
    value: {
      items
    }
  };
}

function respondNotFound(res, resource) {
  return res.status(404).json({
    error: `${resource} không tồn tại.`
  });
}

app.get(
  '/robots.txt',
  asyncHandler(async (_req, res) => {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildRobotsTxt({ siteUrl: resolveSiteUrl(process.env) }));
  })
);

app.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const bootstrapData = await getBootstrapData(db);

    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(
      buildSitemapXml({
        siteUrl: resolveSiteUrl(process.env),
        pages: bootstrapData.pages ?? [],
        categories: bootstrapData.categories ?? [],
        products: bootstrapData.products ?? [],
        lastModified: bootstrapData.generatedAt ?? new Date().toISOString()
      })
    );
  })
);

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await db.execute('SELECT 1 AS ok');

    res.json({
      status: 'ok',
      database: {
        engine: 'mysql',
        connected: true,
        ...getDatabaseConfig()
      }
    });
  })
);

app.get(
  '/api/media/:id',
  asyncHandler(async (req, res) => {
    const asset = await getMediaAssetById(db, Number(req.params.id));

    if (!asset) {
      return respondNotFound(res, 'Anh');
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', String(asset.byteLength));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    return res.end(asset.binaryData);
  })
);

app.get(
  '/api/bootstrap',
  asyncHandler(async (_req, res) => {
    res.json(await getBootstrapData(db));
  })
);

app.get(
  '/api/company',
  asyncHandler(async (_req, res) => {
    res.json(await getCompany(db));
  })
);

app.get(
  '/api/pages',
  asyncHandler(async (_req, res) => {
    res.json(await listPages(db));
  })
);

app.get(
  '/api/pages/:slug',
  asyncHandler(async (req, res) => {
    const page = await getPageBySlug(db, req.params.slug);

    if (!page) {
      return respondNotFound(res, 'Trang');
    }

    return res.json(page);
  })
);

app.get(
  '/api/categories',
  asyncHandler(async (_req, res) => {
    res.json(await listCategories(db));
  })
);

app.get(
  '/api/categories/:slug',
  asyncHandler(async (req, res) => {
    const category = await getCategoryBySlug(db, req.params.slug);

    if (!category) {
      return respondNotFound(res, 'Danh mục');
    }

    return res.json(category);
  })
);

app.get(
  '/api/categories/:slug/products',
  asyncHandler(async (req, res) => {
    const category = await getCategoryBySlug(db, req.params.slug);

    if (!category) {
      return respondNotFound(res, 'Danh mục');
    }

    return res.json({
      category,
      products: await listProductsByCategorySlug(db, req.params.slug)
    });
  })
);

app.get(
  '/api/products',
  asyncHandler(async (_req, res) => {
    res.json(await listProducts(db));
  })
);

app.get(
  '/api/pricing-options',
  asyncHandler(async (_req, res) => {
    res.json(await listPricingOptions(db));
  })
);

app.get(
  '/api/products/:slug',
  asyncHandler(async (req, res) => {
    const product = await getProductBySlug(db, req.params.slug);

    if (!product) {
      return respondNotFound(res, 'Sản phẩm');
    }

    return res.json(product);
  })
);

app.get(
  '/api/admin/auth/session',
  asyncHandler(async (req, res) => {
    const session = readAdminSession(req);

    return res.json({
      authenticated: Boolean(session),
      username: session?.username ?? null
    });
  })
);

app.post(
  '/api/admin/auth/login',
  asyncHandler(async (req, res) => {
    const username = normalizeText(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!isValidAdminCredentials(username, password)) {
      return res.status(401).json({
        error: 'Tên đăng nhập hoặc mật khẩu không đúng.'
      });
    }

    setAdminSessionCookie(res, username || getAdminAuthConfig().username);

    return res.json({
      message: 'Đã đăng nhập quản trị.',
      authenticated: true,
      username: username || getAdminAuthConfig().username
    });
  })
);

app.post(
  '/api/admin/auth/logout',
  asyncHandler(async (_req, res) => {
    clearAdminSessionCookie(res);

    return res.json({
      message: 'Đã đăng xuất quản trị.',
      authenticated: false
    });
  })
);

app.use('/api/admin', requireAdminAuth);

app.post(
  '/api/admin/uploads/product-image',
  productImageUpload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'Chưa có file ảnh.'
      });
    }

    const assetId = await insertMediaAsset(db, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer
    });
    const publicPath = createMediaAssetPublicPath(assetId);
    const fallbackAlt = path.parse(req.file.originalname).name.replace(/[-_]+/g, ' ').trim();

    return res.status(201).json({
      message: 'Đã tải ảnh lên.',
      image: {
        src: publicPath,
        thumbnail: publicPath,
        alt: normalizeText(req.body?.alt) || fallbackAlt
      }
    });
  })
);

app.delete(
  '/api/admin/uploads/product-image',
  asyncHandler(async (req, res) => {
    const paths = [...new Set((Array.isArray(req.body?.paths) ? req.body.paths : []).map((value) => normalizeText(value)).filter(Boolean))];

    if (!paths.length) {
      return res.status(400).json({
        error: 'Thiếu đường dẫn ảnh cần xóa.'
      });
    }

    await deleteManagedMediaAssetsByPaths(db, paths);

    return res.json({
      message: 'Đã xóa ảnh tải lên.'
    });
  })
);

app.post(
  '/api/support-chat',
  asyncHandler(async (req, res) => {
    enforceSupportChatRateLimit(req);

    const validation = validateSupportChatPayload(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid support chat payload.',
        details: validation.errors
      });
    }

    const reply = await generateSupportChatReply(db, validation.value);

    return res.json({
      reply
    });
  })
);

app.post(
  '/api/contact-submissions',
  asyncHandler(async (req, res) => {
    const validation = validateContactPayload(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Dữ liệu không hợp lệ.',
        details: validation.errors
      });
    }

    const record = await createContactSubmission(db, validation.value);

    return res.status(201).json({
      message: 'Đã lưu thông tin liên hệ.',
      record
    });
  })
);

app.get(
  '/api/admin/products',
  asyncHandler(async (_req, res) => {
    res.json(await listProducts(db));
  })
);

app.get(
  '/api/admin/pages',
  asyncHandler(async (_req, res) => {
    res.json(await listPages(db, { includeUnpublished: true }));
  })
);

app.get(
  '/api/admin/showcase-banners',
  asyncHandler(async (_req, res) => {
    res.json(await getShowcaseBanners(db));
  })
);

app.post(
  '/api/admin/products',
  asyncHandler(async (req, res) => {
    const validation = validateProductPayload(req.body);

    if (!validation.isValid) {
        return res.status(400).json({
          error: 'Dữ liệu sản phẩm không hợp lệ.',
          details: validation.errors
        });
      }

    const product = await createProduct(db, validation.value);

    return res.status(201).json({
      message: 'Đã tạo sản phẩm.',
      product
    });
  })
);

app.put(
  '/api/admin/products/:id',
  asyncHandler(async (req, res) => {
    const validation = validateProductPayload(req.body);

    if (!validation.isValid) {
        return res.status(400).json({
          error: 'Dữ liệu sản phẩm không hợp lệ.',
          details: validation.errors
        });
      }

    const product = await updateProduct(db, Number(req.params.id), validation.value);

    if (!product) {
      return respondNotFound(res, 'Sản phẩm');
    }

    return res.json({
      message: 'Đã cập nhật sản phẩm.',
      product
    });
  })
);

app.delete(
  '/api/admin/products/:id',
  asyncHandler(async (req, res) => {
    const existing = await getProductById(db, Number(req.params.id));

    if (!existing) {
      return respondNotFound(res, 'Sản phẩm');
    }

    await deleteProduct(db, Number(req.params.id));

    return res.json({
      message: 'Đã xóa sản phẩm.'
    });
  })
);

app.put(
  '/api/admin/pages/:slug',
  asyncHandler(async (req, res) => {
    const slug = slugify(req.params.slug);
    const validation = validatePagePayload(req.body, slug);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Dữ liệu trang không hợp lệ.',
        details: validation.errors
      });
    }

    const page = await upsertPageBySlug(db, slug, validation.value);

    return res.json({
      message: 'Đã cập nhật trang nội dung.',
      page
    });
  })
);

app.patch(
  '/api/admin/pages/:slug/visibility',
  asyncHandler(async (req, res) => {
    const slug = slugify(req.params.slug);
    const validation = validatePageVisibilityPayload(req.body);

    if (!slug) {
      return res.status(400).json({
        error: 'Slug trang không hợp lệ.'
      });
    }

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Dữ liệu trạng thái trang không hợp lệ.',
        details: validation.errors
      });
    }

    const page = await updatePageVisibilityBySlug(db, slug, validation.value.isPublished);

    if (!page) {
      return respondNotFound(res, 'Trang');
    }

    return res.json({
      message: validation.value.isPublished ? 'Đã hiển thị trang nội dung.' : 'Đã ẩn trang nội dung.',
      page
    });
  })
);

app.put(
  '/api/admin/showcase-banners',
  asyncHandler(async (req, res) => {
    const validation = validateShowcaseBannersPayload(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Dữ liệu banner không hợp lệ.',
        details: validation.errors
      });
    }

    const banners = await updateShowcaseBanners(db, validation.value.items);

    return res.json({
      message: banners.length ? 'Đã cập nhật banner trang chủ.' : 'Đã xóa toàn bộ banner trang chủ.',
      banners
    });
  })
);

app.get(
  '/api/admin/pricing-options',
  asyncHandler(async (_req, res) => {
    res.json(await listPricingOptions(db));
  })
);

app.post(
  '/api/admin/pricing-options',
  asyncHandler(async (req, res) => {
    const validation = validatePricingPayload(req.body);

    if (!validation.isValid) {
        return res.status(400).json({
          error: 'Dữ liệu giá in không hợp lệ.',
          details: validation.errors
        });
      }

    const pricingOption = await createPricingOption(db, validation.value);

    return res.status(201).json({
      message: 'Đã tạo mục giá in.',
      pricingOption
    });
  })
);

app.put(
  '/api/admin/pricing-options/:code',
  asyncHandler(async (req, res) => {
    const validation = validatePricingPayload(req.body);

    if (!validation.isValid) {
        return res.status(400).json({
          error: 'Dữ liệu giá in không hợp lệ.',
          details: validation.errors
        });
      }

    const pricingOption = await updatePricingOption(db, req.params.code, validation.value);

    if (!pricingOption) {
      return respondNotFound(res, 'Mục giá in');
    }

    return res.json({
      message: 'Đã cập nhật mục giá in.',
      pricingOption
    });
  })
);

app.delete(
  '/api/admin/pricing-options/:code',
  asyncHandler(async (req, res) => {
    const deleted = await deletePricingOption(db, req.params.code);

    if (!deleted) {
      return respondNotFound(res, 'Mục giá in');
    }

    return res.json({
      message: 'Đã xóa mục giá in.'
    });
  })
);

if (hasClientDist) {
  app.use(express.static(clientDistDir, { index: false }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      return next();
    }

    if (!req.accepts('html')) {
      return next();
    }

    return res.sendFile(clientDistIndexFile);
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File ảnh vượt quá giới hạn 10MB.'
      });
    }

    return res.status(400).json({
      error: 'Không thể tải ảnh lên.',
      details: error.message
    });
  }

  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message
    });
  }

  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      error: 'Dữ liệu bị trùng.',
      details: error.sqlMessage
    });
  }

  if (isMaxAllowedPacketError(error)) {
    return res.status(400).json({
      error: 'Anh qua lon so voi cau hinh MySQL hien tai. Vui long giam dung luong anh hoac tang max_allowed_packet.'
    });
  }

  res.status(500).json({
    error: 'Lỗi máy chủ.',
    details: process.env.NODE_ENV === 'production' ? undefined : error.message
  });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
