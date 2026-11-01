// Lọc vault Obsidian: chỉ chép note có `dg-publish: true` (và ảnh được nhúng) vào content/.
// Đồng thời tự động trích xuất lịch sử Git của vault để tạo trang Release Notes (Nhật ký cập nhật).
// Dùng: VAULT_DIR=<đường dẫn vault> node scripts/sync-vault.mjs
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { slugifyFilePath } from "@quartz-community/utils"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const vault = process.env.VAULT_DIR
const outDir = path.join(root, "content")
// Bỏ tiền tố thư mục này khỏi đường dẫn đầu ra (giữ URL gọn). Để trống nếu không muốn bỏ.
const stripPrefix = process.env.STRIP_PREFIX ?? "Publish/"
// Mật khẩu chung cho cả site (tùy chọn). Để trống hoặc không đặt thì site công khai như cũ.
const sitePassword = process.env.SITE_PASSWORD || ""
if (/---|[\r\n]/.test(sitePassword)) {
  console.error("SITE_PASSWORD không được chứa '---' hoặc xuống dòng (sẽ làm hỏng frontmatter).")
  process.exit(1)
}

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

function extractTitle(fm, targetPath) {
  const m = fm.match(/^title:\s*(.+)$/im)
  if (m) {
    const raw = m[1].trim().replace(/^["']|["']$/g, "").trim()
    if (raw) return raw
  }
  return path.posix.basename(targetPath, ".md")
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
const publishedByRel = new Map()

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
  const isHome = flag(fm, "dg-home")
  if (isHome) {
    home = target
    target = "index.md"
    // File đổi tên thành index.md nên cần đặt tiêu đề rõ ràng
    if (!/^title:/im.test(fmOut)) fmOut = `title: ${process.env.HOME_TITLE ?? "Trang chủ"}\n${fmOut}`.trim()
  }
  // Chế độ mật khẩu cả site: chèn `password` vào mọi note (trừ note đã có mật khẩu riêng).
  // Quartz (plugin encrypted-pages) mã hóa trang lúc build. Mật khẩu chỉ nằm trong biến môi trường.
  if (sitePassword && !/^password:/im.test(fmOut)) {
    fmOut = `${fmOut}${fmOut ? "\n" : ""}password: ${JSON.stringify(sitePassword)}`
  }
  const content = (fmOut ? `---\n${fmOut}\n---\n` : "") + body
  const dest = path.join(outDir, target)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, content)
  notes++

  if (!isHome) {
    const parts = target.split("/")
    const topic = parts.length > 1 ? parts[0] : "Chung"
    publishedByRel.set(rel, {
      rel,
      target,
      dest,
      title: extractTitle(cleanFm, target),
      topic,
      slug: slugifyFilePath(target),
    })
  }

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
console.log(sitePassword ? "Chế độ mật khẩu cả site: BẬT (mọi note sẽ bị mã hóa lúc build)" : "Chế độ mật khẩu cả site: tắt")

// --- Trích xuất lịch sử Git để tạo Release Notes & cập nhật mtime thực tế ---
function buildReleaseNotes() {
  try {
    const gitPrefix = execFileSync("git", ["-C", vault, "rev-parse", "--show-prefix"], {
      encoding: "utf8",
    }).trim()
    const rawLog = execFileSync(
      "git",
      [
        "-C",
        vault,
        "-c",
        "core.quotePath=false",
        "log",
        "--date=iso-strict",
        "--name-status",
        "--pretty=format:COMMIT|%h|%ad|%s",
      ],
      { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
    )

    const commits = []
    let current = null
    for (const line of rawLog.split(/\r?\n/)) {
      if (!line.trim()) continue
      if (line.startsWith("COMMIT|")) {
        const [, hash, isoDate, ...msgParts] = line.split("|")
        current = { hash, isoDate, message: msgParts.join("|").trim(), files: [] }
        commits.push(current)
      } else if (current && /^[AMDRC]\d*\t/.test(line)) {
        const parts = line.split("\t")
        const status = parts[0][0]
        const rawPath = parts[parts.length - 1]
        const rel = gitPrefix && rawPath.startsWith(gitPrefix) ? rawPath.slice(gitPrefix.length) : rawPath
        if (publishedByRel.has(rel)) {
          current.files.push({ status, rel })
        }
      }
    }

    // Xác định ngày xuất hiện đầu tiên (firstSeenDay) và thời điểm sửa cuối cùng (latestDate) của mỗi bài
    const firstSeenDayByRel = new Map()
    const latestDateByRel = new Map()
    const vnFmt = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    const parseVN = (iso) => {
      const d = new Date(iso)
      const formatted = vnFmt.format(d) // "YYYY-MM-DD HH:mm"
      const [day, time] = formatted.split(" ")
      const [y, m, dd] = day.split("-")
      return { dateObj: d, day, dayVN: `${dd}/${m}/${y}`, time }
    }

    // Duyệt từ cũ nhất -> mới nhất để tìm ngày tạo đầu tiên chính xác
    for (let i = commits.length - 1; i >= 0; i--) {
      const c = commits[i]
      if (!c.files.length) continue
      const { day } = parseVN(c.isoDate)
      for (const f of c.files) {
        if (f.status === "D") continue
        if (!firstSeenDayByRel.has(f.rel)) {
          firstSeenDayByRel.set(f.rel, day)
        }
      }
    }

    // Gom nhóm theo ngày (duyệt từ mới nhất -> cũ nhất)
    const dayMap = new Map() // day -> Map(rel -> entry)
    for (const c of commits) {
      if (!c.files.length) continue
      const { dateObj, day, dayVN, time } = parseVN(c.isoDate)
      for (const f of c.files) {
        if (f.status === "D") continue
        const note = publishedByRel.get(f.rel)
        if (!note) continue
        if (!latestDateByRel.has(f.rel)) {
          latestDateByRel.set(f.rel, dateObj)
        }
        if (!dayMap.has(day)) {
          dayMap.set(day, { day, dayVN, entries: new Map() })
        }
        const group = dayMap.get(day)
        // Giữ bản ghi mới nhất trong ngày cho mỗi bài
        if (!group.entries.has(f.rel)) {
          const isNew = firstSeenDayByRel.get(f.rel) === day || f.status === "A"
          group.entries.set(f.rel, {
            ...note,
            type: isNew ? "new" : "update",
            day,
            dayVN,
            time,
            hash: c.hash,
            message: c.message,
          })
        }
      }
    }

    // Cập nhật mtime cho các file xuất bản để Quartz hiển thị đúng ngày chỉnh sửa từ Git
    for (const [rel, dateObj] of latestDateByRel.entries()) {
      const note = publishedByRel.get(rel)
      if (note && fs.existsSync(note.dest)) {
        try {
          fs.utimesSync(note.dest, dateObj, dateObj)
        } catch {}
      }
    }

    const days = [...dayMap.values()].filter((g) => g.entries.size > 0)
    const recentItems = []
    const seenRecent = new Set()
    for (const g of days) {
      for (const item of g.entries.values()) {
        if (seenRecent.has(item.rel)) continue
        seenRecent.add(item.rel)
        if (recentItems.length < 6) recentItems.push(item)
      }
      if (recentItems.length >= 6) break
    }

    return { days, recentItems }
  } catch (err) {
    console.warn("Không thể đọc lịch sử Git cho Release Notes:", err.message)
    return { days: [], recentItems: [] }
  }
}

const { days: releaseDays, recentItems } = buildReleaseNotes()
const releaseNotesSlug = slugifyFilePath("Release-Notes.md")

// Tạo trang content/Release-Notes.md
if (releaseDays.length > 0) {
  const renderItem = (item, showDate = false) => {
    const badge =
      item.type === "new"
        ? `<span class="rn-badge rn-new">Mới</span>`
        : `<span class="rn-badge rn-update">Cập nhật</span>`
    const titleEl = sitePassword
      ? `<span class="rn-title">${escapeHtml(item.title)}</span>`
      : `<a class="rn-title" href="./${item.slug}">${escapeHtml(item.title)}</a>`
    const metaText = showDate
      ? `${escapeHtml(item.topic)} · ${item.dayVN}`
      : `${escapeHtml(item.topic)} · ${item.time}`
    return `<div class="rn-item">${badge}${titleEl}<span class="rn-meta">${metaText}</span></div>`
  }

  const sectionsHtml = releaseDays
    .map((g) => {
      const items = [...g.entries.values()]
      const newCount = items.filter((i) => i.type === "new").length
      const updateCount = items.length - newCount
      const statParts = []
      if (newCount > 0) statParts.push(`${newCount} bài mới`)
      if (updateCount > 0) statParts.push(`${updateCount} cập nhật`)
      return `<section class="rn-day-group"><h2>Ngày ${g.dayVN} <span class="rn-day-stat">${statParts.join(", ")}</span></h2><div class="rn-list">${items.map((i) => renderItem(i, false)).join("")}</div></section>`
    })
    .join("\n")

  const rnFm = ["---", "title: Nhật ký phát hành (Release Notes)", "description: Lịch sử các ghi chú mới và cập nhật trên Digital Garden"]
  if (sitePassword) rnFm.push(`password: ${JSON.stringify(sitePassword)}`)
  rnFm.push("---")

  const rnBody = `<div class="release-notes-page"><p class="rn-intro">Trang này tự động ghi nhận mỗi khi có ghi chú mới hoặc nội dung được cập nhật từ Obsidian lên Digital Garden (tổng cộng <strong>${notes} ghi chú</strong> qua <strong>${releaseDays.length} ngày phát hành</strong>).</p>${sectionsHtml}</div>`
  fs.writeFileSync(path.join(outDir, "Release-Notes.md"), `${rnFm.join("\n")}\n\n${rnBody}\n`)
  console.log(`Đã tạo Release-Notes.md: ${releaseDays.length} đợt phát hành, ${recentItems.length} bài gần nhất.`)
}

// --- Trang chủ dạng thẻ chủ đề (kiểu Obsidian Help). Tắt bằng HOME_VARIANT=none ---
if ((process.env.HOME_VARIANT ?? "cards") !== "none") {
  const counts = new Map()
  for (const f of walk(outDir)) {
    if (!f.endsWith(".md") || f === "index.md" || f === "Release-Notes.md") continue
    const parts = f.split("/")
    if (parts.length > 1) counts.set(parts[0], (counts.get(parts[0]) ?? 0) + 1)
  }
  const topics = [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([name, n]) => ({ name, n, href: `./${name.toLowerCase().replace(/\s+/g, "-")}/` }))
  // Chế độ mật khẩu: trang thư mục không được tạo ra (mọi trang bị ẩn khỏi danh sách) nên thẻ chỉ để xem, không là link.
  const card = (t) =>
    sitePassword
      ? `<div class="card"><span class="name">${t.name}</span><span class="desc">${t.n} ghi chú</span></div>`
      : `<a class="card" href="${t.href}"><span class="name">${t.name}</span><span class="desc">${t.n} ghi chú</span></a>`

  let recentHtml = ""
  if (recentItems.length > 0) {
    const recentRows = recentItems
      .map((item) => {
        const badge =
          item.type === "new"
            ? `<span class="rn-badge rn-new">Mới</span>`
            : `<span class="rn-badge rn-update">Cập nhật</span>`
        const titleEl = sitePassword
          ? `<span class="rn-title">${escapeHtml(item.title)}</span>`
          : `<a class="rn-title" href="./${item.slug}">${escapeHtml(item.title)}</a>`
        return `<div class="rn-item">${badge}${titleEl}<span class="rn-meta">${escapeHtml(item.topic)} · ${item.dayVN}</span></div>`
      })
      .join("")
    const allLink = sitePassword
      ? ""
      : `<a class="rn-all-link" href="./${releaseNotesSlug}">Xem toàn bộ Release Notes →</a>`
    recentHtml = `<div class="rn-home-section"><div class="rn-home-header"><h2>Mới cập nhật</h2>${allLink}</div><div class="rn-list">${recentRows}</div></div>`
  }

  const html = `<div class="home-cards"><p>Khu vườn ghi chú cá nhân: ${notes} ghi chú, ${topics.length} chủ đề, nối với nhau bằng liên kết. Chọn một chủ đề bên dưới, nhấn <kbd>Ctrl</kbd> + <kbd>K</kbd> để tìm kiếm, hoặc xem toàn bộ mạng lưới ở sơ đồ bên phải.</p>${recentHtml}<h2>Chủ đề</h2><div class="cards">${topics.map(card).join("")}</div></div>`
  const idx = path.join(outDir, "index.md")
  const old = fs.readFileSync(idx, "utf8")
  // index.md luôn có frontmatter dạng ---<khối>---<nội dung> do đoạn trên tạo ra
  const parts = old.split("---")
  const fmLines = (parts[1] ?? "").split(/\r?\n/).filter((l) => !/^title:/i.test(l) && l.trim())
  fmLines.unshift(`title: ${process.env.HOME_TITLE ?? "Digital Garden"}`)
  fs.writeFileSync(idx, ["---", ...fmLines, "---", "", html, ""].join(String.fromCharCode(10)))
  console.log(`Trang chủ dạng thẻ: ${topics.length} chủ đề`)
}
