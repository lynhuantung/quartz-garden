# quartz-garden

Digital garden dựng bằng [Quartz 5](https://quartz.jzhao.xyz), xuất bản lên GitHub Pages.

```
Vault Obsidian (repo riêng, private) ──► Action: lọc note `dg-publish: true` ──► quartz build ──► GitHub Pages
```

- `scripts/sync-vault.mjs`: chép vào `content/` chỉ những note có `dg-publish: true` (kèm ảnh được nhúng). Note có `dg-home: true` thành trang chủ.
- `.github/workflows/deploy.yml`: build và deploy. Chạy khi push, khi gọi tay, khi nhận `repository_dispatch` kiểu `vault-updated`, và mỗi giờ.
- `content/` được tạo lúc build, **không commit** (repo này public). Local: thêm `content/*` vào `.git/info/exclude`.

## Chạy trên máy
```bash
npm ci
VAULT_DIR=<đường dẫn vault> node scripts/sync-vault.mjs
npx quartz plugin install
npx quartz build --serve   # http://localhost:8080
```

## Secret cần có
- `VAULT_TOKEN` (Settings → Secrets → Actions): fine-grained token, chỉ quyền **Contents: Read-only** cho repo vault.
