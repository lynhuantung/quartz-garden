// Nút nổi "Ghi chú ngẫu nhiên" — bấm để mở một ghi chú bất kỳ, phục vụ khám phá ngẫu nhiên.
// Nguồn dữ liệu: contentIndex (biến toàn cục `fetchData` do Quartz tạo; khi bật chế độ mã hóa,
// window.fetch đã được bọc để tự giải mã nên mã này dùng được ở cả hai chế độ).
;(function () {
  if (window.__tlRandomNoteInit) return
  window.__tlRandomNoteInit = true

  var BTN_ID = "tl-random-note-btn"
  var HISTORY_KEY = "tl-random-seen"
  var MAX_HISTORY = 30

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

  async function loadIndex() {
    if (typeof fetchData !== "undefined") return await fetchData
    var res = await fetch(rootPrefix(currentSlug()) + "static/contentIndex.json")
    return await res.json()
  }

  function pick(slugs, here) {
    var seen = readSeen()
    // Ưu tiên ghi chú chưa xem gần đây; hết thì xóa lịch sử và chọn lại từ đầu.
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

  async function goRandom(btn) {
    if (btn.dataset.busy === "1") return
    btn.dataset.busy = "1"
    btn.classList.add("is-spinning")
    try {
      var data = await loadIndex()
      var here = currentSlug()
      var slugs = Object.keys(data || {}).filter(function (s) {
        return !isExcluded(s)
      })
      var target = pick(slugs, here)
      if (!target) return
      var url = new URL(rootPrefix(here) + encodeURI(target), window.location.href)
      if (typeof window.spaNavigate === "function") window.spaNavigate(url)
      else window.location.href = url.toString()
    } catch (e) {
      console.error("TL wiki: không mở được ghi chú ngẫu nhiên", e)
    } finally {
      setTimeout(function () {
        btn.classList.remove("is-spinning")
        btn.dataset.busy = "0"
      }, 500)
    }
  }

  function mount() {
    if (!document.body || document.getElementById(BTN_ID)) return
    var btn = document.createElement("button")
    btn.id = BTN_ID
    btn.type = "button"
    btn.className = "tl-random-btn"
    btn.setAttribute("aria-label", "Mở ghi chú ngẫu nhiên")
    btn.title = "Khám phá ngẫu nhiên"
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="4"/>' +
      '<circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>' +
      "</svg>" +
      '<span class="tl-random-label">Ngẫu nhiên</span>'
    btn.addEventListener("click", function () {
      goRandom(btn)
    })
    document.body.appendChild(btn)
  }

  // `nav` chỉ phát sau khi Quartz (và cổng đăng nhập, nếu có) đã sẵn sàng,
  // nên nút không hiện trên màn hình khóa.
  document.addEventListener("nav", mount)
  if (document.getElementById("quartz-root") && document.querySelector(".page")) mount()
})()
