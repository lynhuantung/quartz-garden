// TL wiki — Tìm kiếm nâng cao + Ghi chú ngẫu nhiên, đặt trên ô tìm kiếm Ctrl+K của Quartz.
//
// Cú pháp (các điều kiện ghép bằng AND; không phân biệt hoa thường và dấu tiếng Việt):
//   từ khóa            từ khóa trong tiêu đề hoặc nội dung
//   "cụm từ"           cụm từ chính xác
//   #tag               ghi chú có tag (gồm cả tag con, ví dụ #sach khớp cả sach/tu-duy)
//   /thư-mục           ghi chú nằm trong thư mục (có khoảng trắng: /"Học hỏi")
//   title:từ           chỉ tìm trong tiêu đề       (bí danh: tieu-de:)
//   body:từ            chỉ tìm trong nội dung      (bí danh: noi-dung:)
//   links:tên          ghi chú có liên kết tới note "tên"
//   is:orphan          ghi chú mồ côi (không liên kết đi và không ai liên kết tới)
//   is:untagged        ghi chú chưa gắn tag
//   -điều-kiện         loại trừ, dùng được với mọi điều kiện trên (-từ, -#tag, -/thư-mục, -"cụm từ")
//   a | b   (hoặc OR) khớp nhóm điều kiện bên trái HOẶC nhóm bên phải, ví dụ: #sach sherlock | #memory
//
// Câu tìm có toán tử (/thư-mục, -loại-trừ, "cụm từ", title:, links:, is:, hoặc từ 2 tag) sẽ được lớp này
// xử lý và hiện danh sách kết quả riêng; câu tìm thường (từ khóa hoặc một #tag) vẫn dùng tìm kiếm gốc của Quartz
// để giữ nguyên khung xem trước. Nút "Ngẫu nhiên · N" luôn dùng ĐÚNG bộ lọc này, nên N khớp với điều kiện đang gõ.
//
// Nguồn dữ liệu: contentIndex (biến toàn cục `fetchData` do Quartz tạo; khi site bật mã hóa,
// window.fetch đã được bọc để tự giải mã nên mã này dùng được ở cả hai chế độ).
;(function () {
  if (window.__tlSearchPlusInit) return
  window.__tlSearchPlusInit = true

  var BTN_ID = "tl-random-note-btn"
  var HISTORY_KEY = "tl-random-seen"
  var MAX_HISTORY = 30
  var MAX_RESULTS = 60
  var MAX_FOLDER_SUGGEST = 12
  var HISTORY_SEARCH_KEY = "tl-search-history"
  var MAX_SEARCH_HISTORY = 8
  var HAS_KEYBOARD = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches)
  var PLACEHOLDER =
    window.innerWidth < 520 ? "Tìm… /thư-mục #tag" : 'Tìm kiếm… gõ / thư mục, #tag, -loại trừ, "cụm từ"'

  // ---------- tiện ích ----------
  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
  }

  function normSpace(s) {
    return fold(s).replace(/\s+/g, " ").trim()
  }

  // Fold từng ký tự, kèm bảng ánh xạ vị trí về chuỗi gốc (để tô sáng đúng chữ có dấu); gộp khoảng trắng.
  function foldMap(s) {
    var out = ""
    var map = []
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i)
      if (/\s/.test(ch)) {
        if (out.length && out.charAt(out.length - 1) !== " ") {
          out += " "
          map.push(i)
        }
        continue
      }
      var f = fold(ch)
      for (var j = 0; j < f.length; j++) {
        out += f.charAt(j)
        map.push(i)
      }
    }
    return { text: out, map: map }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined && text !== null) n.textContent = text
    return n
  }

  function currentSlug() {
    return (document.body && document.body.dataset && document.body.dataset.slug) || "index"
  }

  function rootPrefix(slug) {
    var depth = slug.split("/").length - 1
    return depth > 0 ? "../".repeat(depth) : "./"
  }

  // Slug của Quartz là chữ thường; trang "release-notes" do script sinh tự động (liên kết tới mọi ghi chú).
  function isExcluded(slug) {
    var s = slug.toLowerCase()
    return s === "index" || s === "404" || s === "release-notes" || s.indexOf("tags/") === 0 || /(^|\/)index$/.test(s)
  }

  function readSeen() {
    try {
      var raw = sessionStorage.getItem(HISTORY_KEY)
      return raw ? JSON.parse(raw) : []
    } catch (e) {
      return []
    }
  }

  function writeSeen(list) {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-MAX_HISTORY)))
    } catch (e) {}
  }

  function readSearchHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_SEARCH_KEY)
      var list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch (e) {
      return []
    }
  }

  function remember(q) {
    q = String(q || "").trim()
    if (!q) return
    var list = readSearchHistory().filter(function (x) {
      return x !== q
    })
    list.unshift(q)
    try {
      localStorage.setItem(HISTORY_SEARCH_KEY, JSON.stringify(list.slice(0, MAX_SEARCH_HISTORY)))
    } catch (e) {}
  }

  function go(slug) {
    var url = new URL(rootPrefix(currentSlug()) + encodeURI(slug), window.location.href)
    if (typeof window.spaNavigate === "function") window.spaNavigate(url)
    else window.location.href = url.toString()
  }

  // ---------- dữ liệu ----------
  var cache = null

  async function loadIndex() {
    if (typeof fetchData !== "undefined") return await fetchData
    var res = await fetch(rootPrefix(currentSlug()) + "static/contentIndex.json")
    return await res.json()
  }

  async function loadCache() {
    if (cache) return cache
    var data = (await loadIndex()) || {}
    var entries = []
    var folders = {}
    var tagCounts = {}
    var inbound = {}
    Object.keys(data).forEach(function (slug) {
      if (isExcluded(slug)) return
      var d = data[slug] || {}
      var title = String(d.title || slug)
      var content = String(d.content || "")
      var tags = (d.tags || []).map(String)
      var fp = String(d.filePath || "")
      var dirDisp = fp.lastIndexOf("/") > 0 ? fp.slice(0, fp.lastIndexOf("/")) : ""
      var links = (d.links || [])
        .map(function (l) {
          return fold(String(l).split("#")[0])
        })
        .filter(Boolean)
      var self = fold(slug)
      links.forEach(function (l) {
        if (l !== self) inbound[l] = true
      })
      var seenTag = {}
      tags.forEach(function (t) {
        var tp = t.split("/")
        for (var k = 1; k <= tp.length; k++) {
          var pre = tp.slice(0, k).join("/")
          if (!seenTag[pre]) {
            seenTag[pre] = true
            tagCounts[pre] = (tagCounts[pre] || 0) + 1
          }
        }
      })
      var titleN = normSpace(title)
      var bodyN = normSpace(content)
      var parts = dirDisp ? dirDisp.split("/") : []
      for (var i = 1; i <= parts.length; i++) {
        var label = parts.slice(0, i).join("/")
        var key = fold(label).replace(/\s+/g, "-")
        if (!folders[key]) folders[key] = { key: key, label: label, count: 0, depth: i }
        folders[key].count++
      }
      entries.push({
        slug: slug,
        slugN: fold(slug),
        title: title,
        content: content,
        titleN: titleN,
        bodyN: bodyN,
        hayN: titleN + " " + bodyN,
        tags: tags,
        tagsN: tags.map(fold),
        dirDisp: dirDisp,
        dirN: fold(dirDisp).replace(/\s+/g, "-"),
        links: links,
        orphan: false,
      })
    })
    var real = {}
    entries.forEach(function (e) {
      real[e.slugN] = true
    })
    // Mồ côi = không có liên kết đi tới ghi chú nào khác (không tính trang thư mục/tag) và không ai liên kết tới.
    entries.forEach(function (e) {
      var out = e.links.filter(function (l) {
        return real[l] && l !== e.slugN
      })
      e.orphan = out.length === 0 && !inbound[e.slugN]
    })
    cache = {
      tags: Object.keys(tagCounts)
        .map(function (t) {
          return { tag: t, count: tagCounts[t] }
        })
        .sort(function (a, b) {
          return b.count - a.count || (a.tag < b.tag ? -1 : 1)
        }),
      entries: entries,
      folders: Object.keys(folders).map(function (k) {
        return folders[k]
      }),
    }
    return cache
  }

  // ---------- phân tích câu tìm ----------
  function tokenize(str) {
    var tokens = []
    var cur = ""
    var inQ = false
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i)
      if (c === '"') {
        inQ = !inQ
        cur += c
        continue
      }
      if (!inQ && /\s/.test(c)) {
        if (cur) tokens.push(cur)
        cur = ""
        continue
      }
      cur += c
    }
    if (cur) tokens.push(cur)
    return tokens
  }

  function parseToken(raw) {
    var t = raw
    var neg = false
    if (t.length > 1 && t.charAt(0) === "-") {
      neg = true
      t = t.slice(1)
    }
    var c = { raw: raw, neg: neg, type: "text", field: "any", phrase: false, disp: "", value: "" }
    var v = t
    var m
    if (t.charAt(0) === "#") {
      c.type = "tag"
      v = t.slice(1)
    } else if (t.charAt(0) === "/") {
      c.type = "folder"
      v = t.slice(1)
    } else if ((m = /^(title|tieu-de|body|noi-dung|links|is):(.*)$/i.exec(t))) {
      var k = m[1].toLowerCase()
      v = m[2]
      if (k === "title" || k === "tieu-de") c.field = "title"
      else if (k === "body" || k === "noi-dung") c.field = "body"
      else c.type = k
    }
    c.phrase = v.indexOf('"') !== -1
    v = v.replace(/"/g, "").trim()
    if (!v) return null
    c.disp = v
    if (c.type === "folder" || c.type === "links") c.value = fold(v).replace(/\s+/g, "-").replace(/\/+$/, "")
    else c.value = normSpace(v)
    return c
  }

  // Trả về danh sách nhóm; điều kiện trong một nhóm ghép bằng AND, các nhóm ghép bằng OR (ngăn bởi "|" hoặc "OR").
  function parseQuery(q) {
    var groups = [[]]
    tokenize(q).forEach(function (raw) {
      if (raw === "|" || raw === "OR") {
        if (groups[groups.length - 1].length) groups.push([])
        return
      }
      var c = parseToken(raw)
      if (c) groups[groups.length - 1].push(c)
    })
    return groups.filter(function (g) {
      return g.length
    })
  }

  function flatten(groups) {
    return [].concat.apply([], groups)
  }

  function needsAdvanced(groups) {
    if (groups.length > 1) return true
    var conds = groups[0] || []
    var tagCount = 0
    for (var i = 0; i < conds.length; i++) {
      var c = conds[i]
      if (c.neg || c.phrase || c.field !== "any") return true
      if (c.type === "folder" || c.type === "links" || c.type === "is") return true
      if (c.type === "tag") tagCount++
    }
    return tagCount >= 2
  }

  function condLabel(c) {
    var base
    if (c.type === "tag") base = "#" + c.disp
    else if (c.type === "folder") base = "Thư mục: " + c.disp
    else if (c.type === "links") base = "Liên kết tới: " + c.disp
    else if (c.type === "is")
      base = c.value === "orphan" ? "Mồ côi" : c.value === "untagged" ? "Chưa có tag" : "is:" + c.disp + " (?)"
    else if (c.field === "title") base = "Tiêu đề: " + c.disp
    else if (c.field === "body") base = "Nội dung: " + c.disp
    else base = c.phrase ? '"' + c.disp + '"' : c.disp
    return (c.neg ? "Không " : "") + base
  }

  // ---------- bộ lọc ----------
  function startsPath(s, v) {
    return s === v || s.indexOf(v + "/") === 0
  }

  function matchCond(e, c) {
    var r
    if (c.type === "tag") {
      r = e.tagsN.some(function (x) {
        return startsPath(x, c.value)
      })
    } else if (c.type === "folder") {
      r = startsPath(e.slugN, c.value) || startsPath(e.dirN, c.value)
    } else if (c.type === "links") {
      r = e.links.some(function (l) {
        return l.indexOf(c.value) !== -1
      })
    } else if (c.type === "is") {
      r = c.value === "orphan" ? e.orphan : c.value === "untagged" ? e.tags.length === 0 : false
    } else if (c.field === "title") {
      r = e.titleN.indexOf(c.value) !== -1
    } else if (c.field === "body") {
      r = e.bodyN.indexOf(c.value) !== -1
    } else {
      r = e.hayN.indexOf(c.value) !== -1
    }
    return c.neg ? !r : r
  }

  function countOcc(hay, needle, cap) {
    var n = 0
    var i = -1
    while (n < cap && (i = hay.indexOf(needle, i + 1)) !== -1) n++
    return n
  }

  function scoreGroup(e, conds) {
    var s = 0
    conds.forEach(function (c) {
      if (c.neg || c.type !== "text") return
      if (e.titleN.indexOf(c.value) !== -1) {
        s += 10
        if (e.titleN === c.value) s += 20
        else if (e.titleN.indexOf(c.value) === 0) s += 4
      }
      if (c.field !== "title") s += countOcc(e.bodyN, c.value, 5)
      if (e.slugN.indexOf(c.value) !== -1) s += 1
    })
    return s
  }

  // Chạy một câu tìm trên toàn bộ ghi chú. Phải gọi sau khi loadCache().
  function matchGroup(e, g) {
    return g.every(function (c) {
      return matchCond(e, c)
    })
  }

  function run(q) {
    var groups = parseQuery(q)
    var conds = flatten(groups)
    var hasText = conds.some(function (c) {
      return !c.neg && c.type === "text"
    })
    var items = cache.entries.filter(function (e) {
      return (
        groups.length === 0 ||
        groups.some(function (g) {
          return matchGroup(e, g)
        })
      )
    })
    if (hasText) {
      var scored = items.map(function (e) {
        var best = 0
        groups.forEach(function (g) {
          if (matchGroup(e, g)) best = Math.max(best, scoreGroup(e, g))
        })
        return { e: e, s: best }
      })
      scored.sort(function (a, b) {
        return b.s - a.s || (a.e.slugN < b.e.slugN ? -1 : 1)
      })
      items = scored.map(function (x) {
        return x.e
      })
    } else {
      items.sort(function (a, b) {
        return a.slugN < b.slugN ? -1 : a.slugN > b.slugN ? 1 : 0
      })
    }
    return { groups: groups, conds: conds, items: items, advanced: needsAdvanced(groups) }
  }

  // ---------- ngẫu nhiên ----------
  // Chọn ngẫu nhiên, ưu tiên ghi chú chưa xem trong phiên. Không ghi lịch sử (xem markSeen).
  function choose(slugs, here) {
    var seen = readSeen()
    var fresh = slugs.filter(function (s) {
      return s !== here && seen.indexOf(s) === -1
    })
    if (fresh.length === 0) {
      fresh = slugs.filter(function (s) {
        return s !== here
      })
    }
    if (fresh.length === 0) return null
    return fresh[Math.floor(Math.random() * fresh.length)]
  }

  // Lịch sử tự cắt còn MAX_HISTORY mục; khi mọi ứng viên đều đã xem, choose() tự bỏ qua lịch sử.
  function markSeen(slug) {
    var seen = readSeen().filter(function (s) {
      return s !== slug
    })
    seen.push(slug)
    writeSeen(seen)
  }

  function pick(slugs, here) {
    var chosen = choose(slugs, here)
    if (chosen) markSeen(chosen)
    return chosen
  }

  // Nút nổi chỉ cần danh sách slug, không cần chuẩn hóa toàn bộ nội dung như loadCache()
  // (việc đó tốn vài trăm ms trên điện thoại ở lần bấm đầu tiên).
  var allSlugs = null
  var nextPick = null
  var prefetched = {}

  async function loadSlugs() {
    if (allSlugs) return allSlugs
    var data = (await loadIndex()) || {}
    allSlugs = Object.keys(data).filter(function (s) {
      return !isExcluded(s)
    })
    return allSlugs
  }

  function idle(fn, timeout) {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: timeout })
    else setTimeout(fn, 300)
  }

  // Chọn sẵn ghi chú cho lần bấm tới và tải trước HTML của nó vào cache trình duyệt
  // (GitHub Pages trả max-age=600), nên lúc bấm spaNavigate lấy ngay từ cache thay vì chờ mạng.
  async function prepareNext() {
    try {
      var slugs = await loadSlugs()
      var here = currentSlug()
      if (!nextPick || nextPick === here) nextPick = choose(slugs, here)
      var s = nextPick
      if (!s || prefetched[s]) return
      prefetched[s] = true
      fetch(new URL(rootPrefix(here) + encodeURI(s), window.location.href).toString(), { priority: "low" }).catch(
        function () {
          delete prefetched[s]
        },
      )
    } catch (e) {}
  }

  // Trả về thông báo lỗi (chuỗi) nếu không mở được, ngược lại trả về null.
  async function openRandom(q) {
    if (!q) {
      var all = await loadSlugs()
      var here = currentSlug()
      var target = nextPick && nextPick !== here ? nextPick : choose(all, here)
      nextPick = null
      if (!target) return all.length ? "Chỉ có 1 ghi chú và bạn đang xem nó rồi." : "Không có ghi chú nào khớp."
      markSeen(target)
      go(target)
      return null
    }
    await loadCache()
    var slugs = run(q).items.map(function (e) {
      return e.slug
    })
    if (slugs.length === 0) return "Không có ghi chú nào khớp."
    var target = pick(slugs, currentSlug())
    if (!target) return "Chỉ có 1 ghi chú khớp và bạn đang xem nó rồi."
    go(target)
    return null
  }

  function flash(node, text) {
    var old = node.getAttribute("data-label") || node.textContent
    node.setAttribute("data-label", old)
    node.textContent = text
    node.classList.add("is-warn")
    setTimeout(function () {
      node.textContent = old
      node.classList.remove("is-warn")
    }, 1800)
  }

  // ---------- tô sáng & trích đoạn ----------
  function termsOf(conds) {
    return conds
      .filter(function (c) {
        return !c.neg && c.type === "text"
      })
      .map(function (c) {
        return c.value
      })
  }

  function appendHighlighted(parent, text, terms) {
    var fm = foldMap(text)
    var ranges = []
    terms.forEach(function (t) {
      if (!t) return
      var i = -1
      while ((i = fm.text.indexOf(t, i + 1)) !== -1) {
        ranges.push([fm.map[i], fm.map[i + t.length - 1] + 1])
      }
    })
    ranges.sort(function (a, b) {
      return a[0] - b[0]
    })
    var merged = []
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push([r[0], r[1]])
    })
    var pos = 0
    merged.forEach(function (r) {
      if (r[0] > pos) parent.appendChild(document.createTextNode(text.slice(pos, r[0])))
      parent.appendChild(el("mark", "", text.slice(r[0], r[1])))
      pos = r[1]
    })
    if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)))
  }

  function makeSnippet(e, terms) {
    var content = e.content
    var start = 0
    for (var i = 0; i < terms.length; i++) {
      var p = e.bodyN.indexOf(terms[i])
      if (p !== -1) {
        // bodyN đã bị gộp khoảng trắng nên vị trí chỉ gần đúng: lấy cửa sổ rộng rồi tìm lại chính xác.
        var winStart = Math.max(0, p - 200)
        var win = content.slice(winStart, p + 320)
        var fm = foldMap(win)
        var q = fm.text.indexOf(terms[i])
        if (q !== -1) {
          start = winStart + fm.map[q]
          break
        }
      }
    }
    var from = Math.max(0, start - 60)
    var text = content
      .slice(from, from + 190)
      .replace(/[├└│─┬┴┼┌┐┘]+/g, " ")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s+/g, " ")
      .trim()
    return (from > 0 ? "… " : "") + text + (from + 190 < content.length ? " …" : "")
  }

  // ---------- nút nổi ----------
  var DICE_SVG =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="4"/>' +
    '<circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/></svg>'

  function mountFab() {
    var btn = document.getElementById(BTN_ID)
    if (btn) return
    btn = document.createElement("button")
    btn.id = BTN_ID
    btn.type = "button"
    btn.className = "tl-random-btn"
    btn.setAttribute("aria-label", "Mở ghi chú ngẫu nhiên")
    btn.title = "Mở ghi chú ngẫu nhiên (muốn lọc theo #tag, /thư-mục: dùng ô tìm kiếm Ctrl+K)"
    btn.innerHTML = DICE_SVG + '<span class="tl-random-label">Ngẫu nhiên</span>'
    btn.addEventListener("click", async function () {
      if (btn.dataset.busy === "1") return
      btn.dataset.busy = "1"
      btn.classList.add("is-spinning")
      try {
        var err = await openRandom("")
        if (err) flash(btn.querySelector(".tl-random-label"), err)
      } catch (e) {
        console.error("TL wiki: không mở được ghi chú ngẫu nhiên", e)
      } finally {
        setTimeout(function () {
          btn.classList.remove("is-spinning")
          btn.dataset.busy = "0"
        }, 150)
      }
    })
    document.body.appendChild(btn)
  }

  // ---------- tìm kiếm nâng cao ----------
  function removeToken(st, raw) {
    var tokens = tokenize(st.input.value)
    var i = tokens.indexOf(raw)
    if (i !== -1) tokens.splice(i, 1)
    st.input.value = tokens.length ? tokens.join(" ") + " " : ""
    st.input.focus()
    update(st)
  }

  function folderToken(label) {
    return "/" + (/\s/.test(label) ? '"' + label + '"' : label)
  }

  function folderSuggestions(q) {
    if (!q || /\s$/.test(q)) return []
    var tokens = tokenize(q)
    var last = tokens[tokens.length - 1] || ""
    var neg = last.charAt(0) === "-"
    var body = neg ? last.slice(1) : last
    if (body.charAt(0) !== "/") return []
    var prefix = fold(body.slice(1).replace(/"/g, "")).replace(/\s+/g, "-")
    var list = cache.folders
      .filter(function (f) {
        return f.key.indexOf(prefix) === 0 && f.key !== prefix
      })
      .sort(function (a, b) {
        return a.depth - b.depth || b.count - a.count
      })
      .slice(0, MAX_FOLDER_SUGGEST)
    return list.map(function (f) {
      return {
        label: f.label,
        count: f.count,
        apply: function (st) {
          var cut = q.length - last.length
          st.input.value = q.slice(0, cut) + (neg ? "-" : "") + folderToken(f.label) + " "
          st.input.focus()
          update(st)
        },
      }
    })
  }

  var HELP = [
    ["/thư-mục", 'chỉ trong thư mục (có khoảng trắng: /"Học hỏi")'],
    ["#tag", "có tag, gồm cả tag con; ghép nhiều #tag"],
    ['"cụm từ"', "cụm từ chính xác"],
    ["-từ  -#tag  -/thư-mục", "loại trừ"],
    ["title:từ  body:từ", "chỉ tìm trong tiêu đề / nội dung"],
    ["links:tên", "ghi chú có liên kết tới note đó"],
    ["is:orphan  is:untagged", "ghi chú mồ côi / chưa có tag"],
    ["a | b   hoặc   a OR b", "khớp nhóm bên trái HOẶC nhóm bên phải"],
  ]

  function renderPanel(st, q, res) {
    var p = st.panel
    p.textContent = ""

    var head = el("div", "tl-adv-head")
    res.groups.forEach(function (g, gi) {
      if (gi > 0) head.appendChild(el("span", "tl-adv-or", "hoặc"))
      g.forEach(function (c) {
        var chip = el("button", "tl-adv-chip" + (c.neg ? " is-neg" : ""), condLabel(c) + " ×")
        chip.type = "button"
        chip.title = "Bỏ điều kiện này"
        chip.addEventListener("click", function () {
          removeToken(st, c.raw)
        })
        head.appendChild(chip)
      })
    })
    p.appendChild(head)

    var sugg = folderSuggestions(q)
    if (sugg.length) {
      var box = el("div", "tl-adv-folders")
      box.appendChild(el("span", "tl-adv-folders-title", "Thư mục:"))
      sugg.forEach(function (s) {
        var b = el("button", "tl-adv-folder", s.label + " · " + s.count)
        b.type = "button"
        b.addEventListener("click", function () {
          s.apply(st)
        })
        box.appendChild(b)
      })
      p.appendChild(box)
    }

    if (!res.conds.length) {
      st.shown = []
      st.active = -1
      p.appendChild(el("div", "tl-adv-summary", "Chọn một thư mục ở trên, hoặc gõ tiếp tên thư mục (ví dụ /books)."))
      return
    }

    if (st.lastQuery !== q) {
      st.limit = MAX_RESULTS
      st.lastQuery = q
    }
    var n = res.items.length
    var summaryEl = el(
        "div",
        "tl-adv-summary",
        n +
          " ghi chú khớp" +
          (n > st.limit ? " (đang hiện " + st.limit + ")" : "") +
          (n && HAS_KEYBOARD ? " — Ctrl/Cmd+Enter để mở ngẫu nhiên" : ""),
      )
    summaryEl.setAttribute("aria-live", "polite")
    p.appendChild(summaryEl)

    if (st.lastQuery !== q) {
      st.limit = MAX_RESULTS
      st.lastQuery = q
    }
    st.shown = res.items.slice(0, st.limit)
    st.active = st.shown.length ? 0 : -1
    var terms = termsOf(res.conds)

    if (!st.shown.length) {
      var help = el("div", "tl-adv-help")
      help.appendChild(el("div", "tl-adv-help-title", "Không có ghi chú nào khớp. Cú pháp tìm kiếm:"))
      HELP.forEach(function (h) {
        var row = el("div", "tl-adv-help-row")
        row.appendChild(el("code", "", h[0]))
        row.appendChild(document.createTextNode(" " + h[1]))
        help.appendChild(row)
      })
      p.appendChild(help)
      return
    }

    var list = el("div", "tl-adv-list")
    st.shown.forEach(function (e, i) {
      var card = el("a", "tl-adv-card" + (i === 0 ? " is-active" : ""))
      card.href = rootPrefix(currentSlug()) + encodeURI(e.slug)
      var title = el("div", "tl-adv-title")
      appendHighlighted(title, e.title, terms)
      card.appendChild(title)
      var meta = el("div", "tl-adv-meta")
      if (e.dirDisp) meta.appendChild(el("span", "tl-adv-path", e.dirDisp.split("/").join(" › ")))
      e.tags.slice(0, 4).forEach(function (t) {
        meta.appendChild(el("span", "tl-adv-tag", "#" + t))
      })
      if (meta.childNodes.length) card.appendChild(meta)
      var snip = makeSnippet(e, terms)
      if (snip) {
        var sn = el("div", "tl-adv-snippet")
        appendHighlighted(sn, snip, terms)
        card.appendChild(sn)
      }
      card.addEventListener("click", function (ev) {
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button !== 0) return
        ev.preventDefault()
        remember(st.input.value)
        go(e.slug)
      })
      list.appendChild(card)
    })
    p.appendChild(list)
    if (n > st.limit) {
      var more = el("button", "tl-adv-more", "Hiện thêm " + Math.min(MAX_RESULTS, n - st.limit) + " kết quả")
      more.type = "button"
      more.addEventListener("click", function () {
        st.limit += MAX_RESULTS
        renderPanel(st, q, res)
        var cards = st.panel.querySelectorAll(".tl-adv-card")
        if (cards[st.limit - MAX_RESULTS]) setActive(st, st.limit - MAX_RESULTS)
      })
      p.appendChild(more)
    }
  }

  function insertToken(st, token) {
    var cur = st.input.value.trim()
    st.input.value = (cur ? cur + " " : "") + token + " "
    st.input.focus()
    update(st)
  }

  function renderHome(st) {
    var p = st.panel
    p.textContent = ""
    st.shown = []
    st.active = -1

    function section(title, items, onClick) {
      if (!items.length) return
      var box = el("div", "tl-adv-folders")
      box.appendChild(el("span", "tl-adv-folders-title", title))
      items.forEach(function (it) {
        var b = el("button", "tl-adv-folder", it.text)
        b.type = "button"
        b.addEventListener("click", function () {
          onClick(it)
        })
        box.appendChild(b)
      })
      p.appendChild(box)
    }

    section(
      "Tìm gần đây:",
      readSearchHistory().map(function (q) {
        return { text: q, q: q }
      }),
      function (it) {
        st.input.value = it.q
        st.input.focus()
        update(st)
      },
    )
    section(
      "Thư mục:",
      cache.folders
        .filter(function (f) {
          return f.depth === 1
        })
        .sort(function (a, b) {
          return b.count - a.count
        })
        .slice(0, 10)
        .map(function (f) {
          return { text: f.label + " · " + f.count, token: folderToken(f.label) }
        }),
      function (it) {
        insertToken(st, it.token)
      },
    )
    section(
      "Tag:",
      cache.tags.slice(0, 12).map(function (t) {
        return { text: "#" + t.tag + " · " + t.count, token: "#" + t.tag }
      }),
      function (it) {
        insertToken(st, it.token)
      },
    )
    var help = el("div", "tl-adv-help")
    help.appendChild(el("div", "tl-adv-help-title", "Cú pháp tìm kiếm"))
    HELP.forEach(function (h) {
      var row = el("div", "tl-adv-help-row")
      row.appendChild(el("code", "", h[0]))
      row.appendChild(document.createTextNode(" " + h[1]))
      help.appendChild(row)
    })
    p.appendChild(help)
  }

  function setActive(st, i) {
    var cards = st.panel.querySelectorAll(".tl-adv-card")
    if (!cards.length) return
    i = Math.max(0, Math.min(cards.length - 1, i))
    cards.forEach(function (c, idx) {
      c.classList.toggle("is-active", idx === i)
    })
    st.active = i
    var c = cards[i]
    if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" })
  }

  async function update(st) {
    var seq = ++st.seq
    var q = st.input.value
    try {
      await loadCache()
    } catch (e) {
      st.label.textContent = "Ngẫu nhiên"
      return
    }
    if (seq !== st.seq) return
    var res = run(q.trim())
    var empty = !q.trim()
    st.advanced = empty || res.advanced || folderSuggestions(q).length > 0
    st.label.textContent = "Ngẫu nhiên · " + res.items.length
    st.space.classList.toggle("tl-adv-active", st.advanced)
    st.panel.hidden = !st.advanced
    if (empty) renderHome(st)
    else if (st.advanced) renderPanel(st, q, res)
  }

  function bindInput(st) {
    var input = st.input
    var timer = null
    input.addEventListener("input", function () {
      clearTimeout(timer)
      timer = setTimeout(function () {
        update(st)
      }, 120)
    })
    // Pha capture + stopImmediatePropagation để Quartz không hiểu nhầm các phím này.
    input.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          randomFromSearch(st)
          return
        }
        if (!st.advanced) return
        if (!st.shown || !st.shown.length) {
          if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            e.stopImmediatePropagation()
          }
          return
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          e.stopImmediatePropagation()
          setActive(st, st.active + (e.key === "ArrowDown" ? 1 : -1))
        } else if (e.key === "Enter") {
          e.preventDefault()
          e.stopImmediatePropagation()
          var target = st.shown[st.active < 0 ? 0 : st.active]
          if (target) {
            remember(st.input.value)
            go(target.slug)
          }
        }
      },
      true,
    )
  }

  async function randomFromSearch(st) {
    if (st.btn.dataset.busy === "1") return
    st.btn.dataset.busy = "1"
    try {
      var err = await openRandom(st.input.value.trim())
      if (err) flash(st.label, err)
      else remember(st.input.value)
    } catch (e) {
      console.error("TL wiki: không mở được ghi chú ngẫu nhiên", e)
    } finally {
      st.btn.dataset.busy = "0"
    }
  }

  function ensureSearch(space) {
    var input = space.querySelector(".search-bar")
    if (!input) return
    var st = space.__tl
    if (!st || st.input !== input) {
      st = space.__tl = { space: space, input: input, seq: 0, active: -1, shown: [], advanced: false, limit: MAX_RESULTS, lastQuery: null }
      bindInput(st)
    }
    var btn = space.querySelector(".tl-search-random")
    if (!btn) {
      btn = el("button", "tl-search-random")
      btn.type = "button"
      btn.title = "Mở ghi chú ngẫu nhiên khớp điều kiện đang gõ (Ctrl/Cmd+Enter)"
      btn.innerHTML = DICE_SVG.replace(/width="22" height="22"/, 'width="16" height="16"') + "<span>Ngẫu nhiên</span>"
      btn.addEventListener("click", function () {
        randomFromSearch(space.__tl)
      })
      input.insertAdjacentElement("afterend", btn)
    }
    var panel = space.querySelector(".tl-adv-panel")
    if (!panel) {
      panel = el("div", "tl-adv-panel")
      panel.hidden = true
      var layout = space.querySelector(".search-layout")
      if (layout) layout.insertAdjacentElement("beforebegin", panel)
      else btn.insertAdjacentElement("afterend", panel)
    }
    st.btn = btn
    st.label = btn.querySelector("span")
    st.panel = panel
    space.classList.add("tl-has-random")
    input.placeholder = PLACEHOLDER
    update(st)
  }

  function mount() {
    if (!document.body) return
    mountFab()
    document.querySelectorAll(".search-space").forEach(ensureSearch)
    idle(prepareNext, 1500)
  }

  // `nav` chỉ phát sau khi Quartz (và cổng đăng nhập, nếu có) đã sẵn sàng,
  // nên các nút không hiện trên màn hình khóa.
  document.addEventListener("nav", mount)
  if (document.getElementById("quartz-root") && document.querySelector(".page")) mount()

  // Dùng cho kiểm thử / gỡ lỗi.
  window.__tlSearch = {
    parseQuery: parseQuery,
    needsAdvanced: needsAdvanced,
    fold: fold,
    run: async function (q) {
      await loadCache()
      return run(q)
    },
  }
})()
