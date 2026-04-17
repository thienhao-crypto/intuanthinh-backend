import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

function loadEnvFile(relativePath, options = {}) {
  dotenv.config({
    path: fileURLToPath(new URL(relativePath, import.meta.url)),
    ...options
  });
}

loadEnvFile('../../.env');
loadEnvFile('../.env', { override: true });

const environmentName = String(process.env.NODE_ENV || '').trim();

if (environmentName) {
  loadEnvFile(`../.env.${environmentName}`, { override: true });
}
