// Lọc vault Obsidian: chỉ chép note có `dg-publish: true` (và ảnh được nhúng) vào content/.
// Dùng: VAULT_DIR=<đường dẫn vault> node scripts/sync-vault.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const vault = process.env.VAULT_DIR
const outDir = path.join(root, "content")
// Bỏ tiền tố thư mục này khỏi đường dẫn đầu ra (giữ URL gọn). Để trống nếu không muốn bỏ.
const stripPrefix = process.env.STRIP_PREFIX ?? "Publish/"

if (!vault || !fs.existsSync(vault)) {
  console.error("Thiếu hoặc sai VAULT_DIR:", vault)
  process.exit(1)
}

const SKIP_DIRS = new Set([".obsidian", ".smart-env", ".git", ".trash", "node_modules"])

/** Duyệt vault, trả về danh sách đường dẫn tương đối (dấu /). */
function walk(dir, rel = "") {
  const files = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) files.push(...walk(path.join(dir, e.name), r))
    else files.push(r)
  }
  return files
}

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: "", body: text }
}

const flag = (fm, key) => new RegExp(`^${key}:\\s*true\\s*$`, "mi").test(fm)

const all = walk(vault)
const assets = new Map() // tên file (chữ thường) -> đường dẫn tương đối
for (const f of all) if (!f.endsWith(".md")) assets.set(path.posix.basename(f).toLowerCase(), f)

fs.mkdirSync(outDir, { recursive: true })
// Dọn nội dung cũ nhưng giữ .gitkeep
for (const e of fs.readdirSync(outDir)) {
  if (e !== ".gitkeep") fs.rmSync(path.join(outDir, e), { recursive: true, force: true })
}

const outPath = (rel) => (stripPrefix && rel.startsWith(stripPrefix) ? rel.slice(stripPrefix.length) : rel)

let notes = 0
let home = null
const neededAssets = new Set()

for (const rel of all.filter((f) => f.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(vault, rel), "utf8")
  const { fm, body } = splitFrontmatter(text)
  if (!flag(fm, "dg-publish")) continue

  // Bỏ khóa dg-* và `title:` rỗng (Quartz sẽ lấy tên file làm tiêu đề).
  const cleanFm = fm
    .split(/\r?\n/)
    .filter((l) => !/^dg-[a-z-]+:/i.test(l) && !/^title:\s*$/i.test(l))
    .join("\n")
    .trim()
  let fmOut = cleanFm
  let target = outPath(rel)
  if (flag(fm, "dg-home")) {
    home = target
    target = "index.md"
    // File đổi tên thành index.md nên cần đặt tiêu đề rõ ràng
    if (!/^title:/im.test(fmOut)) fmOut = `title: ${process.env.HOME_TITLE ?? "Trang chủ"}\n${fmOut}`.trim()
  }
  const content = (fmOut ? `---\n${fmOut}\n---\n` : "") + body
  const dest = path.join(outDir, target)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content)
  notes++

  // Thu thập ảnh/tệp được nhúng: ![[file.png|300]] và ![alt](path/file.png)
  for (const m of body.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const name = path.posix.basename(m[1].trim()).toLowerCase()
    if (assets.has(name)) neededAssets.add(assets.get(name))
  }
  for (const m of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z]+:\/\//i.test(m[1])) continue
    const name = path.posix.basename(decodeURIComponent(m[1])).toLowerCase()
    if (assets.has(name)) neededAssets.add(assets.get(name))
  }
}

for (const rel of neededAssets) {
  const dest = path.join(outDir, outPath(rel))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(path.join(vault, rel), dest)
}

if (!home) console.warn("Cảnh báo: không có note nào có dg-home: true, site sẽ thiếu trang chủ.")
console.log(`Đã chép ${notes} note, ${neededAssets.size} tệp đính kèm. Trang chủ: ${home ?? "(chưa có)"}`)

// --- Trang chủ dạng thẻ chủ đề (kiểu Obsidian Help). Tắt bằng HOME_VARIANT=none ---
if ((process.env.HOME_VARIANT ?? "cards") !== "none") {
  const counts = new Map()
  for (const f of walk(outDir)) {
    if (!f.endsWith(".md") || f === "index.md") continue
    const parts = f.split("/")
    if (parts.length > 1) counts.set(parts[0], (counts.get(parts[0]) ?? 0) + 1)
  }
  const topics = [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([name, n]) => ({ name, n, href: `./${name.toLowerCase().replace(/\s+/g, "-")}/` }))
  const card = (t) =>
    `<a class="card" href="${t.href}"><span class="name">${t.name}</span><span class="desc">${t.n} ghi chú</span></a>`
  const html = `<div class="home-cards"><p>Khu vườn ghi chú cá nhân: ${notes} ghi chú, ${topics.length} chủ đề, nối với nhau bằng liên kết. Chọn một chủ đề bên dưới, nhấn <kbd>Ctrl</kbd> + <kbd>K</kbd> để tìm kiếm, hoặc xem toàn bộ mạng lưới ở sơ đồ bên phải.</p><h2>Chủ đề</h2><div class="cards">${topics.map(card).join("")}</div></div>`
  const idx = path.join(outDir, "index.md")
  const old = fs.readFileSync(idx, "utf8")
  // index.md luôn có frontmatter dạng ---<khối>---<nội dung> do đoạn trên tạo ra
  const parts = old.split("---")
  const fmLines = (parts[1] ?? "").split(/\r?\n/).filter((l) => !/^title:/i.test(l) && l.trim())
  fmLines.unshift(`title: ${process.env.HOME_TITLE ?? "Digital Garden"}`)
  fs.writeFileSync(idx, ["---", ...fmLines, "---", "", html, ""].join(String.fromCharCode(10)))
  console.log(`Trang chủ dạng thẻ: ${topics.length} chủ đề`)
}
