export function captureVideoPreviewFrame(video: HTMLVideoElement): string | null {
  const intrinsicWidth = video.videoWidth;
  const intrinsicHeight = video.videoHeight;
  if (
    !Number.isFinite(intrinsicWidth) ||
    !Number.isFinite(intrinsicHeight) ||
    intrinsicWidth <= 0 ||
    intrinsicHeight <= 0
  ) {
    return null;
  }

  const maxCanvasWidth = 480;
  const scale = Math.min(1, maxCanvasWidth / intrinsicWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(intrinsicWidth * scale));
  canvas.height = Math.max(1, Math.round(intrinsicHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } catch {
    return null;
  }
}
