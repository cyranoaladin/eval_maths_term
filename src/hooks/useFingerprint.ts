/**
 * src/hooks/useFingerprint.ts
 *
 * Calcule le fingerprint navigateur côté client via Web Crypto API.
 * La sérialisation utilise serializeCanonical (identique au serveur)
 * pour garantir que le hash résultant est comparable.
 *
 * - Calculé une seule fois par mount (stable ref via useRef).
 * - canvas + WebGL limités à 8 hex pour réduire la surface de variation.
 * - Dégradation gracieuse si canvas/WebGL non disponibles.
 */
import { useEffect, useRef, useState } from "react";
import {
  serializeCanonical,
  type FingerprintComponents,
} from "@contracts/fingerprint-canonical";

async function computeCanvasHash(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "00000000";
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Cwm fjordbank glyphs vex quiz", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillText("Cwm fjordbank glyphs vex quiz", 4, 17);
    const data = canvas.toDataURL();
    const encoded = new TextEncoder().encode(data);
    const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex.slice(0, 8);
  } catch {
    return "00000000";
  }
}

function getWebGLRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "no-webgl";
    const ext = (gl as WebGLRenderingContext).getExtension(
      "WEBGL_debug_renderer_info",
    );
    if (!ext) return "no-ext";
    return (
      (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) ??
      "unknown"
    );
  } catch {
    return "error";
  }
}

async function buildComponents(): Promise<FingerprintComponents> {
  const canvasHash = await computeCanvasHash();
  const webglRenderer = getWebGLRenderer();

  return {
    userAgent: navigator.userAgent.slice(0, 500),
    language: navigator.language,
    languages: Array.from(navigator.languages ?? [navigator.language]).slice(0, 10),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      colorDepth: window.screen.colorDepth,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    platform: navigator.platform.slice(0, 50),
    canvasHash,
    webglRenderer: webglRenderer.slice(0, 200),
  };
}

async function hashComponents(components: FingerprintComponents): Promise<string> {
  const canonical = serializeCanonical(components);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface UseFingerprintResult {
  fingerprintHash: string;
  components: FingerprintComponents | null;
  ready: boolean;
}

/**
 * Calcule le fingerprint une seule fois au mount.
 * `fingerprintHash` est la chaîne SHA-256 hex 64 chars à envoyer au serveur.
 */
export function useFingerprint(): UseFingerprintResult {
  const [state, setState] = useState<UseFingerprintResult>({
    fingerprintHash: "",
    components: null,
    ready: false,
  });
  const computed = useRef(false);

  useEffect(() => {
    if (computed.current) return;
    computed.current = true;

    (async () => {
      try {
        const components = await buildComponents();
        const fingerprintHash = await hashComponents(components);
        setState({ fingerprintHash, components, ready: true });
      } catch {
        setState({ fingerprintHash: "", components: null, ready: true });
      }
    })();
  }, []);

  return state;
}
