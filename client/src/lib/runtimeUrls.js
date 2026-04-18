export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function normalizeUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isAbsoluteUrl(value) {
  return /^(?:https?:)?\/\//i.test(value);
}

export function resolveApiUrl(value = '') {
  const normalizedValue = normalizeUrl(value);

  if (!normalizedValue) {
    return apiBaseUrl;
  }

  if (!apiBaseUrl || isAbsoluteUrl(normalizedValue)) {
    return normalizedValue;
  }

  return normalizedValue.startsWith('/') ? `${apiBaseUrl}${normalizedValue}` : `${apiBaseUrl}/${normalizedValue}`;
}

export function resolveMediaUrl(value) {
  const normalizedValue = normalizeUrl(value);

  if (!normalizedValue || isAbsoluteUrl(normalizedValue) || normalizedValue.startsWith('data:') || normalizedValue.startsWith('blob:')) {
    return normalizedValue;
  }

  if (normalizedValue.startsWith('/api/media/') || normalizedValue.startsWith('/uploads/')) {
    return resolveApiUrl(normalizedValue);
  }

  return normalizedValue;
}

function normalizeImageAsset(image) {
  return {
    ...image,
    src: resolveMediaUrl(image?.src),
    thumbnail: image?.thumbnail ? resolveMediaUrl(image.thumbnail) : resolveMediaUrl(image?.src)
  };
}

export function normalizeSiteDataAssetUrls(siteData) {
  if (!siteData || typeof siteData !== 'object') {
    return siteData;
  }

  return {
    ...siteData,
    products: Array.isArray(siteData.products)
      ? siteData.products.map((product) => ({
          ...product,
          images: Array.isArray(product?.images) ? product.images.map(normalizeImageAsset) : []
        }))
      : [],
    showcaseBanners: Array.isArray(siteData.showcaseBanners)
      ? siteData.showcaseBanners.map(normalizeImageAsset)
      : siteData.showcaseBanners
  };
}
