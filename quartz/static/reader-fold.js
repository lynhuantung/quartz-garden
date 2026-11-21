// reader-fold.js — Trải nghiệm đọc trên điện thoại (màn hình <= 800px).
// Người dùng 2026-11-21: "collapse những vùng không cần thiết, khi cần thì mở ra":
//   - mục "Liên kết" (và "Liên kết ..." khác) trong bài: thu gọn, bấm để mở;
//   - vùng "Liên kết ngược": thu gọn, bấm để mở;
//   - khung Properties (tags): đóng sẵn;
//   - Sơ đồ (local graph): giữ nguyên vì có ý nghĩa.
// Máy tính không đổi. Chạy lại sau mỗi lần chuyển trang (sự kiện "nav" của Quartz SPA).
;(function () {
  if (window.__tlReaderFold) return
  window.__tlReaderFold = true
  var MQ = window.matchMedia("(max-width: 800px)")

  function norm(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .trim()
      .toLowerCase()
  }

  function addStyle() {
    if (document.getElementById("tl-fold-style")) return
    var st = document.createElement("style")
    st.id = "tl-fold-style"
    st.textContent =
      "details.tl-fold{margin:1.6rem 0 0.4rem;border-top:1px solid var(--lightgray)}" +
      "details.tl-fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:.5rem;" +
      "padding:.75rem 0;min-height:44px;-webkit-tap-highlight-color:transparent;user-select:none}" +
      "details.tl-fold>summary::-webkit-details-marker{display:none}" +
      "details.tl-fold>summary::before{content:'';flex:0 0 auto;width:.5rem;height:.5rem;margin:0 .15rem;" +
      "border-right:2px solid var(--gray);border-bottom:2px solid var(--gray);transform:rotate(-45deg);transition:transform .15s}" +
      "details.tl-fold[open]>summary::before{transform:rotate(45deg)}" +
      "details.tl-fold>summary>h2,details.tl-fold>summary>h3{margin:0!important;padding:0!important;border:0!important;" +
      "font-size:.8rem!important;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--darkgray)}" +
      "details.tl-fold>summary .tl-fold-n{font-size:.75rem;color:var(--gray);font-weight:500}" +
      "details.tl-fold>summary:active{opacity:.6}" +
      "details.tl-fold>summary a[role=anchor]{display:none!important}" +
      ".backlinks details.tl-fold{margin-top:.5rem}"
    document.head.appendChild(st)
  }

  // Bọc tiêu đề + nội dung theo sau (tới tiêu đề cùng cấp/cao hơn kế tiếp) vào <details> đóng.
  function foldSection(h, count) {
    if (h.closest("details.tl-fold")) return
    var level = +h.tagName.slice(1)
    var det = document.createElement("details")
    det.className = "tl-fold"
    var sum = document.createElement("summary")
    h.parentNode.insertBefore(det, h)
    var nodes = []
    var n = h.nextSibling
    while (n) {
      if (n.nodeType === 1 && /^H[1-6]$/.test(n.tagName) && +n.tagName.slice(1) <= level) break
      nodes.push(n)
      n = n.nextSibling
    }
    sum.appendChild(h) // giữ thẻ h2/h3 để nút "Nghe" vẫn nhận ra mục "Liên kết" mà dừng
    var c = typeof count === "number" ? count : 0
    nodes.forEach(function (x) {
      if (typeof count !== "number" && x.nodeType === 1) c += x.querySelectorAll("li").length
    })
    if (c) {
      var sp = document.createElement("span")
      sp.className = "tl-fold-n"
      sp.textContent = "(" + c + ")"
      sum.appendChild(sp)
    }
    det.appendChild(sum)
    nodes.forEach(function (x) {
      det.appendChild(x)
    })
  }

  function apply() {
    if (!MQ.matches) return
    addStyle()
    // 1. Mục "Liên kết…" trong bài viết
    document.querySelectorAll(".center article").forEach(function (art) {
      art.querySelectorAll("h2, h3").forEach(function (h) {
        if (/^lien ket\b/.test(norm(h.textContent)) && !h.closest(".backlinks")) foldSection(h)
      })
    })
    // 2. Liên kết ngược
    document.querySelectorAll(".backlinks").forEach(function (bl) {
      var h = bl.querySelector(":scope > h3")
      if (h) foldSection(h, bl.querySelectorAll("li a").length)
    })
    // 3. Khung Properties đóng sẵn
    document.querySelectorAll("details.note-properties").forEach(function (d) {
      if (d.dataset.tlFolded) return
      d.dataset.tlFolded = "1"
      d.open = false
    })
  }

  document.addEventListener("nav", apply)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply)
  else apply()
})()
