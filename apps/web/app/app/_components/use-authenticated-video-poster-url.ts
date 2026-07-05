"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedBlobUrl } from "./authenticated-attachment-image";
import { captureVideoPreviewFrame } from "./video-preview-utils";

/**
 * Resolves a displayable poster URL for gallery tiles and the video lightbox.
 * Prefers an explicit image derivative; otherwise captures the first decoded
 * frame from the authenticated video source.
 */
export function useAuthenticatedVideoPosterUrl(input: {
  posterPreviewUrl: string | null;
  videoSourceUrl: string | null;
}): {
  posterUrl: string | null;
  loading: boolean;
  failed: boolean;
} {
  const { blobUrl: posterBlobUrl, failed: posterImageFailed } = useAuthenticatedBlobUrl(
    input.posterPreviewUrl
  );
  const shouldCaptureFrame =
    input.posterPreviewUrl === null || posterImageFailed || posterBlobUrl === null;
  const { blobUrl: videoBlobUrl, failed: videoFailed } = useAuthenticatedBlobUrl(
    shouldCaptureFrame ? input.videoSourceUrl : null
  );
  const [capturedFrameUrl, setCapturedFrameUrl] = useState<string | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);

  useEffect(() => {
    setCapturedFrameUrl(null);
    setCaptureFailed(false);
  }, [input.videoSourceUrl, input.posterPreviewUrl]);

  useEffect(() => {
    if (!shouldCaptureFrame || videoBlobUrl === null) {
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = videoBlobUrl;

    const finalize = () => {
      if (cancelled) {
        return;
      }
      const frameUrl = captureVideoPreviewFrame(video);
      if (frameUrl === null) {
        setCaptureFailed(true);
        return;
      }
      setCapturedFrameUrl(frameUrl);
    };

    const handleLoadedData = () => {
      finalize();
    };
    const handleError = () => {
      if (!cancelled) {
        setCaptureFailed(true);
      }
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
      video.removeAttribute("src");
      video.load();
    };
  }, [shouldCaptureFrame, videoBlobUrl]);

  if (posterBlobUrl !== null && !posterImageFailed) {
    return { posterUrl: posterBlobUrl, loading: false, failed: false };
  }

  if (capturedFrameUrl !== null) {
    return { posterUrl: capturedFrameUrl, loading: false, failed: false };
  }

  const loading =
    (input.posterPreviewUrl !== null && posterBlobUrl === null && !posterImageFailed) ||
    (shouldCaptureFrame &&
      input.videoSourceUrl !== null &&
      videoBlobUrl === null &&
      !videoFailed) ||
    (shouldCaptureFrame && videoBlobUrl !== null && !captureFailed && capturedFrameUrl === null);

  const failed =
    (input.posterPreviewUrl !== null && posterImageFailed && input.videoSourceUrl === null) ||
    (shouldCaptureFrame && videoFailed) ||
    captureFailed;

  return { posterUrl: null, loading, failed };
}
