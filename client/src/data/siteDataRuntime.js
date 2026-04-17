function getRuntimeSiteData() {
  if (typeof window === 'undefined' || !window.__SITE_DATA__) {
    throw new Error('Site data has not been loaded from API.');
  }

  return window.__SITE_DATA__;
}

export const siteData = getRuntimeSiteData();

export default siteData;
