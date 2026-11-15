/** The `net.request` half of the desktop host's Chromium network (see `chromium-network.ts`). */
import { net, session } from "electron";
import { fetchOver, type Sender } from "./chromium-network.ts";

/** The sender over Electron's `net.request`, on a session of its own. One hop: a redirect comes back as is. */
export function chromiumSender(partition = "comical-host-network"): Sender {
  const ses = session.fromPartition(partition);
  return (req) =>
    new Promise((resolve, reject) => {
      const request = net.request({
        url: req.url,
        method: req.method,
        session: ses,
        credentials: "omit",
        useSessionCookies: false,
        redirect: "manual",
        referrerPolicy: "unsafe-url",
        cache: "no-store",
      });
      request.on("redirect", (status, _method, to, headers) => {
        resolve({ url: req.url, status, statusText: "", headers: { ...headers, location: to }, body: new Uint8Array() });
        request.abort();
      });
      for (const [name, value] of req.headers) request.setHeader(name, value);
      request.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ url: req.url, status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      request.on("error", reject);
      if (req.body !== undefined) request.write(typeof req.body === "string" ? req.body : Buffer.from(req.body));
      request.end();
    });
}

/** The host's `fetch`: Chromium's network unless `COMICAL_CHROMIUM_NETWORK=0`. */
export function hostFetch(env = process.env): typeof fetch | undefined {
  return env.COMICAL_CHROMIUM_NETWORK === "0" ? undefined : fetchOver(chromiumSender());
}
