// random-play.js — Tự đọc khi mở ghi chú ngẫu nhiên, và tự chuyển sang ghi chú ngẫu nhiên khác sau khi đọc xong.
// Người dùng 2026-11-22: "cấu hình tự đọc khi nhấn nút random" + "tự động bấm random nhưng tối đa 20 lần là dừng";
// chọn: đọc xong thì chuyển; bật/tắt bằng cách GIỮ LÂU nút Ngẫu nhiên (giữ yên ~0,6 giây, không kéo).
//   - Tùy chọn lưu trong sessionStorage: tl-auto-read, tl-auto-chain ("1"/"0"). Bật tự chuyển thì tự bật tự đọc.
//     Người dùng 2026-11-22: "khi tắt trình duyệt là sẽ mất tính năng tự động" -> chỉ giữ trong phiên (tải lại trang vẫn giữ,
//     đóng tab/trình duyệt thì về tắt).
//   - Chuỗi tự chuyển: người dùng bấm Ngẫu nhiên (bằng tay) là bắt đầu; mỗi lần đọc HẾT bài (sự kiện tl-tts-finish
//     của read-aloud.js) thì chờ 3 giây rồi tự bấm Ngẫu nhiên; đủ N lần tự bấm thì dừng (N mặc định 20, chỉnh trong bảng,
//     lưu localStorage tl-auto-chain-max vì chỉ là con số, không tự bật gì).
//   - Dừng chuỗi: mở ghi chú khác bằng liên kết/tìm kiếm, hoặc đóng thanh đọc. Tạm dừng thì chuỗi chờ đến khi đọc hết.
//   - Số lần đã tự bấm hiện nhỏ trên nút Ngẫu nhiên (vd 3/20) trong lúc chuỗi đang chạy.
;(function () {
  if (window.__tlRandomPlay) return
  window.__tlRandomPlay = true
  var MAX_DEFAULT = 20
  var MAX_LIMIT = 200
  var K_MAX = "tl-auto-chain-max" // localStorage: số ghi chú tối đa của một chuỗi (người dùng 2026-11-22: "ghi thêm số trang như 40")
  function getMax() {
    var n = 0
    try {
      n = parseInt(localStorage.getItem(K_MAX), 10)
    } catch (e) {}
    return n >= 1 && n <= MAX_LIMIT ? n : MAX_DEFAULT
  }
  function setMax(n) {
    n = Math.round(+n)
    if (!(n >= 1)) n = MAX_DEFAULT
    if (n > MAX_LIMIT) n = MAX_LIMIT
    try {
      localStorage.setItem(K_MAX, String(n))
    } catch (e) {}
    return n
  }
  var WAIT_MS = 3000
  var HOLD_MS = 600
  var K_READ = "tl-auto-read"
  var K_CHAIN = "tl-auto-chain"
  var K_STATE = "tl-auto-chain-state" // sessionStorage: {k: số lần đã tự bấm} khi chuỗi đang chạy

  function get(k) {
    try {
      return sessionStorage.getItem(k) === "1"
    } catch (e) {
      return false
    }
  }
  function set(k, v) {
    try {
      sessionStorage.setItem(k, v ? "1" : "0")
    } catch (e) {}
  }
  function chainState() {
    try {
      return JSON.parse(sessionStorage.getItem(K_STATE) || "null")
    } catch (e) {
      return null
    }
  }
  function setChain(s) {
    try {
      if (s) sessionStorage.setItem(K_STATE, JSON.stringify(s))
      else sessionStorage.removeItem(K_STATE)
    } catch (e) {}
    renderBadge()
  }

  function rndBtn() {
    return document.getElementById("tl-random-note-btn")
  }
  function renderBadge() {
    var b = rndBtn()
    if (!b) return
    var s = chainState()
    if (s && get(K_CHAIN)) b.setAttribute("data-tl-chain", s.k + "/" + getMax())
    else b.removeAttribute("data-tl-chain")
  }

  function addStyle() {
    if (document.getElementById("tl-rp-style")) return
    var st = document.createElement("style")
    st.id = "tl-rp-style"
    st.textContent =
      ".tl-random-btn[data-tl-chain]::after{content:attr(data-tl-chain);position:absolute;left:50%;bottom:2px;" +
      "transform:translateX(-50%);font-size:10px;font-weight:700;line-height:1;color:#fff;white-space:nowrap;pointer-events:none}" +
      "@media (min-width:1200px){.tl-random-btn[data-tl-chain]::after{position:static;transform:none;margin-left:.35rem;" +
      "font-size:.75rem;color:inherit;opacity:.8}}" +
      ".tl-rp-panel{position:fixed;z-index:1000;width:min(300px,calc(100vw - 80px));background:var(--light);color:var(--dark);" +
      "border:1px solid var(--lightgray);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:.75rem .9rem;font-size:.92rem}" +
      ".tl-rp-panel h4{margin:0 0 .5rem;font-size:.95rem}" +
      ".tl-rp-row{display:flex;align-items:flex-start;gap:.65rem;padding:.55rem 0;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      ".tl-rp-row+.tl-rp-row{border-top:1px solid var(--lightgray)}" +
      ".tl-rp-row input{flex:none;width:1.15rem;height:1.15rem;margin:.15rem 0 0;accent-color:var(--secondary)}" +
      ".tl-rp-row small{display:block;color:var(--gray);font-size:.8rem;margin-top:.15rem}" +
      ".tl-rp-max{display:flex;align-items:center;gap:.4rem;padding:.2rem 0 .55rem 1.8rem}" +
      ".tl-rp-max label{flex:1;font-size:.85rem;color:var(--darkgray)}" +
      ".tl-rp-max input{width:3.6rem;height:2.1rem;text-align:center;font-size:1rem;border:1px solid var(--lightgray);" +
      "border-radius:8px;background:var(--light);color:var(--dark);-moz-appearance:textfield}" +
      ".tl-rp-max input::-webkit-inner-spin-button,.tl-rp-max input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}" +
      ".tl-rp-step{width:2.1rem;height:2.1rem;border:1px solid var(--lightgray);border-radius:8px;background:var(--light);" +
      "color:var(--dark);font-size:1.1rem;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      ".tl-rp-foot{margin-top:.4rem;color:var(--gray);font-size:.78rem}"
    document.head.appendChild(st)
  }

  // ---------- bảng tùy chọn (giữ lâu nút Ngẫu nhiên) ----------
  function closePanel() {
    var p = document.getElementById("tl-rp-panel")
    if (p) p.remove()
  }
  function openPanel() {
    addStyle()
    closePanel()
    var p = document.createElement("div")
    p.id = "tl-rp-panel"
    p.className = "tl-rp-panel"
    p.setAttribute("role", "dialog")
    p.setAttribute("aria-label", "Tùy chọn nút Ngẫu nhiên")
    p.innerHTML =
      "<h4>Tùy chọn nút Ngẫu nhiên</h4>" +
      '<label class="tl-rp-row"><input type="checkbox" id="tl-rp-read"><span>Tự đọc khi mở ghi chú ngẫu nhiên' +
      "<small>Mở ghi chú bằng nút Ngẫu nhiên thì tự bắt đầu đọc.</small></span></label>" +
      '<label class="tl-rp-row"><input type="checkbox" id="tl-rp-chain"><span>Tự chuyển sang ghi chú ngẫu nhiên khác' +
      "<small>Đọc xong một ghi chú thì tự mở ghi chú ngẫu nhiên tiếp theo, đủ số ghi chú dưới đây thì dừng.</small></span></label>" +
      '<div class="tl-rp-max"><label for="tl-rp-max">Số ghi chú tối đa</label>' +
      '<button type="button" class="tl-rp-step" data-d="-10" aria-label="Bớt 10">−</button>' +
      '<input type="number" id="tl-rp-max" min="1" max="' + MAX_LIMIT + '" step="1" inputmode="numeric">' +
      '<button type="button" class="tl-rp-step" data-d="10" aria-label="Thêm 10">+</button></div>' +
      '<div class="tl-rp-foot">Giữ nút Ngẫu nhiên để mở lại bảng này. Đóng trình duyệt thì hai tùy chọn tự tắt; số ghi chú tối đa vẫn được giữ.</div>'
    document.body.appendChild(p)
    var cr = p.querySelector("#tl-rp-read")
    var cc = p.querySelector("#tl-rp-chain")
    cr.checked = get(K_READ)
    var cm = p.querySelector("#tl-rp-max")
    cm.value = getMax()
    var saveMax = function () {
      cm.value = setMax(cm.value)
      renderBadge()
    }
    cm.addEventListener("change", saveMax)
    cm.addEventListener("blur", saveMax)
    cm.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        saveMax()
        cm.blur()
      }
    })
    p.querySelectorAll(".tl-rp-step").forEach(function (bt) {
      bt.addEventListener("click", function () {
        var v = (parseInt(cm.value, 10) || getMax()) + +bt.dataset.d
        cm.value = setMax(Math.max(1, v))
        renderBadge()
      })
    })
    cc.checked = get(K_CHAIN)
    cr.addEventListener("change", function () {
      set(K_READ, cr.checked)
      if (!cr.checked && cc.checked) {
        cc.checked = false
        set(K_CHAIN, false)
        setChain(null)
      }
    })
    cc.addEventListener("change", function () {
      set(K_CHAIN, cc.checked)
      if (cc.checked && !cr.checked) {
        cr.checked = true
        set(K_READ, true)
      }
      if (!cc.checked) setChain(null)
    })
    // đặt bảng cạnh nút, nằm gọn trong màn hình
    var b = rndBtn()
    var r = b ? b.getBoundingClientRect() : { left: innerWidth - 60, top: innerHeight / 2, bottom: innerHeight / 2 }
    var pr = p.getBoundingClientRect()
    var left = Math.max(8, Math.min(r.left - pr.width - 10, innerWidth - pr.width - 8))
    var top = r.top + (r.bottom - r.top) / 2 - pr.height / 2
    if (left < 8 || r.left - pr.width - 10 < 8) {
      left = Math.max(8, innerWidth - pr.width - 8)
      top = r.top - pr.height - 10
    }
    top = Math.max(8, Math.min(top, innerHeight - pr.height - 8))
    p.style.left = Math.round(left) + "px"
    p.style.top = Math.round(top) + "px"
  }
  document.addEventListener(
    "pointerdown",
    function (e) {
      var p = document.getElementById("tl-rp-panel")
      if (p && !p.contains(e.target) && !(e.target.closest && e.target.closest("#tl-random-note-btn"))) closePanel()
    },
    true,
  )
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePanel()
  })

  // Giữ yên nút ~0,6 giây mở bảng; di chuyển > 8px là đang kéo đổi chỗ (search-plus.js) nên hủy.
  var hold = null
  var suppressUntil = 0
  document.addEventListener(
    "pointerdown",
    function (e) {
      var b = e.target.closest && e.target.closest("#tl-random-note-btn")
      if (!b || (e.button && e.button !== 0)) return
      clearTimeout(hold && hold.t)
      hold = {
        x: e.clientX,
        y: e.clientY,
        ts: e.timeStamp,
        t: setTimeout(fireHold, HOLD_MS),
      }
    },
    true,
  )
  function fireHold() {
    if (!hold) return
    clearTimeout(hold.t)
    hold = null
    suppressUntil = Date.now() + 1500
    if (navigator.vibrate) {
      try {
        navigator.vibrate(15)
      } catch (err) {}
    }
    openPanel()
  }
  function cancelHold(e) {
    if (!hold) return
    if (e.type === "pointermove" && Math.abs(e.clientX - hold.x) < 8 && Math.abs(e.clientY - hold.y) < 8) return
    // Ngay sau khi chuyển trang, luồng chính có thể bận (vẽ Sơ đồ...) làm setTimeout trễ hơn lúc nhấc tay.
    // Dựa vào mốc thời gian của chính sự kiện chạm: đã giữ yên đủ 0,6 giây thì vẫn tính là giữ lâu.
    if (e.type === "pointerup" && e.timeStamp - hold.ts >= HOLD_MS) return fireHold()
    clearTimeout(hold.t)
    hold = null
  }
  document.addEventListener("pointermove", cancelHold, true)
  document.addEventListener("pointerup", cancelHold, true)
  document.addEventListener("pointercancel", cancelHold, true)
  document.addEventListener(
    "contextmenu",
    function (e) {
      if (e.target.closest && e.target.closest("#tl-random-note-btn")) e.preventDefault()
    },
    true,
  )

  // ---------- nhận biết lần chuyển trang do nút Ngẫu nhiên ----------
  var pending = null // {t, auto}
  var autoClicking = false
  document.addEventListener(
    "click",
    function (e) {
      var b = e.target.closest && e.target.closest("#tl-random-note-btn")
      if (!b) return
      if (Date.now() < suppressUntil) {
        // cú giữ lâu vừa mở bảng: không mở ghi chú
        suppressUntil = 0
        e.stopImmediatePropagation()
        e.preventDefault()
        return
      }
      if (autoClicking) pending = { t: Date.now(), auto: true }
      else {
        pending = { t: Date.now(), auto: false }
        // bấm tay: bắt đầu (lại) chuỗi nếu đang bật tự chuyển
        if (get(K_CHAIN)) setChain({ k: 0 })
      }
      closePanel()
    },
    true,
  )

  var waitTimer = null
  function onNav() {
    clearTimeout(waitTimer)
    addStyle()
    var fromRandom = pending && Date.now() - pending.t < 20000
    pending = null
    if (!fromRandom) {
      if (chainState()) setChain(null) // mở ghi chú khác bằng liên kết/tìm kiếm: dừng chuỗi
      renderBadge()
      return
    }
    renderBadge()
    if (!get(K_READ)) return
    // chờ read-aloud.js gắn nút "Nghe" cho trang mới rồi bắt đầu đọc
    var tries = 0
    ;(function tryStart() {
      var ra = window.__tlReadAloud
      if (ra && document.getElementById("tl-tts-btn")) {
        if (!ra.state().open) ra.start()
        return
      }
      if (++tries < 50) setTimeout(tryStart, 100)
    })()
  }
  document.addEventListener("nav", onNav)

  document.addEventListener("tl-tts-finish", function () {
    var s = chainState()
    if (!s || !get(K_CHAIN)) return
    if (s.k >= getMax()) {
      setChain(null)
      return
    }
    clearTimeout(waitTimer)
    waitTimer = setTimeout(function () {
      // người dùng đã đóng thanh đọc trong 3 giây chờ: dừng chuỗi
      if (!document.getElementById("tl-tts-bar")) {
        setChain(null)
        return
      }
      var cur = chainState()
      var b = rndBtn()
      if (!cur || !b) return
      setChain({ k: cur.k + 1 })
      autoClicking = true
      try {
        b.click()
      } finally {
        autoClicking = false
      }
    }, WAIT_MS)
  })

  // Đóng thanh đọc (nút ×) khi chuỗi đang chạy: dừng chuỗi.
  document.addEventListener(
    "click",
    function (e) {
      if (e.target.closest && e.target.closest(".tl-tts-close") && chainState()) {
        clearTimeout(waitTimer)
        setChain(null)
      }
    },
    true,
  )

  window.__tlRandomPlay = {
    openPanel: openPanel,
    state: function () {
      return { read: get(K_READ), chain: get(K_CHAIN), run: chainState(), max: getMax() }
    },
  }
  addStyle()
  renderBadge()
})()
