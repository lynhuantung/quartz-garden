// Vá nhỏ cho plugin cộng đồng của Quartz (mã đã nén trong node_modules hoặc .quartz/plugins).
// Mỗi bản vá là idempotent; nếu plugin đổi phiên bản làm đoạn mã không còn khớp thì chỉ cảnh báo.
//  1. graph:  nhãn chữ hiện ngay khi mở trang (mặc định chỉ hiện sau khi zoom).
//  2. search: tìm kiếm và tô sáng không phân biệt dấu tiếng Việt
//     ("nao bo" tìm ra và tô sáng "Não bộ", "dinh" ra "Đỉnh").
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Mã JS chèn vào plugin. X: bỏ dấu + hạ chữ thường. M: biến mỗi chữ cái trong biểu thức chính quy
// thành lớp ký tự khớp mọi biến thể có dấu (kể cả dấu dạng tách rời: chữ cái + ký tự U+0300-U+036F).
const COMB = "[\\u0300-\\u036f]*"
const classes = {
  a: "aàáảãạăằắẳẵặâầấẩẫậ",
  e: "eèéẻẽẹêềếểễệ",
  i: "iìíỉĩị",
  o: "oòóỏõọôồốổỗộơờớởỡợ",
  u: "uùúủũụưừứửữự",
  y: "yỳýỷỹỵ",
}
const mapObj =
  "{" +
  Object.entries(classes)
    .map(([k, v]) => `${k}:"[${v}]${COMB}"`)
    .join(",") +
  ',d:"[dđ]"}'
const X = 's=>s.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/\\u0111/g,"d")'
const M = `q=>q.replace(/[a-z]/gi,c=>(${mapObj})[c.toLowerCase()]||c)`

const patches = [
  {
    name: "graph",
    dir: "@quartz-community/graph",
    marker: "forceCenter",
    edits: [
      {
        // Gọi handler zoom một lần với phép biến đổi đơn vị để cập nhật độ hiện của nhãn ngay từ đầu.
        from: '.on("zoom",ut);',
        to: '.on("zoom",ut);ut({transform:o.zoomIdentity});',
      },
      {
        // Cấp liên kết của đồ thị cục bộ do người dùng chọn (lưu ở localStorage "graphDepth").
        // Đồ thị toàn cục (depth < 0) giữ nguyên.
        from: "$u=S.depth,",
        to: '$u=S.depth<0?S.depth:((function(){try{return parseInt(localStorage.getItem("graphDepth"))}catch(e){}})()||S.depth),',
      },
      {
        // Cắt nhãn quá dài (ví dụ "Building a Second Brain - Thiết lập bộ não thứ hai") để không chồng chữ.
        from: "text:iu.text,style:{fontSize:We*15",
        to: 'text:iu.text.length>22?iu.text.slice(0,21)+"…":iu.text,style:{fontSize:We*15',
      },
      {
        // Nút chọn "Cấp 1 · 2 · 3" ngay dưới tiêu đề đồ thị cục bộ; chọn xong tải lại trang để vẽ lại.
        from: ".on(\"zoom\",ut);ut({transform:o.zoomIdentity});",
        to:
          '.on("zoom",ut);ut({transform:o.zoomIdentity});' +
          '(function(){if(S.depth<0)return;var w=_.closest(".graph");if(!w||w.querySelector(".graph-depth"))return;' +
          'var d=document.createElement("div");d.className="graph-depth";d.setAttribute("role","group");' +
          'd.setAttribute("aria-label","Cấp liên kết");' +
          'd.innerHTML="<span>Cấp</span>"+[1,2,3].map(function(n){return \'<button type="button" data-d="\'+n+\'"\'+(n===$u?\' class="on"\':"")+">"+n+"</button>"}).join("");' +
          'd.addEventListener("click",function(e){var n=e.target&&e.target.dataset&&e.target.dataset.d;if(!n)return;' +
          'try{localStorage.setItem("graphDepth",n)}catch(x){}location.reload()});w.appendChild(d)})();',
      },
    ],
  },
  {
    name: "search",
    dir: "@quartz-community/search",
    marker: "encode:Ci",
    edits: [
      {
        // Bộ mã hóa chỉ mục/truy vấn: bỏ dấu
        from: "Ci=t=>{let e=[],n=-1,r=-1,i=t.toLowerCase(),s=0;",
        to: `Ci=t=>{let e=[],n=-1,r=-1,i=(${X})(t),s=0;`,
      },
      {
        // Tô sáng đoạn trích nội dung
        from: 'let s=new RegExp(i,"gi")',
        to: `let s=new RegExp((${M})(i),"gi")`,
      },
      {
        // Tô sáng tiêu đề/từng từ: so khớp không dấu và tạo regex khớp mọi biến thể dấu
        from: "function Tn(t,e,n){",
        to: `function Tn(t,e,n){const X=${X},M=${M};`,
      },
      { from: "c.toLowerCase().startsWith(p.toLowerCase())", to: "X(c).startsWith(X(p))" },
      { from: "l.toLowerCase().includes(f.toLowerCase())", to: "X(l).includes(X(f))" },
      { from: "h=l.replace(a,c=>", to: 'h=l.replace(new RegExp(M(a.source),"gi"),c=>' },
    ],
  },
]

function* walk(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p, depth + 1)
    else if (e.name.endsWith(".js")) yield p
  }
}

for (const patch of patches) {
  let patched = 0
  let already = 0
  let broken = 0
  for (const base of [
    path.join(root, "node_modules", patch.dir),
    path.join(root, ".quartz/plugins"),
  ]) {
    for (const file of walk(base)) {
      let src = fs.readFileSync(file, "utf8")
      if (!src.includes(patch.marker)) continue
      let changed = false
      for (const { from, to } of patch.edits) {
        if (src.includes(to)) continue // đã vá
        if (src.split(from).length === 2) {
          src = src.replace(from, () => to)
          changed = true
        } else {
          broken++
          console.warn(`patch-plugins: [${patch.name}] ${path.relative(root, file)}: không khớp đúng một lần: ${from.slice(0, 50)}`)
        }
      }
      if (changed) {
        fs.writeFileSync(file, src)
        patched++
      } else already++
    }
  }
  if (patched + already === 0) console.warn(`patch-plugins: [${patch.name}] không tìm thấy mã cần vá, bỏ qua`)
  else console.log(`patch-plugins: [${patch.name}] ${patched} file vừa vá, ${already} file đã vá sẵn${broken ? `, ${broken} đoạn không khớp` : ""}`)
}
