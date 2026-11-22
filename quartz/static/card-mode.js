// card-mode.js — Chế độ "Thẻ giấy" (tối giản kiểu Zettelkasten giấy).
// Người dùng 2026-11-22: "2 dạng: 1 bình thường, 1 tối giản giống zettelkasten giấy
// (chỉ gồm tiêu đề gồm cả mã, và nội dung, không có mục liên kết)".
//   - Nút bật/tắt trên thanh công cụ (cạnh nút sáng/tối), nhớ lựa chọn bằng localStorage.
//   - Khi bật: tiêu đề (đã có mã thẻ dạng 24/1a do search-plus.js gắn) + nội dung; ẩn mục "Liên kết…",
//     Liên kết ngược, Sơ đồ, Properties, ngày/phút đọc, breadcrumb, cây thư mục, chân trang.
//   - Ẩn luôn dòng gợi ý "vì sao chọn" 15 giây sau khi bấm Ngẫu nhiên (#tl-why / .tl-why-inline của search-plus.js).
//   - Liên kết nằm trong câu chữ của nội dung vẫn giữ (là một phần của thẻ).
// Chạy lại ở mỗi sự kiện "nav" của Quartz SPA (trang mới thay DOM nên phải gắn lại nút và mã).
;(function () {
  if (window.__tlCardMode) return
  window.__tlCardMode = true
  var KEY = "tl-card-mode"
  var ATTR = "data-tl-card"

  function isOn() {
    try {
      return localStorage.getItem(KEY) === "on"
    } catch (e) {
      return false
    }
  }
  function setOn(v) {
    try {
      localStorage.setItem(KEY, v ? "on" : "off")
    } catch (e) {}
    document.documentElement.setAttribute(ATTR, v ? "on" : "off")
    var b = document.querySelector("button.tl-cardmode")
    if (b) b.setAttribute("aria-pressed", v ? "true" : "false")
  }

  function norm(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .trim()
      .toLowerCase()
  }

  var ON = ":root[" + ATTR + "=on] "
  function addStyle() {
    if (document.getElementById("tl-card-style")) return
    var st = document.createElement("style")
    st.id = "tl-card-style"
    st.textContent =
      // nút bật/tắt
      "button.tl-cardmode{cursor:pointer;background:none;border:0;padding:0 .3rem;margin:0;height:2rem;" +
      "display:flex;align-items:center;color:var(--darkgray);border-radius:8px;-webkit-tap-highlight-color:transparent}" +
      "button.tl-cardmode svg{width:20px;height:20px}" +
      "button.tl-cardmode[aria-pressed=true]{color:var(--secondary)}" +
      // ẩn mọi thứ ngoài tiêu đề và nội dung
      ON + ".sidebar.right," + ON + ".breadcrumb-container," + ON + ".note-properties," + ON + ".content-meta," +
      ON + ".center>hr," + ON + ".page-footer," + ON + "footer," + ON + ".explorer," +
      ON + ".tl-card-hide," + ON + "article details.tl-fold," +
      ON + "#tl-why," + ON + ".tl-why," + ON + ".tl-why-inline{display:none!important}" +
      // khung thẻ: viền giấy, vạch đỏ dưới tiêu đề như thẻ index
      ON + ".center{border:1px solid var(--lightgray);border-radius:6px;padding:1.25rem 1.5rem 1.5rem;" +
      "margin-top:1.25rem;margin-bottom:2rem;box-shadow:0 1px 4px rgba(0,0,0,.06);height:fit-content}" +
      ON + ".center .page-header{margin-top:0!important}" +
      ON + "h1.article-title{margin-top:0;padding-bottom:.45rem;border-bottom:2px solid #e57373}" +
      "@media (max-width:800px){" + ON + ".center{padding:1rem 1rem 1.25rem;margin:.75rem 0 1.5rem}}"
    document.head.appendChild(st)
  }

  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/>' +
    '<line x1="3" y1="9" x2="21" y2="9" stroke="#e57373"/><line x1="6.5" y1="12.5" x2="17.5" y2="12.5"/>' +
    '<line x1="6.5" y1="15.5" x2="14" y2="15.5"/></svg>'

  function addButton() {
    if (document.querySelector("button.tl-cardmode")) return
    var anchor = document.querySelector(".left.sidebar button.darkmode")
    if (!anchor) return
    var wrap = anchor.parentElement
    var box = document.createElement("div")
    box.style.cssText = "flex-grow:0;flex-shrink:1;flex-basis:auto;order:0;align-self:center;justify-self:center;"
    var b = document.createElement("button")
    b.type = "button"
    b.className = "tl-cardmode"
    b.title = "Thẻ giấy: chỉ tiêu đề có mã và nội dung"
    b.setAttribute("aria-label", "Thẻ giấy")
    b.setAttribute("aria-pressed", isOn() ? "true" : "false")
    b.innerHTML = ICON
    b.addEventListener("click", function () {
      setOn(!isOn())
    })
    box.appendChild(b)
    wrap.parentNode.insertBefore(box, wrap.nextSibling)
  }

  // Đánh dấu mục "Liên kết…" (tiêu đề + nội dung tới tiêu đề cùng cấp/cao hơn kế tiếp).
  function markLinks() {
    document.querySelectorAll(".center article h2, .center article h3").forEach(function (h) {
      if (!/^lien ket\b/.test(norm(h.textContent))) return
      var level = +h.tagName.slice(1)
      var host = h.closest("details.tl-fold") || h // reader-fold.js đã bọc thì ẩn cả khối details
      host.classList.add("tl-card-hide")
      if (host !== h) return
      var n = h.nextElementSibling
      while (n && !(/^H[1-6]$/.test(n.tagName) && +n.tagName.slice(1) <= level)) {
        n.classList.add("tl-card-hide")
        n = n.nextElementSibling
      }
    })
  }

  function apply() {
    addStyle()
    document.documentElement.setAttribute(ATTR, isOn() ? "on" : "off")
    addButton()
    markLinks()
  }

  document.documentElement.setAttribute(ATTR, isOn() ? "on" : "off") // sớm nhất có thể, đỡ nháy
  document.addEventListener("nav", apply)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply)
  else apply()
})()
