# Phiếu Phản Ánh — K4 Ngày 12

> **Bài làm cá nhân.** Trả lời bằng lời của chính bạn, dựa trên những gì bạn
> quan sát được khi chạy code — không sao chép đáp án của người khác.
>
> Cách trả lời: thay từng dòng trả lời mẫu bên dưới bằng câu trả lời của bạn.
> `grade.py` đếm số câu đã trả lời (15 điểm cho 10 câu).
>
> Họ và tên: Trần Minh Hiển  Mã học viên: 2A202601812

---

### Câu 1 — Fail fast (CP1)

Trong `Settings`, `api_token` không có giá trị mặc định nên app chết ngay khi
khởi động nếu thiếu biến môi trường. Hãy mô tả một tình huống cụ thể mà việc
"chết sớm" này cứu bạn, so với việc để mặc định `"changeme"`.

> Một tình huống cụ thể là khi deploy lên Render nhưng quên khai báo
> `API_TOKEN`. Nếu code có token mặc định `"changeme"`, container vẫn healthy
> và public endpoint `/chat` có thể bị gọi bằng một credential dễ đoán. Với
> `api_token` bắt buộc, Pydantic ném `ValidationError` ngay lúc khởi động;
> deployment bị đánh dấu lỗi trước khi nhận traffic, nên tôi sửa cấu hình khi
> vẫn đang theo dõi dashboard thay vì phát hiện sau khi API đã bị lạm dụng.

---

### Câu 2 — Log cho máy đọc (CP1)

Chạy service và gọi `/chat` vài lần. Dán một dòng log JSON bạn thu được, rồi
nêu **hai** việc bạn làm được với dòng log đó mà `print("đã trả lời xong")`
không làm được.

> Một dòng log tôi quan sát được khi gọi `/chat` là:
>
> `{"event":"chat_completed","severity":"INFO","client_id":"cp5-test","prompt_tokens":3,"completion_tokens":35,"usd_cost":0.00002145}`
>
> Từ JSON này tôi có thể (1) lọc và đếm số request theo `client_id`, từ đó tìm
> client gọi nhiều nhất; (2) cộng `usd_cost`, token đầu vào/đầu ra để dựng
> dashboard hoặc cảnh báo chi phí. Dòng `print("đã trả lời xong")` không có
> field ổn định để máy truy vấn hoặc tổng hợp hai thông tin đó.

---

### Câu 3 — Kích thước image (CP2)

Build cả hai phiên bản và ghi lại số đo thật:

```bash
docker build -f <Dockerfile-1-stage> -t chat:single .
docker build -t chat:multi .
docker images | grep chat
```

| Bản | Dung lượng |
|-----|-----------|
| 1 stage (bản đầu) | 1.69 GB |
| Multi-stage | 270 MB |

Giải thích: phần dung lượng chênh lệch đó là những gì?

> Tôi build thật hai image ngày 2026-08-10: `day12-chat:single-audit` là 1.69 GB,
> còn `day12-chat:cp2-test` là 270 MB, giảm khoảng 1.42 GB (xấp xỉ 84%). Phần
> chênh lệch chủ yếu là base image Python đầy đủ cùng các gói hệ điều hành mà
> runtime không cần. Bản multi-stage dùng `python:3.11-slim`; stage cuối chỉ
> nhận dependency đã cài từ builder và source cần chạy, không mang toàn bộ môi
> trường build hay pip cache sang production.

---

### Câu 4 — Thứ tự lệnh trong Dockerfile (CP2)

Sửa một ký tự trong `app/main.py` rồi build lại. Với Dockerfile của bạn, những
layer nào được dùng lại từ cache, layer nào phải chạy lại? Nếu bạn đặt
`COPY . .` lên trước `RUN pip install` thì kết quả khác thế nào?

> Khi chỉ sửa `app/main.py`, các layer base image, `WORKDIR`,
> `COPY requirements.txt`, `pip install`, tạo `appuser` và copy dependency từ
> builder vẫn dùng cache vì `requirements.txt` không đổi. Cache bị vô hiệu từ
> `COPY app ./app`; layer source đó và các layer đứng sau nó được tạo lại. Nếu
> đặt `COPY . .` trước `RUN pip install`, chỉ một ký tự trong source cũng làm
> checksum của layer copy đổi, khiến layer cài toàn bộ dependency phải chạy
> lại dù danh sách thư viện không hề thay đổi.

---

### Câu 5 — Vì sao không chạy bằng root (CP2)

Container mặc định chạy bằng root. Mô tả chuỗi sự kiện dẫn từ "một lỗ hổng
trong code Python của bạn" tới "kẻ tấn công có quyền cao trên máy host", và
lệnh `USER` cắt đứt chuỗi đó ở chỗ nào.

> Nếu ứng dụng Python có lỗ hổng thực thi lệnh, kẻ tấn công trước tiên chạy
> lệnh với UID của process trong container. Khi process là root, họ có quyền
> sửa file hệ thống trong container, đọc nhiều dữ liệu hơn và có vị thế tốt
> hơn để lợi dụng mount/socket hoặc lỗ hổng kernel nhằm tác động host. Lệnh
> `USER appuser` làm process chạy bằng UID 10001 không đặc quyền, nên chặn ngay
> bước chiếm quyền root trong container và giảm phạm vi thiệt hại. Nó không
> thay thế việc vá kernel hay bảo vệ Docker socket, nhưng là một lớp giảm quyền
> quan trọng.

---

### Câu 6 — Bearer token (CP3)

Vì sao 401 phải kèm header `WWW-Authenticate: Bearer`? Và vì sao ta trả **cùng
một** thông báo lỗi cho cả ba trường hợp (thiếu header, sai scheme, sai token)
thay vì nói rõ sai ở đâu cho người dùng dễ sửa?

> `WWW-Authenticate: Bearer` cho client biết server yêu cầu cơ chế Bearer theo
> chuẩn HTTP, nhờ đó thư viện/client có thể phản ứng đúng thay vì phải đoán.
> Cùng một thông báo `invalid or missing bearer token` cho thiếu header, sai
> scheme và sai token tránh biến API thành công cụ dò credential: người tấn
> công không biết mình đã đoán đúng cấu trúc hay một phần token hay chưa. Log
> nội bộ vẫn có thể ghi nguyên nhân phù hợp mà không tiết lộ nó trong response.

---

### Câu 7 — Token bucket (CP3)

Với `capacity=10`, `refill_per_minute=10`: một client im lặng 10 phút rồi gửi
liên tiếp. Nó gửi được bao nhiêu request trước khi bị 429? Nếu bỏ đoạn
`min(capacity, ...)` trong `available()` thì con số đó thành bao nhiêu, và tại sao?

> Có chặn `min(capacity, ...)`, sau 10 phút xô vẫn chỉ có tối đa 10 token nên
> client gửi liên tiếp được 10 request, request thứ 11 nhận 429. Nếu bỏ chặn
> trên và xô đang đầy tại lần cập nhật cuối, nó tích thêm `10 phút × 10
> token/phút = 100`, thành 110 token. Nếu xô bắt đầu từ 0 thì thành 100. Đây là
> lý do bỏ `min` cho phép một client im lặng lâu tích lũy burst lớn hơn hẳn
> capacity đã cấu hình.

---

### Câu 8 — Ngân sách theo ngày (CP3)

So sánh hạn mức $30/tháng với hạn mức $1/ngày cho cùng một client. Giả sử có sự
cố khiến một client gọi liên tục từ 2h sáng. Với mỗi cách, thiệt hại tối đa là
bao nhiêu và service tự hồi phục khi nào?

> Với hạn mức 30 USD/tháng, một sự cố bắt đầu lúc 2h sáng có thể tiêu toàn bộ
> phần ngân sách tháng còn lại, tối đa 30 USD, và client chỉ tự hoạt động lại
> khi sang tháng mới (nếu không can thiệp). Với 1 USD/ngày, thiệt hại của ngày
> đó bị chặn ở tối đa 1 USD và key ngày mới cho phép service tự hoạt động lại
> sau 00:00 UTC hôm sau. Hai cách có cùng tổng lý thuyết khoảng 30 USD/tháng,
> nhưng hạn mức ngày thu nhỏ blast radius của một sự cố đơn lẻ.

---

### Câu 9 — /healthz khác /readyz (CP4)

Nếu gộp hai endpoint làm một và cho nó kiểm tra Redis, chuyện gì xảy ra với cụm
3 container khi Redis mất kết nối 30 giây? Trả lời theo đúng thứ tự sự kiện.

> Nếu endpoint gộp kiểm tra cả process và Redis, Redis mất kết nối làm cả ba
> container đồng thời trả 503 cho liveness. Orchestrator hiểu nhầm cả ba
> process bị hỏng và restart chúng cùng lúc. Trong lúc Redis vẫn gián đoạn,
> container mới tiếp tục fail probe và có thể rơi vào vòng lặp restart; load
> balancer không còn instance khỏe để phục vụ kể cả route không cần Redis.
> Tách `/healthz` giúp process vẫn sống, còn `/readyz` chỉ rút instance khỏi
> traffic cho tới khi dependency hồi phục, không gây restart hàng loạt.

---

### Câu 10 — Deploy thật (CP5)

Ghi lại **một** lỗi bạn gặp khi deploy lên cloud (build fail, health check
timeout, sai REDIS_URL, app không đọc `$PORT`...): thông báo lỗi là gì, bạn
tìm ra nguyên nhân bằng cách nào, và sửa ra sao?

> Khi kiểm tra bản Render, tôi gọi nhầm `/steadyz` và nhận `HTTP 404` với
> `{"detail":"Not Found"}`. Tôi đối chiếu lại API contract trong README và
> danh sách route của app, nhận ra endpoint đúng là `/readyz`. Sau khi sửa URL,
> service trả `HTTP 200 {"status":"ready","redis":true}`, đồng thời xác nhận
> `REDIS_URL` của Render đã nối đúng tới Redis service. Lỗi này cũng cho thấy
> health check cần dùng chính xác path đã cấu hình, nếu không platform có thể
> coi một deployment khỏe là thất bại.
