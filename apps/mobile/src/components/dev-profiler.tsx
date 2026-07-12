import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import { useState } from "react";
import { NativeModules, Pressable, Text, View } from "react-native";

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
// POST the trace to Metro itself — its own host+port — at the /_devprofile route added in
// metro.config.js. Riding Metro's port means it works on a Public-network dev machine where
// the firewall only opens Metro's port (a separate :8099 server gets blocked).
//
// Host source is `Constants.expoConfig.hostUri` — the LAN "host:port" the dev client actually
// connected to (e.g. "192.168.1.239:8081"). `NativeModules.SourceCode.scriptURL` is unreliable
// here: under the New Architecture dev client it comes back empty, collapsing to "localhost",
// which is the *phone itself* → "could not connect". Never hardcode a LAN IP.
function uploadUrl(): string {
  const c = Constants as any;
  const hostUri: string =
    Constants.expoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    "";
  const hostPort = hostUri.split("/")[0]; // strip any trailing path
  if (hostPort) return `http://${hostPort}/_devprofile`;
  // last-ditch fallback (rarely reached): the scriptURL origin.
  const scriptURL: string = NativeModules.SourceCode?.scriptURL ?? "";
  const base = scriptURL.match(/^https?:\/\/[^/]+/)?.[0] ?? "http://localhost:8081";
  return `${base}/_devprofile`;
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
    const dest = uploadUrl();
    try {
      const path = await prof.stopProfiling(false);
      const fileUrl = path.startsWith("file://") ? path : "file://" + path;
      const data = await FileSystem.readAsStringAsync(fileUrl);
      setMsg(`→ ${dest} (${data.length}b)…`);
      const r = await fetch(dest, { method: "POST", body: data });
      setMsg(`uploaded ${data.length}b → HTTP ${r.status}`);
    } catch (e: any) {
      // Show the exact destination + error so a failing upload is diagnosable on-device.
      setMsg(`err → ${dest} : ${String(e?.message || e)}`);
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
