import fs from 'node:fs/promises';
import path from 'node:path';

const SITE_URL = 'https://intuanthinh.com';
const OUTPUT_FILE = path.resolve('client/src/data/siteData.js');

const RELEVANT_PAGE_SLUGS = new Set([
  'trang-chu',
  'gioi-thieu',
  'huong-dan-dat-hang',
  'tin-tuc',
  'lien-he',
  'chinh-sach-thanh-toan',
  'chinh-sach-bao-mat'
]);

const HIDDEN_POST_SLUGS = new Set(['hello-world']);

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function decodeEntities(value = '') {
  return value
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&#8230;/g, '...')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '-')
    .replace(/&#8242;/g, "'")
    .replace(/&#8230;/g, '...')
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html = '') {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeHtml(html = '') {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\s(?:class|id|style|loading|decoding|sizes|srcset|aria-describedby|title|width|height)="[^"]*"/gi, '')
      .replace(/\s(?:class|id|style|loading|decoding|sizes|srcset|aria-describedby|title|width|height)='[^']*'/gi, '')
      .replace(/<div>\s*<\/div>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function summarizeHtml(html = '', maxLength = 220) {
  const text = stripTags(html);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function extractParagraphs(html = '', limit = 2) {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];

  return matches
    .map((match) => stripTags(match[1]))
    .filter(Boolean)
    .slice(0, limit);
}

function extractHeadings(html = '', tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');

  return [...html.matchAll(pattern)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

function extractContactInfo(html = '') {
  const text = stripTags(html);
  const phoneMatch = text.match(/0\d{3}[.\s]?\d{2}[.\s]?\d{4}/);
  const zaloMatch = text.match(/Zalo:\s*([0-9.]+)/i);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const officeMatch = text.match(/Đc trụ sở:\s*(.+)/i);
  const workshopMatch = text.match(/Đc sx:\s*(.+)/i);

  return {
    phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, '') : '0915.10.9697',
    zalo: zaloMatch ? zaloMatch[1].replace(/\s+/g, '') : '0915109697',
    email: emailMatch ? emailMatch[0] : '18huongpham@gmail.com',
    office: officeMatch ? officeMatch[1].trim() : '101/17/3 Gò Dầu, Phú Thọ Hoà, TPHCM',
    workshop: workshopMatch ? workshopMatch[1].trim() : '19/2/11 - 19/2/13 Đường số 20, Bình Hưng Hoà, Bình Tân',
    deliveryNote:
      'Miễn phí giao hàng trong bán kính 15km theo lịch, hỗ trợ gửi chành xe hoặc chuyển phát nhanh cho khách tỉnh.'
  };
}

function extractFoundedYear(text = '') {
  const match = text.match(/thành lập từ năm (\d{4})/i);
  return match ? match[1] : '1996';
}

function buildCategoryTree(categories) {
  const map = new Map(categories.map((category) => [category.id, { ...category, children: [] }]));

  for (const category of map.values()) {
    if (category.parent && map.has(category.parent)) {
      map.get(category.parent).children.push(category.slug);
    }
  }

  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi'));
}

function orderProductsFromHome(homeHtml, products) {
  const names = extractHeadings(homeHtml, 'h4');
  const ordered = [];
  const taken = new Set();

  for (const product of products) {
    if (!taken.has(product.slug)) {
      ordered.push(product);
      taken.add(product.slug);
    }
  }

  return ordered;
}

async function main() {
  const [siteMeta, rawPages, rawPosts, rawCategories, rawProductList] = await Promise.all([
    fetchJson(`${SITE_URL}/wp-json/`),
    fetchJson(`${SITE_URL}/wp-json/wp/v2/pages?per_page=100`),
    fetchJson(`${SITE_URL}/wp-json/wp/v2/posts?per_page=100`),
    fetchJson(`${SITE_URL}/wp-json/wc/store/v1/products/categories`),
    fetchJson(`${SITE_URL}/wp-json/wc/store/v1/products?per_page=100`)
  ]);

  const productDetails = await Promise.all(
    rawProductList.map((product) => fetchJson(`${SITE_URL}/wp-json/wc/store/v1/products/${product.id}`))
  );

  const pages = rawPages
    .filter((page) => RELEVANT_PAGE_SLUGS.has(page.slug))
    .map((page) => ({
      id: page.id,
      slug: page.slug,
      title: decodeEntities(page.title.rendered),
      link: page.link,
      excerpt: summarizeHtml(page.excerpt.rendered || page.content.rendered),
      content: normalizeHtml(page.content.rendered),
      plainText: stripTags(page.content.rendered)
    }))
    .sort((left, right) => left.id - right.id);

  const posts = rawPosts
    .filter((post) => !HIDDEN_POST_SLUGS.has(post.slug))
    .map((post) => ({
      id: post.id,
      slug: post.slug,
      title: decodeEntities(post.title.rendered),
      link: post.link,
      date: post.date,
      excerpt: summarizeHtml(post.excerpt.rendered || post.content.rendered),
      content: normalizeHtml(post.content.rendered)
    }));

  const categories = buildCategoryTree(
    rawCategories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: decodeEntities(category.name),
      count: category.count,
      parent: category.parent
    }))
  );

  const products = productDetails.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: decodeEntities(product.name),
    permalink: product.permalink,
    summary: summarizeHtml(product.short_description || product.description, 180),
    shortDescription: normalizeHtml(product.short_description),
    description: normalizeHtml(product.description),
    images: product.images.map((image) => ({
      id: image.id,
      src: image.src,
      thumbnail: image.thumbnail,
      alt: decodeEntities(image.alt || product.name)
    })),
    categories: product.categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: decodeEntities(category.name)
    })),
    primaryCategory: product.categories[0]
      ? {
          id: product.categories[0].id,
          slug: product.categories[0].slug,
          name: decodeEntities(product.categories[0].name)
        }
      : null
  }));

  const homePage = pages.find((page) => page.slug === 'trang-chu');
  const aboutPage = pages.find((page) => page.slug === 'gioi-thieu');
  const guidePage = pages.find((page) => page.slug === 'huong-dan-dat-hang');

  const aboutParagraphs = extractParagraphs(aboutPage?.content || '', 3);
  const companyText = aboutPage?.plainText || '';
  const homeHeading = extractHeadings(homePage?.content || '', 'h3').find((heading) => heading.includes('IN TUẤN THỊNH'));
  const homeHighlights = extractHeadings(homePage?.content || '', 'h4').slice(0, 4);

  const data = {
    generatedAt: new Date().toISOString(),
    source: {
      siteUrl: SITE_URL,
      wpJson: `${SITE_URL}/wp-json/`,
      productsApi: `${SITE_URL}/wp-json/wc/store/v1/products`,
      pagesApi: `${SITE_URL}/wp-json/wp/v2/pages`
    },
    company: {
      name: decodeEntities(siteMeta.name),
      headline: homeHeading || 'IN TUẤN THỊNH - Chuyên In Offset & Gia Công Ấn Phẩm Giấy Chất Lượng Cao',
      foundedYear: extractFoundedYear(companyText),
      about: aboutParagraphs,
      highlights: homeHighlights,
      contact: extractContactInfo(guidePage?.content || ''),
      clients: [
        'Acecook Việt Nam',
        'Khách sạn Sài Gòn Riverside',
        'LG Electronic Việt Nam',
        'Ngân hàng TMCP Sài Gòn Công Thương',
        'VNPT',
        'Mobifone',
        'Vietcombank'
      ]
    },
    pages,
    posts,
    categories,
    products: orderProductsFromHome(homePage?.content || '', products)
  };

  const fileContent = `export const siteData = ${JSON.stringify(data, null, 2)};\n\nexport default siteData;\n`;

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, fileContent, 'utf8');

  console.log(`Saved site data to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
