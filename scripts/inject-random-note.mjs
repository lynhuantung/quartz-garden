// Gắn <script src=".../static/search-plus.js"> vào mọi trang HTML sau khi `quartz build`.
// Chạy TRƯỚC protect-site.mjs. Idempotent: trang đã có thẻ sẽ bị bỏ qua.
import fs from "node:fs"
import path from "node:path"

const publicDir = path.resolve(process.env.PUBLIC_DIR || "public")
const jsFile = path.join(publicDir, "static", "search-plus.js")

if (!fs.existsSync(jsFile)) {
  console.warn(`inject-random-note: không thấy ${jsFile}; bỏ qua (kiểm tra quartz/static/search-plus.js).`)
  process.exit(0)
}

function* walkHtml(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkHtml(p)
    else if (e.name.endsWith(".html")) yield p
  }
}

let injected = 0
for (const htmlFile of walkHtml(publicDir)) {
  let html = fs.readFileSync(htmlFile, "utf8")
  if (html.includes("search-plus.js") || !html.includes("</head>")) continue
  const rel = path.relative(path.dirname(htmlFile), path.join(publicDir, "static")).replace(/\\/g, "/")
  const src = (rel.startsWith(".") ? rel : `./${rel}`) + "/search-plus.js"
  const tag = `<script src="${src}" type="application/javascript" data-persist="true" defer></script>`
  html = html.replace("</head>", () => `${tag}</head>`)
  fs.writeFileSync(htmlFile, html, "utf8")
  injected++
}
console.log(`inject-random-note: đã gắn tìm kiếm nâng cao + ghi chú ngẫu nhiên vào ${injected} trang HTML.`)
