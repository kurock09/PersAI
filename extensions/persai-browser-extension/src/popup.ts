const port = chrome.runtime.connect({ name: "persai-popup-keepalive" });
void port;

const statusNode = document.getElementById("status");
const refreshButton = document.getElementById("refresh");

async function refreshStatus(): Promise<void> {
  if (!(statusNode instanceof HTMLElement)) {
    return;
  }
  statusNode.textContent = "Loading bridge status…";
  const status = (await chrome.runtime.sendMessage({ type: "popup.status" })) as {
    connected?: boolean;
    desiredConnection?: boolean;
    profileCount?: number;
    lastProfileKey?: string | null;
    bridgeDeviceId?: string | null;
  };
  statusNode.innerHTML = [
    `Connected: ${status.connected === true ? "yes" : "no"}`,
    `Socket desired: ${status.desiredConnection === true ? "yes" : "no"}`,
    `Registered device: ${status.bridgeDeviceId ?? "none"}`,
    `Profiles tracked: ${String(status.profileCount ?? 0)}`,
    `Last profile: ${status.lastProfileKey ?? "none"}`
  ].join("<br />");
}

refreshButton?.addEventListener("click", () => {
  void refreshStatus();
});

void refreshStatus();
