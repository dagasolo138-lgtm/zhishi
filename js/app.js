import { initBackendStore } from "./backend-store.js";
import { pause, start } from "./generator.js";
import { loadSettings, renderSettingsPanel } from "./settings.js";
import { initDB } from "./storage.js";
import * as ui from "./ui.js";

async function bootstrap() {
  await initDB();
  await initBackendStore();

  const settings = loadSettings();
  renderSettingsPanel();
  await ui.init();

  if (settings.generationEnabled) {
    start();
  } else {
    pause();
  }
}

function handleBootstrapError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("zhishi initialization failed:", error);

  const statusText = document.querySelector("#status-text");
  if (statusText) {
    statusText.textContent = `初始化失败：${message}`;
    statusText.dataset.status = "error";
  }
}

function runWhenDocumentReady() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootstrap().catch(handleBootstrapError);
    }, { once: true });
    return;
  }

  bootstrap().catch(handleBootstrapError);
}

runWhenDocumentReady();
