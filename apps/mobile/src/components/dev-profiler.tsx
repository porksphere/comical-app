import { useState } from "react";
import { NativeModules, Pressable, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { useDevProfilerEnabled } from "@/lib/dev-profiler-flag";

/**
 * DEV-ONLY on-device Hermes JS profiler. Tap ● PROFILE → do the janky
 * interaction → tap ⏹ STOP. Uses `react-native-release-profiler` (a native
 * module that drives Hermes's C++ sampling profiler — RN 0.85 removed the JS
 * `HermesInternal.enableSamplingProfiler` API), captures entirely on-device (no
 * debugger/inspector connection, so it dodges the unstable device link), then
 * uploads the raw Hermes trace to the dev PC (profile-server.ts). Mounted from
 * app/_layout.tsx behind `__DEV__`. Temporary tooling; safe to delete.
 */
// Derive the dev-PC host from where Metro served the JS bundle — never hardcode a
// LAN IP. profile-server.ts listens on :8099 on that same machine.
function uploadUrl(): string {
  const scriptURL: string = NativeModules.SourceCode?.scriptURL ?? "";
  const origin = scriptURL.match(/^https?:\/\/[^/:]+/)?.[0] ?? "http://localhost";
  return `${origin}:8099/upload`;
}

// Lazy so an app shell built *before* this native module was added doesn't crash
// on load — it just reports "not in this build" until you reinstall the rebuilt shell.
function loadProfiler(): {
  startProfiling: () => void;
  stopProfiling: (saveInDownloads?: boolean, fileName?: string) => Promise<string>;
} | null {
  try {
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
      setMsg("profiler module not in this build — reinstall the rebuilt dev shell");
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
    // stop → the lib writes the trace to a file and returns its path → read → upload
    setRec(false);
    setMsg("saving…");
    try {
      const path = await prof.stopProfiling(false);
      const url = path.startsWith("file://") ? path : "file://" + path;
      const data = await FileSystem.readAsStringAsync(url);
      setMsg(`uploading ${data.length}b…`);
      const r = await fetch(uploadUrl(), { method: "POST", body: data });
      setMsg(`uploaded ${data.length}b → HTTP ${r.status}`);
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
