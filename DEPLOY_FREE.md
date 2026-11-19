# Hướng dẫn triển khai PLAYBANK 100% Miễn phí (Không cần thẻ ngân hàng / Không bật Cloud Billing)

PLAYBANK được thiết kế để chạy hoàn toàn miễn phí mà vẫn giữ **100% xác thực và giao dịch chuyển tiền an toàn phía backend** (người dùng không thể tự sửa số dư từ trình duyệt).

---

## 1. Tại sao không dùng thuần Firebase Spark Free cho backend chuyển tiền?

- **Firebase Spark (gói miễn phí không cần thẻ)** không cho phép triển khai **Cloud Functions** (bắt buộc nâng cấp gói Blaze và gắn thẻ thanh toán).
- Nếu bỏ backend và để trình duyệt tự ghi trực tiếp lên Firestore, logic chuyển tiền và cấp thưởng 1.000.000 PLAYCOIN sẽ phụ thuộc hoàn toàn vào Security Rules phức tạp, khó đảm bảo khóa chống gửi trùng (idempotency) và thông báo đẩy an toàn như một máy chủ thực thụ.
- **Giải pháp thay thế miễn phí hoàn toàn của PLAYBANK**: Backend Node.js Express tích hợp sẵn trong dự án + tự động hỗ trợ **2 chế độ lưu trữ**:
  1. **Mặc định (không cấu hình gì thêm)**: Dùng **SQLite** (`playbank.db`) chạy ngay lập tức khi chạy cục bộ hoặc xem trước.
  2. **Triển khai online miễn phí bền vững**: Kết nối **PostgreSQL miễn phí (không cần thẻ)** từ **Neon.tech** hoặc **Supabase.com** thông qua biến môi trường `DATABASE_URL` — tự động tạo bảng, khóa dòng `SELECT ... FOR UPDATE` chống tranh chấp số dư và chống gửi trùng `idempotency_key`.

---

## 2. Cách triển khai 100% Miễn phí khuyến nghị: Render Free + Neon Free (Không cần thẻ)

### Bước 1: Tạo cơ sở dữ liệu PostgreSQL miễn phí (Không cần thẻ)
Chọn một trong hai dịch vụ miễn phí vĩnh viễn không yêu cầu thẻ tín dụng:
- **Neon.tech**: Đăng nhập bằng GitHub → *Create Project* → sao chép **Connection String** dạng:
  `postgresql://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require`
- **Supabase.com**: Đăng nhập bằng GitHub → *New Project* → vào *Connect / Database* → sao chép **Connection String (URI)** (ưu tiên Transaction/Session Pooler IPv4).

### Bước 2: Đẩy mã nguồn lên GitHub
Xuất/tải mã nguồn dự án này và đẩy lên một repository GitHub cá nhân (Public hoặc Private đều được).

### Bước 3: Triển khai lên Render Free (Không cần thẻ)
1. Đăng nhập [render.com](https://render.com) bằng tài khoản GitHub.
2. Chọn **New + → Web Service** (hoặc **Blueprint** để tự đọc tệp `render.yaml` có sẵn).
3. Cấu hình (nếu tạo thủ công):
   - **Plan**: `Free` ($0/tháng, không cần nhập thẻ)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Trong mục **Environment Variables**, thêm:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = *(dán chuỗi kết nối Neon hoặc Supabase từ Bước 1)*
5. Bấm **Create Web Service**. Sau 2–3 phút, máy chủ sẽ tự tạo toàn bộ bảng PostgreSQL và chạy PLAYBANK cho nhiều điện thoại cùng truy cập!

---

## 3. Phương án thay thế: Hugging Face Spaces (Docker Free, Không cần thẻ)

1. Tạo Space mới trên [huggingface.co/spaces](https://huggingface.co/spaces) với **SDK: Docker (Blank)**.
2. Tải toàn bộ mã nguồn dự án (đã có sẵn `Dockerfile`).
3. Trong **Settings → Variables and secrets**:
   - Thêm Secret `DATABASE_URL` (từ Neon/Supabase).
   - Thêm Variable `PORT` = `7860` (cổng mặc định của Hugging Face Spaces — `server.ts` tự nhận biến `PORT`).
4. Space tự build và chạy miễn phí.

---

## 4. Chạy trực tiếp trên máy tính cá nhân / mạng nội bộ

```bash
npm install
npm run build
NODE_ENV=production npm start
```
Mở `http://localhost:3000`. Dữ liệu tự lưu vào tệp `./playbank.db` (không cần cài thêm database).

---

## 5. Giới hạn của các gói Hosting Miễn phí & Cách PLAYBANK đã xử lý

| Hạn chế gói miễn phí | Ảnh hưởng | Cách PLAYBANK xử lý |
| :--- | :--- | :--- |
| **Ngủ đông sau ~15 phút không truy cập** (Render Free) | Lần mở đầu tiên sau khi nghỉ có thể mất 20–40 giây để khởi động lại server | Dữ liệu nằm trên Neon/Supabase nên không bao giờ mất số dư hay lịch sử giao dịch. |
| **Ngắt kết nối SSE dài trên proxy miễn phí** | Một số proxy free đóng luồng SSE sau 60–100 giây | Giao diện đã tích hợp cơ chế đồng bộ nền thông minh mỗi 12 giây (khi tab đang mở) + đồng bộ ngay khi quay lại tab để đảm bảo vẫn báo nhận tiền. |
| **Camera quét QR yêu cầu HTTPS** | Trình duyệt di động chỉ mở camera qua HTTPS hoặc `localhost` | Render Free và Hugging Face Spaces cấp sẵn chứng chỉ HTTPS miễn phí; ngoài ra luôn có chức năng **Tải ảnh QR từ thư viện**. |
