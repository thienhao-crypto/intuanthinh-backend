import React from 'react';
import ReactDOM from 'react-dom/client';
import maintenanceImage from './assets/partners/anhbaotri.png';
import { normalizeSiteDataAssetUrls, resolveApiUrl } from './lib/runtimeUrls';
import './styles.css';

function assertSiteData(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Khong nhan duoc du lieu site tu API.');
  }

  if (!value.company || typeof value.company !== 'object' || !value.company.contact || typeof value.company.contact !== 'object') {
    throw new Error('Du lieu cong ty khong hop le.');
  }

  for (const key of ['pages', 'categories', 'products', 'pricingOptions']) {
    if (!Array.isArray(value[key])) {
      throw new Error(`Du lieu ${key} khong hop le.`);
    }
  }

  if (value.showcaseBanners != null && !Array.isArray(value.showcaseBanners)) {
    throw new Error('Du lieu showcaseBanners khong hop le.');
  }

  return value;
}

async function loadSiteData() {
  const response = await fetch(resolveApiUrl('/api/bootstrap'), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Bootstrap request failed with ${response.status}`);
  }

  return assertSiteData(normalizeSiteDataAssetUrls(await response.json()));
}

function StartupErrorScreen() {
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

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root'));

  try {
    window.__SITE_DATA__ = await loadSiteData();
    const { default: App } = await import('./App.jsx');

    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Failed to bootstrap site data.', error);
    root.render(<StartupErrorScreen />);
  }
}

bootstrap();
