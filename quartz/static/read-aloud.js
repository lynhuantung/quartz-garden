// TL wiki — Nút "Nghe": đọc to nội dung ghi chú bằng giọng có sẵn của trình duyệt (Web Speech API).
//
// - Nút "Nghe" nằm ngay dưới tiêu đề ghi chú. Bấm thì hiện thanh điều khiển ở đáy màn hình:
//   lùi câu, tạm dừng/đọc tiếp, tới câu, tốc độ, tắt.
// - Chỉ đọc phần thân bài (tiêu đề + đoạn văn, danh sách, trích dẫn, bảng); bỏ qua khối mã, công thức, sơ đồ, hình.
// - Tô sáng câu đang đọc (CSS Custom Highlight API; trình duyệt cũ thì tô cả đoạn) và tự cuộn theo,
//   trừ khi người đọc vừa tự cuộn trang.
// - Chạm vào một đoạn khi đang nghe thì nhảy tới đọc từ đoạn đó.
// - Tạm dừng = hủy câu đang đọc rồi đọc lại từ đầu câu đó khi bấm tiếp (speechSynthesis.pause() không chạy
//   ổn định trên Chrome Android).
// - Giọng: ưu tiên giọng tiếng Việt tự nhiên (Edge: "HoaiMy/NamMinh Online (Natural)"), rồi Google, rồi giọng vi bất kỳ.
;(function () {
  if (window.__tlReadAloudInit) return
  window.__tlReadAloudInit = true
  var synth = window.speechSynthesis
  if (!synth || typeof window.SpeechSynthesisUtterance !== "function") return

  var RATE_KEY = "tl-tts-rate"
  var RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
  var HL_NAME = "tl-tts"
  var BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, .callout-title-inner"
  var SKIP_SEL =
    "pre, script, style, svg, math, .katex, .mermaid, .footnotes, sup, .tl-tts-row, [class^='tl-'], [aria-hidden='true']"
  var HAS_HL = !!(window.CSS && CSS.highlights && typeof window.Highlight === "function")

  var ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>'
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5.5v13a1 1 0 0 1-1.55.83L9 13a1.2 1.2 0 0 1 0-2l9.45-6.33A1 1 0 0 1 20 5.5z"/></svg>'
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5.5v13a1 1 0 0 0 1.55.83L15 13a1.2 1.2 0 0 0 0-2L5.55 4.67A1 1 0 0 0 4 5.5z"/></svg>'
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  var ICON_SPEAK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'

  var st = {
    items: [], // { text, block, range }
    idx: 0,
    playing: false,
    open: false,
    token: 0,
    voice: null,
    rate: loadRate(),
    lastUserScroll: 0,
  }

  function loadRate() {
    try {
      var r = parseFloat(localStorage.getItem(RATE_KEY))
      if (RATES.indexOf(r) >= 0) return r
    } catch (e) {}
    return 1
  }
  function saveRate() {
    try {
      localStorage.setItem(RATE_KEY, String(st.rate))
    } catch (e) {}
  }

  // ---------- giọng đọc ----------
  function pickVoice() {
    var vs = []
    try {
      vs = synth.getVoices() || []
    } catch (e) {}
    var vi = vs.filter(function (v) {
      return /^vi([-_]|$)/i.test(v.lang || "")
    })
    if (!vi.length) return null
    var score = function (v) {
      var n = v.name || ""
      var s = 0
      if (/natural|neural|online/i.test(n)) s += 4
      if (/hoaimy|namminh/i.test(n)) s += 2
      if (/google/i.test(n)) s += 1
      if (v.localService === false) s += 1
      return s
    }
    vi.sort(function (a, b) {
      return score(b) - score(a)
    })
    return vi[0]
  }
  function refreshVoice() {
    st.voice = pickVoice()
  }
  refreshVoice()
  if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", refreshVoice)
  else synth.onvoiceschanged = refreshVoice

  // ---------- tách nội dung thành câu ----------
  function article() {
    return document.querySelector(".center article") || document.querySelector("article")
  }
  function titleEl() {
    return document.querySelector(".center .article-title") || document.querySelector(".article-title")
  }

  // Các nút chữ thuộc riêng khối này (không thuộc khối con như danh sách lồng nhau), bỏ qua phần SKIP_SEL.
  function ownTextNodes(block) {
    var out = []
    var w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement
        if (!p || !n.nodeValue) return NodeFilter.FILTER_REJECT
        if (p.closest(SKIP_SEL) && block.contains(p.closest(SKIP_SEL))) return NodeFilter.FILTER_REJECT
        var b = p.closest(BLOCK_SEL)
        if (b && b !== block && block.contains(b)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    var n
    while ((n = w.nextNode())) out.push(n)
    return out
  }

  // Chia chuỗi thành câu: dấu kết câu (. ! ? … ;) theo sau là khoảng trắng; câu quá dài thì cắt ở dấu phẩy.
  function splitSentences(s) {
    // Câu kết thúc ở chuỗi dấu . ! ? … ; khi ngay sau đó là khoảng trắng hoặc hết chuỗi
    // (3.5, [!NOTE], v.v. không bị cắt). Mẩu chỉ gồm khoảng trắng/dấu thì gộp vào câu trước.
    var res = []
    var from = 0
    var P = ".!?…;"
    for (var i = 0; i < s.length; i++) {
      if (P.indexOf(s[i]) < 0) continue
      var j = i
      while (j + 1 < s.length && P.indexOf(s[j + 1]) >= 0) j++
      if (j + 1 < s.length && !/\s/.test(s[j + 1])) {
        i = j
        continue
      }
      res.push({ start: from, end: j + 1 })
      from = j + 1
      i = j
    }
    if (from < s.length) res.push({ start: from, end: s.length })
    res = res.filter(function (r, k) {
      if (k > 0 && /^[\s.!?…;]*$/.test(s.slice(r.start, r.end))) {
        res[k - 1].end = r.end
        return false
      }
      return true
    })
    // Câu dài hơn 260 ký tự: cắt ở dấu phẩy gần nhất để giọng đọc không bị ngắt giữa chừng (lỗi Chrome).
    var out = []
    res.forEach(function (r) {
      var a = r.start
      while (r.end - a > 260) {
        var cut = s.lastIndexOf(",", a + 240)
        if (cut <= a + 40) cut = s.lastIndexOf(" ", a + 240)
        if (cut <= a + 40) cut = a + 240
        out.push({ start: a, end: cut + 1 })
        a = cut + 1
      }
      out.push({ start: a, end: r.end })
    })
    return out
  }

  function speakable(t) {
    return t
      .replace(/[❯→←↔⇒⇐•·▪►◆■□✓✔✗✘※]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function addBlock(items, block) {
    var nodes = ownTextNodes(block)
    if (!nodes.length) return
    var full = ""
    var map = [] // { node, from } vị trí bắt đầu của từng nút trong chuỗi ghép
    nodes.forEach(function (n) {
      map.push({ node: n, from: full.length })
      full += n.nodeValue
    })
    var locate = function (pos, isEnd) {
      for (var i = map.length - 1; i >= 0; i--) {
        if (map[i].from < pos || (!isEnd && map[i].from === pos)) {
          var off = Math.min(pos - map[i].from, map[i].node.nodeValue.length)
          return { node: map[i].node, off: off }
        }
      }
      return { node: map[0].node, off: 0 }
    }
    splitSentences(full).forEach(function (r) {
      var text = speakable(full.slice(r.start, r.end))
      if (!/[\p{L}\p{N}]/u.test(text)) return
      // Bỏ khoảng trắng đầu/cuối khỏi vùng tô sáng.
      var a = r.start
      var b = r.end
      while (a < b && /\s/.test(full[a])) a++
      while (b > a && /\s/.test(full[b - 1])) b--
      var range = null
      try {
        var s = locate(a, false)
        var e = locate(b, true)
        range = document.createRange()
        range.setStart(s.node, s.off)
        range.setEnd(e.node, e.off)
      } catch (err) {
        range = null
      }
      items.push({ text: text, block: block, range: range })
    })
  }

  function collect() {
    var items = []
    var h = titleEl()
    if (h) {
      var hc = h.cloneNode(true)
      hc.querySelectorAll(SKIP_SEL).forEach(function (x) {
        x.remove()
      })
      var t = speakable(hc.textContent || "")
      if (t) items.push({ text: t, block: h, range: null, isTitle: true })
    }
    var art = article()
    if (!art) return items
    art.querySelectorAll(BLOCK_SEL).forEach(function (b) {
      if (b.closest(SKIP_SEL)) return
      if (b.closest("details:not([open])")) return
      if (!b.getClientRects().length) return // ẩn
      addBlock(items, b)
    })
    return items
  }

  // ---------- tô sáng + cuộn ----------
  var activeBlock = null
  function clearMark() {
    if (HAS_HL) CSS.highlights.delete(HL_NAME)
    if (activeBlock) activeBlock.classList.remove("tl-tts-active")
    activeBlock = null
  }
  function mark(it) {
    clearMark()
    if (!it) return
    if (HAS_HL && it.range) {
      try {
        CSS.highlights.set(HL_NAME, new Highlight(it.range))
      } catch (e) {}
    } else {
      activeBlock = it.block
      activeBlock.classList.add("tl-tts-active")
    }
    if (Date.now() - st.lastUserScroll < 4000) return
    var rect = it.range ? it.range.getBoundingClientRect() : it.block.getBoundingClientRect()
    var bar = document.getElementById("tl-tts-bar")
    var bottomLimit = window.innerHeight - (bar ? bar.offsetHeight + 24 : 24)
    if (rect.top < 70 || rect.bottom > bottomLimit) {
      window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight * 0.3, behavior: "smooth" })
    }
  }
  ;["wheel", "touchmove"].forEach(function (t) {
    window.addEventListener(
      t,
      function () {
        if (st.playing) st.lastUserScroll = Date.now()
      },
      { passive: true, capture: true },
    )
  })

  // ---------- phát ----------
  function speakAt(i) {
    st.token++
    var my = st.token
    try {
      synth.cancel()
    } catch (e) {}
    if (i >= st.items.length) {
      finish()
      return
    }
    if (i < 0) i = 0
    st.idx = i
    st.playing = true
    var it = st.items[i]
    mark(it)
    renderBar()
    var u = new SpeechSynthesisUtterance(it.text)
    u.lang = (st.voice && st.voice.lang) || "vi-VN"
    if (st.voice)
      try {
        u.voice = st.voice
      } catch (e) {}
    u.rate = st.rate
    u.onend = function () {
      if (my !== st.token || !st.playing) return
      // Ngắt nghỉ dài hơn một chút sau tiêu đề.
      setTimeout(
        function () {
          if (my === st.token && st.playing) speakAt(st.idx + 1)
        },
        it.isTitle ? 350 : 60,
      )
    }
    u.onerror = function (e) {
      if (my !== st.token) return
      if (e && (e.error === "interrupted" || e.error === "canceled")) return
      console.warn("TL wiki: lỗi đọc câu", e && e.error)
      if (st.playing) setTimeout(function () {
        if (my === st.token && st.playing) speakAt(st.idx + 1)
      }, 120)
    }
    // Chrome desktop đôi khi treo hàng đợi sau cancel(); gọi resume() cho chắc.
    try {
      synth.resume()
    } catch (e) {}
    synth.speak(u)
  }

  function pause() {
    st.playing = false
    st.token++
    try {
      synth.cancel()
    } catch (e) {}
    renderBar()
  }
  function finish() {
    st.playing = false
    st.idx = 0
    clearMark()
    renderBar(true)
  }
  function stopAll() {
    st.playing = false
    st.open = false
    st.token++
    try {
      synth.cancel()
    } catch (e) {}
    clearMark()
    var bar = document.getElementById("tl-tts-bar")
    if (bar) bar.remove()
    document.documentElement.classList.remove("tl-tts-on")
    syncBtn()
  }

  function start() {
    st.items = collect()
    if (!st.items.length) return
    refreshVoice()
    // Máy không có giọng tiếng Việt: vẫn đọc (trình duyệt tự chọn theo lang vi-VN), nhưng báo vài giây để người dùng biết vì sao giọng lạ.
    st.noVoiceUntil = st.voice ? 0 : Date.now() + 6000
    st.open = true
    st.idx = 0
    document.documentElement.classList.add("tl-tts-on")
    ensureBar()
    speakAt(0)
  }

  // ---------- giao diện ----------
  function btnEl(cls, html, label, onClick) {
    var b = document.createElement("button")
    b.type = "button"
    b.className = cls
    b.innerHTML = html
    b.setAttribute("aria-label", label)
    b.title = label
    b.addEventListener("click", function (e) {
      e.stopPropagation()
      onClick()
    })
    return b
  }

  function ensureBar() {
    var bar = document.getElementById("tl-tts-bar")
    if (bar) return bar
    bar = document.createElement("div")
    bar.id = "tl-tts-bar"
    bar.className = "tl-tts-bar"
    bar.setAttribute("role", "region")
    bar.setAttribute("aria-label", "Điều khiển đọc ghi chú")
    bar.appendChild(btnEl("tl-tts-b tl-tts-prev", ICON_PREV, "Câu trước", function () {
      speakAt(Math.max(0, st.idx - 1))
    }))
    bar.appendChild(btnEl("tl-tts-b tl-tts-main", ICON_PAUSE, "Tạm dừng", function () {
      if (st.playing) pause()
      else speakAt(st.idx)
    }))
    bar.appendChild(btnEl("tl-tts-b tl-tts-next", ICON_NEXT, "Câu sau", function () {
      speakAt(st.idx + 1)
    }))
    var info = document.createElement("span")
    info.className = "tl-tts-info"
    bar.appendChild(info)
    bar.appendChild(btnEl("tl-tts-b tl-tts-rate", "1×", "Tốc độ đọc", function () {
      var i = RATES.indexOf(st.rate)
      st.rate = RATES[(i + 1) % RATES.length]
      saveRate()
      if (st.playing) speakAt(st.idx)
      else renderBar()
    }))
    bar.appendChild(btnEl("tl-tts-b tl-tts-close", ICON_CLOSE, "Tắt đọc", stopAll))
    document.body.appendChild(bar)
    return bar
  }

  function renderBar(done) {
    var bar = document.getElementById("tl-tts-bar")
    if (!bar) return
    var main = bar.querySelector(".tl-tts-main")
    main.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY
    var lbl = st.playing ? "Tạm dừng" : done ? "Nghe lại từ đầu" : "Đọc tiếp"
    main.setAttribute("aria-label", lbl)
    main.title = lbl
    bar.querySelector(".tl-tts-rate").textContent = String(st.rate).replace(".", ",") + "×"
    var info = bar.querySelector(".tl-tts-info")
    info.title = st.voice
      ? "Giọng: " + st.voice.name
      : "Máy chưa cài giọng tiếng Việt. Android: Cài đặt > Quản lý chung > Chuyển văn bản thành giọng nói > Google > tải dữ liệu Tiếng Việt. Windows: dùng Edge (có sẵn giọng HoaiMy, NamMinh)."
    if (done) info.textContent = "Đã đọc hết"
    else if (st.noVoiceUntil && Date.now() < st.noVoiceUntil) info.textContent = "Máy chưa có giọng Việt"
    else info.textContent = "Câu " + (st.idx + 1) + "/" + st.items.length
    bar.classList.toggle("is-paused", !st.playing)
    syncBtn()
  }

  function syncBtn() {
    var b = document.getElementById("tl-tts-btn")
    if (!b) return
    var lbl = b.querySelector(".tl-tts-btn-label")
    if (st.open && st.playing) {
      b.classList.add("is-active")
      lbl.textContent = "Đang đọc"
    } else if (st.open) {
      b.classList.add("is-active")
      lbl.textContent = "Tạm dừng"
    } else {
      b.classList.remove("is-active")
      lbl.textContent = "Nghe"
    }
  }

  function mountBtn() {
    var h = titleEl()
    var art = article()
    if (!h || !art) return
    if ((art.textContent || "").trim().length < 40) return
    if (document.getElementById("tl-tts-btn")) return
    var row = document.createElement("div")
    row.className = "tl-tts-row"
    var b = document.createElement("button")
    b.type = "button"
    b.id = "tl-tts-btn"
    b.className = "tl-tts-btn"
    b.title = "Nghe đọc ghi chú này (chạm vào một đoạn khi đang nghe để đọc từ đoạn đó)"
    b.innerHTML = ICON_SPEAK + '<span class="tl-tts-btn-label">Nghe</span>'
    b.addEventListener("click", function () {
      if (!st.open) start()
      else if (st.playing) pause()
      else speakAt(st.idx)
    })
    row.appendChild(b)
    h.insertAdjacentElement("afterend", row)
    syncBtn()
  }

  // Chạm vào một đoạn khi đang mở thanh đọc: đọc từ câu đầu của đoạn đó (bỏ qua khi bấm vào liên kết).
  document.addEventListener("click", function (e) {
    if (!st.open) return
    var t = e.target
    if (!t || !t.closest || t.closest("a, button, input, summary, .tl-tts-bar")) return
    var sel = window.getSelection && window.getSelection()
    if (sel && !sel.isCollapsed) return
    var art = article()
    if (!art || !art.contains(t)) return
    var b = t.closest(BLOCK_SEL)
    if (!b) return
    for (var i = 0; i < st.items.length; i++) {
      if (st.items[i].block === b || b.contains(st.items[i].block)) {
        st.lastUserScroll = 0
        speakAt(i)
        return
      }
    }
  })

  // Chuyển trang trong Quartz (SPA): dừng đọc trang cũ, gắn nút cho trang mới.
  document.addEventListener("prenav", stopAll)
  document.addEventListener("nav", function () {
    stopAll()
    mountBtn()
  })
  window.addEventListener("pagehide", function () {
    try {
      synth.cancel()
    } catch (e) {}
  })
  if (document.querySelector(".center article")) mountBtn()

  window.__tlReadAloud = {
    collect: function () {
      return collect().map(function (x) {
        return x.text
      })
    },
    voice: function () {
      return st.voice ? st.voice.name + " (" + st.voice.lang + ")" : null
    },
    state: function () {
      return { open: st.open, playing: st.playing, idx: st.idx, n: st.items.length, rate: st.rate }
    },
    start: start,
    stop: stopAll,
  }
})()
