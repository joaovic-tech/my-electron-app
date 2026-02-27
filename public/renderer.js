// ── Constants ──
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3";

// ── DOM Elements ──
const userInput = document.getElementById("userInput");
const micBtn = document.getElementById("micBtn");
const sendBtn = document.getElementById("sendBtn");
const micIcon = document.getElementById("micIcon");
const stopIcon = document.getElementById("stopIcon");
const recordingIndicator = document.getElementById("recordingIndicator");
const branding = document.getElementById("branding");
const responseArea = document.getElementById("responseArea");
const userMessageText = document.getElementById("userMessageText");
const thinkingIndicator = document.getElementById("thinkingIndicator");
const responseText = document.getElementById("responseText");
const errorMsg = document.getElementById("errorMsg");
const errorText = document.getElementById("errorText");

let isRecording = false;
let recognition = null;
let isGenerating = false;
let abortController = null;

// ── Window controls ──
document.getElementById("minimizeBtn").addEventListener("click", () => {
  window.electronAPI?.minimize();
});
document.getElementById("maximizeBtn").addEventListener("click", () => {
  window.electronAPI?.maximize();
});
document.getElementById("closeBtn").addEventListener("click", () => {
  window.electronAPI?.close();
});

// ── Auto-resize textarea ──
userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 112) + "px";
  toggleSendButton();
});

// ── Show/hide send button ──
function toggleSendButton() {
  const hasText = userInput.value.trim().length > 0;
  if (hasText && !isGenerating) {
    sendBtn.classList.remove("hidden");
    sendBtn.classList.add("fade-in");
  } else {
    sendBtn.classList.add("hidden");
  }
}

// ── Submit on Enter (Shift+Enter for new line) ──
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (userInput.value.trim() && !isGenerating) {
      handleSubmit();
    }
  }
});

// ── Send button click ──
sendBtn.addEventListener("click", () => {
  if (userInput.value.trim() && !isGenerating) {
    handleSubmit();
  }
});

// ── Show error ──
function showError(msg) {
  errorText.textContent = msg;
  errorMsg.classList.remove("hidden");
  setTimeout(() => errorMsg.classList.add("hidden"), 5000);
}

// ── Handle submit ──
async function handleSubmit() {
  const message = userInput.value.trim();
  if (!message || isGenerating) return;

  // Hide branding, show response area
  branding.classList.add("hidden");
  responseArea.classList.remove("hidden");
  responseArea.classList.add("flex");
  errorMsg.classList.add("hidden");

  // Show user message
  userMessageText.textContent = message;

  // Clear input
  userInput.value = "";
  userInput.style.height = "auto";
  toggleSendButton();

  // Show thinking indicator
  thinkingIndicator.classList.remove("hidden");
  responseText.textContent = "";
  isGenerating = true;
  userInput.disabled = true;
  userInput.placeholder = "Aguardando resposta...";

  // Scroll down
  responseArea.scrollTop = responseArea.scrollHeight;

  try {
    abortController = new AbortController();

    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: message,
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama retornou status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    // Hide thinking indicator on first token
    let firstToken = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            if (firstToken) {
              thinkingIndicator.classList.add("hidden");
              firstToken = false;
            }
            fullResponse += json.response;
            responseText.textContent = fullResponse;
            responseArea.scrollTop = responseArea.scrollHeight;
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  } catch (err) {
    thinkingIndicator.classList.add("hidden");
    if (err.name === "AbortError") {
      responseText.textContent = fullResponse || "Geração cancelada.";
    } else if (err.message.includes("fetch")) {
      showError(
        "Não foi possível conectar ao Ollama. Verifique se está rodando (ollama serve).",
      );
      responseText.textContent = "";
      // Show branding again if no response
      branding.classList.remove("hidden");
      responseArea.classList.add("hidden");
    } else {
      showError(`Erro: ${err.message}`);
      responseText.textContent = "";
      branding.classList.remove("hidden");
      responseArea.classList.add("hidden");
    }
  } finally {
    isGenerating = false;
    abortController = null;
    userInput.disabled = false;
    userInput.placeholder = "Escreva sua mensagem...";
    userInput.focus();
    toggleSendButton();
  }
}

// ── Microphone / Speech Recognition ──
micBtn.addEventListener("click", () => {
  if (isGenerating) return;
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

function startRecording() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showError("Reconhecimento de voz não suportado neste ambiente.");
    return;
  }

  // Request microphone permission first
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      // Stop the stream immediately — we just needed the permission
      stream.getTracks().forEach((t) => t.stop());

      recognition = new SpeechRecognition();
      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = true;

      let finalTranscript = "";

      recognition.onresult = (event) => {
        let interim = "";
        finalTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }
        userInput.value = finalTranscript + interim;
        userInput.style.height = "auto";
        userInput.style.height = Math.min(userInput.scrollHeight, 112) + "px";
        toggleSendButton();
      };

      recognition.onerror = (event) => {
        console.error("SpeechRecognition error:", event.error);
        const messages = {
          "not-allowed": "Permissão de microfone negada.",
          "no-speech": "Nenhuma fala detectada. Tente novamente.",
          "audio-capture":
            "Nenhum microfone encontrado. Verifique se o áudio está configurado no WSL.",
          network: "Erro de rede. A transcrição requer conexão com a internet.",
          aborted: "Gravação cancelada.",
        };
        showError(messages[event.error] || `Erro de voz: ${event.error}`);
        stopRecording();
      };

      recognition.onend = () => {
        if (isRecording) {
          // User stopped speaking — auto-send if there's text
          isRecording = false;
          resetMicUI();

          if (userInput.value.trim()) {
            handleSubmit();
          }
        }
      };

      recognition.start();
      isRecording = true;

      // Update UI
      micBtn.classList.add("mic-recording", "text-primary-400");
      micBtn.querySelector(".pulse-ring").classList.remove("hidden");
      micIcon.classList.add("hidden");
      stopIcon.classList.remove("hidden");
      recordingIndicator.classList.remove("hidden");
    })
    .catch((err) => {
      console.error("Microphone access error:", err);
      if (err.name === "NotAllowedError") {
        showError("Permissão de microfone negada pelo sistema.");
      } else if (err.name === "NotFoundError") {
        showError(
          "Nenhum microfone encontrado. No WSL, configure PulseAudio/PipeWire para áudio.",
        );
      } else {
        showError(`Erro ao acessar microfone: ${err.message}`);
      }
    });
}

function stopRecording() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }

  isRecording = false;
  resetMicUI();
}

function resetMicUI() {
  micBtn.classList.remove("mic-recording", "text-primary-400");
  micBtn.querySelector(".pulse-ring").classList.add("hidden");
  micIcon.classList.remove("hidden");
  stopIcon.classList.add("hidden");
  recordingIndicator.classList.add("hidden");
  toggleSendButton();
}
