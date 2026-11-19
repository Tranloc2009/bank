# Hướng dẫn triển khai PLAYBANK lên Cloudflare Workers Free + Cloudflare D1 (100% Miễn phí)

Dự án **PLAYBANK** đã được tối ưu trọn gói để triển khai trực tiếp trên **Cloudflare Workers Free** (kèm **Workers Static Assets** phục vụ React + Vite và **Cloudflare D1** làm cơ sở dữ liệu SQLite phân tán) mà **không cần thẻ ngân hàng và không cần bật Billing**.

---

## Tổng quan kiến trúc trên Cloudflare Workers Free

| Thành phần | Công nghệ / Binding | Gói sử dụng |
| :--- | :--- | :--- |
| Frontend SPA | React + Vite (`dist/`) qua `ASSETS` binding | Cloudflare Workers Free |
| Backend API | `worker/index.ts` (`run_worker_first: ["/api/*"]`) | Cloudflare Workers Free (100.000 request/ngày) |
| Cơ sở dữ liệu | **Cloudflare D1** (`binding: "DB"`) | Cloudflare D1 Free (5GB lưu trữ, 5 triệu lượt đọc/ngày) |
| Bảo mật mật khẩu | Web Crypto `PBKDF2-SHA256` (100.000 vòng + muối ngẫu nhiên) | Tích hợp sẵn trong Workers Runtime |
| Chuyển tiền Atomic | `DB.batch([...])` + ràng buộc SQL `CHECK(balance >= 0)` & `UNIQUE(idempotency_key)` | Atomic SQLite Transaction trên D1 |
| Thông báo nhận tiền | Tự động đồng bộ nền nhẹ mỗi 5 giây khi tab đang mở + khi quay lại tab | Miễn phí (không cần Durable Objects) |

---

## Cách 1: Triển khai bằng Wrangler CLI (Nhanh nhất — khuyến nghị)

### Bước 1: Cài đặt thư viện & đăng nhập Cloudflare
```bash
npm install
npx wrangler login
```
Trình duyệt sẽ mở trang đăng nhập Cloudflare (tài khoản Free, không yêu cầu nhập thẻ).

### Bước 2: Tạo cơ sở dữ liệu Cloudflare D1 miễn phí
```bash
npx wrangler d1 create playbank-db
```
Lệnh sẽ in ra `database_id` (dạng UUID, ví dụ `a1b2c3d4-...`).

### Bước 3: Cập nhật `database_id` vào tệp `wrangler.jsonc`
Mở tệp `wrangler.jsonc` và thay thế giá trị:
```jsonc
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```
bằng `database_id` vừa tạo ở Bước 2.

### Bước 4: Khởi tạo bảng trên Cloudflare D1
Chạy migration lên D1 từ xa (production):
```bash
npm run cf:d1:migrate:remote
```
*(Nếu muốn chạy thử local trước bằng Wrangler: `npm run cf:d1:migrate:local && npm run cf:dev`)*

### Bước 5: Build frontend & Deploy lên Cloudflare Workers
```bash
npm run cf:deploy
```
Lệnh sẽ chạy `npm run build` (tạo thư mục `dist/`) rồi đẩy cả Frontend + Worker API lên địa chỉ `https://playbank-simulator.<subdomain>.workers.dev` (có sẵn **HTTPS miễn phí** để quét QR bằng camera điện thoại).

---

## Cách 2: Triển khai qua Cloudflare Dashboard (Tự động từ GitHub)

1. Đẩy mã nguồn dự án này lên một repository **GitHub** (Public hoặc Private).
2. Vào **Cloudflare Dashboard → Storage & Databases → D1 SQL Database → Create** → đặt tên `playbank-db` → sao chép **Database ID**.
3. Trong tab **Console** của `playbank-db` trên Dashboard, dán nội dung tệp `migrations/0001_init.sql` và bấm **Execute** (hoặc dùng `npm run cf:d1:migrate:remote`).
4. Cập nhật `database_id` trong tệp `wrangler.jsonc` trên GitHub repository của bạn.
5. Vào **Workers & Pages → Create → Workers → Import a repository** → chọn repo PLAYBANK:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
6. Bấm **Save and Deploy**. Cloudflare sẽ tự build và phát hành phiên bản trực tuyến miễn phí mỗi khi bạn push code mới.

---

## Lưu ý minh bạch về giới hạn gói Cloudflare Workers Free

1. **Thông báo nhận tiền (Stateless Workers)**: Khác với server Node.js chạy 1 tiến trình duy nhất có thể giữ kết nối SSE trong bộ nhớ, Cloudflare Workers chạy trên nhiều isolate phân tán nên `/api/events` sẽ tự động chuyển giao diện sang chế độ đồng bộ thông minh mỗi **5 giây** (chỉ khi tab đang mở) và cập nhật ngay khi quay lại tab. Nhờ vậy người nhận vẫn nhận thông báo `+PLAYCOIN` và âm thanh gần thời gian thực mà **không cần kích hoạt Durable Objects**.
2. **Dữ liệu cục bộ vs D1**: Khi chạy trong môi trường phát triển cục bộ (`npm run dev`), dữ liệu vẫn nằm trong tệp SQLite `./playbank.db` hiện có. Khi triển khai lên Cloudflare D1 lần đầu, hệ thống tự tạo sẵn 3 tài khoản mẫu (`minhquan@playbank.demo`, `khanhlinh@playbank.demo`, `giabao@playbank.demo` — mật khẩu `Playbank123`) để thử nghiệm ngay bên cạnh việc đăng ký tài khoản mới.
3. **Chỉ sử dụng tiền ảo PLAYCOIN**: Ứng dụng không kết nối ngân hàng thật, không dùng VietQR thật và không sử dụng bất kỳ dịch vụ nào yêu cầu bật Cloud Billing.
