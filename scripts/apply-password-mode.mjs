// Chế độ mật khẩu cả site: chỉnh quartz.config.yaml trong thư mục làm việc của CI (không commit).
// Chạy khi biến SITE_PASSWORD có giá trị; nếu không thì không làm gì.
//  - Tắt mục lục: mục lục được dựng từ các tiêu đề nên sẽ lộ dàn ý trang ngay cả khi thân bài đã mã hóa.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (!process.env.SITE_PASSWORD) {
  console.log("apply-password-mode: SITE_PASSWORD trống, bỏ qua (site công khai)")
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const file = path.join(root, "quartz.config.yaml")
const src = fs.readFileSync(file, "utf8")

const re = /(- source: "@quartz-community\/table-of-contents"\r?\n\s+enabled: )true/
if (re.test(src)) {
  fs.writeFileSync(file, src.replace(re, "$1false"))
  console.log("apply-password-mode: đã tắt mục lục")
} else if (/(- source: "@quartz-community\/table-of-contents"\r?\n\s+enabled: )false/.test(src)) {
  console.log("apply-password-mode: mục lục đã tắt sẵn")
} else {
  console.warn("apply-password-mode: không tìm thấy cấu hình mục lục, kiểm tra lại quartz.config.yaml")
}
