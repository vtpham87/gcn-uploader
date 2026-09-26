# GCN Auto Uploader — Edge Extension (v1.01)
> Tự động upload ảnh lên **quantrigcn.vr.org.vn/quan-ly-file** với kiểm tra tên biển số thông minh, chia đợt an toàn và giao diện Light Mode tương phản cao.  
> **Nhà phát triển:** FYJ

---

## 🚀 Cài vào Microsoft Edge / Google Chrome

1. Mở Edge → vào địa chỉ: **`edge://extensions/`** (hoặc `chrome://extensions/` trên Chrome)
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển ở góc dưới trái)
3. Nhấn **"Load unpacked"** (Tải phần mở rộng đã giải nén) → chọn thư mục `gcn-uploader`
4. Extension xuất hiện trên thanh công cụ ✅
5. *Lưu ý: Nếu vừa cập nhật code, nhấn nút 🔄 (Reload) tại danh sách tiện ích, sau đó F5 lại tab trang web.*

---

## 📋 Cách dùng tại Trạm Đăng kiểm

1. Đăng nhập vào `quantrigcn.vr.org.vn` → vào **Quản lý file**
2. Nhấn icon extension trên thanh công cụ
3. **Chấm trạng thái:**
   - 🟢 **Xanh lá**: Đã kết nối với trang Quản lý file ✓
   - 🟡 **Vàng**: Đang ở tab khác của GCN (extension bảo vệ dữ liệu đang nhập, không tự cướp tab)
   - 🔴 **Đỏ**: Chưa mở trang Quản lý file
4. Nhấn **"Chọn & Quét"** để chọn cả thư mục ảnh chụp xe trong ngày (hoặc bấm dấu `+` để chọn ảnh lẻ)
5. Extension tự động phân tích:
   - ✅ **Sẵn sàng**: Tên ảnh đúng chuẩn biển số xe Việt Nam
   - 🔴 **Có "bs"**: Ảnh cận cảnh biển số (tùy chọn bỏ qua hoặc tự xóa chữ "bs")
   - 🟡 **Trùng tên**: Đã upload thành công trong ngày
   - 🔵 **Đổi tên**: Tự động xử lý tên theo cấu hình
   - ⚪ **Sai định dạng**: Tự động loại bỏ file rác (ảnh không phải biển số)
6. Nhấn **"Upload N ảnh"**
7. Extension tự động:
   - Chia nhỏ thành từng đợt (5 ảnh/đợt)
   - Truyền dữ liệu batch IPC an toàn
   - Điều khiển click nút "Up files", gán file, click "Upload"
   - Báo cáo kết quả chi tiết từng đợt

---

## ⚙️ Cài đặt

| Tùy chọn | Mô tả |
|----------|-------|
| Lọc ký tự "bs" | Bỏ qua hoặc tự xóa "bs" khỏi tên file ảnh |
| Chống trùng tên | Chỉ so sánh với các file đã **upload thành công** hôm nay (file lỗi mạng không bị khóa nhầm) |
| Phân biệt hoa/thường | abc.jpg ≠ ABC.jpg |
| Hành động khi lỗi | **Bỏ qua file đó** / **Tự đổi tên** |
| Prefix đổi tên | Thêm vào đầu tên file khi đổi (mặc định: `copy_`) |

---

## 🔧 Tính năng nổi bật phiên bản v1.01

- **Nhà phát triển**: FYJ
- **Chống khóa file lỗi**: File upload thất bại do mạng/timeout không bị tính vào danh sách trùng tên, cho phép thử lại ngay.
- **An toàn phiên làm việc**: Không tự động redirect hay ghi đè URL khi đăng kiểm viên đang ở trang chi tiết xe (`/thong-tin-phuong-tien`).
- **Bộ lọc biển số 2 bước**: Bóc tách cờ `bs` độc lập với regex biển số; hỗ trợ chuẩn 5 số (`15A12345`), 5 số có mã màu (`15A12345T/V/X`), liên doanh (`15LD12345`), 4 số cũ (`15A1234`), lần 2 (`l2/ _l2`).
- **Chọn cả thư mục thật**: Hỗ trợ thuộc tính `webkitdirectory` trên nút Chọn & Quét.
- **IPC Batching**: Gửi từng đợt 5 ảnh một sang content script, loại trừ nguy cơ sập popup do tràn bộ nhớ IPC.
- **Giao diện Light Mode tương phản cao**: Nền trắng chữ đen to rõ, nút bấm sắc nét, tối ưu cho điều kiện ánh sáng ngoài trời/xưởng kiểm định.
