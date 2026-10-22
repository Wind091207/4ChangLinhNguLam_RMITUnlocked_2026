# 🎬 Kịch Bản Demo 2 Phút & Giải Thích Chuyên Sâu — DualKey (Giao Diện Vũ Trụ Tối Giản)

> **Quy định Video của Ban Tổ Chức (Tide UNLOCKED · RMIT Challenge 2):**
> - **Thời lượng tối đa:** **2 phút (120 giây)**
> - **Định dạng & Nơi lưu:** File **`.mp4`**, dung lượng **< 100 MB**, đặt trực tiếp trong thư mục gốc của GitHub repo (ví dụ: `demo.mp4`).
> - **Chuẩn bị trước khi quay:**
>   1. Mở `http://localhost:3000`, bấm **`Reset`** trên thanh trên cùng để đưa dữ liệu về trạng thái sạch ban đầu.
>   2. Đảm bảo đang chọn nhân vật **`Dave Miller`** (`Submitter`) và phiếu chi **`EXP-2026-041` (`$18,500 AUD`)** đang mở sẵn.

---

## 🌌 Điểm Đắt Giá Của Giao Diện Mới (Deep-Space Cosmic UI)

Giao diện mới được thiết kế theo phong cách **Vũ trụ tối giản (Deep-Space Minimalism)** trên một màn hình duy nhất (không cần chuyển qua lại nhiều tab phức tạp):
1. **Thanh `ACTING AS` & Quyền hạn trực quan (`DAVE CAN` / `ALICE CAN` / `BOB CAN`):** Ngay khi chọn nhân vật, hàng huy hiệu bên dưới báo rõ người đó được làm gì (`✓` màu xanh ngọc) và bị cấm làm gì (`✕` gạch ngang).
2. **4 Ô Trạng Thái Tổng Quan (Status Counters):** Hiển thị thời gian thực số phiếu chờ duyệt (`Awaiting approval`), sẵn sàng giải ngân (`Ready to release`), yêu cầu đổi quyền đang bị giữ chờ Quorum (`Role changes held for quorum`), và tổng số hành vi vượt quyền đã bị chặn (`Attempts blocked`).
3. **Bảng Trạng Thái Yêu Cầu (Request Status Board — Cột Trái):**
   - **Role change requests · TideCloak IGA:** Nằm ngay trên đầu cột trái với nút mô phỏng tấn công 1-click **`⚡ Simulate: Alice grants herself approver`**.
   - **Expense requests:** Mỗi phiếu chi có thanh tiến trình 4 bước (`Submitted` → `Approval 1` → `Approval 2` → `Released`). Những nút mà nhân vật hiện tại không đủ quyền sẽ có **viền nét đứt kèm ổ khóa `🔒` và dòng cảnh báo lý do ngay bên dưới nút** (nhưng bạn vẫn bấm vào được để server kiểm tra và trả về bảng giải thích từ chối!).
4. **Bảng Giải Thích Lý Do Từ Chối (`DECISION PANEL` — Cột Phải):**
   - Mỗi khi một hành động bị từ chối (`✕ REFUSED`) hoặc bị giữ chờ đồng thuận (`❙❙ HELD FOR QUORUM`), bảng này sáng lên màu đỏ/vàng hổ phách và giải thích rõ bằng ngôn ngữ tự nhiên:
     - **Why it was refused / Why it is on hold:** Lý do cụ thể vì sao không đủ quyền hạn.
     - **Missing permission:** Thiếu quyền mật mã nào (`expense-approver`, `payee decrypt key`, `tide-realm-admin`).
     - **Who can do this:** Chỉ rõ ai trong tổ chức mới có quyền thực hiện (`Bob, Carol`).
     - **Enforced by:** Do tầng bảo mật nào của TideCloak chặn (`TideCloak IGA quorum (2 of 3)`, `TideCloak E2EE (tag: payee)`, `TideCloak role check`).

---

## 🎥 Kịch Bản Bấm Giờ Từng Giây (4 Cảnh — 120 Giây)

---

### ⏱️ CẢNH 1: Mở Đầu & Tầm Nhìn ("The Possibility") — `0:00 → 0:20` (20 giây)

* **🖱️ Thao tác chuột:**
  1. Đưa chuột lướt qua logo hành tinh **`DualKey`** và trạng thái **`TideCloak · realm dualkey · quorum 2 of 3`** ở góc trên.
  2. Lướt qua 4 thẻ nhân vật ở mục **`ACTING AS`**: `Dave Miller` (Submitter), `Alice Vance` (IT Admin · no finance rights), `Bob Chen` (Approver · Finance), `Carol Nguyen` (Approver · CFO).
* **🎙️ Lời thoại (Tiếng Anh):**
  > *"This is DualKey Expense Desk, built with TideCloak. We built a quorum-governed treasury workspace for NGOs and research funds where no single person—not even an IT administrator with root IAM and database access—can unilaterally grant themselves approval rights, read beneficiary bank accounts, or release high-value funds."*

---

### ⏱️ CẢNH 2: Nút Thắt Niềm Tin & Bảo Mật E2EE ("The Constraint") — `0:20 → 0:45` (25 giây)

* **🖱️ Thao tác chuột:**
  1. Đang ở **`Dave Miller`**, nhìn vào phiếu **`EXP-2026-041` (`$18,500 AUD` — Emergency Solar Microgrid)**.
  2. Bấm vào nút nét đứt **`🔒 Reveal bank details`** (có ghi chú `Approvers only — will be refused`) → Nhìn sang bảng **`DECISION PANEL`** màu đỏ bên phải hiện ngay:
     - **`✕ REFUSED (HTTP 403)`**
     - **Why it was refused:** *Bank details are end-to-end encrypted to approvers only. Without the key, even full database access shows ciphertext.*
     - **Missing permission:** `expense-approver`, `payee decrypt key` · **Who can do this:** `Bob, Carol`.
  3. Bấm nút **`View raw database`** trên thanh trên cùng → Cho giám khảo thấy trường `payeeBankCiphertext` trong Database hoàn toàn là bản mã, rồi bấm **`Close`**.
* **🎙️ Lời thoại (Tiếng Anh):**
  > *"In traditional systems, dual-approval fails if a server admin can dump the database or rewrite IAM roles. Here, Dave submitted an $18,500 solar microgrid expense. The beneficiary's bank details are sealed under TideCloak's `payee` encryption tag. Even if we inspect the raw server database, only ciphertext is stored."*

---

### ⏱️ CẢNH 3: Màn Tấn Công Nội Bộ Của IT Admin `Alice` ("The Prototype & Why TideCloak Matters") — `0:45 → 1:35` (50 giây)

* **🖱️ Thao tác chuột:**
  1. Ở mục **`ACTING AS`**, bấm chọn **`Alice Vance` (`IT Admin · no finance rights`)**. Chỉ vào hàng **`ALICE CAN`**: có `✓ Review role changes` nhưng bị gạch chéo `✕ Reveal bank details` và `✕ Approve & release`.
  2. Trên phiếu `$18,500 AUD`, bấm thử nút **`🔒 Approve (1 of 2)`** → Bảng **`DECISION PANEL`** bên phải báo đỏ **`✕ REFUSED (HTTP 403)`**: *"Only people holding the expense-approver role can approve. Being an IT admin does not grant financial authority."*
  3. Nhìn lên khung đầu tiên bên trái (`Role change requests · TideCloak IGA`), bấm nút màu vàng **`⚡ Simulate: Alice grants herself approver`**:
     - Ngay lập tức một thẻ yêu cầu đổi quyền hiện ra với trạng thái **`Held for quorum · 1/2`**.
     - Bảng **`DECISION PANEL`** bên phải chuyển sang màu vàng hổ phách **`❙❙ HELD FOR QUORUM (HTTP 202)`**: *"Role changes need 2 of 3 admins to sign. The request is parked and the role is NOT active until a second admin co-signs."*
  4. Ngay trên thẻ yêu cầu đổi quyền vừa hiện ra, Alice bấm thử nút **`🔒 Co-sign (2nd admin)`** (`You already signed — needs another admin`) → Bảng **`DECISION PANEL`** báo đỏ **`✕ REFUSED (HTTP 409)`**: *"You already provided the first signature. A second, different admin has to co-sign."*
* **🎙️ Lời thoại (Tiếng Anh):**
  > *"Now let's switch to Alice, our Head of IT and Realm Admin. When Alice tries to approve the $18,500 expense, she is refused with HTTP 403, and the decision panel shows she lacks `expense-approver`. So Alice launches an insider attack: granting herself `expense-approver` on TideCloak. TideCloak's IGA engine intercepts the mutation and holds it for a 2-of-3 admin quorum. When Alice tries to co-sign her own request, TideCloak blocks her with HTTP 409."*

---

### ⏱️ CẢNH 4: Phê Duyệt Kép Hợp Lệ (`Bob` + `Carol`) & Giải Ngân ("What Changes") — `1:35 → 2:00` (25 giây)

* **🖱️ Thao tác chuột:**
  1. Chuyển sang **`Bob Chen` (`Approver · Finance`)**.
  2. Ở khung `Role change requests` đầu trang, bấm nút đỏ **`Reject request`** để hủy yêu cầu tự nâng quyền của Alice.
  3. Xuống phiếu `$18,500 AUD`:
     - Bấm **`Reveal bank details`** → Hộp mật mã mở khóa màu xanh ngọc hiển thị rõ số tài khoản thật (`Commonwealth Bank of Australia · BSB 063-184 · Account 1094-8821-73`).
     - Bấm **`Approve (1 of 2)`** → Thanh tiến trình nhảy sang bước 3 (`Needs 2nd approver · 1/2`).
     - *(Thao tác nhanh)* Bấm thử **`🔒 Release payment`** → Bảng bên phải báo đỏ **`✕ REFUSED (HTTP 412)`** vì mới có `1/2` chữ ký.
  4. Chuyển sang **`Carol Nguyen` (`Approver · CFO`)**:
     - Bấm **`Approve (2 of 2)`** → Đạt đủ 2 chữ ký (`Ready to release`).
     - Bấm **`Release payment`** → Giải ngân thành công (`✓ ALLOWED`), thanh tiến trình xanh toàn bộ 4 bước kèm mã giao dịch `TIDE-ESCROW-TX-...`!
  5. Ở giây cuối, bấm nút lọc **`Refused`** trên bảng **`Activity`** bên phải để hiển thị toàn bộ danh sách các lần từ chối và lý do.
* **🎙️ Lời thoại (Tiếng Anh):**
  > *"When Finance Director Bob logs in, he rejects Alice's rogue request, reveals the verified bank coordinates, and signs Approval 1 of 2. Releasing funds early is refused with HTTP 412. Only when CFO Carol provides the second independent signature does DualKey release the $18,500 payment—giving organizations mathematical multi-party control."*
