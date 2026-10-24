// Vá plugin graph: cho nhãn chữ hiện ngay khi mở trang (mặc định nhãn chỉ hiện sau khi người dùng zoom).
// Độ hiện được điều khiển bởi opacityScale trong quartz.config.yaml. Idempotent.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const file = path.join(root, "node_modules/@quartz-community/graph/dist/index.js")

// Gọi handler zoom một lần với phép biến đổi đơn vị để cập nhật độ hiện của nhãn ngay từ đầu.
const from = '.on("zoom",ut);'
const to = '.on("zoom",ut);ut({transform:o.zoomIdentity});'

const src = fs.readFileSync(file, "utf8")
if (src.includes(to)) {
  console.log("patch-graph: đã vá sẵn")
} else if (src.split(from).length === 2) {
  fs.writeFileSync(file, src.replace(from, to))
  console.log("patch-graph: đã vá, nhãn hiện sẵn khi mở trang")
} else {
  console.warn("patch-graph: không tìm thấy đúng một đoạn cần vá (plugin graph đổi phiên bản?), bỏ qua")
}
