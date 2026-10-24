// Vá plugin graph: cho nhãn chữ hiện ngay khi mở trang (mặc định nhãn chỉ hiện sau khi người dùng zoom).
// Độ hiện được điều khiển bởi opacityScale trong quartz.config.yaml. Idempotent.
// Plugin có thể nằm ở node_modules hoặc .quartz/plugins tùy môi trường, nên dò cả hai nơi.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Gọi handler zoom một lần với phép biến đổi đơn vị để cập nhật độ hiện của nhãn ngay từ đầu.
const from = '.on("zoom",ut);'
const to = '.on("zoom",ut);ut({transform:o.zoomIdentity});'

function* walk(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, depth + 1)
    else if (e.name.endsWith(".js")) yield p
  }
}

let patched = 0
let already = 0
for (const base of [
  path.join(root, "node_modules/@quartz-community/graph"),
  path.join(root, ".quartz/plugins"),
]) {
  for (const file of walk(base)) {
    const src = fs.readFileSync(file, "utf8")
    if (!src.includes("forceCenter")) continue
    if (src.includes(to)) {
      already++
    } else if (src.split(from).length === 2) {
      fs.writeFileSync(file, src.replace(from, to))
      patched++
      console.log("patch-graph: đã vá", path.relative(root, file))
    }
  }
}
if (patched + already === 0) console.warn("patch-graph: không tìm thấy mã graph để vá (plugin đổi phiên bản?), bỏ qua")
else console.log(`patch-graph: ${patched} file vừa vá, ${already} file đã vá sẵn`)
