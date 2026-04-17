import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openDatabase } from '../server/lib/database.js';
import { getBootstrapData } from '../server/lib/siteRepository.js';
import {
  buildRobotsTxt,
  buildSearchConsoleVerificationFileContent,
  buildSitemapEntries,
  buildSitemapXml,
  normalizeSearchConsoleVerificationFile,
  resolveSiteUrl
} from '../server/lib/seo.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const clientDir = path.join(rootDir, 'client');
const publicDir = path.join(clientDir, 'public');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(clientDir, '.env') });
dotenv.config({ path: path.join(rootDir, 'server', '.env') });

const db = await openDatabase();

try {
  const bootstrapData = await getBootstrapData(db);
  const siteUrl = resolveSiteUrl(process.env);
  const sitemapInput = {
    siteUrl,
    pages: bootstrapData.pages ?? [],
    categories: bootstrapData.categories ?? [],
    products: bootstrapData.products ?? [],
    lastModified: bootstrapData.generatedAt ?? new Date().toISOString()
  };

  const sitemapXml = buildSitemapXml(sitemapInput);
  const robotsTxt = buildRobotsTxt({ siteUrl });
  const sitemapEntries = buildSitemapEntries(sitemapInput);

  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'sitemap.xml'), sitemapXml, 'utf8');
  await fs.writeFile(path.join(publicDir, 'robots.txt'), robotsTxt, 'utf8');

  const verificationFileName = normalizeSearchConsoleVerificationFile(
    process.env.GOOGLE_SITE_VERIFICATION_FILE || process.env.SEARCH_CONSOLE_VERIFICATION_FILE
  );

  if (verificationFileName) {
    const verificationContent = buildSearchConsoleVerificationFileContent(verificationFileName);
    await fs.writeFile(path.join(publicDir, verificationFileName), verificationContent, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        message: 'SEO assets generated successfully.',
        siteUrl,
        outputDirectory: publicDir,
        sitemapEntries: sitemapEntries.length,
        verificationFile: verificationFileName || null
      },
      null,
      2
    )
  );
} finally {
  await db.end();
}
