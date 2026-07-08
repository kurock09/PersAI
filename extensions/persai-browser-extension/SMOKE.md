# PersAI Browser Extension Smoke Plan

## Local developer-mode smoke

1. Build the package:
   - `corepack pnpm --filter @persai/browser-extension run build`
2. Load the unpacked extension from `extensions/persai-browser-extension/dist` in Chrome developer mode.
3. Open a PersAI web tab on one of the allowed origins:
   - `https://persai.dev`
   - `http://localhost:<web-port>`
4. Keep that PersAI tab open for the rest of the smoke. The MV3 relay socket is only expected to stay alive while a PersAI tab or the extension popup is open.
5. Open the extension popup and verify the status panel loads without errors.
6. From the PersAI web tab DevTools console, simulate the future S7 page-to-extension handshake with a `window.postMessage(...)` request that carries either:
   - a real `persai.bridge.register_device_request` payload with a fresh bearer token and assistant/workspace ids, or
   - a real `persai.bridge.register_device_result` payload returned by `POST /api/v1/assistant/browser-bridge/devices`.
7. Confirm the popup status now shows a registered device id and a live desired socket state.
8. Use the extension service worker DevTools to observe that:
   - the WebSocket connects to the S1 relay,
   - the connect payload contains `assistantId`, `workspaceId`, `bridgeDeviceId`, `deviceKind="extension"`, and `deviceToken`,
   - reconnects use bounded backoff rather than a tight retry loop.
9. Trigger a login/navigation command to a fresh origin such as `https://lavka.yandex.ru/` and verify Chrome shows a per-origin permission prompt. Deny once and confirm the returned bridge result is structured:
   - `ok: false`
   - `errorReason: "permission_denied"`
10. Accept the permission prompt, then trigger the same command again and confirm:
    - one popup/minimized window is created for the `profileKey`,
    - the mapping is persisted in `chrome.storage.local`,
    - ordinary background `navigate` / `snapshot` / `act` commands reuse that same window and tab.
11. On a Lavka login flow, confirm:
    - the window becomes visible only for explicit assist/open-view behavior,
    - cookies persist across window minimize/restore,
    - a follow-up text snapshot returns page text and `elements`,
    - a simple act chain (`goto` / `click` / `type` / `wait_for_selector`) returns per-op warnings instead of collapsing the whole command when one step fails.
12. Trigger a page that shows a captcha, payment, or equivalent protected confirmation surface and confirm the result is honest:
    - `ok: false`
    - `errorReason: "needs_user_action"`
    - the bridge window is shown for the user.

## Known MVP limitations

- PDF is intentionally unsupported in this slice. The result shape is:
  - `ok: false`
  - `errorReason: "unsupported_pdf"`
- Screenshot capture is best-effort only. Chrome may reject background capture depending on tab/window state or permission limits. The result shape is:
  - `ok: false`
  - `errorReason: "unsupported_screenshot"`
- S7 web UI wiring is not part of this slice. The smoke uses a manual page-to-extension message instead of product UI controls.

## Chrome Web Store checklist

1. Manifest is MV3.
2. No `chrome.debugger` permission.
3. No `<all_urls>` host permission.
4. Target-site access uses `optional_host_permissions` and runtime `chrome.permissions.request(...)`.
5. `externally_connectable` is limited to PersAI web origins only.
6. Background behavior is documented honestly: socket is expected only while a PersAI tab or popup is open.
7. Privacy text for submission must state that cookies stay in the user's browser and PersAI does not export them.
8. Submission notes should call out that captcha/payment/protected controls return `needs_user_action` and are not bypassed automatically.
