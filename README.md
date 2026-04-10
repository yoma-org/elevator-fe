# YECL Maintenance System — Frontend

Web frontend cho hệ thống quản lý bảo trì thang máy Yoma Elevator (YECL). Bao gồm giao diện báo cáo bảo trì cho kỹ thuật viên và dashboard quản trị cho các phòng ban.

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** + TypeScript
- **Tailwind CSS 4**
- **React Hook Form** + Zod (form validation)
- **jsPDF** + jspdf-autotable (xuất báo cáo PDF)
- **SheetJS (xlsx)** (xuất Excel)

## Cấu trúc thư mục

```
frontend-next/
├── app/
│   ├── layout.tsx          # Root layout (Barlow font)
│   ├── page.tsx            # Trang báo cáo bảo trì (technician)
│   ├── login/page.tsx      # Trang đăng nhập admin
│   └── admin/
│       ├── layout.tsx      # Admin layout (header, navigation)
│       └── page.tsx        # Admin dashboard
├── components/
│   ├── AdminHeader.tsx     # Header cho admin dashboard
│   ├── BatchUploadModal.tsx # Modal upload hàng loạt
│   └── SmartTextInput.tsx  # Input thông minh với autocomplete
├── lib/
│   ├── admin-auth.ts       # Xử lý authentication (cookie-based)
│   ├── admin-session-context.tsx # Session context provider
│   └── permissions.ts      # Role-based permission matrix
└── public/
    └── logo.jpg            # Logo Yoma Elevator
```

## Các trang chính

### Trang báo cáo bảo trì (`/`)
Form nhiều bước cho kỹ thuật viên ghi nhận báo cáo bảo trì:
1. Thông tin cơ bản (tòa nhà, thiết bị)
2. Checklist kiểm tra
3. Ảnh chụp & ghi chú
4. Vấn đề & vật tư sử dụng
5. Xem lại & gửi

### Trang đăng nhập admin (`/login`)
Xác thực email/password cho quản trị viên.

### Dashboard admin (`/admin`)
Bảng điều khiển quản lý work order với các tính năng:
- Xem danh sách work order (bảng, filter, search)
- Xem chi tiết work order (checklist, ghi chú, chữ ký)
- Duyệt/chuyển trạng thái theo quy trình
- Xuất báo cáo PDF và Excel
- Upload work order hàng loạt

## Hệ thống phân quyền

Phân quyền theo role và trạng thái work order:

| Role | Mô tả |
|------|--------|
| `operation` | Tiếp nhận báo cáo, chuyển sang PC Review |
| `pc-team` | Kiểm tra kỹ thuật, duyệt sang Commercial |
| `commercial` | Duyệt thương mại, xuất hóa đơn |
| `mnt-manager` | Quản lý bảo trì, giám sát quy trình |

Quy trình duyệt: **Received → PC Review → Commercial Review → Invoice Ready → Closed**

## Cài đặt & Chạy

```bash
# Cài dependencies
npm install

# Chạy development server
npm run dev

# Build production
npm run build

# Chạy production
npm start
```

Mặc định chạy tại `http://localhost:3000`.

## Biến môi trường

| Biến | Mô tả | Mặc định |
|------|--------|----------|
| `NEXT_PUBLIC_API_BASE_URL` | URL backend API | `http://localhost:3001/api` |

## Deploy

Đang deploy trên **Vercel** tại: https://elevator-fe-kappa.vercel.app
