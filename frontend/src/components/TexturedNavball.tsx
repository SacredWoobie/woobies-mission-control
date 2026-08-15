import { useEffect, useMemo, useRef, useState } from "react";
import textureUrl from "../assets/navball/ksp2-pre-alpha-diffuse.png";
import { makeNavballBasis } from "./navballGeometry";
import { NavballAircraftSymbol } from "./NavballAircraftSymbol";
import { renderTexturedNavball, type NavballTextureSource } from "./navballTexture";

const displaySize = 168;
const maximumDevicePixelRatio = 2;
let texturePromise: Promise<NavballTextureSource> | undefined;

function loadTexture(): Promise<NavballTextureSource> {
  if (texturePromise) return texturePromise;
  texturePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        reject(new Error("The browser does not provide a 2D canvas context."));
        return;
      }
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      resolve({ data: imageData.data, height: imageData.height, width: imageData.width });
    };
    image.onerror = () => reject(new Error("The optional navball texture could not be loaded."));
    image.src = textureUrl;
  });
  return texturePromise;
}

export function TexturedNavball({ heading, pitch, roll }: { heading: number; pitch: number; roll: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderBufferRef = useRef<{ canvas: HTMLCanvasElement; image: ImageData; size: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const normalizedHeading = ((heading % 360) + 360) % 360;
  const normalizedPitch = Math.max(-90, Math.min(90, pitch));
  const basis = useMemo(
    () => makeNavballBasis(normalizedHeading, normalizedPitch, roll),
    [normalizedHeading, normalizedPitch, roll],
  );

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let removeVisibilityListener: (() => void) | undefined;
    loadTexture().then((texture) => {
      if (cancelled) return;
      const draw = () => {
        if (cancelled || document.hidden) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const ratio = Math.min(maximumDevicePixelRatio, Math.max(1, window.devicePixelRatio || 1));
        const size = Math.round(displaySize * ratio);
        let buffer = renderBufferRef.current;
        if (!buffer || buffer.canvas !== canvas || buffer.size !== size) {
          canvas.width = size;
          canvas.height = size;
          buffer = { canvas, image: context.createImageData(size, size), size };
          renderBufferRef.current = buffer;
        }
        renderTexturedNavball(texture, basis, size, buffer.image.data);
        context.putImageData(buffer.image, 0, 0);
      };
      const scheduleDraw = () => {
        if (frame) window.cancelAnimationFrame(frame);
        frame = document.hidden ? 0 : window.requestAnimationFrame(draw);
      };
      const onVisibilityChange = () => {
        if (!document.hidden) scheduleDraw();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      removeVisibilityListener = () => document.removeEventListener("visibilitychange", onVisibilityChange);
      scheduleDraw();
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    });
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      removeVisibilityListener?.();
    };
  }, [basis]);

  const label = `KSP2 pre-alpha style navball at heading ${Math.round(normalizedHeading)}, pitch ${Math.round(normalizedPitch)}, roll ${Math.round(roll)}`;
  return (
    <div aria-label={loadFailed ? `${label}; texture unavailable` : label} className={`navball navball-textured${loadFailed ? " texture-failed" : ""}`} role="img">
      <canvas aria-hidden="true" ref={canvasRef} />
      <svg aria-hidden="true" className="navball-textured-overlay" focusable="false" viewBox="0 0 168 168">
        <circle className="nav-sphere-bezel" cx="84" cy="84" r="82" />
        <circle className="nav-sphere-rim" cx="84" cy="84" r="78" />
        <NavballAircraftSymbol />
      </svg>
    </div>
  );
}
