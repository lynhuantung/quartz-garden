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
//   7/1a  hoặc mã:7/1a  thẻ Zettel theo mã (lấy từ tên tệp "7-1a Tiêu đề.md"), gồm cả thẻ con 7/1a1...;
//                      mã:7/ = mọi thẻ nhánh 7
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

  // ---------- mã Zettel ----------
  // Tên tệp thẻ dạng "7-1a Tiêu đề.md" (mã 7/1a, dấu "/" đổi thành "-"). Slug của Quartz: "7-1a-tiêu-đề".
  // Property "Mã" không có trong contentIndex nên mã được suy ra từ tên tệp/slug.
  var CODE_RE = /^(\d+)-(\d+[a-z0-9]*)(?:[\s-]|$)/i
  var CODE_QUERY_RE = /^\d+\/\d*[a-z0-9]*$/i

  function codeFromName(name) {
    var m = CODE_RE.exec(String(name || ""))
    return m ? m[1] + "/" + m[2].toLowerCase() : ""
  }

  // "7/1" khớp 7/1, 7/1a, 7/1b, 7/1a1 nhưng KHÔNG khớp 7/10; "7/" khớp mọi thẻ nhánh 7.
  function codeMatch(code, v) {
    if (!code || !v) return false
    if (code === v) return true
    if (code.indexOf(v) !== 0) return false
    var last = v.charAt(v.length - 1)
    var next = code.charAt(v.length)
    if (last === "/") return true
    return /\d/.test(last) ? /[a-z]/.test(next) : /\d/.test(next)
  }

  // So sánh mã theo kiểu Folgezettel: 7/1 < 7/1a < 7/1b < 7/2 < 7/10.
  function codeCmp(a, b) {
    var pa = a.match(/\d+|[a-z]+|\//g) || []
    var pb = b.match(/\d+|[a-z]+|\//g) || []
    for (var i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] === pb[i]) continue
      var na = /^\d/.test(pa[i])
      var nb = /^\d/.test(pb[i])
      if (na && nb) return parseInt(pa[i], 10) - parseInt(pb[i], 10)
      return pa[i] < pb[i] ? -1 : 1
    }
    return pa.length - pb.length
  }

  // Huy hiệu mã: rê chuột (title) hoặc chạm (điện thoại) để xem ý nghĩa nhánh và các thẻ cha,
  // vd 8/18b → "Nhánh 8: Bộ não thứ hai" + "8/18: Bốn trụ cột của bộ não thứ hai là gì?".
  var codeTitles = null
  var codeFolder = {}

  function loadCodeTitles(data) {
    if (codeTitles) return codeTitles
    codeTitles = {}
    Object.keys(data).forEach(function (slug) {
      var d = data[slug] || {}
      var c = codeFromName(String(d.filePath || "").split("/").pop() || slug.split("/").pop())
      if (c && !codeTitles[c]) codeTitles[c] = String(d.title || slug)
      // Dự phòng khi nhánh chưa có thẻ mục lục N/0: dùng tên thư mục chứa thẻ.
      var dir = String(d.filePath || "").split("/")
      if (c && dir.length > 1 && !codeFolder[c.split("/")[0]]) codeFolder[c.split("/")[0]] = dir[dir.length - 2].replace(/^\d+\s*-\s*/, "")
    })
    return codeTitles
  }

  function cleanTopic(t) {
    return String(t || "")
      .replace(/\s*\((mục lục|muc luc)\)\s*$/i, "")
      .replace(/\s*-\s*Mục lục\s*$/i, "")
      .trim()
  }

  function codeMeaning(code) {
    if (!codeTitles) return ""
    var parts = code.split("/")
    var branch = parts[0]
    var toks = (parts[1] || "").match(/\d+|[a-z]+/g) || []
    var lines = []
    var root = codeTitles[branch + "/0"]
    lines.push("Nhánh " + branch + ": " + (root ? cleanTopic(root) : codeFolder[branch] || "(chưa có thẻ mục lục " + branch + "/0)"))
    for (var i = 1; i < toks.length; i++) {
      var pc = branch + "/" + toks.slice(0, i).join("")
      if (codeTitles[pc]) lines.push(pc + ": " + codeTitles[pc])
    }
    return lines.join("\n")
  }

  function showTip(text) {
    var old = document.getElementById("tl-why")
    if (old) old.remove()
    var n = el("div", "tl-why", text)
    n.id = "tl-why"
    n.setAttribute("role", "status")
    document.body.appendChild(n)
    setTimeout(function () {
      n.classList.add("is-out")
    }, 4000)
    setTimeout(function () {
      n.remove()
    }, 4600)
  }

  function codeBadge(code, tappable) {
    var b = el("span", "tl-zettel-code", code)
    b.title = "Mã Zettel " + code
    var fill = function () {
      var t = codeMeaning(code)
      if (t) b.title = t
      return t
    }
    if (!fill() && typeof loadIndex === "function")
      loadIndex()
        .then(function (data) {
          loadCodeTitles(data || {})
          fill()
        })
        .catch(function () {})
    if (tappable) {
      b.setAttribute("role", "button")
      b.tabIndex = 0
      var open = function (ev) {
        ev.preventDefault()
        var t = fill()
        if (t) showTip(t)
      }
      b.addEventListener("click", open)
      b.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") open(ev)
      })
    }
    return b
  }

  // Hiện mã Zettel cạnh tiêu đề trang (tiêu đề lấy từ property title nên không chứa mã).
  function showPageCode() {
    var slug = currentSlug()
    var code = codeFromName(decodeURIComponent(slug.split("/").pop() || ""))
    document.querySelectorAll(".article-title").forEach(function (h) {
      var old = h.querySelector(".tl-zettel-code")
      if (old) old.remove()
      if (code) h.insertBefore(codeBadge(code, true), h.firstChild)
    })
  }

  // Nhật ký phát hành sinh link dạng <a data-rn-href="slug"> (không href) để Quartz không tính là liên kết
  // (không thành backlink, không nối trên đồ thị). Gắn href lúc xem để vẫn bấm được.
  function linkReleaseNotes() {
    var pre = rootPrefix(currentSlug())
    document.querySelectorAll("a[data-rn-href]").forEach(function (a) {
      if (!a.getAttribute("href")) a.setAttribute("href", pre + a.getAttribute("data-rn-href"))
    })
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
    buildGraph(data)
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
        if (!folders[key]) folders[key] = { key: key, label: label, count: 0, depth: i, segs: pathSegs(label) }
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
        dirSegs: pathSegs(dirDisp),
        code: codeFromName(fp.split("/").pop() || slug.split("/").pop()),
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
    } else if ((m = /^(ma|mã|zettel):(.*)$/i.exec(t))) {
      c.type = "code"
      v = m[2]
    } else if (CODE_QUERY_RE.test(t) && t.indexOf("/") > 0) {
      c.type = "code"
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
    if (c.type === "folder") c.segs = pathSegs(v.replace(/\/+$/, ""))
    if (c.type === "code") c.value = fold(v).replace(/-/g, "/").replace(/\s+/g, "")
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
      if (c.type === "folder" || c.type === "links" || c.type === "is" || c.type === "code") return true
      if (c.type === "tag") tagCount++
    }
    return tagCount >= 2
  }

  function condLabel(c) {
    var base
    if (c.type === "tag") base = "#" + c.disp
    else if (c.type === "folder") base = "Thư mục: " + c.disp
    else if (c.type === "links") base = "Liên kết tới: " + c.disp
    else if (c.type === "code") base = "Mã Zettel: " + c.value
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

  // Chuẩn hóa từng cấp thư mục: bỏ dấu, gộp khoảng trắng/gạch ngang/gạch dưới/dấu chấm thành một "-".
  // "Books/08 - Phương thức" -> ["books", "08-phuong-thuc"]; gõ "/08 phuong" hay "/08-phuong" đều khớp.
  function segNorm(x) {
    return fold(x).replace(/[\s\-_.–—]+/g, "-").replace(/^-+|-+$/g, "")
  }

  function pathSegs(p) {
    return String(p || "")
      .split("/")
      .map(segNorm)
      .filter(function (x, i, a) {
        return x || i === a.length - 1
      })
  }

  // Khớp đường dẫn theo từng cấp: mỗi cấp gõ vào chỉ cần là phần ĐẦU của cấp tương ứng,
  // cấp cuối được khớp giữa tên khi dài >= 3 ký tự. "/book/08" khớp "Books/08 - Phương thức Toyota";
  // "/book/" gợi ý các thư mục con của Books. Trả về cấp bắt đầu khớp (nhỏ hơn = sát gốc hơn), -1 nếu không khớp.
  function segMatch(segs, qs) {
    if (!segs || !qs || !qs.length) return -1
    for (var s = 0; s + qs.length <= segs.length; s++) {
      var ok = true
      for (var j = 0; j < qs.length && ok; j++) {
        var seg = segs[s + j]
        var q = qs[j]
        var last = j === qs.length - 1
        ok = seg.indexOf(q) === 0 || (last && q.length >= 3 && seg.indexOf(q) > 0)
      }
      if (ok) return s
    }
    return -1
  }

  // Khớp thư mục ở bất kỳ cấp nào: "/toyota" hoặc "/08-phương" tìm được "Books/08 - Phương thức Toyota".
  function folderAnywhere(dirN, v) {
    if (!dirN || !v) return false
    return dirN.split("/").some(function (seg, i, arr) {
      return seg.indexOf(v) === 0 || seg.indexOf(v) > 0 && v.length >= 3
    })
  }

  function matchCond(e, c) {
    var r
    if (c.type === "tag") {
      r = e.tagsN.some(function (x) {
        return startsPath(x, c.value)
      })
    } else if (c.type === "folder") {
      r =
        startsPath(e.slugN, c.value) ||
        startsPath(e.dirN, c.value) ||
        folderAnywhere(e.dirN, c.value) ||
        segMatch(e.dirSegs, c.segs) !== -1
    } else if (c.type === "code") {
      r = codeMatch(e.code, c.value)
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
        if (a.code && b.code && a.dirN === b.dirN) return codeCmp(a.code, b.code)
        return a.slugN < b.slugN ? -1 : a.slugN > b.slugN ? 1 : 0
      })
    }
    return { groups: groups, conds: conds, items: items, advanced: needsAdvanced(groups) }
  }

  // ---------- ôn tập theo đường cong lãng quên (không có nút chấm điểm) ----------
  // Mỗi lần ĐỌC một ghi chú >= USE_MIN_MS (mở bằng random, tìm kiếm hay liên kết đều tính) là một lần "dùng".
  // Lần dùng đúng lúc (đã qua >= nửa khoảng giãn) đẩy ghi chú lên bậc kế tiếp: 1 → 3 → 7 → 16 → 35 → 80 → 180 → 365 ngày.
  // Mở lại quá sớm chỉ ghi nhận "vừa dùng", không lên bậc. Bỏ quên quá lâu (> 4 lần khoảng giãn) thì lùi 1 bậc
  // ("use it or lose it"; tối thiểu bậc 2 để lần đọc này vẫn được tính). Nút random ưu tiên ghi chú đến hạn,
  // cách chọn xem phần "ngẫu nhiên" bên dưới.
  // Lưu trong localStorage nên mỗi thiết bị/trình duyệt có lịch riêng.
  var MEMORY_KEY = "tl-memory"
  var DAY = 86400000
  var INTERVALS = [1, 3, 7, 16, 35, 80, 180, 365]
  var USE_MIN_MS = 8000
  var memo = null

  function memLoad() {
    if (memo) return memo
    try {
      memo = JSON.parse(localStorage.getItem(MEMORY_KEY) || "{}") || {}
    } catch (e) {
      memo = {}
    }
    return memo
  }

  function memSave() {
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memo || {}))
    } catch (e) {}
  }

  function stepDays(n) {
    return INTERVALS[Math.min(Math.max(n, 1), INTERVALS.length) - 1]
  }

  // Bản ghi: [bậc, lần dùng cuối (ms), hạn ôn (ms)].
  function recordUse(slug, now) {
    now = now || Date.now()
    var m = memLoad()
    var r = m[slug]
    var n
    if (!r) {
      n = 1
    } else {
      var gap = stepDays(r[0]) * DAY
      var elapsed = now - r[1]
      if (elapsed < gap / 2) {
        r[1] = now
        memSave()
        return r
      }
      n = elapsed > gap * 4 ? Math.max(2, r[0] - 1) : r[0] + 1
    }
    m[slug] = [n, now, now + stepDays(n) * DAY]
    memSave()
    return m[slug]
  }

  var useTimer = null
  function trackUse() {
    if (useTimer) clearTimeout(useTimer)
    var slug = currentSlug()
    if (isExcluded(slug)) return
    pushTrail(slug)
    useTimer = setTimeout(function () {
      useTimer = null
      if (currentSlug() === slug) recordUse(slug)
    }, USE_MIN_MS)
  }

  function weightedPick(list, weightOf) {
    var total = 0
    var w = list.map(function (x) {
      var v = Math.max(weightOf(x), 0.0001)
      total += v
      return v
    })
    var t = Math.random() * total
    for (var i = 0; i < list.length; i++) {
      t -= w[i]
      if (t <= 0) return list[i]
    }
    return list[list.length - 1]
  }

  function memStats(slugs, now) {
    now = now || Date.now()
    var m = memLoad()
    var due = 0
    var fresh = 0
    slugs.forEach(function (s) {
      var r = m[s]
      if (!r) fresh++
      else if (r[2] <= now) due++
    })
    return { due: due, fresh: fresh, total: slugs.length }
  }

  // ---------- ngẫu nhiên: ôn đúng lúc, đi theo liên kết, sang chủ đề khác ----------
  // Mỗi lần bấm chọn MỘT chế độ (khoảng 20 lần bấm ≈ 12 ôn · 4 kết nối · 2 liên ngành · 2 khám phá):
  //   ôn          ghi chú đến hạn theo đường cong lãng quên; ưu tiên ghi chú gần thứ đang đọc
  //   kết nối     ghi chú liên quan tới vài ghi chú vừa đọc nhưng CHƯA liên kết (Adamic–Adar, đồng trích dẫn,
  //               Cosine) hoặc hàng xóm trực tiếp lâu chưa đọc
  //   liên ngành  cụm (Louvain) ít gặp gần đây, ưu tiên ghi chú cầu nối (Betweenness cao)
  //   khám phá    ghi chú chưa xem bao giờ, hoặc lâu chưa gặp
  // Đọc 4 ghi chú liền trong cùng một cụm thì lần sau bắt buộc sang cụm khác (thoát "bong bóng").
  // Tồn đọng (ghi chú đến hạn) càng nhiều thì càng dành nhiều lượt để ôn và càng ít nạp ghi chú mới (như Anki);
  // ngay cả lượt kết nối / liên ngành cũng ưu tiên ghi chú đến hạn trong vùng của nó, để không đánh đổi trí nhớ.
  // Dữ liệu quan hệ tính sẵn lúc build (scripts/build-related.mjs, trường "tl" trong contentIndex), nên chọn rất nhanh.
  // Mọi chế độ chỉ chọn trong danh sách ứng viên, tức là gói gọn trong điều kiện tìm kiếm đang dùng.
  var MODE_SHARE = [
    ["review", 0.6],
    ["connect", 0.2],
    ["bridge", 0.1],
    ["explore", 0.1],
  ]
  var STREAK_LIMIT = 4
  var BACKLOG_FULL = 40 // từ mức tồn đọng này, gần như chỉ ôn

  // 0 (không tồn đọng) → 1 (tồn đọng nhiều)
  function pressureOf(dueCount) {
    return Math.min(1, dueCount / BACKLOG_FULL)
  }

  // Trọng số theo trạng thái ghi nhớ: đến hạn > chưa xem (giảm khi tồn đọng) > vừa ôn.
  function needWeight(r, now, pressure) {
    if (!r) return 1.5 * (1 - 0.85 * pressure)
    if (r[2] <= now) return 3
    return 0.4
  }
  var TRAIL_KEY = "tl-trail"
  var WHY_KEY = "tl-why"
  var REL_TEXT = ["có liên kết trực tiếp", "có hàng xóm chung", "thường được dẫn cùng nhau", "nội dung tương đồng, nên đối chiếu"]
  var G = null
  var whyOf = {}
  var commLabel = {}

  function buildGraph(data) {
    if (G) return G
    var keys = Object.keys(data)
    var idx = new Map()
    keys.forEach(function (k, i) {
      idx.set(k, i)
    })
    G = {
      keys: keys,
      idx: idx,
      tl: keys.map(function (k) {
        return (data[k] && data[k].tl) || null
      }),
      title: keys.map(function (k) {
        return String((data[k] && data[k].title) || k)
      }),
      fp: keys.map(function (k) {
        return String((data[k] && data[k].filePath) || "")
      }),
    }
    return G
  }

  function readTrail() {
    try {
      return JSON.parse(sessionStorage.getItem(TRAIL_KEY) || "[]")
    } catch (e) {
      return []
    }
  }

  function pushTrail(slug) {
    var t = readTrail().filter(function (s) {
      return s !== slug
    })
    t.push(slug)
    try {
      sessionStorage.setItem(TRAIL_KEY, JSON.stringify(t.slice(-12)))
    } catch (e) {}
  }

  function commOf(slug) {
    if (!G) return -1
    var i = G.idx.get(slug)
    var t = i === undefined ? null : G.tl[i]
    return t ? t.c : -1
  }

  // Tên cụm = thư mục chiếm đa số trong cụm (Louvain không tự đặt tên chủ đề).
  function labelOf(c) {
    if (commLabel[c] !== undefined) return commLabel[c]
    var count = {}
    G.tl.forEach(function (t, i) {
      if (!t || t.c !== c) return
      var parts = G.fp[i].split("/")
      var f = parts.length > 1 ? parts[parts.length - 2] : ""
      if (f) count[f] = (count[f] || 0) + 1
    })
    var best = ""
    Object.keys(count).forEach(function (f) {
      if (!best || count[f] > count[best]) best = f
    })
    return (commLabel[c] = best.replace(/^\d+\s*-\s*/, ""))
  }

  function pickMode(trail, pressure) {
    var cs = trail.slice(-STREAK_LIMIT).map(commOf)
    if (cs.length >= STREAK_LIMIT && cs[0] !== -1 && cs.every(function (c) {
      return c === cs[0]
    }))
      return "bridge"
    // Tồn đọng nhiều: phần "ôn" tăng từ 60% lên tới 85%, ba chế độ còn lại co lại theo tỉ lệ.
    var review = MODE_SHARE[0][1] + (0.85 - MODE_SHARE[0][1]) * pressure
    var rest = (1 - review) / (1 - MODE_SHARE[0][1])
    var r = Math.random()
    for (var i = 0; i < MODE_SHARE.length; i++) {
      r -= i === 0 ? review : MODE_SHARE[i][1] * rest
      if (r <= 0) return MODE_SHARE[i][0]
    }
    return "review"
  }

  // Chọn ghi chú cho lần bấm tới; lý do được lưu vào whyOf[slug] để hiện sau khi mở.
  function choose(slugs, here) {
    var seen = readSeen()
    var cands = slugs.filter(function (s) {
      return s !== here && seen.indexOf(s) === -1
    })
    if (cands.length === 0) {
      cands = slugs.filter(function (s) {
        return s !== here
      })
    }
    if (cands.length === 0) return null
    var now = Date.now()
    var m = memLoad()
    var inC = new Set(cands)
    var trail = readTrail()
    if (here && trail[trail.length - 1] !== here) trail.push(here)
    var dueCount = 0
    cands.forEach(function (s) {
      if (m[s] && m[s][2] <= now) dueCount++
    })
    var pressure = pressureOf(dueCount)
    var mode = G ? pickMode(trail, pressure) : "review"
    var order = [mode, "review", "connect", "explore", "bridge"]
    for (var k = 0; k < order.length; k++) {
      var got = pickBy(order[k], cands, inC, trail, here, m, now, pressure)
      if (got) {
        whyOf[got[0]] = got[1]
        return got[0]
      }
    }
    var any = cands[Math.floor(Math.random() * cands.length)]
    whyOf[any] = "Ngẫu nhiên"
    return any
  }

  function daysAgo(r, now) {
    return Math.round((now - r[1]) / DAY)
  }

  function pickBy(mode, cands, inC, trail, here, m, now, pressure) {
    var hereC = commOf(here)
    if (mode === "review") {
      var due = cands.filter(function (s) {
        return m[s] && m[s][2] <= now
      })
      if (!due.length) return null
      // Gần thứ đang đọc (cùng cụm) được ưu tiên gấp đôi, để việc ôn liền mạch.
      var s = weightedPick(due, function (x) {
        var r = m[x]
        var w = 1 + (now - r[2]) / (stepDays(r[0]) * DAY)
        return commOf(x) === hereC && hereC !== -1 ? w * 2 : w
      })
      return [s, "Ôn lại · đọc lần cuối " + daysAgo(m[s], now) + " ngày trước"]
    }
    if (mode === "connect") {
      if (!G) return null
      var score = new Map()
      var from = new Map()
      var ctx = trail.slice(-3)
      ctx.forEach(function (src, pos) {
        var i = G.idx.get(src)
        var t = i === undefined ? null : G.tl[i]
        if (!t) return
        var wCtx = pos === ctx.length - 1 ? 1 : 0.5
        var add = function (j, kind, w) {
          var s = G.keys[j]
          if (!inC.has(s)) return
          var r = m[s]
          if (r && now - r[1] < 2 * DAY) return // vừa đọc thì để lần khác
          var v = w * wCtx * needWeight(r, now, pressure)
          if (v > (score.get(s) || 0)) {
            score.set(s, v)
            from.set(s, [src, kind])
          }
        }
        t.r.forEach(function (x) {
          add(x[0], x[1], x[1] === 3 ? 1.5 : 1.2)
        })
        t.n.forEach(function (j) {
          add(j, 0, 0.8)
        })
      })
      if (!score.size) return null
      var list = Array.from(score.keys())
      var s2 = weightedPick(list, function (x) {
        return score.get(x)
      })
      var f = from.get(s2)
      var srcTitle = G.title[G.idx.get(f[0])]
      return [s2, "Liên quan tới «" + srcTitle + "»: " + REL_TEXT[f[1]]]
    }
    if (mode === "bridge") {
      if (!G) return null
      var recent = new Set(trail.slice(-8).map(commOf))
      var byC = new Map()
      cands.forEach(function (s) {
        var c = commOf(s)
        if (c === -1 || recent.has(c)) return
        if (!byC.has(c)) byC.set(c, [])
        byC.get(c).push(s)
      })
      if (!byC.size) return null
      // Cụm có nhiều ghi chú chưa xem / đến hạn dễ được chọn hơn.
      var cs = Array.from(byC.keys())
      var c = weightedPick(cs, function (x) {
        var l = byC.get(x)
        var need = l.filter(function (s) {
          return !m[s] || m[s][2] <= now
        }).length
        return Math.sqrt(l.length) * (0.2 + need / l.length)
      })
      var s3 = weightedPick(byC.get(c), function (x) {
        var t = G.tl[G.idx.get(x)]
        var r = m[x]
        return (5 + (t ? t.b : 0)) * needWeight(r, now, pressure)
      })
      return [s3, "Sang cụm khác: " + (labelOf(c) || "chủ đề mới")]
    }
    // khám phá
    var fresh = cands.filter(function (s) {
      return !m[s]
    })
    if (fresh.length && Math.random() >= pressure * 0.7)
      return [fresh[Math.floor(Math.random() * fresh.length)], "Khám phá · chưa đọc bao giờ"]
    cands = cands.filter(function (x) {
      return m[x]
    })
    if (!cands.length) return null
    var old = weightedPick(cands, function (x) {
      return 1 + (now - m[x][1]) / DAY
    })
    return [old, "Khám phá · lâu chưa gặp (" + daysAgo(m[old], now) + " ngày)"]
  }

  // Hiện lý do chọn trong vài giây sau khi mở ghi chú bằng nút Ngẫu nhiên (không có nút bấm nào).
  function setWhy(slug) {
    try {
      if (whyOf[slug]) sessionStorage.setItem(WHY_KEY, JSON.stringify({ s: slug, w: whyOf[slug] }))
    } catch (e) {}
  }

  function showWhy() {
    var w = null
    try {
      w = JSON.parse(sessionStorage.getItem(WHY_KEY) || "null")
      sessionStorage.removeItem(WHY_KEY)
    } catch (e) {}
    var old = document.getElementById("tl-why")
    if (old) old.remove()
    if (!w || w.s !== currentSlug()) return
    showTip(w.w)
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
  var nextPickScope = null
  var prefetched = {}

  // Phạm vi random: điều kiện tìm kiếm gần nhất của người dùng. Ô tìm kiếm tự đóng sau mỗi lần nhảy trang,
  // nên nút nổi phải nhớ điều kiện này, nếu không random sẽ "văng" ra ngoài thư mục/tag đang tìm.
  var SCOPE_KEY = "tl-random-scope"
  var SCOPE_ID = "tl-random-scope"

  function getScope() {
    try {
      return sessionStorage.getItem(SCOPE_KEY) || ""
    } catch (e) {
      return ""
    }
  }

  function setScope(q) {
    q = String(q || "").trim()
    try {
      if (q) sessionStorage.setItem(SCOPE_KEY, q)
      else sessionStorage.removeItem(SCOPE_KEY)
    } catch (e) {}
    nextPick = null
    nextPickScope = null
    refreshScopeChip()
  }

  function clearScope() {
    setScope("")
    document.querySelectorAll(".search-space").forEach(function (sp) {
      var st = sp.__tl
      if (st) {
        st.input.value = ""
        update(st)
      }
    })
  }

  // Không hiện chữ: chỉ một nút × nhỏ gắn ở góc nút nổi khi đang random theo điều kiện tìm kiếm.
  // Rê chuột / giữ vào nút để xem điều kiện (title); bấm × để random toàn bộ.
  function refreshScopeChip() {
    if (!document.body) return
    var q = getScope()
    var badge = document.getElementById(SCOPE_ID)
    var fab = document.getElementById(BTN_ID)
    if (fab) {
      var st = allSlugs ? memStats(allSlugs) : null
      var info = st ? " · đến hạn ôn " + st.due + " · chưa xem " + st.fresh + "/" + st.total : ""
      fab.title = (q ? "Ôn ghi chú trong: " + q : "Ôn ghi chú theo đường cong lãng quên") + info
      fab.classList.toggle("has-scope", !!q)
    }
    if (!q) {
      if (badge) badge.hidden = true
      return
    }
    if (!badge) {
      badge = el("button", "tl-random-scope", "×")
      badge.id = SCOPE_ID
      badge.type = "button"
      badge.addEventListener("click", clearScope)
      document.body.appendChild(badge)
    }
    badge.hidden = false
    badge.setAttribute("aria-label", "Đang random trong: " + q + ". Bấm để bỏ điều kiện, random toàn bộ")
    badge.title = "Đang random trong: " + q + " — bấm để bỏ điều kiện"
  }

  // Nút nổi chỉ cần danh sách slug, không cần chuẩn hóa toàn bộ nội dung như loadCache()
  // (việc đó tốn vài trăm ms trên điện thoại ở lần bấm đầu tiên).
  async function loadSlugs() {
    if (allSlugs) return allSlugs
    var data = (await loadIndex()) || {}
    buildGraph(data)
    loadCodeTitles(data)
    allSlugs = Object.keys(data).filter(function (s) {
      return !isExcluded(s)
    })
    refreshScopeChip()
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
      var scope = getScope()
      var slugs
      if (scope) {
        await loadCache()
        slugs = run(scope).items.map(function (e) {
          return e.slug
        })
      } else {
        slugs = await loadSlugs()
      }
      var here = currentSlug()
      if (!nextPick || nextPick === here || nextPickScope !== scope) {
        nextPick = choose(slugs, here)
        nextPickScope = scope
      }
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
      setWhy(target)
      go(target)
      return null
    }
    await loadCache()
    var slugs = run(q).items.map(function (e) {
      return e.slug
    })
    if (slugs.length === 0) return "Không có ghi chú nào khớp."
    var here = currentSlug()
    var target
    if (nextPick && nextPickScope === q && nextPick !== here && slugs.indexOf(nextPick) !== -1) {
      target = nextPick
      markSeen(target)
    } else {
      target = pick(slugs, here)
    }
    nextPick = null
    nextPickScope = null
    if (!target) return "Chỉ có 1 ghi chú khớp và bạn đang xem nó rồi."
    setWhy(target)
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
        var err = await openRandom(getScope())
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
    refreshScopeChip()
  }

  // ---------- tìm kiếm nâng cao ----------
  function removeToken(st, raw) {
    var tokens = tokenize(st.input.value)
    var i = tokens.indexOf(raw)
    if (i !== -1) tokens.splice(i, 1)
    st.input.value = tokens.length ? tokens.join(" ") + " " : ""
    setScope(st.input.value)
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
    var raw = body.slice(1).replace(/"/g, "")
    var prefix = fold(raw).replace(/\s+/g, "-")
    var qs = pathSegs(raw)
    var endsSlash = /\/$/.test(raw)
    var list = cache.folders
      .map(function (f) {
        if (f.key === prefix.replace(/\/+$/, "")) return null
        var at = segMatch(f.segs, qs)
        if (at === -1 && f.key.indexOf(prefix) === 0) at = 0
        else if (at === -1 && prefix.length >= 2 && f.key.indexOf(prefix) > -1) at = 99
        if (at === -1) return null
        // Gõ "/book/" thì chỉ gợi ý cấp con trực tiếp, không trải hết các cấp cháu.
        if (endsSlash && f.segs.length !== at + qs.length) return null
        return { f: f, at: at }
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.at - b.at || a.f.depth - b.f.depth || b.f.count - a.f.count || (a.f.label < b.f.label ? -1 : 1)
      })
      .slice(0, MAX_FOLDER_SUGGEST)
      .map(function (x) {
        return x.f
      })
    return list.map(function (f) {
      return {
        label: f.label,
        count: f.count,
        apply: function (st) {
          var cut = q.length - last.length
          st.input.value = q.slice(0, cut) + (neg ? "-" : "") + folderToken(f.label) + " "
          setScope(st.input.value)
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
    ["7/1a   mã:7/", "thẻ Zettel theo mã (gồm thẻ con) / cả nhánh 7"],
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
      if (e.code) title.appendChild(codeBadge(e.code))
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
    setScope(st.input.value)
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
        setScope(st.input.value)
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
    // Khi Quartz chưa lập xong chỉ mục (điện thoại mất 10–25 giây), lớp này trả kết quả thay.
    var root = st.space.closest(".search")
    var quartzPending = !!root && !quartzReady(root)
    st.advanced = empty || quartzPending || res.advanced || folderSuggestions(q).length > 0
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
      setScope(input.value)
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
      setScope(st.input.value)
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

  // ---------- mở khung tìm kiếm ngay, kể cả khi Quartz chưa lập xong chỉ mục ----------
  // Quartz chỉ gắn sự kiện cho nút "Tìm" và Ctrl+K SAU KHI lập chỉ mục FlexSearch cho mọi ghi chú.
  // Trên điện thoại việc này mất 10–25 giây; trong lúc đó bấm "Tìm" không có phản ứng gì.
  // Lớp này mở khung ngay, báo đang tải, rồi chạy lại câu đã gõ khi Quartz sẵn sàng.
  function quartzReady(root) {
    return !!root.querySelector(".results-container")
  }

  function setLoading(root, on) {
    var space = root.querySelector(".search-space")
    if (!space) return
    var n = space.querySelector(".tl-search-loading")
    if (on && !n) {
      n = el("div", "tl-search-loading", "Đang tải chỉ mục tìm kiếm đầy đủ…")
      n.style.cssText = "padding:0.6rem 1rem;color:var(--gray);font-size:0.9rem"
      space.appendChild(n)
    }
    if (n) n.hidden = !on
  }

  function earlyClose(root) {
    var cont = root.querySelector(".search-container")
    if (!cont) return
    cont.classList.remove("active")
    var sb = cont.closest(".sidebar")
    if (sb) sb.style.zIndex = ""
    var btn = root.querySelector(".search-button")
    if (btn) btn.setAttribute("aria-expanded", "false")
    setLoading(root, false)
  }

  function earlyOpen(root) {
    var cont = root.querySelector(".search-container")
    var input = root.querySelector(".search-bar")
    if (!cont || !input) return
    cont.classList.add("active")
    var sb = cont.closest(".sidebar")
    if (sb) sb.style.zIndex = "9999"
    var btn = root.querySelector(".search-button")
    if (btn) btn.setAttribute("aria-expanded", "true")
    setLoading(root, true)
    input.focus()
    if (root.__tlWait) return
    root.__tlWait = setInterval(function () {
      if (!document.contains(root)) {
        clearInterval(root.__tlWait)
        root.__tlWait = null
        return
      }
      if (!quartzReady(root)) return
      clearInterval(root.__tlWait)
      root.__tlWait = null
      setLoading(root, false)
      if (!cont.classList.contains("active")) return
      // Giao lại cho Quartz: mở bằng handler thật rồi chạy câu đã gõ.
      var q = input.value
      if (btn) btn.click()
      if (input.value !== q) input.value = q
      input.focus()
      if (q) input.dispatchEvent(new Event("input", { bubbles: true }))
    }, 250)
  }

  function bindEarlyOpen() {
    document.querySelectorAll(".search").forEach(function (root) {
      if (root.__tlEarly) return
      root.__tlEarly = true
      var btn = root.querySelector(".search-button")
      var cont = root.querySelector(".search-container")
      if (btn)
        btn.addEventListener(
          "click",
          function (e) {
            if (quartzReady(root)) return
            e.preventDefault()
            e.stopPropagation()
            earlyOpen(root)
          },
          true,
        )
      if (cont)
        cont.addEventListener("click", function (e) {
          if (!quartzReady(root) && e.target === cont) earlyClose(root)
        })
    })
    if (document.__tlEarlyKeys) return
    document.__tlEarlyKeys = true
    document.addEventListener(
      "keydown",
      function (e) {
        var roots = Array.prototype.slice.call(document.querySelectorAll(".search")).filter(function (r) {
          return !quartzReady(r)
        })
        if (!roots.length) return
        if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
          var vis =
            roots.filter(function (r) {
              var b = r.querySelector(".search-button")
              return b && b.offsetParent !== null
            })[0] || roots[0]
          e.preventDefault()
          var c = vis.querySelector(".search-container")
          if (c && c.classList.contains("active")) earlyClose(vis)
          else earlyOpen(vis)
        } else if (e.key === "Escape") {
          roots.forEach(earlyClose)
        }
      },
      true,
    )
  }

  function mount() {
    if (!document.body) return
    bindEarlyOpen()
    showPageCode()
    linkReleaseNotes()
    trackUse()
    showWhy()
    mountFab()
    refreshScopeChip()
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
    codeMeaning: function (c) {
      return loadIndex().then(function (d) {
        loadCodeTitles(d || {})
        return codeMeaning(c)
      })
    },
    recordUse: recordUse,
    memory: function () {
      return memLoad()
    },
    choose: async function () {
      var s = choose(await loadSlugs(), currentSlug())
      return { slug: s, why: whyOf[s] }
    },
    needsAdvanced: needsAdvanced,
    fold: fold,
    run: async function (q) {
      await loadCache()
      return run(q)
    },
  }
})()
