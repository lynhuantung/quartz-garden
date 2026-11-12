// Hậu xử lý bảo mật Private GitHub Auth + AES-256-GCM cho toàn bộ trang tĩnh sau khi `npx quartz build` hoàn tất.
// Giữ nguyên 100% tính năng của Quartz (Graph View, Backlinks, Chủ đề, Mục lục, Tìm kiếm tiếng Việt, Release Notes)
// nhưng mã hóa toàn bộ HTML và contentIndex.json bằng AES-256-GCM và yêu cầu xác thực GitHub (@lynhuantung) trước khi giải mã.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = path.join(root, "public")
const authConfigPath =
  process.env.AUTH_CONFIG_PATH ||
  path.resolve(root, "../Obsibian/obs-Personal/obs-Personal/.obsidian/tl-wiki-auth.json")

if (!fs.existsSync(authConfigPath)) {
  console.error(`protect-site: Không tìm thấy file cấu hình khóa tại ${authConfigPath}`)
  process.exit(1)
}

const authConfig = JSON.parse(fs.readFileSync(authConfigPath, "utf8"))
const siteKeyBase64 = authConfig.siteKey
const siteKeyBuf = Buffer.from(siteKeyBase64, "base64")
if (siteKeyBuf.length !== 32) {
  console.error("protect-site: siteKey phải là 32 bytes (256-bit) dạng Base64")
  process.exit(1)
}

const owner = authConfig.owner || "lynhuantung"
const displayName = process.env.OWNER_DISPLAY_NAME || "Tùng Lý"
const repo = authConfig.repo || "obs-Personal"
const branch = process.env.VAULT_BRANCH || "obs-Personal"
// Mật khẩu chung bắt buộc lấy từ secret SITE_PASSWORD; không có mật khẩu dự phòng ghi cứng.
const sitePassword = process.env.SITE_PASSWORD || ""
if (sitePassword.length < 12) {
  console.error("protect-site: thiếu secret SITE_PASSWORD hoặc mật khẩu quá ngắn (cần ít nhất 12 ký tự)")
  process.exit(1)
}

function encryptAesGcm(plainText, keyBuf) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv)
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  const ctWithTag = Buffer.concat([enc, tag])
  return {
    iv: iv.toString("base64"),
    ct: ctWithTag.toString("base64"),
  }
}

// Mã hóa siteKey bằng mật khẩu chung: PBKDF2-HMAC-SHA256 (300,000 vòng) + AES-256-GCM.
// KHÔNG đưa VAULT_TOKEN vào trang: ai có mật khẩu sẽ lấy được token đọc kho vault Private.
let wrappedTokenObj = null
{
  const salt = crypto.randomBytes(16)
  const derivedKey = crypto.pbkdf2Sync(sitePassword, salt, 300000, 32, "sha256")
  const secretBundle = JSON.stringify({
    token: "",
    siteKey: siteKeyBase64,
  })
  const { iv, ct } = encryptAesGcm(secretBundle, derivedKey)
  wrappedTokenObj = {
    salt: salt.toString("base64"),
    iv,
    ct,
    iter: 300000,
  }
}

// 1. Đếm thống kê từ contentIndex.json trước khi mã hóa để hiển thị trên màn hình khóa cá nhân hóa
let noteCount = 418
let topicCount = 11
const contentIndexPath = path.join(publicDir, "static", "contentIndex.json")
if (fs.existsSync(contentIndexPath)) {
  const rawIndex = fs.readFileSync(contentIndexPath, "utf8")
  if (!rawIndex.includes('"__tlEncrypted":true')) {
    try {
      const idxObj = JSON.parse(rawIndex)
      const keys = Object.keys(idxObj)
      noteCount = keys.length || 418
      const topFolders = new Set()
      for (const k of keys) {
        const seg = k.split("/")[0]
        if (seg && seg !== "index" && seg !== "Release-Notes") topFolders.add(seg)
      }
      if (topFolders.size > 0) topicCount = topFolders.size
    } catch (e) {}

    const encIndex = encryptAesGcm(rawIndex, siteKeyBuf)
    fs.writeFileSync(
      contentIndexPath,
      JSON.stringify({ __tlEncrypted: true, iv: encIndex.iv, ct: encIndex.ct }),
      "utf8",
    )
    console.log("protect-site: Đã mã hóa AES-256-GCM cho static/contentIndex.json")
  }
}

// 2. Xóa sitemap.xml và index.xml (RSS) để không lộ danh sách bài viết và nội dung tóm tắt
for (const sensitiveFile of ["sitemap.xml", "index.xml"]) {
  const p = path.join(publicDir, sensitiveFile)
  if (fs.existsSync(p)) {
    fs.unlinkSync(p)
    console.log(`protect-site: Đã xóa ${sensitiveFile} để bảo mật danh sách URL`)
  }
}

// 3. Tạo file runtime client script public/static/tl-wiki-auth.js
const clientScript = `(function(){
  const CFG = ${JSON.stringify({
    owner,
    displayName,
    repo,
    branch,
    noteCount,
    topicCount,
    wrappedToken: wrappedTokenObj,
  })};
  const STORAGE_KEY = "tl_wiki_auth_v1";
  let stopGraphAnim = null;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function importSiteKey(b64Key) {
    const raw = b64ToBytes(b64Key);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  async function decryptStr(ivB64, ctB64, key) {
    const iv = b64ToBytes(ivB64);
    const ct = b64ToBytes(ctB64);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(dec);
  }

  async function unwrapTokenWithPassword(password) {
    if (!CFG.wrappedToken) throw new Error("Chưa cấu hình khóa mật khẩu, vui lòng dùng GitHub Token.");
    const enc = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey("raw", enc, "PBKDF2", false, ["deriveKey"]);
    const salt = b64ToBytes(CFG.wrappedToken.salt);
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: CFG.wrappedToken.iter || 300000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    return decryptStr(CFG.wrappedToken.iv, CFG.wrappedToken.ct, aesKey);
  }

  async function verifyGitHubAndFetchSiteKey(username, secretInput) {
    const cleanUser = (username || CFG.owner).trim().toLowerCase();
    if (cleanUser !== CFG.owner.toLowerCase()) {
      throw new Error("Tài khoản GitHub không có quyền truy cập (chỉ dành cho @" + CFG.owner + ").");
    }
    const trimmedSecret = (secretInput || "").trim();
    if (!trimmedSecret) {
      throw new Error("Vui lòng nhập Mật khẩu mở khóa hoặc GitHub Personal Access Token.");
    }
    let ghToken = trimmedSecret;
    let fallbackSiteKey = null;
    const isDirectToken = /^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(trimmedSecret);
    if (!isDirectToken) {
      try {
        const unwrappedStr = await unwrapTokenWithPassword(trimmedSecret);
        const unwrapped = JSON.parse(unwrappedStr);
        ghToken = unwrapped.token || "";
        fallbackSiteKey = unwrapped.siteKey || null;
      } catch (e) {
        throw new Error("Mật khẩu mở khóa hoặc GitHub Token không chính xác.");
      }
    }

    // Xác thực trực tuyến với GitHub API: kiểm tra tài khoản & quyền đọc repo Private obs-Personal
    if (ghToken) {
      try {
        const userRes = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: "Bearer " + ghToken,
            Accept: "application/vnd.github+json"
          }
        });
        if (!userRes.ok) {
          if (isDirectToken) throw new Error("Xác thực GitHub thất bại (Token không hợp lệ hoặc đã hết hạn).");
        } else {
          const userData = await userRes.json();
          if (!userData.login || userData.login.toLowerCase() !== CFG.owner.toLowerCase()) {
            throw new Error("Tài khoản @" + (userData.login || "unknown") + " không phải chủ sở hữu @" + CFG.owner + ".");
          }
          const authFileUrl = "https://api.github.com/repos/" + CFG.owner + "/" + CFG.repo + "/contents/.obsidian/tl-wiki-auth.json?ref=" + encodeURIComponent(CFG.branch);
          const fileRes = await fetch(authFileUrl, {
            headers: {
              Authorization: "Bearer " + ghToken,
              Accept: "application/vnd.github+json"
            }
          });
          if (fileRes.ok) {
            const fileData = await fileRes.json();
            const jsonStr = atob((fileData.content || "").replace(/\\s+/g, ""));
            const parsed = JSON.parse(jsonStr);
            if (parsed.siteKey) {
              return {
                siteKey: parsed.siteKey,
                login: userData.login,
                avatarUrl: userData.avatar_url || ("https://github.com/" + CFG.owner + ".png?size=120"),
                authAt: Date.now()
              };
            }
          } else if (isDirectToken) {
            throw new Error("Token GitHub này không có quyền đọc kho Private " + CFG.owner + "/" + CFG.repo + ".");
          }
        }
      } catch (apiErr) {
        if (isDirectToken || !fallbackSiteKey) throw apiErr;
      }
    }

    if (fallbackSiteKey) {
      return {
        siteKey: fallbackSiteKey,
        login: CFG.owner,
        avatarUrl: "https://github.com/" + CFG.owner + ".png?size=120",
        authAt: Date.now()
      };
    }
    throw new Error("Không thể xác thực với GitHub.");
  }

  function getKnowledgeLogoSvg(uid, extraClass) {
    const id = (name) => "tl_" + name + "_" + uid;
    return (
      '<svg class="tl-knowledge-logo ' + (extraClass || "") + '" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="TL wiki Knowledge Emblem">' +
        '<defs>' +
          '<radialGradient id="' + id("bg") + '" cx="50%" cy="38%" r="65%">' +
            '<stop offset="0%" stop-color="#251e47"/>' +
            '<stop offset="55%" stop-color="#131126"/>' +
            '<stop offset="100%" stop-color="#090a12"/>' +
          '</radialGradient>' +
          '<linearGradient id="' + id("rim") + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
            '<stop offset="0%" stop-color="#c4b5fd"/>' +
            '<stop offset="50%" stop-color="#8b5cf6"/>' +
            '<stop offset="100%" stop-color="#38bdf8"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + id("crystal") + '" x1="15%" y1="10%" x2="85%" y2="90%">' +
            '<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.38"/>' +
            '<stop offset="50%" stop-color="#6366f1" stop-opacity="0.22"/>' +
            '<stop offset="100%" stop-color="#38bdf8" stop-opacity="0.35"/>' +
          '</linearGradient>' +
          '<linearGradient id="' + id("book") + '" x1="0%" y1="0%" x2="100%" y2="0%">' +
            '<stop offset="0%" stop-color="#38bdf8"/>' +
            '<stop offset="50%" stop-color="#a78bfa"/>' +
            '<stop offset="100%" stop-color="#38bdf8"/>' +
          '</linearGradient>' +
          '<radialGradient id="' + id("glow") + '" cx="50%" cy="46%" r="42%">' +
            '<stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.55"/>' +
            '<stop offset="60%" stop-color="#38bdf8" stop-opacity="0.18"/>' +
            '<stop offset="100%" stop-color="#090a12" stop-opacity="0"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<circle cx="60" cy="60" r="56" fill="url(#' + id("bg") + ')" stroke="url(#' + id("rim") + ')" stroke-width="2.4"/>' +
        '<circle cx="60" cy="60" r="48" fill="none" stroke="url(#' + id("rim") + ')" stroke-width="0.9" stroke-dasharray="3 5" opacity="0.45"/>' +
        '<circle cx="60" cy="50" r="34" fill="url(#' + id("glow") + ')"/>' +
        '<polygon points="60,17 85,34 81,64 60,77 39,64 35,34" fill="url(#' + id("crystal") + ')" stroke="url(#' + id("rim") + ')" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M60 17 L60 77 M35 34 L60 47 L85 34 M39 64 L60 47 L81 64" stroke="#c4b5fd" stroke-width="0.9" opacity="0.35" fill="none"/>' +
        '<g stroke="#e0e7ff" stroke-width="1.45" stroke-linecap="round" opacity="0.92">' +
          '<line x1="60" y1="22" x2="44" y2="37"/>' +
          '<line x1="60" y1="22" x2="76" y2="37"/>' +
          '<line x1="60" y1="22" x2="60" y2="46"/>' +
          '<line x1="44" y1="37" x2="60" y2="46"/>' +
          '<line x1="76" y1="37" x2="60" y2="46"/>' +
          '<line x1="44" y1="37" x2="46" y2="57"/>' +
          '<line x1="76" y1="37" x2="74" y2="57"/>' +
          '<line x1="60" y1="46" x2="46" y2="57"/>' +
          '<line x1="60" y1="46" x2="74" y2="57"/>' +
          '<line x1="46" y1="57" x2="60" y2="71"/>' +
          '<line x1="74" y1="57" x2="60" y2="71"/>' +
          '<line x1="60" y1="46" x2="60" y2="71"/>' +
        '</g>' +
        '<circle cx="60" cy="22" r="3.4" fill="#ffffff" stroke="#38bdf8" stroke-width="1.4"/>' +
        '<circle cx="44" cy="37" r="3.1" fill="#c4b5fd" stroke="#ffffff" stroke-width="1"/>' +
        '<circle cx="76" cy="37" r="3.1" fill="#7dd3fc" stroke="#ffffff" stroke-width="1"/>' +
        '<circle cx="60" cy="46" r="4.6" fill="#ffffff" stroke="#a78bfa" stroke-width="1.8"/>' +
        '<circle cx="46" cy="57" r="3" fill="#7dd3fc" stroke="#ffffff" stroke-width="1"/>' +
        '<circle cx="74" cy="57" r="3" fill="#c4b5fd" stroke="#ffffff" stroke-width="1"/>' +
        '<circle cx="60" cy="71" r="3.2" fill="#ffffff" stroke="#38bdf8" stroke-width="1.3"/>' +
        '<path d="M60 82 C49 75, 35 74, 24 79 L24 89 C35 84, 49 85, 60 93 C71 85, 85 84, 96 89 L96 79 C85 74, 71 75, 60 82 Z" fill="url(#' + id("book") + ')" opacity="0.95"/>' +
        '<path d="M22 93 C35 88, 49 89, 60 97 C71 89, 85 88, 98 93" fill="none" stroke="#c4b5fd" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/>' +
        '<line x1="60" y1="77" x2="60" y2="94" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function injectUserBadge(session) {
    const mountBadge = () => {
      const toolbar = document.querySelector(".left.sidebar .flex-component") || document.querySelector(".left.sidebar");
      if (!toolbar || toolbar.querySelector(".tl-user-menu-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "tl-user-menu-wrap";
      wrap.innerHTML =
        '<button type="button" class="tl-avatar-btn" aria-label="Tài khoản ' + CFG.displayName + '" title="' + CFG.displayName + ' (@' + (session.login || CFG.owner) + ')">' +
          getKnowledgeLogoSvg("nav", "tl-avatar-thumb") +
          '<span class="tl-avatar-dot"></span>' +
        '</button>' +
        '<div class="tl-user-popover" hidden>' +
          '<div class="tl-pop-header">' +
            getKnowledgeLogoSvg("pop", "tl-pop-avatar") +
            '<div class="tl-pop-meta">' +
              '<span class="tl-pop-name">' + CFG.displayName + '</span>' +
              '<span class="tl-pop-handle">@' + (session.login || CFG.owner) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="tl-pop-status">🔒 Đã xác thực GitHub Private</div>' +
          '<button type="button" class="tl-pop-logout">Khóa khu vườn (Đăng xuất)</button>' +
        '</div>';

      const btn = wrap.querySelector(".tl-avatar-btn");
      const pop = wrap.querySelector(".tl-user-popover");
      const logoutBtn = wrap.querySelector(".tl-pop-logout");

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
      });
      document.addEventListener("click", (e) => {
        if (!wrap.contains(e.target)) pop.hidden = true;
      });
      logoutBtn.addEventListener("click", () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        window.location.reload();
      });
      toolbar.appendChild(wrap);
    };
    mountBadge();
    document.addEventListener("nav", mountBadge);
  }

  async function decryptCurrentDocument(key, session) {
    if (stopGraphAnim) {
      stopGraphAnim();
      stopGraphAnim = null;
    }
    const encScript = document.getElementById("tl-encrypted-root");
    const rootEl = document.getElementById("quartz-root");
    if (encScript && rootEl) {
      const payload = JSON.parse(encScript.textContent);
      const html = await decryptStr(payload.iv, payload.ct, key);
      rootEl.innerHTML = html;
      encScript.remove();
      if (payload.tIv && payload.tCt) {
        try {
          document.title = await decryptStr(payload.tIv, payload.tCt, key);
        } catch (e) {}
      }
    }
    injectUserBadge(session);
  }

  async function decryptFetchedHtmlString(rawHtml, key) {
    const marker = '<script id="tl-encrypted-root" type="application/json">';
    const idx = rawHtml.indexOf(marker);
    if (idx === -1) return rawHtml;
    const endIdx = rawHtml.indexOf("</script>", idx);
    if (endIdx === -1) return rawHtml;
    const jsonText = rawHtml.slice(idx + marker.length, endIdx);
    const payload = JSON.parse(jsonText);
    const decryptedInner = await decryptStr(payload.iv, payload.ct, key);
    let out = rawHtml.replace(
      /<div id="quartz-root"([^>]*)><\\/div><script id="tl-encrypted-root" type="application\\/json">[\\s\\S]*?<\\/script>/,
      (_, attrs) => '<div id="quartz-root"' + attrs + '>' + decryptedInner + '</div>'
    );
    if (payload.tIv && payload.tCt) {
      try {
        const decTitle = await decryptStr(payload.tIv, payload.tCt, key);
        out = out.replace(/<title>[^<]*<\\/title>/, () => "<title>" + decTitle + "</title>");
      } catch (e) {}
    }
    return out;
  }

  // Chặn window.fetch để tự động giải mã contentIndex.json và các trang HTML khi điều hướng SPA / Popover
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const urlStr = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
    if (urlStr.includes("api.github.com") || urlStr.includes("fonts.googleapis.com") || urlStr.includes("cdn.jsdelivr.net") || urlStr.includes("cdnjs.cloudflare.com") || urlStr.includes("github.com/")) {
      return origFetch(input, init);
    }
    const res = await origFetch(input, init);
    if (!res.ok) return res;

    if (urlStr.includes("contentIndex.json")) {
      const key = await window.__tlWikiReady;
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.__tlEncrypted) {
          const decJson = await decryptStr(parsed.iv, parsed.ct, key);
          return new Response(decJson, {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
      } catch (e) {
        console.error("TL wiki: lỗi giải mã contentIndex.json", e);
      }
      return new Response(text, { status: res.status, headers: res.headers });
    }

    const ctHeader = (res.headers.get("content-type") || "").toLowerCase();
    if (ctHeader.includes("text/html")) {
      const key = await window.__tlWikiReady;
      const rawHtml = await res.text();
      if (rawHtml.includes('id="tl-encrypted-root"')) {
        try {
          const decHtml = await decryptFetchedHtmlString(rawHtml, key);
          return new Response(decHtml, {
            status: res.status,
            statusText: res.statusText,
            headers: { "Content-Type": "text/html; charset=utf-8" }
          });
        } catch (e) {
          console.error("TL wiki: lỗi giải mã trang HTML", e);
        }
      }
      return new Response(rawHtml, {
        status: res.status,
        statusText: res.statusText,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    return res;
  };

  function getGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return "Chào buổi sáng";
    if (h >= 11 && h < 14) return "Chào buổi trưa";
    if (h >= 14 && h < 18) return "Chào buổi chiều";
    return "Chào buổi tối";
  }

  function startNeuralGraphCanvas(canvas) {
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let rafId = null;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    const labels = [
      "Second Brain", "Zettelkasten", "Sherlock Holmes", "Feynman",
      "Synapse", "InfraNodus", "Tài chính", "Ghi chú mạng lưới",
      "Obsidian", "Tư duy sâu", "Trí nhớ", "TL wiki"
    ];
    const count = Math.min(48, Math.max(24, Math.floor((width * height) / 28000)));
    const nodes = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.42,
      vy: (Math.random() - 0.5) * 0.42,
      r: i < labels.length ? 3.2 : 1.8 + Math.random() * 1.4,
      label: i < labels.length ? labels[i] : ""
    }));

    let mouse = { x: -9999, y: -9999 };
    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener("mousemove", onMove);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < 0 || a.x > width) a.vx *= -1;
        if (a.y < 0 || a.y > height) a.vy *= -1;

        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 155) {
            const alpha = (1 - dist / 155) * 0.22;
            ctx.strokeStyle = "rgba(167, 139, 250, " + alpha.toFixed(3) + ")";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (md < 180) {
          const alpha = (1 - md / 180) * 0.45;
          ctx.strokeStyle = "rgba(196, 181, 253, " + alpha.toFixed(3) + ")";
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }

        ctx.fillStyle = a.label ? "rgba(196, 181, 253, 0.78)" : "rgba(167, 139, 250, 0.42)";
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();

        if (a.label) {
          ctx.font = "500 11px Inter, system-ui, sans-serif";
          ctx.fillStyle = "rgba(218, 218, 218, 0.34)";
          ctx.fillText(a.label, a.x + 7, a.y + 3);
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
    };
  }

  function renderLoginScreen(resolveReady) {
    const rootEl = document.getElementById("quartz-root");
    if (!rootEl) return;
    const greeting = getGreeting();

    rootEl.innerHTML = \`
      <div class="tl-login-backdrop">
        <canvas id="tl-neural-canvas" class="tl-neural-canvas"></canvas>
        <div class="tl-aurora tl-aurora-1"></div>
        <div class="tl-aurora tl-aurora-2"></div>

        <div class="tl-login-card">
          <div class="tl-card-top-bar">
            <span class="tl-brand-Chip">
              <span class="tl-dot-live"></span>
              TL wiki · Second Brain OS
            </span>
            <span class="tl-vault-chip" title="Kho lưu trữ GitHub Private">
              🔒 \${CFG.owner}/\${CFG.repo}
            </span>
          </div>

          <div class="tl-profile-hero">
            <div class="tl-avatar-ring" title="Biểu tượng Tri thức &amp; Second Brain — TL wiki">
              \${getKnowledgeLogoSvg("hero", "tl-avatar-img")}
              <span class="tl-verified-badge" title="Kho tri thức bảo mật đã xác thực">✦</span>
            </div>
            <p class="tl-greeting">\${greeting}, <strong>\${CFG.displayName}</strong></p>
            <h1 class="tl-hero-title">Khu vườn Tri thức Cá nhân</h1>
            <p class="tl-hero-quote">“Kết nối các ý tưởng rời rạc thành mạng lưới tri thức sống động.”</p>
          </div>

          <div class="tl-stats-grid">
            <div class="tl-stat-item">
              <span class="tl-stat-num">\${CFG.noteCount}</span>
              <span class="tl-stat-label">Ghi chú</span>
            </div>
            <div class="tl-stat-item">
              <span class="tl-stat-num">\${CFG.topicCount}</span>
              <span class="tl-stat-label">Chủ đề</span>
            </div>
            <div class="tl-stat-item">
              <span class="tl-stat-num">AES-256</span>
              <span class="tl-stat-label">Bảo mật GitHub</span>
            </div>
          </div>

          <form id="tl-login-form" class="tl-login-form">
            <input id="tl-gh-user" type="hidden" value="\${CFG.owner}" />

            <div class="tl-owner-identity">
              <div class="tl-owner-left">
                <svg height="16" viewBox="0 0 16 16" width="16" fill="currentColor">
                  <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                </svg>
                <span>Đăng nhập dưới tên <strong>@\${CFG.owner}</strong></span>
              </div>
              <span class="tl-sync-tag">Desktop &amp; Mobile</span>
            </div>

            <label class="tl-field">
              <div class="tl-secret-wrap">
                <input id="tl-gh-secret" type="password" placeholder="Nhập mật khẩu mở khóa hoặc GitHub Token..." autocomplete="current-password" required autofocus />
                <button type="button" id="tl-toggle-pwd" class="tl-toggle-pwd" aria-label="Hiện hoặc ẩn mật khẩu" title="Hiện/ẩn mật khẩu">
                  <svg id="tl-eye-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
            </label>

            <div id="tl-login-error" class="tl-login-error" hidden></div>

            <button id="tl-login-btn" type="submit" class="tl-login-btn">
              <span>Mở khóa Khu vườn Tri thức</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </button>
          </form>

          <div class="tl-login-footer">
            <a href="https://github.com/settings/tokens/new?description=TL+wiki+Access&scopes=repo" target="_blank" rel="noopener">
              Hoặc lấy mã Token trực tiếp từ GitHub →
            </a>
          </div>
        </div>
      </div>
    \`;

    stopGraphAnim = startNeuralGraphCanvas(document.getElementById("tl-neural-canvas"));

    const form = document.getElementById("tl-login-form");
    const userInp = document.getElementById("tl-gh-user");
    const secretInp = document.getElementById("tl-gh-secret");
    const toggleBtn = document.getElementById("tl-toggle-pwd");
    const errBox = document.getElementById("tl-login-error");
    const submitBtn = document.getElementById("tl-login-btn");

    if (toggleBtn && secretInp) {
      toggleBtn.addEventListener("click", () => {
        const isPwd = secretInp.type === "password";
        secretInp.type = isPwd ? "text" : "password";
        secretInp.focus();
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Đang xác thực GitHub &amp; giải mã...</span>';
      try {
        const session = await verifyGitHubAndFetchSiteKey(userInp.value, secretInp.value);
        const key = await importSiteKey(session.siteKey);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (err) {}
        await decryptCurrentDocument(key, session);
        resolveReady(key);
      } catch (err) {
        errBox.textContent = err && err.message ? err.message : "Đăng nhập thất bại.";
        errBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Mở khóa Khu vườn Tri thức</span>';
      }
    });
  }

  window.__tlWikiReady = new Promise((resolve) => {
    const start = async () => {
      try {
        const rawSession = localStorage.getItem(STORAGE_KEY);
        if (rawSession) {
          const session = JSON.parse(rawSession);
          if (session && session.siteKey) {
            const key = await importSiteKey(session.siteKey);
            await decryptCurrentDocument(key, session);
            resolve(key);
            return;
          }
        }
      } catch (e) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
      }
      renderLoginScreen(resolve);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  });
})();
`

const clientScriptPath = path.join(publicDir, "static", "tl-wiki-auth.js")
fs.mkdirSync(path.dirname(clientScriptPath), { recursive: true })
fs.writeFileSync(clientScriptPath, clientScript, "utf8")

// 4. Chèn await window.__tlWikiReady vào đầu các file postscript-*.js
for (const entry of fs.readdirSync(publicDir)) {
  if (/^postscript-.*\.js$/.test(entry)) {
    const psPath = path.join(publicDir, entry)
    const psContent = fs.readFileSync(psPath, "utf8")
    if (!psContent.includes("__tlWikiReady")) {
      fs.writeFileSync(psPath, `await window.__tlWikiReady;\n${psContent}`, "utf8")
      console.log(`protect-site: Đã khóa cổng khởi tạo trong ${entry}`)
    }
  }
}

// 5. Duyệt toàn bộ file .html trong public/ để mã hóa #quartz-root và <title>, xóa meta lộ nội dung
function* walkHtml(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkHtml(p)
    else if (e.name.endsWith(".html")) yield p
  }
}

let htmlEncryptedCount = 0
for (const htmlFile of walkHtml(publicDir)) {
  let html = fs.readFileSync(htmlFile, "utf8")
  if (html.includes('id="tl-encrypted-root"')) continue

  const relDir = path.relative(path.dirname(htmlFile), path.join(publicDir, "static")).replace(/\\/g, "/")
  const scriptSrc = (relDir.startsWith(".") ? relDir : `./${relDir}`) + "/tl-wiki-auth.js"

  const titleMatch = html.match(/<title>([^<]*)<\/title>/)
  const originalTitle = titleMatch ? titleMatch[1] : "TL wiki"
  const encTitle = encryptAesGcm(originalTitle, siteKeyBuf)

  const bodyMarker = '<div id="quartz-root"'
  const rootStart = html.indexOf(bodyMarker)
  const bodyEnd = html.lastIndexOf("</div></body>")
  if (rootStart === -1 || bodyEnd === -1 || bodyEnd <= rootStart) continue

  const openTagEnd = html.indexOf(">", rootStart)
  if (openTagEnd === -1 || openTagEnd >= bodyEnd) continue

  const rootOpenTag = html.slice(rootStart, openTagEnd + 1)
  const rootInnerHtml = html.slice(openTagEnd + 1, bodyEnd)
  const encRoot = encryptAesGcm(rootInnerHtml, siteKeyBuf)

  const payloadJson = JSON.stringify({
    iv: encRoot.iv,
    ct: encRoot.ct,
    tIv: encTitle.iv,
    tCt: encTitle.ct,
  })

  html =
    html.slice(0, rootStart) +
    `${rootOpenTag}</div><script id="tl-encrypted-root" type="application/json">${payloadJson}</script></body>` +
    html.slice(bodyEnd + "</div></body>".length)

  html = html
    .replace(/<title>[^<]*<\/title>/, "<title>TL wiki · Tùng Lý</title>")
    .replace(/<meta name="og:site_name" content="[^"]*"\/>/g, '<meta name="og:site_name" content="TL wiki · Tùng Lý"/>')
    .replace(/<meta name="description" content="[^"]*"\/>/g, '<meta name="description" content="TL wiki — Khu vườn tri thức cá nhân của Tùng Lý"/>')
    .replace(/<meta property="og:description" content="[^"]*"\/>/g, '<meta property="og:description" content="TL wiki — Khu vườn tri thức cá nhân của Tùng Lý"/>')
    .replace(/<meta name="twitter:description" content="[^"]*"\/>/g, '<meta name="twitter:description" content="TL wiki — Khu vườn tri thức cá nhân của Tùng Lý"/>')
    .replace(/<meta property="og:title" content="[^"]*"\/>/g, '<meta property="og:title" content="TL wiki · Tùng Lý"/>')
    .replace(/<meta name="twitter:title" content="[^"]*"\/>/g, '<meta name="twitter:title" content="TL wiki · Tùng Lý"/>')
    .replace(/<meta property="og:image:alt" content="[^"]*"\/>/g, '<meta property="og:image:alt" content="TL wiki · Tùng Lý"/>')

  const authScriptTag = `<script src="${scriptSrc}" type="application/javascript" data-persist="true"></script>`
  if (html.includes("const fetchData = fetch(")) {
    html = html.replace(
      '<script type="application/javascript" data-persist="true">const fetchData = fetch(',
      () => `${authScriptTag}<script type="application/javascript" data-persist="true">const fetchData = fetch(`,
    )
  } else {
    html = html.replace("</head>", () => `${authScriptTag}</head>`)
  }

  fs.writeFileSync(htmlFile, html, "utf8")
  htmlEncryptedCount++
}

console.log(`protect-site: Đã mã hóa AES-256-GCM và gắn cổng GitHub Auth cá nhân hóa cho ${htmlEncryptedCount} trang HTML.`)
