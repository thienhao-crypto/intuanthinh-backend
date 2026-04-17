import { useEffect, useRef, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from 'react-router-dom';
import siteData from './data/siteDataRuntime';
import acecookLogo from './assets/partners/acecook.svg';
import riversideLogo from './assets/partners/riverside.png';
import lgLogo from './assets/partners/lg.svg';
import saigonbankLogo from './assets/partners/saigonbank.jpg';
import vnptLogo from './assets/partners/vnpt.png';
import mobifoneLogo from './assets/partners/mobifone.png';
import vietcombankLogo from './assets/partners/vietcombank.png';
import bannerOne from './assets/partners/banner (1).jpg';
import bannerTwo from './assets/partners/banner (2).jpg';
import companyLogo from './assets/partners/logo-cty-cropped.png';
import maintenanceImage from './assets/partners/anhbaotri.png';
import AdminPage from './admin/AdminPage';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const fanpageUrl = 'https://www.facebook.com/profile.php?id=61573351719593';
const siteLabel = 'In nhanh - Giá rẻ Tuấn Thịnh';
const company = siteData.company;
const topCategories = siteData.categories.filter((category) => category.parent === 0);
const pagesBySlug = Object.fromEntries(siteData.pages.map((page) => [page.slug, page]));
const recruitmentPage = pagesBySlug['tuyen-dung'] || null;
const productsBySlug = Object.fromEntries(siteData.products.map((product) => [product.slug, product]));
const categoryBySlug = Object.fromEntries(siteData.categories.map((category) => [category.slug, category]));
const heroBackgroundImages = [...new Set(siteData.products.flatMap((product) => (product.images || []).map((image) => image?.src).filter(Boolean)))].slice(0, 6);
const partnerLogos = [
  { name: 'Acecook Việt Nam', logo: acecookLogo },
  { name: 'Khách sạn Sài Gòn Riverside', logo: riversideLogo },
  { name: 'LG Electronic Việt Nam', logo: lgLogo },
  { name: 'Ngân hàng TMCP Sài Gòn Công Thương', logo: saigonbankLogo },
  { name: 'VNPT', logo: vnptLogo },
  { name: 'Mobifone', logo: mobifoneLogo },
  { name: 'Vietcombank', logo: vietcombankLogo }
];
const defaultShowcaseBanners = [
  { src: bannerOne, alt: 'Banner giới thiệu dịch vụ in ấn Tuấn Thịnh' },
  { src: bannerTwo, alt: 'Banner giới thiệu xưởng in Tuấn Thịnh' }
];
const showcaseBanners = Array.isArray(siteData.showcaseBanners) ? siteData.showcaseBanners : defaultShowcaseBanners;
const pricingOptions = Array.isArray(siteData.pricingOptions) ? siteData.pricingOptions : [];

function createPricingResult(product, quantity) {
  return {
    productName: product.name,
    quantity,
    total: product.unitPrice * quantity,
    turnaround: product.turnaround,
    unitLabel: product.unitLabel,
    unitPrice: product.unitPrice
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(value);
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripHtmlTags(value) {
  return String(value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
}

function tokenizeSearchText(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter(Boolean);
}

function getUniqueSearchTokens(value, limit = 80) {
  const tokens = [];
  const seen = new Set();

  for (const token of tokenizeSearchText(value)) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    tokens.push(token);

    if (tokens.length >= limit) {
      break;
    }
  }

  return tokens;
}

function getEditDistanceLimit(queryToken, candidateToken) {
  const shortestLength = Math.min(queryToken.length, candidateToken.length);

  if (shortestLength <= 3) {
    return 0;
  }

  if (shortestLength <= 5) {
    return 1;
  }

  return 2;
}

function isSingleTransposition(source, target) {
  if (source.length !== target.length || source.length < 2) {
    return false;
  }

  let firstMismatch = -1;
  let secondMismatch = -1;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === target[index]) {
      continue;
    }

    if (firstMismatch === -1) {
      firstMismatch = index;
      continue;
    }

    if (secondMismatch === -1) {
      secondMismatch = index;
      continue;
    }

    return false;
  }

  return (
    firstMismatch >= 0 &&
    secondMismatch === firstMismatch + 1 &&
    source[firstMismatch] === target[secondMismatch] &&
    source[secondMismatch] === target[firstMismatch]
  );
}

function levenshteinDistance(source, target, maxDistance = Number.POSITIVE_INFINITY) {
  if (source === target) {
    return 0;
  }

  if (!source.length) {
    return target.length;
  }

  if (!target.length) {
    return source.length;
  }

  if (Math.abs(source.length - target.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previousRow = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const currentRow = [sourceIndex];
    let rowMin = currentRow[0];

    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      const nextDistance = Math.min(
        currentRow[targetIndex - 1] + 1,
        previousRow[targetIndex] + 1,
        previousRow[targetIndex - 1] + substitutionCost
      );

      currentRow[targetIndex] = nextDistance;
      rowMin = Math.min(rowMin, nextDistance);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    previousRow = currentRow;
  }

  return previousRow[target.length];
}

function getTokenSimilarityScore(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) {
    return 0;
  }

  if (queryToken === candidateToken) {
    return 1;
  }

  if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
    return 0.94;
  }

  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    return 0.78;
  }

  if (isSingleTransposition(queryToken, candidateToken)) {
    return 0.7;
  }

  const maxDistance = getEditDistanceLimit(queryToken, candidateToken);

  if (!maxDistance) {
    return 0;
  }

  const distance = levenshteinDistance(queryToken, candidateToken, maxDistance);

  if (distance > maxDistance) {
    return 0;
  }

  return distance === 1 ? 0.65 : 0.52;
}

function createProductSearchIndex(product) {
  const name = normalizeSearchText(product?.name);
  const categories = normalizeSearchText((product?.categories || []).map((category) => category?.name).filter(Boolean).join(' '));
  const summary = normalizeSearchText(product?.summary);
  const details = normalizeSearchText(
    [stripHtmlTags(product?.shortDescription), stripHtmlTags(product?.description)]
      .filter(Boolean)
      .join(' ')
  );

  return {
    name,
    categories,
    summary,
    details,
    nameTokens: getUniqueSearchTokens(name, 24),
    categoryTokens: getUniqueSearchTokens(categories, 24),
    summaryTokens: getUniqueSearchTokens(summary, 36),
    detailTokens: getUniqueSearchTokens(details, 80),
    fullText: [name, categories, summary, details].filter(Boolean).join(' ')
  };
}

function scoreProductSearch(product, normalizedQuery, queryTokens) {
  if (!normalizedQuery) {
    return 0;
  }

  const searchIndex = createProductSearchIndex(product);
  let score = 0;

  if (searchIndex.name === normalizedQuery) {
    score += 500;
  } else if (searchIndex.name.startsWith(normalizedQuery)) {
    score += 320;
  } else if (searchIndex.name.includes(normalizedQuery)) {
    score += 220;
  }

  if (searchIndex.categories.includes(normalizedQuery)) {
    score += 120;
  }

  if (searchIndex.summary.includes(normalizedQuery)) {
    score += 80;
  }

  if (queryTokens.length > 1 && searchIndex.fullText.includes(normalizedQuery)) {
    score += 90;
  }

  const matchers = [
    { tokens: searchIndex.nameTokens, weight: 140 },
    { tokens: searchIndex.categoryTokens, weight: 100 },
    { tokens: searchIndex.summaryTokens, weight: 60 },
    { tokens: searchIndex.detailTokens, weight: 32 }
  ];

  for (const token of queryTokens) {
    let bestTokenScore = 0;

    for (const matcher of matchers) {
      for (const candidateToken of matcher.tokens) {
        const similarity = getTokenSimilarityScore(token, candidateToken);

        if (!similarity) {
          continue;
        }

        bestTokenScore = Math.max(bestTokenScore, similarity * matcher.weight);
      }
    }

    if (!bestTokenScore) {
      return 0;
    }

    score += bestTokenScore;
  }

  if (
    queryTokens.length &&
    queryTokens.every((token) => searchIndex.nameTokens.some((candidateToken) => getTokenSimilarityScore(token, candidateToken) >= 0.94))
  ) {
    score += 110;
  }

  score += queryTokens.length * 24;

  return score;
}

function searchProducts(products, query) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return products;
  }

  const queryTokens = tokenizeSearchText(normalizedQuery);

  return products
    .map((product) => ({
      product,
      score: scoreProductSearch(product, normalizedQuery, queryTokens)
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product.name.localeCompare(right.product.name, 'vi', { sensitivity: 'base' })
    )
    .map((item) => item.product);
}

function countProductsForCategory(categorySlug) {
  const category = categoryBySlug[categorySlug];

  if (!category) {
    return 0;
  }

  return getProductsForCategory(category).length;
}

function getChildCategories(parentId) {
  return siteData.categories.filter((category) => category.parent === parentId);
}

function getProductCategoryTrail(product) {
  return product.categories;
}

function getProductsForCategory(category) {
  if (!category) {
    return [];
  }

  const childSlugs = getChildCategories(category.id).map((child) => child.slug);
  const allowedSlugs = new Set([category.slug, ...childSlugs]);

  return siteData.products.filter((product) =>
    product.categories.some((productCategory) => allowedSlugs.has(productCategory.slug))
  );
}

function getPageBySlug(slug) {
  return pagesBySlug[slug];
}

function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    document.title = siteLabel;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);

  return null;
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <img src={companyLogo} alt="" />
    </div>
  );
}

function buildSupportReply(message) {
  const normalized = message.toLowerCase();

  if (normalized.includes('báo giá') || normalized.includes('gia') || normalized.includes('giá')) {
    return `Anh/chị có thể gửi quy cách in, số lượng và thời gian cần hàng. ${siteLabel} sẽ tư vấn và báo giá nhanh qua hotline ${company.contact.phone}.`;
  }

  if (
    normalized.includes('thời gian') ||
    normalized.includes('bao lâu') ||
    normalized.includes('gấp') ||
    normalized.includes('tiến độ')
  ) {
    return 'Thời gian thực hiện phụ thuộc số lượng, kỹ thuật in và mức độ gấp. Anh/chị có thể liên hệ trực tiếp để được tư vấn phương án phù hợp nhất.';
  }

  if (
    normalized.includes('gửi file') ||
    normalized.includes('file') ||
    normalized.includes('thiết kế') ||
    normalized.includes('email')
  ) {
    return `Anh/chị có thể gửi file in và thông tin yêu cầu qua email ${company.contact.email} hoặc nhắn Zalo ${company.contact.zalo}.`;
  }

  if (
    normalized.includes('địa chỉ') ||
    normalized.includes('trụ sở') ||
    normalized.includes('xưởng') ||
    normalized.includes('cửa hàng')
  ) {
    return `Trụ sở: ${company.contact.office}. Xưởng sản xuất: ${company.contact.workshop}.`;
  }

  return `Cảm ơn anh/chị đã liên hệ. ${siteLabel} sẽ hỗ trợ qua hotline ${company.contact.phone} hoặc email ${company.contact.email}.`;
}

async function requestSupportChatReply(message, history) {
  const response = await fetch(`${apiBaseUrl}/api/support-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      history
    })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || 'Support chat request failed.');
  }

  return typeof data?.reply === 'string' ? data.reply.trim() : '';
}

function createSupportChatHistory(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'bot')
    .slice(-10)
    .map((message) => ({
      role: message.role,
      text: message.text
    }));
}

function SupportChatWidget() {
  const quickActions = [
    'Tôi muốn báo giá nhanh',
    'Thời gian hoàn thành bao lâu?',
    'Tôi cần gửi file in',
    'Cho tôi xin địa chỉ'
  ];

  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesContainerRef = useRef(null);
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'bot',
      text: `Xin chào, ${siteLabel} có thể hỗ trợ báo giá, nhận file in và tư vấn đơn hàng cho anh/chị.`
    }
  ]);

  async function pushConversation(text) {
    const trimmed = text.trim();

    if (!trimmed || isSending) {
      return;
    }

    const createdAt = Date.now();
    const pendingReplyId = createdAt + 1;
    const history = createSupportChatHistory(messages);

    setMessages((current) => [
      ...current,
      { id: createdAt, role: 'user', text: trimmed },
      { id: pendingReplyId, role: 'bot', text: '\u0110ang so\u1ea1n tr\u1ea3 l\u1eddi...', isPending: true }
    ]);
    setIsSending(true);

    try {
      const reply = await requestSupportChatReply(trimmed, history);

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingReplyId
            ? {
                id: pendingReplyId,
                role: 'bot',
                text: reply || buildSupportReply(trimmed)
              }
            : message
        )
      );
    } catch (error) {
      console.error('Support chat AI request failed.', error);

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingReplyId
            ? {
                id: pendingReplyId,
                role: 'bot',
                text: buildSupportReply(trimmed)
              }
            : message
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !messagesContainerRef.current) {
      return;
    }

    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [isOpen, messages]);

  function handleSubmit(event) {
    event.preventDefault();
    void pushConversation(draft);
    setDraft('');
    setIsOpen(true);
  }

  function handleQuickAction(text) {
    setIsOpen(true);
    void pushConversation(text);
  }

  return (
    <div className={`chat-widget${isOpen ? ' is-open' : ''}`}>
      {isOpen ? (
        <section className="chat-panel" aria-label="Hỗ trợ khách hàng">
          <header className="chat-panel__header">
            <div className="chat-agent">
              <div className="chat-agent__avatar" aria-hidden="true">
                TT
              </div>
              <div>
                <strong>Hỗ trợ khách hàng</strong>
                <span>Đang sẵn sàng tư vấn</span>
              </div>
            </div>

            <button
              className="chat-close"
              type="button"
              aria-label="Đóng hộp chat"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="chat-messages" ref={messagesContainerRef}>
            {messages.map((message) => (
              <article
                className={`chat-bubble${message.role === 'user' ? ' chat-bubble--user' : ''}`}
                key={message.id}
              >
                {message.text}
              </article>
            ))}
          </div>

          <div className="chat-quick-actions">
            {quickActions.map((action) => (
              <button disabled={isSending} key={action} type="button" onClick={() => handleQuickAction(action)}>
                {action}
              </button>
            ))}
          </div>

          <form className="chat-composer" onSubmit={handleSubmit}>
            <input
              disabled={isSending}
              type="text"
              placeholder="Nhập nội dung cần hỗ trợ..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button disabled={isSending} type="submit">
              {isSending ? '\u0110ang g\u1eedi...' : 'Gửi'}
            </button>
          </form>
        </section>
      ) : null}

      <button
        className="chat-fab"
        type="button"
        aria-label="Mở chat hỗ trợ"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="chat-fab__icon" aria-hidden="true" />
        <span className="chat-fab__label">Hỗ trợ nhanh</span>
      </button>
    </div>
  );
}

function Layout({ children }) {
  return (
    <div className="site-shell">
      <div className="site-glow site-glow--left" aria-hidden="true" />
      <div className="site-glow site-glow--right" aria-hidden="true" />

      <header className="site-header">
        <Link className="brand-lockup" to="/">
          <BrandMark />
          <div>
            <strong>{siteLabel}</strong>
            <span>In Offset, bao bì và ấn phẩm giấy</span>
          </div>
        </Link>

        <nav className="main-nav" aria-label="Điều hướng chính">
          <NavLink to="/">Trang chủ</NavLink>
          <NavLink to="/gioi-thieu">Giới thiệu</NavLink>
          <NavLink to="/san-pham">Sản phẩm</NavLink>
          <NavLink to="/huong-dan-dat-hang">Đặt hàng</NavLink>
          <NavLink to="/gia-in">Giá in</NavLink>
          {recruitmentPage ? <NavLink to="/tuyen-dung">Tuyển dụng</NavLink> : null}
          <NavLink to="/lien-he">Liên hệ</NavLink>
          <a href={fanpageUrl} target="_blank" rel="noreferrer">
            Fanpage
          </a>
        </nav>
      </header>

      {children}

      <footer className="site-footer">
        <div>
          <strong>{siteLabel}</strong>
          <p>Chuyên in offset, gia công bao bì và các ấn phẩm giấy chất lượng cao.</p>
        </div>

        <div className="footer-links">
          <Link to="/gioi-thieu">Giới thiệu</Link>
          <Link to="/huong-dan-dat-hang">Hướng dẫn đặt hàng</Link>
          {recruitmentPage ? <Link to="/tuyen-dung">Tuyển dụng</Link> : null}
          <Link to="/chinh-sach-thanh-toan">Chính sách thanh toán</Link>
          <Link to="/chinh-sach-bao-mat">Chính sách bảo mật</Link>
          <a href={fanpageUrl} target="_blank" rel="noreferrer">
            Fanpage
          </a>
        </div>

        <div className="footer-meta">
          <span>Hotline: {company.contact.phone}</span>
          <span>Email: {company.contact.email}</span>
        </div>
      </footer>

      <SupportChatWidget />
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, centered = false }) {
  return (
    <div className={`section-heading${centered ? ' section-heading--centered' : ''}`}>
      {eyebrow ? <span>{eyebrow}</span> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function ProductCard({ product }) {
  const categoryTrail = getProductCategoryTrail(product);

  return (
    <article className="product-card">
      <Link className="product-card__image" to={`/san-pham/${product.slug}`}>
        <img src={product.images[0]?.src} alt={product.images[0]?.alt || product.name} />
      </Link>

      <div className="product-card__body">
        <div className="pill-row">
          {categoryTrail.slice(0, 2).map((category) => (
            <Link className="pill" key={category.slug} to={`/danh-muc/${category.slug}`}>
              {category.name}
            </Link>
          ))}
        </div>

        <h3>
          <Link to={`/san-pham/${product.slug}`}>{product.name}</Link>
        </h3>
        <p>{product.summary}</p>
      </div>
    </article>
  );
}

function HtmlBlock({ html }) {
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

function EmptyState({ title, description, actionLabel, actionTo }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {actionLabel && actionTo ? (
        <Link className="primary-link" to={actionTo}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}

function HeroProductSearch() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');

  function handleSubmit(event) {
    event.preventDefault();

    const trimmedKeyword = keyword.trim();
    navigate(trimmedKeyword ? `/san-pham?search=${encodeURIComponent(trimmedKeyword)}` : '/san-pham');
  }

  return (
    <form className="hero-search" role="search" onSubmit={handleSubmit}>
      <input
        aria-label="Tìm kiếm sản phẩm"
        placeholder="Tìm sản phẩm, bao bì, tem nhãn..."
        type="search"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <button type="submit">Tìm kiếm</button>
    </form>
  );
}

function HomePage() {
  const featuredProducts = siteData.products.slice(0, 8);
  const [activeHeroImage, setActiveHeroImage] = useState(0);
  const [activeShowcaseBanner, setActiveShowcaseBanner] = useState(0);

  useEffect(() => {
    const hasHeroRotation = heroBackgroundImages.length > 1;
    const hasShowcaseRotation = showcaseBanners.length > 1;

    if (!hasHeroRotation && !hasShowcaseRotation) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (hasHeroRotation) {
        setActiveHeroImage((current) => (current + 1) % heroBackgroundImages.length);
      }

      if (hasShowcaseRotation) {
        setActiveShowcaseBanner((current) => (current + 1) % showcaseBanners.length);
      }
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <Layout>
      <main>
        <section className="hero-panel">
          {heroBackgroundImages.length ? (
            <div className="hero-background" aria-hidden="true">
              {heroBackgroundImages.map((image, index) => (
                <div
                  className={`hero-background__image${index === activeHeroImage ? ' is-active' : ''}`}
                  key={`${image}-panel`}
                  style={{ backgroundImage: `url("${image}")` }}
                />
              ))}
              <div className="hero-background__veil" />
            </div>
          ) : null}

          <div className="hero-copy">
            <div className="hero-copy__content">
            <h1>{siteLabel}</h1>
            <p>
              {siteLabel} chuyên in offset, gia công ấn phẩm giấy, bao bì, tem nhãn và các sản phẩm
              phục vụ doanh nghiệp với chất lượng ổn định, tiến độ nhanh và chi phí hợp lý.
            </p>

            <div className="hero-actions">
              <Link className="primary-link" to="/san-pham">
                Xem toàn bộ sản phẩm
              </Link>
              <HeroProductSearch />
            </div>

            <div className="stats-grid">
              <article>
                <strong>{company.foundedYear}</strong>
                <span>Năm thành lập</span>
              </article>
              <article>
                <strong>{topCategories.length}</strong>
                <span>Nhóm dịch vụ chính</span>
              </article>
              <article>
                <strong>{siteData.products.length}</strong>
                <span>Sản phẩm hiện có</span>
              </article>
            </div>
            </div>
          </div>

          <div className="hero-panel__side">
            <div className="showcase-card">
              <span>Thông tin liên hệ</span>
              <strong>{company.contact.phone}</strong>
              <p>{`Xưởng sản xuất ${company.contact.workshop}`}</p>
              <div className="contact-links">
                <a href={`tel:${company.contact.phone.replace(/\./g, '')}`}>Gọi ngay</a>
                <a href={`https://zalo.me/${company.contact.zalo}`} target="_blank" rel="noreferrer">
                  Zalo
                </a>
                <a href={`mailto:${company.contact.email}`}>Email</a>
              </div>
            </div>

            <div className="showcase-card showcase-card--soft showcase-card--compact">
              <span>Điểm nổi bật</span>
              <ul className="hero-checks">
                {company.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {showcaseBanners.length ? (
          <section className="section-block section-block--banner">
            <div className="showcase-banner" aria-label="Banner giới thiệu nổi bật">
              <div className="showcase-banner__media">
                {showcaseBanners.map((banner, index) => (
                  <img
                    alt={index === activeShowcaseBanner ? banner.alt : ''}
                    aria-hidden={index !== activeShowcaseBanner}
                    className={`showcase-banner__image${index === activeShowcaseBanner ? ' is-active' : ''}`}
                    key={banner.src}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    src={banner.src}
                  />
                ))}
                <div className="showcase-banner__veil" />
              </div>

              {showcaseBanners.length > 1 ? (
                <div className="showcase-banner__dots" aria-hidden="true">
                  {showcaseBanners.map((banner, index) => (
                    <span className={index === activeShowcaseBanner ? 'is-active' : ''} key={`${banner.src}-dot`} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="section-block">
          <SectionHeading
            eyebrow="Điểm mạnh hiện tại"
            title={`Những giá trị nổi bật của ${siteLabel}`}
            description="Tư vấn rõ ràng, kinh nghiệm lâu năm và quy trình xử lý linh hoạt giúp khách hàng yên tâm khi triển khai đơn hàng."
          />

          <div className="feature-grid">
            {company.highlights.map((item, index) => (
              <article className="feature-card" key={item}>
                <span>0{index + 1}</span>
                <h3>{item}</h3>
                <p>Đây là những yếu tố giúp doanh nghiệp tạo sự tin cậy và duy trì chất lượng dịch vụ ổn định.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="category-grid category-grid--flush">
            {topCategories.map((category) => (
              <Link className="category-card" key={category.slug} to={`/danh-muc/${category.slug}`}>
                <span>{category.name}</span>
                <strong>{countProductsForCategory(category.slug)} sản phẩm</strong>
                <small>{getChildCategories(category.id).length} danh mục con</small>
              </Link>
            ))}
          </div>
        </section>

        <section className="section-block">
          <SectionHeading
            eyebrow="Sản phẩm tiêu biểu"
            title={`Một số sản phẩm nổi bật tại ${siteLabel}`}
            description="Các mẫu sản phẩm được trình bày rõ ràng để khách hàng dễ tham khảo và lựa chọn theo từng nhu cầu cụ thể."
          />

          <div className="product-grid">
            {featuredProducts.map((product) => (
              <ProductCard key={product.slug} product={product} />
            ))}
          </div>
        </section>

        <section className="section-block">
          <SectionHeading
            eyebrow="Khách hàng tiêu biểu"
            title="Một số đối tác và khách hàng tiêu biểu"
            description="Sự đồng hành cùng nhiều thương hiệu lớn là nền tảng cho uy tín và kinh nghiệm của doanh nghiệp."
          />

          <div className="client-grid">
            {partnerLogos.map((partner) => (
              <article className="client-chip" key={partner.name}>
                <img src={partner.logo} alt={partner.name} loading="lazy" />
                <span className="sr-only">{partner.name}</span>
              </article>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}

function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchTerm = (searchParams.get('search') || '').trim();
  const [searchDraft, setSearchDraft] = useState(searchTerm);
  const filteredProducts = searchProducts(siteData.products, searchTerm);
  const isSearching = Boolean(searchTerm);

  useEffect(() => {
    setSearchDraft(searchTerm);
  }, [searchTerm]);

  function handleSearchSubmit(event) {
    event.preventDefault();

    const trimmedKeyword = searchDraft.trim();

    if (!trimmedKeyword) {
      setSearchParams({});
      return;
    }

    setSearchParams({ search: trimmedKeyword });
  }

  function handleClearSearch() {
    setSearchDraft('');
    setSearchParams({});
  }

  return (
    <Layout>
      <main className="page-content">
        <section className="page-hero">
          <SectionHeading
            eyebrow="Toàn bộ sản phẩm"
            title="Danh mục sản phẩm và dịch vụ"
            description={
              isSearching
                ? `Tìm thấy ${filteredProducts.length} sản phẩm phù hợp với từ khóa "${searchTerm}".`
                : 'Tham khảo toàn bộ nhóm sản phẩm đang được cung cấp để lựa chọn đúng hạng mục cần triển khai.'
            }
          />

          <form className="catalog-search" role="search" onSubmit={handleSearchSubmit}>
            <input
              aria-label="Tìm kiếm sản phẩm trong trang danh mục"
              placeholder="Nhập tên sản phẩm hoặc từ khóa liên quan..."
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <button type="submit">Tìm kiếm</button>
            {isSearching ? (
              <button className="catalog-search__reset" type="button" onClick={handleClearSearch}>
                Xóa lọc
              </button>
            ) : null}
          </form>
        </section>

        {!isSearching ? (
          <section className="section-block">
            <div className="category-grid">
              {topCategories.map((category) => (
                <Link className="category-card" key={category.slug} to={`/danh-muc/${category.slug}`}>
                  <span>{category.name}</span>
                  <strong>{countProductsForCategory(category.slug)} sản phẩm</strong>
                  <small>{getChildCategories(category.id).length} nhóm con</small>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="section-block">
          {filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Không có kết quả phù hợp"
              description={`Không tìm thấy sản phẩm phù hợp với từ khóa "${searchTerm}".`}
              actionLabel="Xem toàn bộ sản phẩm"
              actionTo="/san-pham"
            />
          )}
        </section>
      </main>
    </Layout>
  );
}

function CategoryPage() {
  const { categorySlug } = useParams();
  const category = categoryBySlug[categorySlug];

  if (!category) {
    return (
      <Layout>
        <EmptyState
          title="Không tìm thấy danh mục"
          description="Danh mục bạn đang mở hiện không tồn tại hoặc đã được thay đổi."
          actionLabel="Xem toàn bộ sản phẩm"
          actionTo="/san-pham"
        />
      </Layout>
    );
  }

  const childCategories = getChildCategories(category.id);
  const products = getProductsForCategory(category);

  return (
    <Layout>
      <main className="page-content">
        <section className="page-hero">
          <SectionHeading
            eyebrow="Danh mục"
            title={category.name}
            description={`Hiện có ${products.length} sản phẩm liên quan trong nhóm này.`}
          />

          {childCategories.length ? (
            <div className="pill-row">
              {childCategories.map((childCategory) => (
                <Link className="pill" key={childCategory.slug} to={`/danh-muc/${childCategory.slug}`}>
                  {childCategory.name}
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <section className="section-block">
          {products.length ? (
            <div className="product-grid">
              {products.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Danh mục này chưa có sản phẩm hiển thị"
              description="Danh mục này hiện chưa có sản phẩm để hiển thị."
              actionLabel="Quay về trang sản phẩm"
              actionTo="/san-pham"
            />
          )}
        </section>
      </main>
    </Layout>
  );
}

function ProductPage() {
  const { productSlug } = useParams();
  const product = productsBySlug[productSlug];
  const [activeImage, setActiveImage] = useState(product?.images[0]?.src || '');

  useEffect(() => {
    setActiveImage(product?.images[0]?.src || '');
  }, [productSlug, product]);

  if (!product) {
    return (
      <Layout>
        <EmptyState
          title="Không tìm thấy sản phẩm"
          description="Sản phẩm bạn đang tìm hiện không tồn tại hoặc đã được cập nhật."
          actionLabel="Quay lại danh mục sản phẩm"
          actionTo="/san-pham"
        />
      </Layout>
    );
  }

  const relatedProducts = siteData.products
    .filter(
      (item) =>
        item.slug !== product.slug &&
        item.categories.some((category) => product.categories.some((target) => target.slug === category.slug))
    )
    .slice(0, 4);

  return (
    <Layout>
      <main className="page-content">
        <section className="product-hero">
          <div className="product-gallery">
            <div className="product-gallery__main">
              <img src={activeImage || product.images[0]?.src} alt={product.images[0]?.alt || product.name} />
            </div>

            {product.images.length > 1 ? (
              <div className="product-gallery__thumbs">
                {product.images.map((image) => (
                  <button
                    className={activeImage === image.src ? 'is-active' : ''}
                    key={image.id}
                    type="button"
                    onClick={() => setActiveImage(image.src)}
                  >
                    <img src={image.thumbnail || image.src} alt={image.alt || product.name} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="product-summary">
            <div className="pill-row">
              {getProductCategoryTrail(product).map((category) => (
                <Link className="pill" key={category.slug} to={`/danh-muc/${category.slug}`}>
                  {category.name}
                </Link>
              ))}
            </div>

            <h1>{product.name}</h1>
            <p>{product.summary}</p>

            {product.shortDescription ? (
              <div className="surface-card">
                <HtmlBlock html={product.shortDescription} />
              </div>
            ) : null}

            <div className="product-actions">
              <a className="primary-link" href={`tel:${company.contact.phone.replace(/\./g, '')}`}>
                Gọi tư vấn
              </a>
              <Link className="secondary-link" to="/huong-dan-dat-hang">
                Xem cách đặt hàng
              </Link>
            </div>
          </div>
        </section>

        <section className="section-block">
          <SectionHeading
            eyebrow="Mô tả chi tiết"
            title={`Thông tin hiện có về ${product.name}`}
            description="Phần dưới đây được giữ lại từ nội dung cũ và hiển thị lại trong khung đọc dễ theo dõi hơn."
          />

          <article className="content-card">
            <HtmlBlock html={product.description || '<p>Chưa có mô tả chi tiết.</p>'} />
          </article>
        </section>

        {relatedProducts.length ? (
          <section className="section-block">
          <SectionHeading
            eyebrow="Liên quan"
            title="Một số sản phẩm cùng nhóm"
            description="Tham khảo thêm các sản phẩm cùng nhóm để có lựa chọn phù hợp hơn."
          />

            <div className="product-grid">
              {relatedProducts.map((item) => (
                <ProductCard key={item.slug} product={item} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </Layout>
  );
}

function ContentPage({ slug, fallbackTitle, fallbackDescription }) {
  const page = getPageBySlug(slug);

  if (!page) {
    return (
      <Layout>
        <EmptyState
          title="Không tìm thấy nội dung"
          description="Trang bạn đang mở hiện không tồn tại hoặc chưa có nội dung hiển thị."
          actionLabel="Về trang chủ"
          actionTo="/"
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="page-content">
        <section className="page-hero">
          <SectionHeading
            title={page.title || fallbackTitle}
            description={page.excerpt || fallbackDescription}
          />
        </section>

        <section className="section-block">
          {page.content ? (
            <article className="content-card">
              <HtmlBlock html={page.content} />
            </article>
          ) : (
            <EmptyState
              title={page.title}
              description="Trang này hiện chưa có nội dung chi tiết để hiển thị."
              actionLabel="Liên hệ ngay"
              actionTo="/lien-he"
            />
          )}
        </section>
      </main>
    </Layout>
  );
}

function PricingPage() {
  const defaultProduct = pricingOptions[0] ?? null;
  const [selectedProductId, setSelectedProductId] = useState(defaultProduct?.id ?? '');
  const [quantity, setQuantity] = useState('100');
  const [result, setResult] = useState(() => (defaultProduct ? createPricingResult(defaultProduct, 100) : null));

  if (!pricingOptions.length) {
    return (
      <Layout>
        <EmptyState
          title="Chua co du lieu gia in"
          description="Bang pricing_options trong CSDL hien chua co ban ghi de hien thi."
          actionLabel="Ve trang chu"
          actionTo="/"
        />
      </Layout>
    );
  }

  function handleCalculate(event) {
    event.preventDefault();

    const selectedProduct = pricingOptions.find((product) => product.id === selectedProductId);
    const parsedQuantity = Number.parseInt(quantity, 10);
    const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;

    if (!selectedProduct) {
      return;
    }

    setResult(createPricingResult(selectedProduct, safeQuantity));
  }

  return (
    <Layout>
      <main className="page-content">
        <section className="page-hero">
          <SectionHeading
            eyebrow="Giá in"
            title="Bảng giá tham khảo"
            description="Chọn sản phẩm, nhập số lượng và bấm tính để xem mức chi phí minh họa ngay trên giao diện."
          />
        </section>

        <section className="section-block">
          <div className="pricing-layout">
            <article className="pricing-card">
              <span>Bộ tính giá</span>
              <h3>Tính nhanh chi phí in</h3>
              <p>Đây là bảng giá minh họa trên frontend để khách hàng tham khảo trước khi liên hệ.</p>

              <form className="pricing-form" onSubmit={handleCalculate}>
                <label>
                  Tên sản phẩm
                  <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
                    {pricingOptions.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Số lượng
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="Nhập số lượng"
                  />
                </label>

                <button type="submit">Tính tiền</button>
              </form>
            </article>

            <article className="pricing-card pricing-card--accent">
              <span>Kết quả tạm tính</span>
              <h3>{result.productName}</h3>

              <div className="pricing-result">
                <div>
                  <small>Đơn giá tham khảo</small>
                  <strong>
                    {formatCurrency(result.unitPrice)} / {result.unitLabel}
                  </strong>
                </div>
                <div>
                  <small>Số lượng</small>
                  <strong>
                    {result.quantity} {result.unitLabel}
                  </strong>
                </div>
                <div>
                  <small>Thời gian dự kiến</small>
                  <strong>{result.turnaround}</strong>
                </div>
              </div>

              <div className="pricing-total">
                <small>Tổng tiền tạm tính</small>
                <strong>{formatCurrency(result.total)}</strong>
              </div>
            </article>
          </div>
        </section>
      </main>
    </Layout>
  );
}

function ContactPage() {
  return (
    <Layout>
      <main className="page-content">
        <section className="page-hero">
          <SectionHeading
            eyebrow="Liên hệ"
            title="Thông tin liên hệ và đặt hàng"
            description={`Kết nối nhanh với ${siteLabel} để được tư vấn, báo giá và tiếp nhận yêu cầu in ấn.`}
          />
        </section>

        <section className="contact-layout">
          <article className="contact-card">
            <span>Hotline</span>
            <strong>{company.contact.phone}</strong>
            <p>Liên hệ trực tiếp để được tư vấn báo giá và xác nhận quy cách in.</p>
            <div className="contact-card__actions">
              <a className="primary-link" href={`tel:${company.contact.phone.replace(/\./g, '')}`}>
                Gọi ngay
              </a>
              <a className="secondary-link" href={`https://zalo.me/${company.contact.zalo}`} target="_blank" rel="noreferrer">
                Nhắn Zalo
              </a>
            </div>
          </article>

          <article className="contact-card">
            <span>Email</span>
            <strong>{company.contact.email}</strong>
            <p>Phù hợp khi gửi file thiết kế, quy cách in và thông tin doanh nghiệp.</p>
            <div className="contact-card__actions">
              <a className="primary-link" href={`mailto:${company.contact.email}`}>
                Gửi email
              </a>
            </div>
          </article>

          <article className="contact-card">
            <span>Trụ sở</span>
            <strong>{company.contact.office}</strong>
            <p>Khách có thể mang file đến trực tiếp để nhân viên kiểm tra và tiếp nhận đơn hàng.</p>
          </article>

          <article className="contact-card">
            <span>Xưởng sản xuất</span>
            <strong>{company.contact.workshop}</strong>
            <p>{company.contact.deliveryNote}</p>
          </article>
        </section>

        <section className="section-block">
          <SectionHeading
            eyebrow="Đặt hàng"
            title="Ba cách đặt hàng đang có"
            description="Nội dung này được tách từ trang hướng dẫn đặt hàng cũ."
          />

          <div className="steps-grid">
            <article className="step-card">
              <span>01</span>
              <h3>Điện thoại / Zalo</h3>
              <p>Hotline hiện tại: {company.contact.phone}.</p>
            </article>
            <article className="step-card">
              <span>02</span>
              <h3>Email</h3>
              <p>Gửi file, quy cách in và thông tin liên hệ qua {company.contact.email}.</p>
            </article>
            <article className="step-card">
              <span>03</span>
              <h3>Đến trực tiếp</h3>
              <p>Mang file đến công ty để kiểm tra file và tạo đơn hàng trực tiếp.</p>
            </article>
          </div>
        </section>
      </main>
    </Layout>
  );
}

function NotFoundPage() {
  return (
    <Layout>
      <EmptyState
        title="Không tìm thấy trang"
        description="Đường dẫn bạn đang mở không tồn tại."
        actionLabel="Về trang chủ"
        actionTo="/"
      />
    </Layout>
  );
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/san-pham" element={<CatalogPage />} />
        <Route path="/danh-muc/:categorySlug" element={<CategoryPage />} />
        <Route path="/san-pham/:productSlug" element={<ProductPage />} />
        <Route
          path="/gioi-thieu"
          element={
            <ContentPage
              slug="gioi-thieu"
              fallbackTitle="Giới thiệu"
              fallbackDescription="Thông tin giới thiệu về doanh nghiệp."
            />
          }
        />
        <Route
          path="/huong-dan-dat-hang"
          element={
            <ContentPage
              slug="huong-dan-dat-hang"
              fallbackTitle="Hướng dẫn đặt hàng"
              fallbackDescription="Thông tin hotline, email và cách nhận hàng."
            />
          }
        />
        <Route
          path="/chinh-sach-thanh-toan"
          element={
            <ContentPage
              slug="chinh-sach-thanh-toan"
              fallbackTitle="Chính sách thanh toán"
              fallbackDescription="Trang chính sách đang được giữ theo dữ liệu hiện có."
            />
          }
        />
        <Route
          path="/chinh-sach-bao-mat"
          element={
            <ContentPage
              slug="chinh-sach-bao-mat"
              fallbackTitle="Chính sách bảo mật"
              fallbackDescription="Trang chính sách đang được giữ theo dữ liệu hiện có."
            />
          }
        />
        <Route
          path="/tuyen-dung"
          element={
            <ContentPage
              slug="tuyen-dung"
              fallbackTitle="Tuyển dụng"
              fallbackDescription="Thông tin vị trí đang tuyển và cách ứng tuyển tại công ty."
            />
          }
        />
        <Route path="/gia-in" element={<PricingPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/tin-tuc" element={<Navigate to="/gia-in" replace />} />
        <Route path="/lien-he" element={<ContactPage />} />
        <Route path="/trang-chu" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

function App() {
  const [isBackendAvailable, setIsBackendAvailable] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function checkBackendAvailability() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/health`, {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`Health request failed with ${response.status}`);
        }

        if (!isCancelled) {
          setIsBackendAvailable(true);
        }
      } catch (error) {
        console.error('Backend health check failed.', error);

        if (!isCancelled) {
          setIsBackendAvailable(false);
        }
      }
    }

    checkBackendAvailability();
    const intervalId = window.setInterval(checkBackendAvailability, 15000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  if (!isBackendAvailable) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          background: '#f4efe6'
        }}
      >
        <img
          src={maintenanceImage}
          alt="Trang bao tri"
          style={{
            display: 'block',
            width: 'min(960px, 100%)',
            height: 'auto',
            borderRadius: '20px',
            boxShadow: '0 24px 80px rgba(47, 31, 20, 0.12)'
          }}
        />
      </main>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;

