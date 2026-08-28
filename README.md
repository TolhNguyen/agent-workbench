# Agent Workbench 0.5

Agent Workbench là **không gian làm việc của bạn với AI**. Nó ghi nhớ bạn là ai,
bạn phụ trách những hệ thống nào, và những gì đã học được — để mỗi lần bắt đầu
một việc mới, trợ lý AI không phải đoán lại từ đầu.

Toàn bộ nằm trong một thư mục duy nhất trên máy bạn. Không server, không
database, không cần kết nối mạng để chạy.

> Repo này là **công cụ dùng chung**, chưa phải không gian làm việc của bạn.
> Fork về, chạy `node bin/awb.js init --root .` một lần (Bước 1 bên dưới), và
> mọi thứ riêng của bạn — hồ sơ, dự án, việc, kiến thức — sẽ nằm trong bản fork
> đó. Repo gốc không giữ dữ liệu của ai, nên bạn kéo cập nhật về lúc nào cũng
> được mà không bị xung đột.

---

## Bắt đầu trong 5 phút

### Bước 0 — Kiểm tra máy

Cần **Node.js phiên bản 20 trở lên**. Kiểm tra:

```bash
node --version
node bin/awb.js version
```

Kết quả mong đợi: `v20.x` (hoặc mới hơn) và `0.5.0`. Nếu lệnh thứ hai báo lỗi,
bạn đang đứng sai thư mục — hãy `cd` vào thư mục chứa tệp này.

Mọi lệnh dưới đây đều chạy từ thư mục này.

### Bước 1 — Khởi tạo không gian làm việc của bạn

Chạy **một lần duy nhất** sau khi fork về:

```bash
node bin/awb.js init --root .
node bin/awb.js validate
```

Nếu bỏ qua bước này, mọi lệnh sẽ báo:

```text
Error: No Agent Workbench found. Run `awb init` or pass --root.
```

```text
Workspace is valid.
Name: Agent Workbench
Format: 0.3
Counts: 0 projects, 0 relationships, 0 knowledge items, 0 artifacts
```

Thấy `Workspace is valid.` là xong bước này.

### Bước 2 — Giới thiệu bản thân (chỉ làm một lần)

Đây là bước quan trọng nhất. Trước khi làm được việc gì, workspace cần biết bạn
là ai — nếu không, trợ lý sẽ đoán, và đoán sai.

```bash
node bin/awb.js profile status
```

```text
Onboarding is not complete. Interview the user with these questions, then
record the answers with `awb profile complete`.

- name (required): What should I call you?
- role (required): Which role best describes your main work here?
  Choose from roles: developer, reviewer, technical-writer
- language (required): Which language should I write and talk to you in?
- responsibilities (required): What are you responsible for day to day?
...
```

**Cách dùng thông thường:** bảo trợ lý AI *"đọc START_HERE.md và bắt đầu"*. Nó sẽ
tự chạy lệnh trên, hỏi bạn từng câu bằng tiếng Việt, rồi tự ghi lại. Bạn chỉ việc
trả lời.

**Nếu muốn tự nhập:**

```bash
node bin/awb.js profile complete \
  --name "Nguyễn Văn A" \
  --role developer \
  --language vi \
  --responsibility "Bảo trì hệ thống bán hàng" \
  --system "order-api" \
  --skill debugging
```

```text
Profile recorded: user/PROFILE.md
Name: Nguyễn Văn A
Role: developer
Language: vi
```

Câu trả lời được lưu ở `user/PROFILE.md` — tệp văn bản thường, sửa tay lúc nào
cũng được.

### Bước 3 — Khai báo dự án đầu tiên

"Dự án" là một codebase, một tập tài liệu, hay bất cứ thứ gì bạn làm việc trên đó.

```bash
node bin/awb.js project add order-api --name "Order API" --path src/order-api --create
```

```text
Project added: order-api
Name: Order API
Mode: managed
Path: src/order-api
```

Mã nguồn thật đặt trong `src/order-api/`. Lưu ý: **thư mục mã nguồn không được
commit lên Git** của workspace này (xem [Git](#code-của-tôi-có-bị-đẩy-lên-git-không)).

### Bước 4 — Tạo việc cần làm

```bash
node bin/awb.js task create \
  --id TASK-DEMO \
  --title "Sửa lỗi tính phí ship" \
  --role developer \
  --project order-api \
  --deliverable patch \
  --quality-gate tests-pass
```

```text
Task created: TASK-DEMO
Role: developer
Projects: order-api
```

`--deliverable` là thứ bạn cam kết giao ra. `--quality-gate` là điều kiện phải
đạt trước khi được đóng việc. Cả hai đều do bạn tự đặt tên.

Khi cần trợ lý nạp đúng bối cảnh cho việc này:

```bash
node bin/awb.js task context TASK-DEMO
```

Lệnh này trả về **tham chiếu**, không đổ hết nội dung ra — nên nó không làm ngợp
cửa sổ ngữ cảnh của trợ lý.

### Bước 5 — Làm xong thì ghi nhận và đóng

```bash
# Ghi nhận sản phẩm đã làm ra
node bin/awb.js artifact add TASK-DEMO --project order-api --path ship.js --kind patch --verified

# Xác nhận điều kiện chất lượng đã đạt
node bin/awb.js task gate-pass TASK-DEMO tests-pass

# Kiểm tra rồi đóng
node bin/awb.js task verify TASK-DEMO
node bin/awb.js task close TASK-DEMO
```

```text
Task is verified: TASK-DEMO
Artifacts: 1
Task closed: TASK-DEMO
Verified: true
```

`task close` **từ chối** đóng nếu còn thiếu sản phẩm, còn artifact chưa xác minh,
hoặc còn điều kiện chất lượng chưa đạt. Đó là chủ ý.

---

## Xem mình đang có sẵn những gì

```bash
node bin/awb.js role list        # vai trò
node bin/awb.js skill list       # kỹ năng
node bin/awb.js workflow list    # quy trình
node bin/awb.js skill show debugging   # xem chi tiết một mục
```

Bộ đi kèm là **bộ khởi động để bạn thay**, không phải danh mục hoàn chỉnh. Thêm
cái của riêng bạn bằng cách tạo thư mục:

```bash
mkdir -p roles/product-owner
# rồi viết roles/product-owner/ROLE.md mô tả vai trò đó
```

Xong là dùng được ngay: `--role product-owner`.

## Ghi lại điều đã học

```bash
node bin/awb.js memory propose --scope project:order-api \
  --title "Phí ship tính theo khu vực" \
  --text "Luôn kiểm tra tỉnh/thành trước khi tính phí."

node bin/awb.js memory list
node bin/awb.js memory approve LEARN-...
```

Điều đã học **phải được bạn duyệt** mới trở thành kiến thức chính thức. Trợ lý
không tự ghi thẳng vào bộ nhớ dài hạn.

## Khi bạn chưa biết cách làm

Trước khi cam kết vào một hướng, hãy tìm hiểu bằng `awb research start` — và
ghi lại cả những lần thất bại bằng `awb research attempt`, vì đó mới là thứ
giúp người sau đỡ mất thời gian. Xong thì kết luận bằng
`awb research conclude`:

```bash
node bin/awb.js research start --question "Shopify có webhook đơn hàng không?"
node bin/awb.js research attempt <id> --tried "Poll REST mỗi 30s" --result failed --note "429 sau 40 request/phút"
node bin/awb.js research attempt <id> --tried "Webhook orders/create" --result passed
node bin/awb.js research conclude <id> --text "Dùng webhook orders/create; polling dính 429."
```

`conclude` tạo một đề xuất chờ bạn duyệt — giống mọi bài học khác:

```bash
node bin/awb.js memory approve <proposal-id>
```

Nghiên cứu **không cần dự án** và **không bị chặn bởi onboarding**: nó chính là
thứ giúp bạn quyết định có nên tạo dự án hay không.

Nếu cách làm đó đáng lặp lại, hãy biến nó thành skill — xem
`workflows/research-to-skill/WORKFLOW.md`.

---

## Gặp lỗi thì làm gì

Mọi thông báo lỗi đều nói rõ cách xử lý. Dưới đây là những lỗi hay gặp nhất:

| Thông báo | Nghĩa là gì | Làm gì |
|---|---|---|
| `No Agent Workbench found. Run \`awb init\` or pass --root.` | Bạn đang đứng ngoài thư mục workspace | `cd` về thư mục chứa tệp README này |
| `This workspace has no user profile yet...` | Chưa làm Bước 2 | Chạy `profile status` rồi `profile complete` |
| `Unknown role: dev. Available: developer, reviewer, technical-writer.` | Gõ sai tên vai trò | Dùng đúng một tên trong danh sách nó liệt kê |
| `Unknown option for \`awb task create\`: --titl.` | Gõ sai tên tuỳ chọn | Xem `node bin/awb.js task --help` |
| `... is already inside the workspace at ...` | Bạn lỡ tạo workspace lồng trong workspace | Dùng workspace đã có, đừng tạo cái mới |
| `Task ... is not verified.` | Còn thiếu artifact hoặc điều kiện chất lượng | Chạy `task verify <id>` để xem thiếu gì |
| `user/PROFILE.md has been edited.` | Bạn đã sửa tay hồ sơ, lệnh không dám ghi đè | Thêm `--replace` nếu thật sự muốn ghi đè |
| `No roles/ entries exist yet.` | Workspace cũ, chưa có bộ khởi động | Chạy `node bin/awb.js migrate` |

Không có trong bảng? Chạy `node bin/awb.js validate` — nó liệt kê mọi thứ đang
sai trong workspace.

## Code của tôi có bị đẩy lên Git không?

**Không.** Workspace này commit hồ sơ, vai trò, kỹ năng, kiến thức, và bản ghi
công việc của bạn. Mã nguồn dự án trong `src/` **bị loại trừ hoàn toàn**.

Hệ quả cần biết: thư mục dự án trong `src/` **không được version bởi repo nào
cả**. Nếu công việc đó cần lịch sử, hãy để nó ở repo riêng và khai báo dạng
external source, hoặc thêm vào dạng submodule. Chi tiết ở
[docs/REFERENCE.md](docs/REFERENCE.md).

## Nâng cấp workspace cũ

Nếu bạn đang giữ một bản Workbench từ trước 0.4:

```bash
node bin/awb.js migrate
node bin/awb.js validate
```

Lệnh này cài bộ vai trò/kỹ năng khởi động và chuẩn hoá định danh. Nó **không bao
giờ đè lên** thứ bạn tự viết, và chạy lại nhiều lần cũng không sao.

---

## Đi sâu hơn

- [docs/REFERENCE.md](docs/REFERENCE.md) — tra cứu đầy đủ: chế độ nguồn,
  submodule, external source, quan hệ giữa dự án, provider, chính sách Git,
  danh sách lệnh
- [docs/ONBOARDING.md](docs/ONBOARDING.md) — thiết kế của luồng phỏng vấn
- [docs/CORE_SPEC.md](docs/CORE_SPEC.md) — đặc tả chuẩn của Core
- [CHANGELOG.md](CHANGELOG.md) — thay đổi theo phiên bản

Trợ giúp ngay trong dòng lệnh:

```bash
node bin/awb.js help          # tổng quan
node bin/awb.js task --help   # trợ giúp cho một nhóm lệnh
```

Mọi lệnh đều hỗ trợ `--json` để máy đọc được.
