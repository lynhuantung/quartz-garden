// Tính sẵn quan hệ giữa các ghi chú cho nút Ngẫu nhiên và GẮN THẲNG vào public/static/contentIndex.json
// (chạy sau `quartz build`, TRƯỚC protect-site.mjs, nên dữ liệu được mã hóa cùng contentIndex, không lộ ra file riêng).
//
// Mỗi ghi chú được thêm trường `tl`:
//   n: chỉ số các ghi chú liên kết trực tiếp (vô hướng)          — "hàng xóm"
//   r: [[chỉ số, loại, điểm], ...] ghi chú LIÊN QUAN nhưng CHƯA liên kết:
//        1 = Adamic–Adar (hàng xóm chung, hàng xóm ít liên kết được tính nặng hơn)
//        2 = Đồng trích dẫn (co-citation, có hướng: ghi chú khác cùng dẫn tới cả hai)
//        3 = Cosine TF-IDF (giống nhau về tiêu đề, tag, nội dung)
//   c: mã cụm (Louvain trên đồ thị liên kết)
//   b: Betweenness theo phần trăm (0–100): ghi chú nằm trên nhiều đường ngắn nhất, "cầu nối" giữa các vùng
// Chỉ số = vị trí trong Object.keys(contentIndex) (thứ tự khóa JSON được giữ nguyên khi parse ở trình duyệt).
import fs from "node:fs"
import path from "node:path"

const file = process.argv[2] || path.join(process.cwd(), "public", "static", "contentIndex.json")
const data = JSON.parse(fs.readFileSync(file, "utf8"))
const keys = Object.keys(data)
const TOP = 6

const isExcluded = (slug) => {
  const s = slug.toLowerCase()
  return s === "index" || s === "404" || s === "release-notes" || s.startsWith("tags/") || /(^|\/)index$/.test(s)
}
const lower = (s) => String(s || "").toLowerCase()
const keyIndex = new Map()
keys.forEach((k, i) => keyIndex.set(lower(k), i))
const notes = keys.map((k, i) => i).filter((i) => !isExcluded(keys[i]))
const isNote = new Set(notes)

// ---------- đồ thị liên kết ----------
const out = new Map() // có hướng
const und = new Map() // vô hướng
notes.forEach((i) => {
  out.set(i, new Set())
  und.set(i, new Set())
})
for (const i of notes) {
  for (const raw of data[keys[i]].links || []) {
    const t = lower(String(raw).split("#")[0]).replace(/\/index$/, "")
    const j = keyIndex.get(t)
    if (j === undefined || j === i || !isNote.has(j)) continue
    out.get(i).add(j)
    und.get(i).add(j)
    und.get(j).add(i)
  }
}
const deg = (i) => und.get(i).size
const linked = (a, b) => und.get(a).has(b)

// ---------- Adamic–Adar ----------
const aa = new Map()
const bump = (m, a, b, v) => {
  if (!m.has(a)) m.set(a, new Map())
  m.get(a).set(b, (m.get(a).get(b) || 0) + v)
}
for (const w of notes) {
  const nb = [...und.get(w)]
  if (nb.length < 2) continue
  const v = 1 / Math.log(nb.length)
  for (let x = 0; x < nb.length; x++)
    for (let y = x + 1; y < nb.length; y++) {
      const a = nb[x]
      const b = nb[y]
      if (linked(a, b)) continue
      bump(aa, a, b, v)
      bump(aa, b, a, v)
    }
}

// ---------- Đồng trích dẫn (có hướng): C và D cùng dẫn tới A và B => A–B ----------
const cc = new Map()
for (const c of notes) {
  const t = [...out.get(c)]
  for (let x = 0; x < t.length; x++)
    for (let y = x + 1; y < t.length; y++) {
      const a = t[x]
      const b = t[y]
      if (linked(a, b)) continue
      bump(cc, a, b, 1)
      bump(cc, b, a, 1)
    }
}

// ---------- Cosine TF-IDF ----------
const syl = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 1 && !/^\d+$/.test(x))
const termsOf = (i) => {
  const d = data[keys[i]]
  const tf = new Map()
  const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w)
  const feed = (text, w) => {
    const s = syl(text)
    s.forEach((x, k) => {
      add(x, w)
      if (k + 1 < s.length) add(x + " " + s[k + 1], w * 1.5)
    })
  }
  feed(d.title, 3)
  feed(String(d.content || "").slice(0, 6000), 1)
  ;(d.tags || []).forEach((t) => add("#" + lower(t), 2))
  return tf
}
const tfs = new Map(notes.map((i) => [i, termsOf(i)]))
const df = new Map()
for (const tf of tfs.values()) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1)
const N = notes.length
const vec = new Map()
for (const [i, tf] of tfs) {
  const v = new Map()
  let norm = 0
  for (const [t, f] of tf) {
    const d = df.get(t)
    if (d < 2 || d > N * 0.2) continue // bỏ từ quá hiếm (nhiễu) và quá phổ biến (như stopword, tag "zettel")
    const w = (1 + Math.log(f)) * Math.log(N / d)
    v.set(t, w)
    norm += w * w
  }
  norm = Math.sqrt(norm) || 1
  for (const [t, w] of v) v.set(t, w / norm)
  vec.set(i, v)
}
const inv = new Map()
for (const [i, v] of vec) for (const [t, w] of v) {
  if (!inv.has(t)) inv.set(t, [])
  inv.get(t).push([i, w])
}
const cs = new Map()
for (const [i, v] of vec) {
  const acc = new Map()
  for (const [t, w] of v) for (const [j, w2] of inv.get(t)) if (j !== i) acc.set(j, (acc.get(j) || 0) + w * w2)
  for (const [j, s] of acc) if (s >= 0.25 && !linked(i, j)) bump(cs, i, j, s)
}

// ---------- Louvain ----------
function louvain(nodeList, edges) {
  // edges: Map(node -> Map(node -> w)), vô hướng, có thể có self-loop
  let comm = new Map(nodeList.map((x) => [x, x]))
  let graph = edges
  let members = new Map(nodeList.map((x) => [x, [x]]))
  for (let level = 0; level < 10; level++) {
    const nodes = [...graph.keys()]
    const k = new Map()
    let m2 = 0
    for (const u of nodes) {
      let s = 0
      for (const [, w] of graph.get(u)) s += w
      k.set(u, s)
      m2 += s
    }
    if (m2 === 0) break
    const c = new Map(nodes.map((u) => [u, u]))
    const tot = new Map(nodes.map((u) => [u, k.get(u)]))
    let moved = false
    for (let pass = 0; pass < 20; pass++) {
      let changed = 0
      for (const u of nodes) {
        const cu = c.get(u)
        const wTo = new Map()
        for (const [v, w] of graph.get(u)) if (v !== u) wTo.set(c.get(v), (wTo.get(c.get(v)) || 0) + w)
        tot.set(cu, tot.get(cu) - k.get(u))
        let best = cu
        let bestGain = (wTo.get(cu) || 0) - (tot.get(cu) * k.get(u)) / m2
        for (const [cv, w] of wTo) {
          const g = w - (tot.get(cv) * k.get(u)) / m2
          if (g > bestGain + 1e-12) {
            bestGain = g
            best = cv
          }
        }
        tot.set(best, tot.get(best) + k.get(u))
        if (best !== cu) {
          c.set(u, best)
          changed++
        }
      }
      if (!changed) break
      moved = true
    }
    if (!moved) break
    // gộp cụm thành nút mới
    const next = new Map()
    const nextMembers = new Map()
    for (const u of nodes) {
      const cu = c.get(u)
      if (!next.has(cu)) next.set(cu, new Map())
      if (!nextMembers.has(cu)) nextMembers.set(cu, [])
      nextMembers.get(cu).push(...members.get(u))
      for (const [v, w] of graph.get(u)) {
        const cv = c.get(v)
        next.get(cu).set(cv, (next.get(cu).get(cv) || 0) + w)
      }
    }
    graph = next
    members = nextMembers
  }
  let id = 0
  for (const [, list] of [...members].sort((a, b) => b[1].length - a[1].length)) {
    for (const x of list) comm.set(x, id)
    id++
  }
  return comm
}
const edgeMap = new Map(notes.map((i) => [i, new Map([...und.get(i)].map((j) => [j, 1]))]))
const comm = louvain(notes, edgeMap)

// ---------- Betweenness (Brandes, vô hướng, không trọng số) ----------
const bc = new Map(notes.map((i) => [i, 0]))
for (const s of notes) {
  const stack = []
  const pred = new Map()
  const sigma = new Map([[s, 1]])
  const dist = new Map([[s, 0]])
  const q = [s]
  for (let h = 0; h < q.length; h++) {
    const v = q[h]
    stack.push(v)
    for (const w of und.get(v)) {
      if (!dist.has(w)) {
        dist.set(w, dist.get(v) + 1)
        q.push(w)
      }
      if (dist.get(w) === dist.get(v) + 1) {
        sigma.set(w, (sigma.get(w) || 0) + sigma.get(v))
        if (!pred.has(w)) pred.set(w, [])
        pred.get(w).push(v)
      }
    }
  }
  const delta = new Map()
  while (stack.length) {
    const w = stack.pop()
    for (const v of pred.get(w) || []) delta.set(v, (delta.get(v) || 0) + (sigma.get(v) / sigma.get(w)) * (1 + (delta.get(w) || 0)))
    if (w !== s) bc.set(w, bc.get(w) + (delta.get(w) || 0))
  }
}
const ranked = [...bc.entries()].filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1])
const pct = new Map(ranked.map(([i], r) => [i, Math.round(((r + 1) / ranked.length) * 100)]))

// ---------- ghi vào contentIndex ----------
const top = (m, i, kind, min) =>
  [...(m.get(i) || new Map())]
    .filter(([, s]) => s >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([j, s]) => [j, kind, Math.round(s * 100) / 100])
let rel = 0
for (const i of notes) {
  const seen = new Set()
  const r = [...top(aa, i, 1, 0.5), ...top(cc, i, 2, 2), ...top(cs, i, 3, 0.25)].filter(([j]) => !seen.has(j) && seen.add(j))
  rel += r.length
  data[keys[i]].tl = { n: [...und.get(i)], r, c: comm.get(i), b: pct.get(i) || 0 }
}
fs.writeFileSync(file, JSON.stringify(data))
const sizes = {}
for (const i of notes) sizes[comm.get(i)] = (sizes[comm.get(i)] || 0) + 1
const big = Object.values(sizes).filter((x) => x >= 3).length
console.log(
  `build-related: ${notes.length} ghi chú, ${rel} gợi ý liên quan chưa liên kết, ${big} cụm (>=3 ghi chú), ` +
    `betweenness cho ${ranked.length} ghi chú.`,
)
