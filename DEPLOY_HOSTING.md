# Deploy Hosting

Stack nay can hosting ho tro Node.js. Neu hosting chi ho tro PHP/static file thi backend `server/index.js` se khong chay duoc.

## Cau hinh production

Server da duoc cau hinh de doc `server/.env.production` khi `NODE_ENV=production`.

Gia tri da chuan bi cho domain `intuanthinh.com`:

- `DB_HOST=localhost:3306`
- `DB_NAME=intuanthinh_intuanthinh`
- `DB_USER=intuanthinh_intuanthinh`
- `DB_CHARSET=utf8`
- `SITE_URL=https://intuanthinh.com`

## Lenh can chay tren hosting

1. Cai package:
   `npm install --omit=dev`
2. Build frontend:
   `npm run build:hosting`
3. Neu la lan dau khoi tao CSDL:
   `npm run db:seed`
4. Chay app:
   `npm start`

## Bien moi truong bat buoc

Can set trong panel hosting hoac startup config:

- `NODE_ENV=production`
- `PORT=<port do hosting cap>`

Neu hosting khong cho doc file env, hay tao cac bien tren panel bang noi dung trong `server/.env.production`.

## Cach app phuc vu website

- Express phuc vu API tai `/api/*`
- Express phuc vu media tai `/api/media/:id`
- Express phuc vu frontend build tai `client/dist`
- SPA routes nhu `/san-pham`, `/gia-in`, `/admin` se duoc fallback ve `client/dist/index.html`

## Luu y MySQL

- Hosting MySQL can cho phep tao bang InnoDB
- Neu upload banner/anh ma gap loi `max_allowed_packet`, tang cau hinh MySQL len it nhat `16M`
