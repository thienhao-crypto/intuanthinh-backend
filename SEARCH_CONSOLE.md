# Search Console

1. Vào Google Search Console và tạo property theo dạng `URL prefix` cho domain thật của site.
2. Chọn cách xác minh `HTML file`.
3. Google sẽ cấp một file dạng `googlexxxxxxxxxxxx.html`.
4. Ghi đúng tên file đó vào biến `GOOGLE_SITE_VERIFICATION_FILE` trong `server/.env`.
5. Đặt `SITE_URL` đúng domain thật, ví dụ `https://intuanthinh.com`.
6. Chạy `npm run seo:sync` hoặc `npm run build`.
7. Deploy lại frontend để file xác minh, `robots.txt` và `sitemap.xml` xuất hiện ngoài public.
8. Quay lại Search Console và bấm Verify.
9. Sau khi verify xong, gửi sitemap `https://your-domain/sitemap.xml` trong mục Sitemaps.

Lưu ý:

- `sitemap.xml` và `robots.txt` được sinh từ dữ liệu thật trong MySQL.
- `GOOGLE_SITE_VERIFICATION_FILE` là tùy chọn. Nếu để trống, script sẽ không tạo file xác minh.
- Sitemap và Search Console chỉ giúp Google crawl/index đúng hơn. Không có cách nào cam kết top 1-3 chỉ bằng sitemap.
