const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const messageInput = $("#messageInput");
const tokenInput = $("#tokenInput");
const clientInput = $("#clientInput");
const sendButton = $("#sendButton");

const session = {
  successfulRequests: 0,
  rememberedMessages: 0,
};

const friendlyErrors = {
  400: { title: "Yêu cầu chưa hợp lệ", detail: "Hãy kiểm tra lại thông tin vừa nhập." },
  401: { title: "Chưa được xác thực", detail: "Token đang thiếu hoặc không đúng. Hãy kiểm tra API token rồi thử lại." },
  402: { title: "Đã đạt giới hạn ngân sách", detail: "Client này đã dùng hết ngân sách trong ngày. Bạn có thể đổi mã người dùng để tiếp tục demo." },
  422: { title: "Nội dung chưa hợp lệ", detail: "Tin nhắn cần có ít nhất một ký tự và không dài quá 2.000 ký tự." },
  429: { title: "Bạn đang gửi quá nhanh", detail: "Cơ chế rate limit đã bảo vệ service. Hãy chờ một chút rồi thử lại." },
  503: { title: "Dịch vụ chưa sẵn sàng", detail: "Ứng dụng đang khởi động, đang tắt dần hoặc tạm mất kết nối Redis." },
};

function escapeForDisplay(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const dot = document.createElement("span");
  dot.className = "toast-dot";
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(dot, text);
  $("#toastRegion").appendChild(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function technicalDetails(payload) {
  const details = document.createElement("details");
  details.className = "technical";
  const summary = document.createElement("summary");
  summary.textContent = "Xem chi tiết kỹ thuật";
  const pre = document.createElement("pre");
  pre.textContent = escapeForDisplay(payload);
  details.append(summary, pre);
  return details;
}

function addMessage(role, text, options = {}) {
  const row = document.createElement("div");
  row.className = `message ${role}${options.error ? " error" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  const body = document.createElement("div");
  body.textContent = text;
  bubble.appendChild(body);

  if (options.meta?.length) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    options.meta.forEach((item) => {
      const span = document.createElement("span");
      span.textContent = item;
      meta.appendChild(span);
    });
    bubble.appendChild(meta);
  }

  if (options.technical) bubble.appendChild(technicalDetails(options.technical));
  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return row;
}

function addTyping() {
  const row = document.createElement("div");
  row.className = "message bot";
  row.id = "typingIndicator";
  row.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function removeTyping() {
  $("#typingIndicator")?.remove();
}

function headers(useToken = true) {
  const result = { "Content-Type": "application/json" };
  if (useToken && tokenInput.value.trim()) {
    result.Authorization = `Bearer ${tokenInput.value.trim()}`;
  }
  if (clientInput.value.trim()) result["X-Client-Id"] = clientInput.value.trim();
  return result;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return { detail: await response.text() };
}

function updateRequestMetrics(status, latency) {
  $("#statusMetric").textContent = `HTTP ${status}`;
  $("#latencyMetric").textContent = `${Math.round(latency)} ms`;
}

function updateMetrics(data, status, latency) {
  session.successfulRequests += 1;
  session.rememberedMessages = Number(data.turns_before || 0) + 2;
  $("#successMetric").textContent = session.successfulRequests;
  $("#historyMetric").textContent = session.rememberedMessages;
  updateRequestMetrics(status, latency);
}

async function sendChat(message) {
  const cleanMessage = message.trim();
  if (!cleanMessage) {
    showToast("Hãy nhập một câu hỏi trước khi gửi.", "error");
    messageInput.focus();
    return;
  }
  if (!tokenInput.value.trim()) {
    showToast("Bạn cần nhập API token để trò chuyện.", "error");
    tokenInput.focus();
    return;
  }

  addMessage("user", cleanMessage, { meta: [`Người dùng: ${clientInput.value.trim() || "anonymous"}`] });
  messageInput.value = "";
  resizeComposer();
  sendButton.disabled = true;
  addTyping();

  try {
    const startedAt = performance.now();
    const response = await fetch("/chat", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message: cleanMessage }),
    });
    const latency = performance.now() - startedAt;
    const data = await parseResponse(response);
    removeTyping();
    updateRequestMetrics(response.status, latency);

    if (!response.ok) {
      const friendly = friendlyErrors[response.status] || {
        title: "Không thể hoàn thành yêu cầu",
        detail: "Đã có lỗi ngoài dự kiến. Hãy thử lại sau.",
      };
      const retryAfter = response.headers.get("retry-after");
      const meta = [`Mã phản hồi: ${response.status}`];
      if (retryAfter) meta.push(`Thử lại sau khoảng ${retryAfter} giây`);
      addMessage("bot", `${friendly.title}. ${friendly.detail}`, {
        error: true,
        meta,
        technical: { status: response.status, body: data, retry_after: retryAfter },
      });
      return;
    }

    updateMetrics(data, response.status, latency);
    addMessage("bot", data.reply, {
      meta: [
        `HTTP ${response.status} thật`,
        `Redis trả về ${data.turns_before} tin nhắn trước`,
        `Độ trễ ${Math.round(latency)} ms`,
        "Nội dung trả lời: mock LLM",
      ],
      technical: {
        du_lieu_that: {
          http_status: response.status,
          client_id: data.client_id,
          redis_turns_before: data.turns_before,
          latency_ms: Math.round(latency),
        },
        du_lieu_mo_phong: {
          reply: data.reply,
          estimated_usage: data.usage,
          mock_usd_cost: data.usd_cost,
        },
      },
    });
  } catch (error) {
    removeTyping();
    addMessage("bot", "Không thể kết nối tới service. Hãy kiểm tra mạng hoặc thử tải lại trang.", {
      error: true,
      technical: { error: error.message },
    });
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
}

function setHealthCard(cardId, textId, ok, okText, errorText) {
  const card = $(cardId);
  card.classList.remove("loading", "error");
  if (!ok) card.classList.add("error");
  $(textId).textContent = ok ? okText : errorText;
}

async function refreshHealth() {
  const refreshButton = $("#refreshStatus");
  refreshButton.classList.add("spinning");
  [$("#healthCard"), $("#readyCard")].forEach((card) => {
    card.className = "health-card loading";
  });
  $("#healthText").textContent = "Đang kiểm tra…";
  $("#readyText").textContent = "Đang kiểm tra…";

  const check = async (path) => {
    try {
      const response = await fetch(path, { cache: "no-store" });
      return { ok: response.ok, status: response.status, data: await parseResponse(response) };
    } catch (error) {
      return { ok: false, status: 0, data: { detail: error.message } };
    }
  };

  const [health, readiness] = await Promise.all([check("/healthz"), check("/readyz")]);
  setHealthCard("#healthCard", "#healthText", health.ok, "Đang hoạt động", "Không phản hồi");
  setHealthCard("#readyCard", "#readyText", readiness.ok, "Đã kết nối", "Chưa sẵn sàng");
  refreshButton.classList.remove("spinning");
}

function createTestReport(title, description) {
  const row = document.createElement("div");
  row.className = "message test";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const head = document.createElement("div");
  head.className = "test-report-head";
  const heading = document.createElement("div");
  const kicker = document.createElement("small");
  kicker.textContent = "Kết quả kiểm thử từ API thật";
  const name = document.createElement("strong");
  name.textContent = title;
  heading.append(kicker, name);
  const verdict = document.createElement("span");
  verdict.className = "test-verdict";
  verdict.textContent = "ĐANG CHẠY";
  head.append(heading, verdict);
  const copy = document.createElement("p");
  copy.className = "test-report-copy";
  copy.textContent = description;
  const codes = document.createElement("div");
  codes.className = "http-codes";
  const progress = document.createElement("div");
  progress.className = "test-progress";
  const progressBar = document.createElement("span");
  progress.appendChild(progressBar);
  bubble.append(head, copy, codes, progress);
  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;

  return {
    row, bubble, copy, progress, progressBar, verdict,
    addCode(label, blocked = false) {
      const badge = document.createElement("span");
      badge.className = `http-code${blocked ? " blocked" : ""}`;
      badge.textContent = label;
      codes.appendChild(badge);
    },
    setProgress(value) {
      progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
    },
    finish(passed, resultText, technical) {
      row.classList.add(passed ? "passed" : "failed");
      verdict.textContent = passed ? "ĐẠT" : "CHƯA ĐẠT";
      copy.textContent = resultText;
      progress.remove();
      if (technical) bubble.appendChild(technicalDetails(technical));
      messages.scrollTop = messages.scrollHeight;
    },
  };
}

async function runSingleTest(button, title, description, request, expectedStatus, successText) {
  button.disabled = true;
  const report = createTestReport(title, description);
  try {
    const startedAt = performance.now();
    const response = await fetch("/chat", request);
    const latency = performance.now() - startedAt;
    const data = await parseResponse(response);
    const passed = response.status === expectedStatus;
    report.addCode(`HTTP ${response.status}`, response.status >= 400);
    report.addCode(`${Math.round(latency)} ms`);
    report.setProgress(100);
    report.finish(
      passed,
      passed ? successText : `Service trả HTTP ${response.status}, trong khi kết quả kỳ vọng là ${expectedStatus}.`,
      { status: response.status, latency_ms: Math.round(latency), response: data },
    );
    updateRequestMetrics(response.status, latency);
  } catch (error) {
    report.finish(false, "Không kết nối được tới service.", { error: error.message });
  } finally {
    button.disabled = false;
  }
}

async function testAuthentication() {
  const button = $("#testAuth");
  await runSingleTest(
    button,
    "Bearer authentication",
    "Đang gửi một request thật nhưng cố ý không đính kèm Authorization header.",
    {
      method: "POST",
      headers: headers(false),
      body: JSON.stringify({ message: "Kiểm tra xác thực" }),
    },
    401,
    "Service trả HTTP 401 và từ chối request. Endpoint /chat đang được bảo vệ bằng Bearer token.",
  );
}

async function testValidation() {
  if (!tokenInput.value.trim()) {
    showToast("Nhập token trước để bài kiểm tra đi tới lớp kiểm tra nội dung.", "error");
    tokenInput.focus();
    return;
  }
  const button = $("#testValidation");
  await runSingleTest(
    button,
    "Kiểm tra dữ liệu đầu vào",
    "Đang gửi request thật với trường message rỗng và token hợp lệ.",
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message: "" }),
    },
    422,
    "Service trả HTTP 422. Pydantic đã chặn dữ liệu rỗng trước khi logic chat được thực thi.",
  );
}

async function testRateLimit() {
  if (!tokenInput.value.trim()) {
    showToast("Nhập token trước khi kiểm tra giới hạn tốc độ.", "error");
    tokenInput.focus();
    return;
  }
  const button = $("#testRateLimit");
  button.disabled = true;
  const report = createTestReport(
    "Token bucket rate limit",
    "Đang gửi tuần tự 15 request thật bằng cùng một client để làm cạn token bucket.",
  );
  const codes = [];
  let lastLatency = 0;
  try {
    for (let index = 0; index < 15; index += 1) {
      const startedAt = performance.now();
      const response = await fetch("/chat", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ message: `Kiểm tra tốc độ ${index + 1}` }),
      });
      lastLatency = performance.now() - startedAt;
      codes.push(response.status);
      report.addCode(String(response.status), response.status === 429);
      report.copy.textContent = `Đã nhận response thật từ ${index + 1}/15 request.`;
      report.setProgress(((index + 1) / 15) * 100);
      messages.scrollTop = messages.scrollHeight;
    }
    const blocked = codes.filter((code) => code === 429).length;
    report.finish(
      blocked > 0,
      blocked
        ? `${blocked}/15 request thật đã bị chặn bằng HTTP 429. Token bucket đang bảo vệ service khỏi lưu lượng quá nhanh.`
        : "Chưa xuất hiện HTTP 429. Bucket có thể vừa được nạp lại; hãy bấm thử thêm một lần.",
      { http_statuses: codes, blocked_requests: blocked },
    );
    updateRequestMetrics(codes.at(-1), lastLatency);
  } catch (error) {
    report.finish(false, "Kết nối bị gián đoạn trước khi hoàn tất 15 request.", {
      completed_statuses: codes,
      error: error.message,
    });
  } finally {
    button.disabled = false;
  }
}

async function testRedisHistory() {
  if (!tokenInput.value.trim()) {
    showToast("Nhập token trước khi kiểm tra lịch sử Redis.", "error");
    tokenInput.focus();
    return;
  }
  const button = $("#testRedis");
  button.disabled = true;
  const proofClient = `redis-proof-${Date.now().toString(36)}`;
  const report = createTestReport(
    "Redis lưu lịch sử hội thoại",
    "Đang tạo một client hoàn toàn mới và gửi hai lượt chat thật với cùng client ID.",
  );
  const proofHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokenInput.value.trim()}`,
    "X-Client-Id": proofClient,
  };
  const evidence = [];

  try {
    for (let turn = 1; turn <= 2; turn += 1) {
      const startedAt = performance.now();
      const response = await fetch("/chat", {
        method: "POST",
        headers: proofHeaders,
        body: JSON.stringify({ message: `Bằng chứng Redis, lượt ${turn}` }),
      });
      const latency = performance.now() - startedAt;
      const data = await parseResponse(response);
      evidence.push({
        turn,
        http_status: response.status,
        redis_turns_before: data.turns_before,
        latency_ms: Math.round(latency),
      });
      report.addCode(
        response.ok ? `Lượt ${turn}: Redis trả ${data.turns_before} tin cũ` : `Lượt ${turn}: HTTP ${response.status}`,
        !response.ok,
      );
      report.setProgress(turn * 50);
    }

    const passed = evidence[0]?.http_status === 200
      && evidence[0]?.redis_turns_before === 0
      && evidence[1]?.http_status === 200
      && evidence[1]?.redis_turns_before === 2;
    report.finish(
      passed,
      passed
        ? "Lượt đầu Redis trả 0 tin cũ; lượt hai trả đúng 2 tin (user + assistant) của lượt trước. Lịch sử đã được ghi và đọc lại thành công."
        : "Kết quả hai lượt chưa tạo được chuỗi bằng chứng 0 → 2 như kỳ vọng.",
      { client_id: proofClient, evidence },
    );
    const last = evidence.at(-1);
    if (last) updateRequestMetrics(last.http_status, last.latency_ms);
  } catch (error) {
    report.finish(false, "Không thể hoàn tất hai lượt kiểm tra Redis.", { evidence, error: error.message });
  } finally {
    button.disabled = false;
  }
}

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`;
  $("#characterCount").textContent = `${messageInput.value.length.toLocaleString("vi-VN")} / 2.000`;
}

$("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat(messageInput.value);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chatForm").requestSubmit();
  }
});
messageInput.addEventListener("input", resizeComposer);

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt;
    resizeComposer();
    messageInput.focus();
  });
});

$("#toggleToken").addEventListener("click", () => {
  tokenInput.type = tokenInput.type === "password" ? "text" : "password";
});

$("#clearChat").addEventListener("click", () => {
  messages.querySelectorAll(".message").forEach((message) => message.remove());
  showToast("Đã dọn màn hình. Lịch sử trên Redis vẫn được giữ lại.");
});

$("#refreshStatus").addEventListener("click", refreshHealth);
$("#testAuth").addEventListener("click", testAuthentication);
$("#testValidation").addEventListener("click", testValidation);
$("#testRateLimit").addEventListener("click", testRateLimit);
$("#testRedis").addEventListener("click", testRedisHistory);
clientInput.addEventListener("change", () => showToast("Đã đổi người dùng. Request tiếp theo sẽ dùng lịch sử và hạn mức riêng."));

refreshHealth();
