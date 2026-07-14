import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { NativeModules, Pressable, Text, View } from "react-native";

import { useDevProfilerEnabled } from "@/lib/dev-profiler-flag";

/**
 * On-device Hermes JS profiler. Tap ● PROFILE → do the janky interaction → tap ⏹ STOP. Uses
 * `react-native-release-profiler` (a native module driving Hermes's C++ sampling profiler — RN 0.85
 * removed the JS `HermesInternal.enableSamplingProfiler` API), captures entirely on-device (no
 * debugger/inspector connection), then gets the trace off the device:
 *  - DEV (Metro running): POST to Metro's own `/_devprofile` route (metro.config.js middleware).
 *  - RELEASE profiling build (no Metro): hand the file to the OS share sheet (AirDrop / Save to Files).
 *
 * Mounted from app/_layout.tsx behind `PROFILING_ENABLED` (dev, or a CI profiling-release build), and
 * hidden unless the Settings → Developer toggle is on. Temporary tooling; safe to delete.
 */

// The Metro host:port the dev client connected to, or null in a release build (no Metro). Source is
// `Constants.expoConfig.hostUri` (the LAN "host:port", e.g. "192.168.1.239:8081"); `scriptURL` is
// unreliable under the New-Arch dev client (comes back empty → "localhost", the phone itself).
function metroHost(): string | null {
  const c = Constants as any;
  const hostUri: string =
    Constants.expoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    "";
  const hostPort = hostUri.split("/")[0]; // strip any trailing path
  if (hostPort) return hostPort;
  const scriptURL: string = NativeModules.SourceCode?.scriptURL ?? "";
  return scriptURL.match(/^https?:\/\/([^/]+)/)?.[1] ?? null; // null in release
}

// Lazy so an app shell built *before* this native module was added doesn't crash on load — it just
// reports "not in this build" until you reinstall the rebuilt shell.
function loadProfiler(): {
  startProfiling: () => void;
  stopProfiling: (saveInDownloads?: boolean, fileName?: string) => Promise<string>;
} | null {
  try {
    // Intentionally a lazy require (not a static import): the module may be
    // absent from an app shell built before it was added, and we swallow that
    // below instead of crashing at load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-release-profiler");
  } catch {
    return null;
  }
}

export function DevProfiler() {
  // Hooks first (unconditionally, for React Compiler), then the enabled gate.
  const enabled = useDevProfilerEnabled();
  const [rec, setRec] = useState(false);
  const [msg, setMsg] = useState("");

  async function toggle() {
    const prof = loadProfiler();
    if (!prof?.startProfiling) {
      setMsg("profiler module not in this build — reinstall the rebuilt shell");
      return;
    }
    if (!rec) {
      try {
        prof.startProfiling();
        setRec(true);
        setMsg("● recording — do the janky thing");
      } catch (e: any) {
        setMsg("start err: " + String(e?.message || e));
      }
      return;
    }
    // stop → the lib writes the trace to a file and returns its path → deliver it off-device
    setRec(false);
    setMsg("saving…");
    try {
      const path = await prof.stopProfiling(false);
      const fileUrl = path.startsWith("file://") ? path : "file://" + path;
      const host = metroHost();
      if (host) {
        // DEV: POST straight to Metro's /_devprofile route.
        const dest = `http://${host}/_devprofile`;
        const data = await FileSystem.readAsStringAsync(fileUrl);
        setMsg(`→ ${dest} (${data.length}b)…`);
        const r = await fetch(dest, { method: "POST", body: data });
        setMsg(`uploaded ${data.length}b → HTTP ${r.status}`);
      } else {
        // RELEASE profiling build: no Metro — share the trace file out (AirDrop to a Mac / Save to
        // Files), then pull it onto the PC and run it through the same analysis.
        setMsg("saved — opening share…");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Sharing = require("expo-sharing");
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUrl, { mimeType: "application/json", dialogTitle: "Hermes profile" });
          setMsg("shared — AirDrop / Save to Files");
        } else {
          setMsg("saved: " + fileUrl);
        }
      }
    } catch (e: any) {
      setMsg("err: " + String(e?.message || e));
    }
  }

  if (!enabled) return null; // hidden unless toggled on in Settings → Developer

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", right: 10, bottom: 110, zIndex: 99999, alignItems: "flex-end" }}
    >
      <Pressable
        onPress={toggle}
        style={{
          backgroundColor: rec ? "#cc2222" : "#208AEF",
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "800" }}>{rec ? "⏹ STOP" : "● PROFILE"}</Text>
      </Pressable>
      {!!msg && (
        <Text
          style={{
            marginTop: 4,
            color: "#fff",
            backgroundColor: "rgba(0,0,0,0.75)",
            fontSize: 10,
            paddingHorizontal: 5,
            paddingVertical: 2,
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {msg}
        </Text>
      )}
    </View>
  );
}
