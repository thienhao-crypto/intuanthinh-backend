const DEFAULT_SITE_URL = 'https://intuanthinh.com';
const excludedPageSlugs = new Set(['trang-chu', 'tin-tuc']);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizePathname(pathname = '/') {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function normalizeSiteUrl(siteUrl) {
  const candidate = String(siteUrl || '').trim();

  if (!candidate) {
    return DEFAULT_SITE_URL;
  }

  try {
    const url = new URL(candidate);
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function toAbsoluteUrl(siteUrl, pathname = '/') {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const normalizedPathname = normalizePathname(pathname);
  return `${normalizedSiteUrl}${normalizedPathname === '/' ? '' : normalizedPathname}`;
}

function getPagePath(slug) {
  if (!slug || slug === 'trang-chu') {
    return '/';
  }

  return `/${slug}`;
}

function uniqueRoutes(routes) {
  return [...new Map(routes.map((route) => [route.loc, route])).values()];
}

export function resolveSiteUrl(env = process.env) {
  return normalizeSiteUrl(env.SITE_URL || env.VITE_SITE_URL || DEFAULT_SITE_URL);
}

export function buildSitemapEntries({ siteUrl, pages = [], categories = [], products = [] }) {
  const effectiveSiteUrl = resolveSiteUrl({ SITE_URL: siteUrl });

  const routes = [
    { loc: toAbsoluteUrl(effectiveSiteUrl, '/') },
    { loc: toAbsoluteUrl(effectiveSiteUrl, '/san-pham') },
    { loc: toAbsoluteUrl(effectiveSiteUrl, '/gia-in') },
    { loc: toAbsoluteUrl(effectiveSiteUrl, '/lien-he') }
  ];

  for (const page of pages) {
    if (!page?.slug || excludedPageSlugs.has(page.slug)) {
      continue;
    }

    const path = getPagePath(page?.slug);
    routes.push({ loc: toAbsoluteUrl(effectiveSiteUrl, path) });
  }

  for (const category of categories) {
    if (!category?.slug) {
      continue;
    }

    routes.push({ loc: toAbsoluteUrl(effectiveSiteUrl, `/danh-muc/${category.slug}`) });
  }

  for (const product of products) {
    if (!product?.slug) {
      continue;
    }

    routes.push({ loc: toAbsoluteUrl(effectiveSiteUrl, `/san-pham/${product.slug}`) });
  }

  return uniqueRoutes(routes);
}

export function buildSitemapXml(input) {
  const entries = buildSitemapEntries(input);
  const body = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function buildRobotsTxt({ siteUrl }) {
  const effectiveSiteUrl = resolveSiteUrl({ SITE_URL: siteUrl });

  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/admin/
Disallow: /api/contact-submissions

Sitemap: ${toAbsoluteUrl(effectiveSiteUrl, '/sitemap.xml')}
`;
}

export function normalizeSearchConsoleVerificationFile(fileName) {
  const normalized = String(fileName || '').trim();
  return /^google[a-zA-Z0-9_-]+\.html$/.test(normalized) ? normalized : '';
}

export function buildSearchConsoleVerificationFileContent(fileName) {
  const normalizedFileName = normalizeSearchConsoleVerificationFile(fileName);

  if (!normalizedFileName) {
    return '';
  }

  return `google-site-verification: ${normalizedFileName}\n`;
}
