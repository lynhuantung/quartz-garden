// Ghi chú ngẫu nhiên — giống "Open random note" của Obsidian:
//  1. Nút nổi (dưới phải, mọi trang): luôn mở một ghi chú ngẫu nhiên trong TOÀN BỘ vault (hành vi cố định, dễ đoán).
//  2. Trong ô tìm kiếm (Ctrl+K): nút "Ngẫu nhiên trong kết quả (N)" — random theo đúng điều kiện đang gõ
//     (phím tắt: Ctrl/Cmd+Enter). Điều kiện, ghép bằng AND, không phân biệt hoa thường và dấu tiếng Việt:
//       #sach     ghi chú có tag "sach" (gồm cả tag con như sach/tu-duy)
//       /Books    ghi chú nằm trong thư mục "Books"   (có khoảng trắng: /"Books/01 - Tên")
//       tư duy    từ khóa trong tiêu đề hoặc nội dung
//     Nhờ vậy không cần thêm nút phụ nào ngoài giao diện đã có.
//
// Nguồn dữ liệu: contentIndex (biến toàn cục `fetchData` do Quartz tạo; khi site bật mã hóa,
// window.fetch đã được bọc để tự giải mã nên mã này dùng được ở cả hai chế độ).
;(function () {
  if (window.__tlRandomNoteInit) return
  window.__tlRandomNoteInit = true

  var BTN_ID = "tl-random-note-btn"
  var HISTORY_KEY = "tl-random-seen"
  var MAX_HISTORY = 30

  var cache = null // { entries: [...] }

  // ---------- tiện ích ----------
  function fold(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
  }

  function currentSlug() {
    return (document.body && document.body.dataset && document.body.dataset.slug) || "index"
  }

  function rootPrefix(slug) {
    var depth = slug.split("/").length - 1
    return depth > 0 ? "../".repeat(depth) : "./"
  }

  function isExcluded(slug) {
    return (
      slug === "index" ||
      slug === "404" ||
      slug === "Release-Notes" ||
      slug.indexOf("tags/") === 0 ||
      /(^|\/)index$/.test(slug)
    )
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

  // ---------- dữ liệu ----------
  async function loadIndex() {
    if (typeof fetchData !== "undefined") return await fetchData
    var res = await fetch(rootPrefix(currentSlug()) + "static/contentIndex.json")
    return await res.json()
  }

  async function loadCache() {
    if (cache) return cache
    var data = (await loadIndex()) || {}
    var entries = []
    Object.keys(data).forEach(function (slug) {
      if (isExcluded(slug)) return
      var d = data[slug] || {}
      entries.push({
        slug: slug,
        slugN: fold(slug),
        tags: (d.tags || []).map(function (t) {
          return fold(t)
        }),
        hay: fold((d.title || "") + " " + (d.content || "")),
      })
    })
    cache = { entries: entries }
    return cache
  }

  // ---------- bộ lọc ----------
  function parseFilter(str) {
    var tokens = (String(str || "").match(/[#\/]?"[^"]*"|\S+/g) || []).map(function (t) {
      return t.replace(/"/g, "")
    })
    var f = { tags: [], folders: [], words: [] }
    tokens.forEach(function (t) {
      if (t.charAt(0) === "#" && t.length > 1) f.tags.push(fold(t.slice(1)))
      else if (t.charAt(0) === "/" && t.length > 1) f.folders.push(fold(t.slice(1)).replace(/\/+$/, ""))
      else if (t !== "#" && t !== "/") f.words.push(fold(t))
    })
    return f
  }

  function matches(entry, f) {
    for (var i = 0; i < f.tags.length; i++) {
      var t = f.tags[i]
      var ok = entry.tags.some(function (x) {
        return x === t || x.indexOf(t + "/") === 0
      })
      if (!ok) return false
    }
    for (var j = 0; j < f.folders.length; j++) {
      var fo = f.folders[j]
      if (!(entry.slugN === fo || entry.slugN.indexOf(fo + "/") === 0)) return false
    }
    for (var k = 0; k < f.words.length; k++) {
      if (entry.hay.indexOf(f.words[k]) === -1) return false
    }
    return true
  }

  function poolFor(filterStr) {
    var f = parseFilter(filterStr)
    return cache.entries
      .filter(function (e) {
        return matches(e, f)
      })
      .map(function (e) {
        return e.slug
      })
  }

  function pick(slugs, here) {
    var seen = readSeen()
    var fresh = slugs.filter(function (s) {
      return s !== here && seen.indexOf(s) === -1
    })
    if (fresh.length === 0) {
      seen = []
      fresh = slugs.filter(function (s) {
        return s !== here
      })
    }
    if (fresh.length === 0) return null
    var chosen = fresh[Math.floor(Math.random() * fresh.length)]
    seen.push(chosen)
    writeSeen(seen)
    return chosen
  }

  // ---------- hành động ----------
  // Trả về thông báo lỗi (chuỗi) nếu không mở được, ngược lại trả về null.
  async function openRandom(filterStr) {
    await loadCache()
    var here = currentSlug()
    var slugs = poolFor(filterStr)
    if (slugs.length === 0) return "Không có ghi chú nào khớp."
    var target = pick(slugs, here)
    if (!target) return "Chỉ có 1 ghi chú khớp và bạn đang xem nó rồi."
    var url = new URL(rootPrefix(here) + encodeURI(target), window.location.href)
    if (typeof window.spaNavigate === "function") window.spaNavigate(url)
    else window.location.href = url.toString()
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
    if (!btn) {
      btn = document.createElement("button")
      btn.id = BTN_ID
      btn.type = "button"
      btn.className = "tl-random-btn"
      btn.setAttribute("aria-label", "Mở ghi chú ngẫu nhiên")
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
          }, 500)
        }
      })
      document.body.appendChild(btn)
    }
    btn.title = "Mở ghi chú ngẫu nhiên (muốn lọc theo #tag hoặc /thư-mục: dùng ô tìm kiếm Ctrl+K)"
  }

  // ---------- nút trong ô tìm kiếm ----------
  function mountSearchButtons() {
    var spaces = document.querySelectorAll(".search-space")
    spaces.forEach(function (space) {
      if (space.querySelector(".tl-search-random")) return
      var input = space.querySelector(".search-bar")
      if (!input) return

      var btn = document.createElement("button")
      btn.type = "button"
      btn.className = "tl-search-random"
      btn.innerHTML = DICE_SVG.replace(/width="22" height="22"/, 'width="16" height="16"') + "<span></span>"
      var label = btn.querySelector("span")

      var timer = null
      async function updateLabel() {
        var q = input.value.trim()
        var base = q ? "Ngẫu nhiên trong kết quả" : "Ngẫu nhiên (toàn bộ ghi chú)"
        try {
          await loadCache()
          label.textContent = base + " · " + poolFor(q).length
        } catch (e) {
          label.textContent = base
        }
      }

      async function go() {
        if (btn.dataset.busy === "1") return
        btn.dataset.busy = "1"
        try {
          var err = await openRandom(input.value.trim())
          if (err) flash(label, err)
        } catch (e) {
          console.error("TL wiki: không mở được ghi chú ngẫu nhiên", e)
        } finally {
          btn.dataset.busy = "0"
        }
      }

      btn.addEventListener("click", go)
      input.addEventListener("input", function () {
        clearTimeout(timer)
        timer = setTimeout(updateLabel, 150)
      })
      // Pha capture + stopImmediatePropagation để Ctrl/Cmd+Enter không bị Quartz hiểu là "mở kết quả đầu".
      input.addEventListener(
        "keydown",
        function (e) {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            e.stopImmediatePropagation()
            go()
          }
        },
        true,
      )
      input.insertAdjacentElement("afterend", btn)
      updateLabel()
    })
  }

  function mount() {
    if (!document.body) return
    mountFab()
    mountSearchButtons()
  }

  // `nav` chỉ phát sau khi Quartz (và cổng đăng nhập, nếu có) đã sẵn sàng,
  // nên các nút không hiện trên màn hình khóa.
  document.addEventListener("nav", mount)
  if (document.getElementById("quartz-root") && document.querySelector(".page")) mount()

  // Dùng cho kiểm thử.
  window.__tlRandomNote = { parseFilter: parseFilter, matches: matches, fold: fold }
})()
