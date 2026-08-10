const $ = (selector) => document.querySelector(selector);
const messages = $("#messages");
const messageInput = $("#messageInput");
const tokenInput = $("#tokenInput");
const clientInput = $("#clientInput");
const sendButton = $("#sendButton");
const testResult = $("#testResult");

const session = {
  successfulRequests: 0,
  rememberedMessages: 0,
  cost: 0,
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

function updateMetrics(data) {
  session.successfulRequests += 1;
  session.rememberedMessages = Number(data.turns_before || 0) + 2;
  session.cost += Number(data.usd_cost || 0);
  $("#successMetric").textContent = session.successfulRequests;
  $("#historyMetric").textContent = session.rememberedMessages;
  $("#costMetric").textContent = `$${session.cost.toFixed(6)}`;
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
    const response = await fetch("/chat", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ message: cleanMessage }),
    });
    const data = await parseResponse(response);
    removeTyping();

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

    updateMetrics(data);
    addMessage("bot", data.reply, {
      meta: [
        `Đã nhớ ${data.turns_before} tin nhắn trước`,
        `${data.usage.prompt} token đầu vào`,
        `${data.usage.completion} token trả lời`,
        `Chi phí mock $${Number(data.usd_cost).toFixed(8)}`,
      ],
      technical: data,
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

function displayTestResult(title, text, success, codes = []) {
  testResult.className = `test-result ${success ? "success" : "warning"}`;
  testResult.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = title;
  const description = document.createElement("div");
  description.textContent = text;
  testResult.append(strong, description);
  if (codes.length) {
    const codeList = document.createElement("div");
    codeList.className = "result-codes";
    codes.forEach((code) => {
      const badge = document.createElement("span");
      badge.className = "result-code";
      badge.textContent = code;
      codeList.appendChild(badge);
    });
    testResult.appendChild(codeList);
  }
}

async function runSingleTest(button, request, expectedStatus, successText) {
  button.disabled = true;
  try {
    const response = await fetch("/chat", request);
    const data = await parseResponse(response);
    const passed = response.status === expectedStatus;
    displayTestResult(
      passed ? "Kiểm tra đạt" : "Kết quả chưa như mong đợi",
      passed ? successText : `Service trả mã ${response.status}, kỳ vọng ${expectedStatus}.`,
      passed,
      [`HTTP ${response.status}`],
    );
    if (!passed) testResult.appendChild(technicalDetails(data));
  } catch (error) {
    displayTestResult("Không thể kiểm tra", "Không kết nối được tới service.", false);
  } finally {
    button.disabled = false;
  }
}

async function testAuthentication() {
  const button = $("#testAuth");
  await runSingleTest(button, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ message: "Kiểm tra xác thực" }),
  }, 401, "Service đã từ chối request không có token. Endpoint công khai đang được bảo vệ.");
}

async function testValidation() {
  if (!tokenInput.value.trim()) {
    showToast("Nhập token trước để bài kiểm tra đi tới lớp kiểm tra nội dung.", "error");
    tokenInput.focus();
    return;
  }
  const button = $("#testValidation");
  await runSingleTest(button, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: "" }),
  }, 422, "Nội dung rỗng đã bị chặn trước khi chạy logic chat.");
}

async function testRateLimit() {
  if (!tokenInput.value.trim()) {
    showToast("Nhập token trước khi kiểm tra giới hạn tốc độ.", "error");
    tokenInput.focus();
    return;
  }
  const button = $("#testRateLimit");
  button.disabled = true;
  displayTestResult("Đang gửi request…", "Service đang nhận 15 yêu cầu liên tiếp.", true);
  const codes = [];
  try {
    for (let index = 0; index < 15; index += 1) {
      const response = await fetch("/chat", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ message: `Kiểm tra tốc độ ${index + 1}` }),
      });
      codes.push(response.status);
      displayTestResult("Đang kiểm tra giới hạn tốc độ", `Đã gửi ${index + 1}/15 yêu cầu.`, true, codes);
    }
    const blocked = codes.filter((code) => code === 429).length;
    displayTestResult(
      blocked ? "Rate limit đang hoạt động" : "Chưa chạm giới hạn",
      blocked
        ? `${blocked} yêu cầu đã được chặn để bảo vệ service khỏi lưu lượng quá nhanh.`
        : "Bucket có thể đã được nạp lại hoặc cấu hình hạn mức lớn. Hãy bấm thử thêm một lần.",
      blocked > 0,
      codes.map((code) => `HTTP ${code}`),
    );
  } catch (error) {
    displayTestResult("Kiểm tra bị gián đoạn", "Không thể hoàn tất chuỗi request.", false, codes);
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
clientInput.addEventListener("change", () => showToast("Đã đổi người dùng. Request tiếp theo sẽ dùng lịch sử và hạn mức riêng."));

refreshHealth();
