const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const SUPPORT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const SUPPORT_RATE_LIMIT_MAX_REQUESTS = 12;
const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 1000;

const supportRateLimitStore = new Map();

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value, maxLength = 180) {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function formatCurrencyVnd(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function getSupportChatConfig() {
  return {
    apiKey: normalizeText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    model: normalizeText(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL
  };
}

function sanitizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .map((message) => ({
      role: message?.role === 'bot' ? 'model' : message?.role === 'user' ? 'user' : '',
      text: truncateText(message?.text, MAX_MESSAGE_LENGTH)
    }))
    .filter((message) => message.role && message.text)
    .slice(-MAX_HISTORY_MESSAGES);
}

function extractReplyText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => normalizeText(part?.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getClientIpAddress(req) {
  const forwardedFor = normalizeText(req.headers['x-forwarded-for']);

  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return normalizeText(req.ip) || 'unknown';
}

export function validateSupportChatPayload(payload) {
  const message = truncateText(payload?.message, MAX_MESSAGE_LENGTH);
  const history = sanitizeHistory(payload?.history);
  const errors = [];

  if (!message) {
    errors.push('Missing chat message.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    value: {
      message,
      history
    }
  };
}

export function enforceSupportChatRateLimit(req) {
  const now = Date.now();
  const ipAddress = getClientIpAddress(req);
  const requests = (supportRateLimitStore.get(ipAddress) || []).filter(
    (timestamp) => now - timestamp < SUPPORT_RATE_LIMIT_WINDOW_MS
  );

  if (requests.length >= SUPPORT_RATE_LIMIT_MAX_REQUESTS) {
    const error = new Error('Support chat is temporarily rate limited.');
    error.statusCode = 429;
    throw error;
  }

  requests.push(now);
  supportRateLimitStore.set(ipAddress, requests);
}

function buildProductSummary(product) {
  const categories = (Array.isArray(product?.categories) ? product.categories : [])
    .map((category) => normalizeText(category?.name))
    .filter(Boolean)
    .join(', ');

  if (!categories) {
    return `- ${product.name}`;
  }

  return `- ${product.name} | Danh muc: ${categories}`;
}

function buildPricingSummary(option) {
  return `- ${option.name}: ${formatCurrencyVnd(option.unitPrice)} / ${option.unitLabel}; thoi gian ${option.turnaround}`;
}

function buildPageSummary(page) {
  return `- ${page.title} (${page.slug}): ${truncateText(page.excerpt || page.plainText, 180)}`;
}

function buildSupportKnowledgeBase(bootstrapData) {
  const company = bootstrapData.company ?? {};
  const contact = company.contact ?? {};
  const highlights = Array.isArray(company.highlights) ? company.highlights.filter(Boolean) : [];
  const categories = Array.isArray(bootstrapData.categories) ? bootstrapData.categories : [];
  const products = Array.isArray(bootstrapData.products) ? bootstrapData.products : [];
  const pricingOptions = Array.isArray(bootstrapData.pricingOptions) ? bootstrapData.pricingOptions : [];
  const pages = Array.isArray(bootstrapData.pages) ? bootstrapData.pages.filter((page) => page.slug && page.slug !== 'trang-chu') : [];

  const lines = [
    `Cong ty: ${normalizeText(company.name)}`,
    `Gioi thieu: ${normalizeText(company.headline)}`,
    `Nam thanh lap: ${normalizeText(company.foundedYear) || 'Khong ro'}`,
    `Hotline: ${normalizeText(contact.phone)}`,
    `Email: ${normalizeText(contact.email)}`,
    `Zalo: ${normalizeText(contact.zalo)}`,
    `Tru so: ${normalizeText(contact.office)}`,
    `Xuong: ${normalizeText(contact.workshop)}`,
    `Ghi chu giao hang: ${normalizeText(contact.deliveryNote)}`
  ];

  if (highlights.length) {
    lines.push(`Diem manh: ${highlights.join(', ')}`);
  }

  if (categories.length) {
    lines.push(`Danh muc: ${categories.map((category) => category.name).join(', ')}`);
  }

  if (pricingOptions.length) {
    lines.push('Bang gia tham khao:');
    lines.push(...pricingOptions.map(buildPricingSummary));
  }

  if (products.length) {
    lines.push('San pham hien co tren website:');
    lines.push(...products.map(buildProductSummary));
  }

  if (pages.length) {
    lines.push('Trang thong tin huu ich:');
    lines.push(...pages.map(buildPageSummary));
  }

  return lines.join('\n');
}

function buildSystemInstruction(knowledgeBase) {
  return [
    'You are the Vietnamese sales assistant for In nhanh - Gia re Tuan Thinh.',
    'Always reply in Vietnamese.',
    'Be concise, practical, and business-focused.',
    'Only use the verified business context below and the current conversation.',
    'Do not invent prices, addresses, lead times, materials, or policies.',
    'If the user wants an exact quote, ask for quantity, size, material, finish, and deadline.',
    'If the answer is not confirmed by the business context, say that you do not have enough confirmed data and direct the user to hotline, email, or Zalo.',
    'If the user asks about topics unrelated to the printing business, politely steer the conversation back to printing products and ordering support.',
    '',
    'Business context:',
    knowledgeBase
  ].join('\n');
}

async function callGeminiApi({ apiKey, model, message, history, systemInstruction }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          ...history.map((item) => ({
            role: item.role,
            parts: [{ text: item.text }]
          })),
          {
            role: 'user',
            parts: [{ text: message }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 400
        }
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const apiMessage =
        normalizeText(data?.error?.message) ||
        normalizeText(data?.message) ||
        `Gemini API request failed with status ${response.status}.`;
      const error = new Error(apiMessage);
      error.statusCode = response.status >= 400 && response.status < 500 ? 502 : 503;
      throw error;
    }

    const reply = extractReplyText(data);

    if (!reply) {
      const error = new Error('Gemini API returned an empty response.');
      error.statusCode = 502;
      throw error;
    }

    return reply;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateSupportChatReply(bootstrapData, payload) {
  const { apiKey, model } = getSupportChatConfig();

  if (!apiKey) {
    const error = new Error('Support chat AI is not configured.');
    error.statusCode = 503;
    throw error;
  }

  const knowledgeBase = buildSupportKnowledgeBase(bootstrapData ?? {});

  return callGeminiApi({
    apiKey,
    model,
    message: payload.message,
    history: payload.history,
    systemInstruction: buildSystemInstruction(knowledgeBase)
  });
}
