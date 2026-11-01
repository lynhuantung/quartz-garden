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
const repo = authConfig.repo || "obs-Personal"
const branch = process.env.VAULT_BRANCH || "obs-Personal"
const vaultToken = process.env.VAULT_TOKEN || ""
const sitePassword = process.env.SITE_PASSWORD || "TungLy@2026"

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

// Mã hóa GitHub token + siteKey dự phòng bằng PBKDF2-HMAC-SHA256 (300,000 vòng) + AES-256-GCM
let wrappedTokenObj = null
{
  const salt = crypto.randomBytes(16)
  const derivedKey = crypto.pbkdf2Sync(sitePassword, salt, 300000, 32, "sha256")
  const secretBundle = JSON.stringify({
    token: vaultToken || "",
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

// 1. Mã hóa public/static/contentIndex.json
const contentIndexPath = path.join(publicDir, "static", "contentIndex.json")
if (fs.existsSync(contentIndexPath)) {
  const rawIndex = fs.readFileSync(contentIndexPath, "utf8")
  if (!rawIndex.includes('"__tlEncrypted":true')) {
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
    repo,
    branch,
    wrappedToken: wrappedTokenObj,
  })};
  const STORAGE_KEY = "tl_wiki_auth_v1";
  let cryptoKeyPromise = null;

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
    const cleanUser = (username || "").trim().toLowerCase();
    if (cleanUser !== CFG.owner.toLowerCase()) {
      throw new Error("Tài khoản GitHub không có quyền truy cập (chỉ cho phép @" + CFG.owner + ").");
    }
    const trimmedSecret = (secretInput || "").trim();
    if (!trimmedSecret) {
      throw new Error("Vui lòng nhập Mật khẩu truy cập hoặc GitHub Personal Access Token.");
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
        throw new Error("Mật khẩu hoặc GitHub Token không chính xác.");
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
                avatarUrl: userData.avatar_url || "",
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
        avatarUrl: "https://github.com/" + CFG.owner + ".png?size=64",
        authAt: Date.now()
      };
    }
    throw new Error("Không thể xác thực với GitHub.");
  }

  function injectUserBadge(session) {
    const mountBadge = () => {
      const leftSidebar = document.querySelector(".left.sidebar");
      if (!leftSidebar || leftSidebar.querySelector(".tl-gh-badge")) return;
      const badge = document.createElement("div");
      badge.className = "tl-gh-badge";
      badge.innerHTML =
        '<div class="tl-gh-user">' +
          '<span class="tl-gh-lock" title="Đã xác thực GitHub Private">🔒</span>' +
          (session.avatarUrl ? '<img class="tl-gh-avatar" src="' + session.avatarUrl + '" alt=""/>' : '') +
          '<span class="tl-gh-name">@' + (session.login || CFG.owner) + '</span>' +
        '</div>' +
        '<button type="button" class="tl-gh-logout" title="Đăng xuất và khóa trang">Đăng xuất</button>';
      badge.querySelector(".tl-gh-logout").addEventListener("click", () => {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        window.location.reload();
      });
      leftSidebar.appendChild(badge);
    };
    mountBadge();
    document.addEventListener("nav", mountBadge);
  }

  async function decryptCurrentDocument(key, session) {
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
    // Không chặn các request gọi tới GitHub API hoặc CDN bên ngoài
    if (urlStr.includes("api.github.com") || urlStr.includes("fonts.googleapis.com") || urlStr.includes("cdn.jsdelivr.net") || urlStr.includes("cdnjs.cloudflare.com")) {
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

  function renderLoginScreen(resolveReady) {
    const rootEl = document.getElementById("quartz-root");
    if (!rootEl) return;
    rootEl.innerHTML = \`
      <div class="tl-login-backdrop">
        <div class="tl-login-card">
          <div class="tl-login-header">
            <div class="tl-gh-logo">
              <svg height="38" viewBox="0 0 16 16" width="38" fill="currentColor" aria-hidden="true">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
              </svg>
            </div>
            <h1>TL wiki</h1>
            <p class="tl-login-sub">Kho tri thức cá nhân (Private) · Yêu cầu đăng nhập GitHub</p>
            <div class="tl-repo-pill">🔒 github.com/\${CFG.owner}/\${CFG.repo}</div>
          </div>
          <form id="tl-login-form" class="tl-login-form">
            <label class="tl-field">
              <span>Tài khoản GitHub</span>
              <input id="tl-gh-user" type="text" value="\${CFG.owner}" autocomplete="username" required />
            </label>
            <label class="tl-field">
              <span>Mật khẩu truy cập hoặc GitHub Token</span>
              <input id="tl-gh-secret" type="password" placeholder="Nhập mật khẩu hoặc ghp_..." autocomplete="current-password" required autofocus />
            </label>
            <div id="tl-login-error" class="tl-login-error" hidden></div>
            <button id="tl-login-btn" type="submit" class="tl-login-btn">
              <span>Đăng nhập với GitHub</span>
            </button>
          </form>
          <div class="tl-login-footer">
            <a href="https://github.com/settings/tokens/new?description=TL+wiki+Access&scopes=repo" target="_blank" rel="noopener">
              Lấy mã Token nhanh từ GitHub (nếu đang đăng nhập github.com) →
            </a>
          </div>
        </div>
      </div>
    \`;

    const form = document.getElementById("tl-login-form");
    const userInp = document.getElementById("tl-gh-user");
    const secretInp = document.getElementById("tl-gh-secret");
    const errBox = document.getElementById("tl-login-error");
    const submitBtn = document.getElementById("tl-login-btn");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Đang xác thực với GitHub...</span>';
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
        submitBtn.innerHTML = '<span>Đăng nhập với GitHub</span>';
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

  // Tìm đường dẫn tương đối tới static/tl-wiki-auth.js
  const relDir = path.relative(path.dirname(htmlFile), path.join(publicDir, "static")).replace(/\\/g, "/")
  const scriptSrc = (relDir.startsWith(".") ? relDir : `./${relDir}`) + "/tl-wiki-auth.js"

  // Tách <title>...</title>
  const titleMatch = html.match(/<title>([^<]*)<\/title>/)
  const originalTitle = titleMatch ? titleMatch[1] : "TL wiki"
  const encTitle = encryptAesGcm(originalTitle, siteKeyBuf)

  // Tách nội dung bên trong <div id="quartz-root" ...>...</div></body>
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

  // Thay thế #quartz-root bằng khung rỗng + payload mã hóa AES-256-GCM
  html =
    html.slice(0, rootStart) +
    `${rootOpenTag}</div><script id="tl-encrypted-root" type="application/json">${payloadJson}</script></body>` +
    html.slice(bodyEnd + "</div></body>".length)

  // Xóa thông tin mô tả bài viết trong các thẻ meta để không lộ nội dung qua link preview
  html = html
    .replace(/<title>[^<]*<\/title>/, "<title>TL wiki (Private)</title>")
    .replace(/<meta name="description" content="[^"]*"\/>/g, '<meta name="description" content="TL wiki — Kho tri thức cá nhân (Private)"/>')
    .replace(/<meta property="og:description" content="[^"]*"\/>/g, '<meta property="og:description" content="TL wiki — Kho tri thức cá nhân (Private)"/>')
    .replace(/<meta name="twitter:description" content="[^"]*"\/>/g, '<meta name="twitter:description" content="TL wiki — Kho tri thức cá nhân (Private)"/>')
    .replace(/<meta property="og:title" content="[^"]*"\/>/g, '<meta property="og:title" content="TL wiki (Private)"/>')
    .replace(/<meta name="twitter:title" content="[^"]*"\/>/g, '<meta name="twitter:title" content="TL wiki (Private)"/>')
    .replace(/<meta property="og:image:alt" content="[^"]*"\/>/g, '<meta property="og:image:alt" content="TL wiki (Private)"/>')

  // Chèn script xác thực ngay trước script fetchData trong <head>
  const authScriptTag = `<script src="${scriptSrc}" type="application/javascript" data-persist="true"></script>`
  if (html.includes("const fetchData = fetch(")) {
    html = html.replace(
      '<script type="application/javascript" data-persist="true">const fetchData = fetch(',
      `${authScriptTag}<script type="application/javascript" data-persist="true">const fetchData = fetch(`,
    )
  } else {
    html = html.replace("</head>", `${authScriptTag}</head>`)
  }

  fs.writeFileSync(htmlFile, html, "utf8")
  htmlEncryptedCount++
}

console.log(`protect-site: Đã mã hóa AES-256-GCM và gắn cổng GitHub Auth cho ${htmlEncryptedCount} trang HTML.`)
