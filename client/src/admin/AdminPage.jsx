import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveApiUrl, resolveMediaUrl } from '../lib/runtimeUrls';

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function createProductPermalink(slug) {
  return slug ? `https://intuanthinh.com/product/${slug}/` : '';
}

function isManagedUploadPath(value) {
  return typeof value === 'string' && (value.startsWith('/api/media/') || value.startsWith('/uploads/products/'));
}

function createImageFormState(image, persisted = false) {
  return {
    src: image?.src || '',
    thumbnail: image?.thumbnail || '',
    alt: image?.alt || '',
    persisted,
    isUploading: false,
    uploadError: ''
  };
}

function createEmptyImage() {
  return createImageFormState();
}

function createEmptyProductForm() {
  return {
    id: null,
    name: '',
    slug: '',
    permalink: '',
    summary: '',
    shortDescription: '',
    description: '',
    primaryCategoryId: '',
    categoryIds: [],
    images: [createEmptyImage()]
  };
}

function createEmptyPricingForm() {
  return {
    id: '',
    name: '',
    unitPrice: '',
    unitLabel: '',
    turnaround: ''
  };
}

function normalizeMultilineText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');
}

function collapsePlainText(value) {
  return normalizeMultilineText(value)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getNodePlainText(node) {
  if (!node) {
    return '';
  }

  if (node.nodeType === 3) {
    return node.textContent || '';
  }

  if (node.nodeType !== 1) {
    return '';
  }

  const clone = node.cloneNode(true);

  if (typeof clone.querySelectorAll === 'function') {
    clone.querySelectorAll('br').forEach((breakNode) => breakNode.replaceWith('\n'));
  }

  return clone.textContent || '';
}

function collectRecruitmentPlainBlocks(root) {
  const blocks = [];

  Array.from(root?.childNodes || []).forEach((node) => {
    if (node.nodeType === 3) {
      const text = collapsePlainText(node.textContent || '');

      if (text) {
        blocks.push(text);
      }

      return;
    }

    if (node.nodeType !== 1) {
      return;
    }

    const tag = node.tagName.toLowerCase();

    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(node.children)
        .filter((child) => child.tagName?.toLowerCase() === 'li')
        .map((child) => collapsePlainText(getNodePlainText(child)))
        .filter(Boolean)
        .map((text) => `- ${text}`);

      if (items.length) {
        blocks.push(items.join('\n'));
      }

      return;
    }

    if (['div', 'section', 'article', 'main'].includes(tag)) {
      const nested = recruitmentHtmlToPlainText(node.innerHTML || '');

      if (nested) {
        blocks.push(nested);
      }

      return;
    }

    const text = collapsePlainText(getNodePlainText(node));

    if (text) {
      blocks.push(text);
    }
  });

  return blocks;
}

function fallbackRecruitmentHtmlToPlainText(html) {
  return normalizeMultilineText(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function recruitmentHtmlToPlainText(html) {
  const normalizedHtml = normalizeMultilineText(html).trim();

  if (!normalizedHtml) {
    return '';
  }

  if (typeof DOMParser === 'undefined') {
    return fallbackRecruitmentHtmlToPlainText(normalizedHtml);
  }

  const document = new DOMParser().parseFromString(`<div>${normalizedHtml}</div>`, 'text/html');
  const root = document.body.firstElementChild || document.body;

  return collectRecruitmentPlainBlocks(root)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isRecruitmentBullet(line) {
  return /^(?:[-*]|\u2022)\s+.+/.test(line);
}

function isLikelyRecruitmentHeading(line, nextNonEmptyLine) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length > 120 || /[.!?]$/.test(trimmed)) {
    return false;
  }

  return Boolean(nextNonEmptyLine?.trim());
}

function formatParagraphLines(lines) {
  return lines.map((line) => escapeHtml(line)).join('<br />');
}

function recruitmentPlainTextToHtml(text) {
  const lines = normalizeMultilineText(text).split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }

    if (index >= lines.length) {
      break;
    }

    if (isRecruitmentBullet(lines[index].trim())) {
      const items = [];

      while (index < lines.length && isRecruitmentBullet(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^(?:[-*]|\u2022)\s+/, ''));
        index += 1;
      }

      blocks.push(`<ul>\n${items.map((item) => `  <li>${escapeHtml(item)}</li>`).join('\n')}\n</ul>`);
      continue;
    }

    const blockLines = [];

    while (index < lines.length) {
      const currentLine = lines[index].trim();

      if (!currentLine || isRecruitmentBullet(currentLine)) {
        break;
      }

      blockLines.push(currentLine);
      index += 1;
    }

    if (!blockLines.length) {
      index += 1;
      continue;
    }

    let lookaheadIndex = index;

    while (lookaheadIndex < lines.length && !lines[lookaheadIndex].trim()) {
      lookaheadIndex += 1;
    }

    const nextNonEmptyLine = lines[lookaheadIndex]?.trim() || '';

    if (blockLines.length > 1 && isLikelyRecruitmentHeading(blockLines[0], blockLines[1])) {
      blocks.push(`<h2>${escapeHtml(blockLines[0])}</h2>`);
      blocks.push(`<p>${formatParagraphLines(blockLines.slice(1))}</p>`);
      continue;
    }

    if (blockLines.length === 1 && isLikelyRecruitmentHeading(blockLines[0], nextNonEmptyLine)) {
      blocks.push(`<h2>${escapeHtml(blockLines[0])}</h2>`);
      continue;
    }

    blocks.push(`<p>${formatParagraphLines(blockLines)}</p>`);
  }

  return blocks.join('\n').trim();
}

function createEmptyRecruitmentForm() {
  return {
    slug: 'tuyen-dung',
    title: 'Tuyển dụng',
    link: '/tuyen-dung',
    excerpt: '',
    content: '',
    isPublished: true
  };
}

function createEmptyBannerForm() {
  return [createEmptyImage()];
}

function bannersToForm(banners) {
  return Array.isArray(banners) && banners.length ? banners.map((banner) => createImageFormState(banner, true)) : createEmptyBannerForm();
}

function createEmptyLoginForm() {
  return {
    username: '',
    password: ''
  };
}

function productToForm(product) {
  return {
    id: product.id,
    name: product.name || '',
    slug: product.slug || '',
    permalink: product.permalink || '',
    summary: product.summary || '',
    shortDescription: product.shortDescription || '',
    description: product.description || '',
    primaryCategoryId: product.primaryCategory?.id ? String(product.primaryCategory.id) : '',
    categoryIds: (product.categories || []).map((category) => String(category.id)),
    images: product.images && product.images.length ? product.images.map((image) => createImageFormState(image, true)) : [createEmptyImage()]
  };
}

function pricingToForm(option) {
  return {
    id: option.id || '',
    name: option.name || '',
    unitPrice: String(option.unitPrice || ''),
    unitLabel: option.unitLabel || '',
    turnaround: option.turnaround || ''
  };
}

function pageToForm(page) {
  return {
    slug: page?.slug || 'tuyen-dung',
    title: page?.title || 'Tuyển dụng',
    link: page?.link || '/tuyen-dung',
    excerpt: page?.excerpt || '',
    content: recruitmentHtmlToPlainText(page?.content || ''),
    isPublished: page?.isPublished !== false
  };
}

async function requestJson(url, options) {
  const response = await fetch(resolveApiUrl(url), {
    credentials: 'include',
    ...(options || {})
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.details
      ? Array.isArray(data.details)
        ? data.details.join(' ')
        : data.details
      : data?.error || 'Yêu cầu thất bại.';

    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function isUnauthorizedError(error) {
  return error?.statusCode === 401;
}

function handleAdminRequestError(error, onUnauthorized, onMessage) {
  if (isUnauthorizedError(error)) {
    onUnauthorized?.();
    return true;
  }

  onMessage?.(error.message);
  return false;
}

async function deleteUploadedFiles(paths) {
  const safePaths = [...new Set((Array.isArray(paths) ? paths : [paths]).filter((value) => isManagedUploadPath(value)))];

  if (!safePaths.length) {
    return;
  }

  await requestJson('/api/admin/uploads/product-image', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ paths: safePaths })
  });
}

function collectTransientUploadPaths(images) {
  return [
    ...new Set(
      (images || [])
        .filter((image) => !image?.persisted)
        .flatMap((image) => [image?.src, image?.thumbnail])
        .filter((value) => isManagedUploadPath(value))
    )
  ];
}

function AdminConsole({ authUsername, onLogout, onUnauthorized }) {
  const [activePanel, setActivePanel] = useState('products');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [pages, setPages] = useState([]);
  const [showcaseBanners, setShowcaseBanners] = useState([]);
  const [hasBannerConfig, setHasBannerConfig] = useState(false);
  const [pricingOptions, setPricingOptions] = useState([]);
  const [productForm, setProductForm] = useState(createEmptyProductForm);
  const [pricingForm, setPricingForm] = useState(createEmptyPricingForm);
  const [recruitmentForm, setRecruitmentForm] = useState(createEmptyRecruitmentForm);
  const [bannerForm, setBannerForm] = useState(createEmptyBannerForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSavingPricing, setIsSavingPricing] = useState(false);
  const [isSavingRecruitment, setIsSavingRecruitment] = useState(false);
  const [isSavingBanners, setIsSavingBanners] = useState(false);
  const [isTogglingRecruitmentVisibility, setIsTogglingRecruitmentVisibility] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [draggingImageIndex, setDraggingImageIndex] = useState(null);
  const [draggingBannerIndex, setDraggingBannerIndex] = useState(null);
  const imageInputRefs = useRef([]);
  const bannerInputRefs = useRef([]);
  const latestProductImagesRef = useRef(productForm.images);
  const latestBannerImagesRef = useRef(bannerForm);

  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    latestProductImagesRef.current = productForm.images;
  }, [productForm.images]);

  useEffect(() => {
    latestBannerImagesRef.current = bannerForm;
  }, [bannerForm]);

  useEffect(
    () => () => {
      deleteUploadedFiles([
        ...collectTransientUploadPaths(latestProductImagesRef.current),
        ...collectTransientUploadPaths(latestBannerImagesRef.current)
      ]).catch(() => {});
    },
    []
  );

  async function loadAdminData() {
    setIsLoading(true);
    setFeedback('');

    try {
      const [categoriesData, productsData, pagesData, pricingData, bannersData] = await Promise.all([
        requestJson('/api/categories'),
        requestJson('/api/admin/products'),
        requestJson('/api/admin/pages'),
        requestJson('/api/admin/pricing-options'),
        requestJson('/api/admin/showcase-banners')
      ]);
      const recruitmentPage = pagesData.find((page) => page.slug === 'tuyen-dung') || null;
      const normalizedBanners = Array.isArray(bannersData) ? bannersData : [];

      setCategories(categoriesData);
      setProducts(productsData);
      setPages(pagesData);
      setPricingOptions(pricingData);
      setHasBannerConfig(Array.isArray(bannersData));
      setShowcaseBanners(normalizedBanners);
      setBannerForm(bannersToForm(normalizedBanners));
      setRecruitmentForm(pageToForm(recruitmentPage));
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsLoading(false);
    }
  }

  function selectProduct(product) {
    deleteUploadedFiles(collectTransientUploadPaths(productForm.images)).catch(() => {});
    setActivePanel('products');
    setProductForm(productToForm(product));
    setFeedback('');
  }

  function resetProductForm() {
    deleteUploadedFiles(collectTransientUploadPaths(productForm.images)).catch(() => {});
    setProductForm(createEmptyProductForm());
    setFeedback('');
  }

  function selectPricing(option) {
    setActivePanel('pricing');
    setPricingForm(pricingToForm(option));
    setFeedback('');
  }

  function resetPricingForm() {
    setPricingForm(createEmptyPricingForm());
    setFeedback('');
  }

  function resetBannerForm() {
    deleteUploadedFiles(collectTransientUploadPaths(bannerForm)).catch(() => {});
    setActivePanel('banners');
    setBannerForm(bannersToForm(showcaseBanners));
    setFeedback('');
  }

  function resetRecruitmentForm() {
    const recruitmentPage = pages.find((page) => page.slug === 'tuyen-dung') || null;
    setActivePanel('recruitment');
    setRecruitmentForm(pageToForm(recruitmentPage));
    setFeedback('');
  }

  function handleProductFieldChange(field, value) {
    setProductForm((current) => {
      if (field === 'name') {
        const next = { ...current, name: value };
        const currentSlug = current.slug || '';
        const previousAutoSlug = slugify(current.name || '');
        const previousAutoPermalink = createProductPermalink(previousAutoSlug);

        if (!currentSlug || currentSlug === previousAutoSlug) {
          next.slug = slugify(value);
        }

        if (!current.permalink || current.permalink === previousAutoPermalink) {
          next.permalink = createProductPermalink(next.slug || slugify(value));
        }

        return next;
      }

      if (field === 'primaryCategoryId') {
        return {
          ...current,
          primaryCategoryId: value,
          categoryIds: value && !current.categoryIds.includes(value) ? [value, ...current.categoryIds] : current.categoryIds
        };
      }

      return {
        ...current,
        [field]: value
      };
    });
  }

  function toggleCategory(categoryId) {
    setProductForm((current) => {
      const exists = current.categoryIds.includes(categoryId);
      const categoryIds = exists
        ? current.categoryIds.filter((item) => item !== categoryId)
        : [...current.categoryIds, categoryId];

      const primaryCategoryId = categoryIds.includes(current.primaryCategoryId) ? current.primaryCategoryId : categoryIds[0] || '';

      return {
        ...current,
        categoryIds,
        primaryCategoryId
      };
    });
  }

  function updateImage(index, field, value) {
    setProductForm((current) => ({
      ...current,
      images: current.images.map((image, imageIndex) =>
        imageIndex === index
          ? {
              ...image,
              [field]: value
            }
          : image
      )
    }));
  }

  function updateImageState(index, patch) {
    setProductForm((current) => ({
      ...current,
      images: current.images.map((image, imageIndex) => (imageIndex === index ? { ...image, ...patch } : image))
    }));
  }

  function addImage() {
    setProductForm((current) => ({
      ...current,
      images: [...current.images, createEmptyImage()]
    }));
  }

  function removeImage(index) {
    const image = productForm.images[index];

    if (image && !image.persisted) {
      deleteUploadedFiles(collectTransientUploadPaths([image])).catch(() => {});
    }

    setProductForm((current) => ({
      ...current,
      images: current.images.length === 1 ? [createEmptyImage()] : current.images.filter((_, imageIndex) => imageIndex !== index)
    }));
  }

  async function uploadImageFile(index, file) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      updateImageState(index, { uploadError: 'Vui lòng chọn đúng file ảnh.' });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      updateImageState(index, { uploadError: 'Ảnh vượt quá giới hạn 10MB.' });
      return;
    }

    const previousImage = productForm.images[index];
    const formData = new FormData();
    formData.append('image', file);
    formData.append('alt', previousImage?.alt || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim());

    updateImageState(index, {
      isUploading: true,
      uploadError: ''
    });

    try {
      const data = await requestJson('/api/admin/uploads/product-image', {
        method: 'POST',
        body: formData
      });

      updateImageState(index, {
        src: data.image.src,
        thumbnail: data.image.thumbnail,
        alt: previousImage?.alt || data.image.alt,
        persisted: false,
        isUploading: false,
        uploadError: ''
      });

      if (previousImage && !previousImage.persisted) {
        await deleteUploadedFiles(collectTransientUploadPaths([previousImage]));
      }
    } catch (error) {
      if (!handleAdminRequestError(error, onUnauthorized, (message) => {
        updateImageState(index, {
          isUploading: false,
          uploadError: message
        });
      })) {
        return;
      }
    } finally {
      if (imageInputRefs.current[index]) {
        imageInputRefs.current[index].value = '';
      }
    }
  }

  function openImagePicker(index) {
    imageInputRefs.current[index]?.click();
  }

  function handleImageInputChange(index, event) {
    const file = event.target.files?.[0];
    uploadImageFile(index, file);
  }

  function handleImageDrop(index, event) {
    event.preventDefault();
    setDraggingImageIndex(null);
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith('image/'));

    if (!file) {
      updateImageState(index, { uploadError: 'Không tìm thấy file ảnh hợp lệ trong vùng kéo thả.' });
      return;
    }

    uploadImageFile(index, file);
  }

  function updateBannerImage(index, field, value) {
    setBannerForm((current) =>
      current.map((image, imageIndex) =>
        imageIndex === index
          ? {
              ...image,
              [field]: value
            }
          : image
      )
    );
  }

  function updateBannerImageState(index, patch) {
    setBannerForm((current) => current.map((image, imageIndex) => (imageIndex === index ? { ...image, ...patch } : image)));
  }

  function addBannerImage() {
    setBannerForm((current) => [...current, createEmptyImage()]);
  }

  function removeBannerImage(index) {
    const image = bannerForm[index];

    if (image && !image.persisted) {
      deleteUploadedFiles(collectTransientUploadPaths([image])).catch(() => {});
    }

    setBannerForm((current) => (current.length === 1 ? createEmptyBannerForm() : current.filter((_, imageIndex) => imageIndex !== index)));
  }

  async function uploadBannerImageFile(index, file) {
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      updateBannerImageState(index, { uploadError: 'Vui lòng chọn đúng file ảnh.' });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      updateBannerImageState(index, { uploadError: 'Ảnh vượt quá giới hạn 10MB.' });
      return;
    }

    const previousImage = bannerForm[index];
    const formData = new FormData();
    formData.append('image', file);
    formData.append('alt', previousImage?.alt || file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim());

    updateBannerImageState(index, {
      isUploading: true,
      uploadError: ''
    });

    try {
      const data = await requestJson('/api/admin/uploads/product-image', {
        method: 'POST',
        body: formData
      });

      updateBannerImageState(index, {
        src: data.image.src,
        thumbnail: data.image.thumbnail,
        alt: previousImage?.alt || data.image.alt,
        persisted: false,
        isUploading: false,
        uploadError: ''
      });

      if (previousImage && !previousImage.persisted) {
        await deleteUploadedFiles(collectTransientUploadPaths([previousImage]));
      }
    } catch (error) {
      if (!handleAdminRequestError(error, onUnauthorized, (message) => {
        updateBannerImageState(index, {
          isUploading: false,
          uploadError: message
        });
      })) {
        return;
      }
    } finally {
      if (bannerInputRefs.current[index]) {
        bannerInputRefs.current[index].value = '';
      }
    }
  }

  function openBannerImagePicker(index) {
    bannerInputRefs.current[index]?.click();
  }

  function handleBannerImageInputChange(index, event) {
    const file = event.target.files?.[0];
    uploadBannerImageFile(index, file);
  }

  function handleBannerImageDrop(index, event) {
    event.preventDefault();
    setDraggingBannerIndex(null);
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith('image/'));

    if (!file) {
      updateBannerImageState(index, { uploadError: 'Không tìm thấy file ảnh hợp lệ trong vùng kéo thả.' });
      return;
    }

    uploadBannerImageFile(index, file);
  }

  async function handleSaveProduct(event) {
    event.preventDefault();

    if (productForm.images.some((image) => image.isUploading)) {
      setFeedback('Chờ ảnh tải lên xong rồi hãy lưu sản phẩm.');
      return;
    }

    setIsSavingProduct(true);
    setFeedback('');

    const payload = {
      ...productForm,
      primaryCategoryId: productForm.primaryCategoryId ? Number(productForm.primaryCategoryId) : null,
      categoryIds: productForm.categoryIds.map((item) => Number(item)),
      images: productForm.images
        .filter((image) => image.src.trim())
        .map((image) => ({
          src: image.src,
          thumbnail: image.thumbnail,
          alt: image.alt
        }))
    };

    try {
      const url = productForm.id ? `/api/admin/products/${productForm.id}` : '/api/admin/products';
      const method = productForm.id ? 'PUT' : 'POST';
      const data = await requestJson(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (productForm.id) {
        setProducts((current) => current.map((product) => (product.id === data.product.id ? data.product : product)));
      } else {
        setProducts((current) => [data.product, ...current]);
      }

      setProductForm(productToForm(data.product));
      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function handleDeleteProduct(id) {
    if (!window.confirm('Bạn có chắc muốn xóa sản phẩm này?')) {
      return;
    }

    setFeedback('');

    try {
      const data = await requestJson(`/api/admin/products/${id}`, {
        method: 'DELETE'
      });

      setProducts((current) => current.filter((product) => product.id !== id));

      if (productForm.id === id) {
        resetProductForm();
      }

      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    }
  }

  function handlePricingFieldChange(field, value) {
    setPricingForm((current) => {
      return {
        ...current,
        [field]: value
      };
    });
  }

  function handleRecruitmentFieldChange(field, value) {
    setRecruitmentForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSavePricing(event) {
    event.preventDefault();
    setIsSavingPricing(true);
    setFeedback('');

    const payload = {
      ...pricingForm,
      id: pricingForm._originalId || slugify(pricingForm.name),
      unitPrice: Number(pricingForm.unitPrice)
    };

    try {
      const currentCode = pricingForm._originalId || pricingForm.id || slugify(pricingForm.name);
      const method = pricingForm._originalId ? 'PUT' : 'POST';
      const url = pricingForm._originalId ? `/api/admin/pricing-options/${pricingForm._originalId}` : '/api/admin/pricing-options';
      const data = await requestJson(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (pricingForm._originalId) {
        setPricingOptions((current) =>
          current.map((item) => (item.id === currentCode ? data.pricingOption : item))
        );
      } else {
        setPricingOptions((current) => [data.pricingOption, ...current]);
      }

      setPricingForm({
        ...pricingToForm(data.pricingOption),
        _originalId: data.pricingOption.id
      });
      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsSavingPricing(false);
    }
  }

  async function handleDeletePricing(code) {
    if (!window.confirm('Bạn có chắc muốn xóa mục giá này?')) {
      return;
    }

    setFeedback('');

    try {
      const data = await requestJson(`/api/admin/pricing-options/${code}`, {
        method: 'DELETE'
      });

      setPricingOptions((current) => current.filter((item) => item.id !== code));

      if ((pricingForm._originalId || pricingForm.id) === code) {
        resetPricingForm();
      }

      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    }
  }

  function beginEditPricing(option) {
    setActivePanel('pricing');
    setPricingForm({
      ...pricingToForm(option),
      _originalId: option.id
    });
    setFeedback('');
  }

  async function handleSaveBanners(event) {
    event.preventDefault();

    if (bannerForm.some((image) => image.isUploading)) {
      setFeedback('Chờ ảnh banner tải lên xong rồi hãy lưu.');
      return;
    }

    setIsSavingBanners(true);
    setFeedback('');

    const payload = {
      items: bannerForm
        .filter((image) => image.src.trim())
        .map((image) => ({
          src: image.src,
          thumbnail: image.thumbnail,
          alt: image.alt
        }))
    };

    try {
      const data = await requestJson('/api/admin/showcase-banners', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      setHasBannerConfig(true);
      setShowcaseBanners(data.banners);
      setBannerForm(bannersToForm(data.banners));
      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsSavingBanners(false);
    }
  }

  async function handleSaveRecruitment(event) {
    event.preventDefault();
    setIsSavingRecruitment(true);
    setFeedback('');

    const payload = {
      title: recruitmentForm.title,
      link: recruitmentForm.link || '/tuyen-dung',
      excerpt: recruitmentForm.excerpt,
      content: recruitmentPlainTextToHtml(recruitmentForm.content),
      isPublished: recruitmentForm.isPublished
    };

    try {
      const data = await requestJson('/api/admin/pages/tuyen-dung', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      setPages((current) => {
        const others = current.filter((page) => page.slug !== 'tuyen-dung');
        return [data.page, ...others];
      });
      setRecruitmentForm(pageToForm(data.page));
      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsSavingRecruitment(false);
    }
  }

  async function handleToggleRecruitmentVisibility() {
    const recruitmentPage = pages.find((page) => page.slug === 'tuyen-dung') || null;

    if (!recruitmentPage) {
      setFeedback('Chưa tìm thấy trang tuyển dụng để cập nhật trạng thái.');
      return;
    }

    setIsTogglingRecruitmentVisibility(true);
    setFeedback('');

    try {
      const data = await requestJson('/api/admin/pages/tuyen-dung/visibility', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isPublished: !recruitmentPage.isPublished
        })
      });

      setPages((current) => current.map((page) => (page.slug === 'tuyen-dung' ? data.page : page)));
      setRecruitmentForm((current) => ({
        ...current,
        isPublished: data.page.isPublished
      }));
      setFeedback(data.message);
    } catch (error) {
      handleAdminRequestError(error, onUnauthorized, setFeedback);
    } finally {
      setIsTogglingRecruitmentVisibility(false);
    }
  }

  if (isLoading) {
    return (
      <main className="admin-shell">
        <section className="admin-hero">
          <p>Đang tải dữ liệu quản trị...</p>
        </section>
      </main>
    );
  }

  const recruitmentPage = pages.find((page) => page.slug === 'tuyen-dung') || null;
  const isRecruitmentPublished = recruitmentPage?.isPublished ?? recruitmentForm.isPublished;
  const showcaseBannerCount = showcaseBanners.length;

  return (
    <main className="admin-shell">
      <section className="admin-hero">
        <div className="admin-hero__copy">
          <span className="admin-eyebrow">Quản trị</span>
          <h1>Quản lý sản phẩm, giá in, banner và tuyển dụng</h1>
          <p>Cập nhật toàn bộ dữ liệu đang hiển thị trên website, bao gồm sản phẩm, bảng giá tham khảo, banner trang chủ và nội dung tuyển dụng.</p>
        </div>

        <div className="admin-hero__actions">
          <span className="admin-auth-status">Đăng nhập: {authUsername}</span>
          <Link className="secondary-link" to="/">
            Xem website
          </Link>
          <button className="primary-link admin-plain-button" type="button" onClick={loadAdminData}>
            Tải lại dữ liệu
          </button>
          <button className="secondary-link admin-plain-button" type="button" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      </section>

      <section className="admin-summary-grid">
        <article className="admin-stat">
          <span>Sản phẩm</span>
          <strong>{products.length}</strong>
          <small>Dữ liệu đang có trong MySQL</small>
        </article>
        <article className="admin-stat">
          <span>Danh mục</span>
          <strong>{categories.length}</strong>
          <small>Dùng để gán cho sản phẩm</small>
        </article>
        <article className="admin-stat">
          <span>Giá in</span>
          <strong>{pricingOptions.length}</strong>
          <small>Tính tiền trên trang công khai</small>
        </article>
        <article className="admin-stat">
          <span>Tuyển dụng</span>
          <strong>{pages.some((page) => page.slug === 'tuyen-dung') ? 'Đã có' : 'Chưa có'}</strong>
          <small>Trang tuyển dụng công khai</small>
        </article>
        <article className="admin-stat">
          <span>Banner</span>
          <strong>{hasBannerConfig ? showcaseBannerCount : 'Mặc định'}</strong>
          <small>{hasBannerConfig ? 'Banner đang quản lý trong admin' : 'Website đang dùng banner từ code'}</small>
        </article>
      </section>

      {feedback ? <div className="admin-feedback">{feedback}</div> : null}

      <section className="admin-tabs">
        <button
          className={activePanel === 'products' ? 'is-active' : ''}
          type="button"
          onClick={() => setActivePanel('products')}
        >
          Sản phẩm
        </button>
        <button
          className={activePanel === 'pricing' ? 'is-active' : ''}
          type="button"
          onClick={() => setActivePanel('pricing')}
        >
          Giá in
        </button>
        <button
          className={activePanel === 'recruitment' ? 'is-active' : ''}
          type="button"
          onClick={() => setActivePanel('recruitment')}
        >
          Tuyển dụng
        </button>
        <button
          className={activePanel === 'banners' ? 'is-active' : ''}
          type="button"
          onClick={() => setActivePanel('banners')}
        >
          Banner
        </button>
      </section>

      {activePanel === 'products' ? (
        <section className="admin-grid">
          <aside className="admin-list-card">
            <div className="admin-card__header">
              <div>
                <span>Danh sách</span>
                <h2>Sản phẩm</h2>
              </div>
              <button className="primary-link admin-plain-button" type="button" onClick={resetProductForm}>
                Thêm mới
              </button>
            </div>

            <div className="admin-list">
              {products.map((product) => (
                <article className="admin-list-item" key={product.id}>
                  <button className="admin-list-item__main" type="button" onClick={() => selectProduct(product)}>
                    <strong>{product.name}</strong>
                    <span>{product.slug}</span>
                  </button>
                  <button className="admin-list-item__delete" type="button" onClick={() => handleDeleteProduct(product.id)}>
                    Xóa
                  </button>
                </article>
              ))}
            </div>
          </aside>

          <section className="admin-form-card">
            <div className="admin-card__header">
              <div>
                <span>Biên tập</span>
                <h2>{productForm.id ? `Sửa sản phẩm #${productForm.id}` : 'Thêm sản phẩm mới'}</h2>
              </div>
            </div>

            <form className="admin-form" onSubmit={handleSaveProduct}>
              <label>
                Tên sản phẩm
                <input value={productForm.name} onChange={(event) => handleProductFieldChange('name', event.target.value)} />
              </label>

              <label>
                Mô tả tóm tắt
                <textarea rows="3" value={productForm.summary} onChange={(event) => handleProductFieldChange('summary', event.target.value)} />
              </label>

              <div className="admin-form__split admin-form__split--categories">
                <label className="admin-field admin-field--primary-category">
                  Danh mục chính
                  <select
                    value={productForm.primaryCategoryId}
                    onChange={(event) => handleProductFieldChange('primaryCategoryId', event.target.value)}
                  >
                    <option value="">Chọn danh mục</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="admin-category-box">
                  <span>Gán danh mục</span>
                  <div className="admin-category-list">
                    {categories.map((category) => (
                      <label key={category.id}>
                        <input
                          checked={productForm.categoryIds.includes(String(category.id))}
                          type="checkbox"
                          onChange={() => toggleCategory(String(category.id))}
                        />
                        <span>{category.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="admin-subsection">
                <div className="admin-card__header">
                  <div>
                    <span>Hình ảnh</span>
                    <h3>Ảnh sản phẩm</h3>
                  </div>
                  <button className="secondary-link admin-plain-button" type="button" onClick={addImage}>
                    Thêm ảnh
                  </button>
                </div>

                <div className="admin-image-grid">
                  {productForm.images.map((image, index) => (
                    <article className="admin-image-card" key={`${image.src}-${index}`}>
                      <div
                        className={`admin-upload-zone ${draggingImageIndex === index ? 'is-drag-over' : ''} ${image.src ? 'has-image' : ''}`}
                        onDragEnter={() => setDraggingImageIndex(index)}
                        onDragLeave={() => setDraggingImageIndex((current) => (current === index ? null : current))}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDraggingImageIndex(index);
                        }}
                        onDrop={(event) => handleImageDrop(index, event)}
                      >
                        <input
                          ref={(element) => {
                            imageInputRefs.current[index] = element;
                          }}
                          accept="image/*"
                          className="admin-upload-input"
                          type="file"
                          onChange={(event) => handleImageInputChange(index, event)}
                        />

                        {image.src ? (
                          <div className="admin-upload-zone__preview">
                            <img src={resolveMediaUrl(image.thumbnail || image.src)} alt={image.alt || `Ảnh sản phẩm ${index + 1}`} />
                          </div>
                        ) : (
                          <div className="admin-upload-zone__placeholder">
                            <strong>Kéo thả ảnh vào đây</strong>
                            <span>Hoặc chọn ảnh từ máy tính để tải lên hệ thống.</span>
                          </div>
                        )}

                        <div className="admin-upload-zone__actions">
                          <button className="secondary-link admin-plain-button" type="button" onClick={() => openImagePicker(index)}>
                            {image.src ? 'Thay ảnh' : 'Chọn ảnh'}
                          </button>
                          <small>Hỗ trợ JPG, PNG, WEBP. Tối đa 10MB.</small>
                        </div>
                      </div>

                      {image.isUploading ? <p className="admin-image-status">Đang tải ảnh lên...</p> : null}
                      {image.uploadError ? <p className="admin-image-status is-error">{image.uploadError}</p> : null}

                      <label>
                        Mô tả ảnh
                        <input value={image.alt} onChange={(event) => updateImage(index, 'alt', event.target.value)} />
                      </label>
                      <button className="admin-text-button" disabled={image.isUploading} type="button" onClick={() => removeImage(index)}>
                        Xóa ảnh này
                      </button>
                    </article>
                  ))}
                </div>
              </div>

              <div className="admin-form__actions">
                <button className="primary-link admin-plain-button" disabled={isSavingProduct || productForm.images.some((image) => image.isUploading)} type="submit">
                  {isSavingProduct
                    ? 'Đang lưu...'
                    : productForm.images.some((image) => image.isUploading)
                      ? 'Đang tải ảnh...'
                      : productForm.id
                        ? 'Cập nhật sản phẩm'
                        : 'Tạo sản phẩm'}
                </button>
                <button className="secondary-link admin-plain-button" type="button" onClick={resetProductForm}>
                  Làm mới form
                </button>
              </div>
            </form>
          </section>
        </section>
      ) : activePanel === 'pricing' ? (
        <section className="admin-grid admin-grid--pricing">
          <aside className="admin-list-card">
            <div className="admin-card__header">
              <div>
                <span>Bảng giá</span>
                <h2>Giá in</h2>
              </div>
              <button className="primary-link admin-plain-button" type="button" onClick={resetPricingForm}>
                Thêm mục giá
              </button>
            </div>

            <div className="admin-list">
              {pricingOptions.map((option) => (
                <article className="admin-list-item" key={option.id}>
                  <button className="admin-list-item__main" type="button" onClick={() => beginEditPricing(option)}>
                    <strong>{option.name}</strong>
                    <span>
                      {formatCurrency(option.unitPrice)} / {option.unitLabel}
                    </span>
                  </button>
                  <button className="admin-list-item__delete" type="button" onClick={() => handleDeletePricing(option.id)}>
                    Xóa
                  </button>
                </article>
              ))}
            </div>
          </aside>

          <section className="admin-form-card">
            <div className="admin-card__header">
              <div>
                <span>Trình chỉnh sửa</span>
                <h2>{pricingForm._originalId ? 'S\u1eeda gi\u00e1 in' : 'Th\u00eam gi\u00e1 in m\u1edbi'}</h2>
              </div>
            </div>

            <form className="admin-form" onSubmit={handleSavePricing}>
              <label>
                {'T\u00ean hi\u1ec3n th\u1ecb'}
                <input value={pricingForm.name} onChange={(event) => handlePricingFieldChange('name', event.target.value)} />
              </label>

              <div className="admin-form__split">
                <label>
                  Đơn giá
                  <input
                    min="1"
                    step="1"
                    type="number"
                    value={pricingForm.unitPrice}
                    onChange={(event) => handlePricingFieldChange('unitPrice', event.target.value)}
                  />
                </label>

                <label>
                  Đơn vị
                  <input value={pricingForm.unitLabel} onChange={(event) => handlePricingFieldChange('unitLabel', event.target.value)} />
                </label>
              </div>

              <label>
                Thời gian hoàn thành
                <input value={pricingForm.turnaround} onChange={(event) => handlePricingFieldChange('turnaround', event.target.value)} />
              </label>

              <div className="admin-pricing-preview">
                <small>Xem nhanh</small>
                <strong>{pricingForm.name || 'Chưa đặt tên'}</strong>
                <span>
                  {pricingForm.unitPrice ? formatCurrency(pricingForm.unitPrice) : '--'} / {pricingForm.unitLabel || '--'}
                </span>
                <p>{pricingForm.turnaround || 'Chưa có thời gian dự kiến.'}</p>
              </div>

              <div className="admin-form__actions">
                <button className="primary-link admin-plain-button" disabled={isSavingPricing} type="submit">
                  {isSavingPricing ? 'Đang lưu...' : pricingForm._originalId ? 'Cập nhật giá in' : 'Tạo giá in'}
                </button>
                <button className="secondary-link admin-plain-button" type="button" onClick={resetPricingForm}>
                  Làm mới form
                </button>
              </div>
            </form>
          </section>
        </section>
      ) : activePanel === 'banners' ? (
        <section className="admin-grid admin-grid--content">
          <aside className="admin-list-card">
            <div className="admin-card__header">
              <div>
                <span>Hình ảnh</span>
                <h2>Banner trang chủ</h2>
              </div>
              <button className="primary-link admin-plain-button" type="button" onClick={resetBannerForm}>
                Làm mới
              </button>
            </div>

            <div className="admin-list">
              <article className="admin-list-item admin-list-item--stacked">
                <button className="admin-list-item__main" type="button" onClick={() => setActivePanel('banners')}>
                  <strong>{showcaseBannerCount ? `${showcaseBannerCount} banner đang dùng` : 'Chưa có banner riêng'}</strong>
                  <span>Hiển thị phía trên mục Điểm mạnh hiện tại</span>
                </button>
                <p className="admin-list-item__note">
                  Banner lưu trong admin sẽ ghi đè toàn bộ slider ở trang chủ. Nếu chưa cấu hình trong admin, website vẫn dùng banner mặc định đang có trên code.
                </p>
                <div className="admin-list-item__meta">
                  <span
                    className={`admin-status-chip ${
                      showcaseBannerCount ? 'is-live' : hasBannerConfig ? 'is-hidden' : 'is-live'
                    }`}
                  >
                    {showcaseBannerCount
                      ? 'Đang hiển thị banner admin'
                      : hasBannerConfig
                        ? 'Đang ẩn banner trang chủ'
                        : 'Đang dùng banner mặc định'}
                  </span>
                  <button className="admin-text-button" type="button" onClick={addBannerImage}>
                    Thêm banner
                  </button>
                </div>
              </article>
            </div>
          </aside>

          <section className="admin-form-card">
            <div className="admin-card__header">
              <div>
                <span>Biên tập</span>
                <h2>Slider banner</h2>
              </div>
              <a className="secondary-link" href="/">
                Mở trang chủ
              </a>
            </div>

            <form className="admin-form" onSubmit={handleSaveBanners}>
              <div className="admin-subsection">
                <div className="admin-card__header">
                  <div>
                    <span>Hình ảnh</span>
                    <h3>Danh sách banner</h3>
                  </div>
                  <button className="secondary-link admin-plain-button" type="button" onClick={addBannerImage}>
                    Thêm banner
                  </button>
                </div>

                <p className="admin-list-item__note">
                  Kéo thả hoặc chọn ảnh để tải lên. Thứ tự trong danh sách là thứ tự xoay banner; xóa hết rồi lưu sẽ ẩn banner khỏi trang chủ.
                </p>

                <div className="admin-image-grid">
                  {bannerForm.map((image, index) => (
                    <article className="admin-image-card" key={`${image.src || 'banner'}-${index}`}>
                      <div
                        className={`admin-upload-zone ${draggingBannerIndex === index ? 'is-drag-over' : ''} ${image.src ? 'has-image' : ''}`}
                        onDragEnter={() => setDraggingBannerIndex(index)}
                        onDragLeave={() => setDraggingBannerIndex((current) => (current === index ? null : current))}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDraggingBannerIndex(index);
                        }}
                        onDrop={(event) => handleBannerImageDrop(index, event)}
                      >
                        <input
                          ref={(element) => {
                            bannerInputRefs.current[index] = element;
                          }}
                          accept="image/*"
                          className="admin-upload-input"
                          type="file"
                          onChange={(event) => handleBannerImageInputChange(index, event)}
                        />

                        {image.src ? (
                          <div className="admin-upload-zone__preview">
                            <img src={resolveMediaUrl(image.thumbnail || image.src)} alt={image.alt || `Banner ${index + 1}`} />
                          </div>
                        ) : (
                          <div className="admin-upload-zone__placeholder">
                            <strong>Kéo thả banner vào đây</strong>
                            <span>Hoặc chọn ảnh từ máy tính để tải lên hệ thống.</span>
                          </div>
                        )}

                        <div className="admin-upload-zone__actions">
                          <button className="secondary-link admin-plain-button" type="button" onClick={() => openBannerImagePicker(index)}>
                            {image.src ? 'Thay ảnh' : 'Chọn ảnh'}
                          </button>
                          <small>Hỗ trợ JPG, PNG, WEBP. Tối đa 10MB.</small>
                        </div>
                      </div>

                      {image.isUploading ? <p className="admin-image-status">Đang tải ảnh lên...</p> : null}
                      {image.uploadError ? <p className="admin-image-status is-error">{image.uploadError}</p> : null}

                      <label>
                        Mô tả ảnh
                        <input value={image.alt} placeholder={`Banner ${index + 1}`} onChange={(event) => updateBannerImage(index, 'alt', event.target.value)} />
                      </label>
                      <button className="admin-text-button" disabled={image.isUploading} type="button" onClick={() => removeBannerImage(index)}>
                        Xóa banner này
                      </button>
                    </article>
                  ))}
                </div>
              </div>

              <div className="admin-form__actions">
                <button className="primary-link admin-plain-button" disabled={isSavingBanners || bannerForm.some((image) => image.isUploading)} type="submit">
                  {isSavingBanners
                    ? 'Đang lưu...'
                    : bannerForm.some((image) => image.isUploading)
                      ? 'Đang tải ảnh...'
                      : 'Cập nhật banner'}
                </button>
                <button className="secondary-link admin-plain-button" type="button" onClick={resetBannerForm}>
                  Khôi phục dữ liệu
                </button>
              </div>
            </form>
          </section>
        </section>
      ) : (
        <section className="admin-grid admin-grid--content">
          <aside className="admin-list-card">
            <div className="admin-card__header">
              <div>
                <span>Nội dung</span>
                <h2>Tuyển dụng</h2>
              </div>
              <button className="primary-link admin-plain-button" type="button" onClick={resetRecruitmentForm}>
                Làm mới
              </button>
            </div>

            <div className="admin-list">
              <article className="admin-list-item admin-list-item--stacked">
                <button className="admin-list-item__main" type="button" onClick={() => setActivePanel('recruitment')}>
                  <strong>{recruitmentForm.title || 'Tuyển dụng'}</strong>
                  <span>/tuyen-dung</span>
                </button>
                <p className="admin-list-item__note">
                  Đây là trang công khai để đăng nhu cầu tuyển dụng, quyền lợi và cách ứng tuyển.
                </p>
                <div className="admin-list-item__meta">
                  <span className={`admin-status-chip ${isRecruitmentPublished ? 'is-live' : 'is-hidden'}`}>
                    {isRecruitmentPublished ? 'Đang hiển thị' : 'Đang ẩn'}
                  </span>
                  <button
                    className="admin-text-button"
                    disabled={isTogglingRecruitmentVisibility || !recruitmentPage}
                    type="button"
                    onClick={handleToggleRecruitmentVisibility}
                  >
                    {isTogglingRecruitmentVisibility ? 'Đang cập nhật...' : isRecruitmentPublished ? 'Ẩn bài tuyển dụng' : 'Hiện bài tuyển dụng'}
                  </button>
                </div>
              </article>
            </div>
          </aside>

          <section className="admin-form-card">
            <div className="admin-card__header">
              <div>
                <span>Biên tập</span>
                <h2>Trang tuyển dụng</h2>
              </div>
              <a className="secondary-link" href="/tuyen-dung">
                Mở trang tuyển dụng
              </a>
            </div>

            <form className="admin-form" onSubmit={handleSaveRecruitment}>
              <label>
                Tiêu đề trang
                <input value={recruitmentForm.title} onChange={(event) => handleRecruitmentFieldChange('title', event.target.value)} />
              </label>

              <label>
                Mô tả ngắn
                <textarea
                  rows="3"
                  value={recruitmentForm.excerpt}
                  onChange={(event) => handleRecruitmentFieldChange('excerpt', event.target.value)}
                />
              </label>

              <label>
                Nội dung tuyển dụng
                <small>Nhập như văn bản thường. Dòng bắt đầu bằng `-` sẽ thành gạch đầu dòng; mỗi mục cách nhau một dòng trống.</small>
                <textarea
                  className="admin-textarea admin-textarea--rich"
                  rows="16"
                  value={recruitmentForm.content}
                  onChange={(event) => handleRecruitmentFieldChange('content', event.target.value)}
                  placeholder={`Vị trí đang nhận hồ sơ\n- Nhân viên kinh doanh dịch vụ in ấn\n- Nhân viên thiết kế - chế bản\n\nYêu cầu chung\n- Tác phong làm việc nghiêm túc\n\nCách ứng tuyển\nGửi CV qua email hoặc hotline để được hướng dẫn.`}
                />
              </label>

              <div className="admin-subsection admin-subsection--preview">
                <div className="admin-card__header">
                  <div>
                    <span>Xem trước</span>
                    <h3>{recruitmentForm.title || 'Tuyển dụng'}</h3>
                  </div>
                </div>

                {recruitmentForm.excerpt ? <p className="admin-page-excerpt">{recruitmentForm.excerpt}</p> : null}

                <div
                  className="admin-page-preview rich-text"
                  dangerouslySetInnerHTML={{
                    __html: recruitmentPlainTextToHtml(recruitmentForm.content) || '<p>Chưa có nội dung tuyển dụng để hiển thị.</p>'
                  }}
                />
              </div>

              <div className="admin-form__actions">
                <button className="primary-link admin-plain-button" disabled={isSavingRecruitment} type="submit">
                  {isSavingRecruitment ? 'Đang lưu...' : 'Cập nhật tuyển dụng'}
                </button>
                <button className="secondary-link admin-plain-button" type="button" onClick={resetRecruitmentForm}>
                  Khôi phục dữ liệu
                </button>
              </div>
            </form>
          </section>
        </section>
      )}
    </main>
  );
}

function AdminLoginScreen({ form, feedback, isSubmitting, onFieldChange, onSubmit }) {
  return (
    <main className="admin-shell admin-auth-shell">
      <section className="admin-auth-card">
        <div className="admin-hero__copy">
          <span className="admin-eyebrow">Đăng nhập quản trị</span>
          <h1>Truy cập khu vực admin</h1>
          <p>Đăng nhập để quản lý sản phẩm, giá in, banner và nội dung tuyển dụng hiển thị trên website.</p>
        </div>

        {feedback ? <div className="admin-auth-feedback">{feedback}</div> : null}

        <form className="admin-form admin-auth-form" onSubmit={onSubmit}>
          <label>
            Tên đăng nhập
            <input
              autoComplete="username"
              value={form.username}
              onChange={(event) => onFieldChange('username', event.target.value)}
            />
          </label>

          <label>
            Mật khẩu
            <input
              autoComplete="current-password"
              type="password"
              value={form.password}
              onChange={(event) => onFieldChange('password', event.target.value)}
            />
          </label>

          <div className="admin-form__actions">
            <button className="primary-link admin-plain-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
            <Link className="secondary-link" to="/">
              Về trang chủ
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}

export default function AdminPage() {
  const [authStatus, setAuthStatus] = useState('checking');
  const [authUsername, setAuthUsername] = useState('');
  const [loginForm, setLoginForm] = useState(createEmptyLoginForm);
  const [authFeedback, setAuthFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    setAuthStatus('checking');
    setAuthFeedback('');

    try {
      const data = await requestJson('/api/admin/auth/session');

      if (data.authenticated) {
        setAuthUsername(data.username || '');
        setLoginForm((current) => ({
          ...current,
          username: data.username || current.username,
          password: ''
        }));
        setAuthStatus('authenticated');
        return;
      }

      setAuthUsername('');
      setLoginForm((current) => ({
        ...current,
        password: ''
      }));
      setAuthStatus('unauthenticated');
    } catch (error) {
      setAuthUsername('');
      setAuthFeedback(error.message);
      setAuthStatus('unauthenticated');
    }
  }

  function handleLoginFieldChange(field, value) {
    setLoginForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setAuthFeedback('');

    try {
      const data = await requestJson('/api/admin/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loginForm)
      });

      setAuthUsername(data.username || loginForm.username.trim());
      setLoginForm((current) => ({
        ...current,
        password: ''
      }));
      setAuthStatus('authenticated');
    } catch (error) {
      setAuthFeedback(error.message);
      setAuthStatus('unauthenticated');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await requestJson('/api/admin/auth/logout', {
        method: 'POST'
      });
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setAuthFeedback(error.message);
      }
    } finally {
      setAuthUsername('');
      setLoginForm((current) => ({
        ...current,
        password: ''
      }));
      setAuthStatus('unauthenticated');
      setAuthFeedback('Đã đăng xuất khỏi khu vực quản trị.');
    }
  }

  function handleUnauthorized() {
    setAuthUsername('');
    setLoginForm((current) => ({
      ...current,
      password: ''
    }));
    setAuthStatus('unauthenticated');
    setAuthFeedback('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }

  if (authStatus === 'checking') {
    return (
      <main className="admin-shell">
        <section className="admin-hero">
          <p>Đang kiểm tra phiên đăng nhập quản trị...</p>
        </section>
      </main>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <AdminLoginScreen
        feedback={authFeedback}
        form={loginForm}
        isSubmitting={isSubmitting}
        onFieldChange={handleLoginFieldChange}
        onSubmit={handleLoginSubmit}
      />
    );
  }

  return <AdminConsole authUsername={authUsername} onLogout={handleLogout} onUnauthorized={handleUnauthorized} />;
}
