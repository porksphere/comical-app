import { createBunNetwork } from "@comical/host-bun";
import { describe, expect, test } from "bun:test";
import { fetchOver, requestHeaders, toResponse } from "./chromium-network.ts";

describe("chromium network", () => {
  test("a bridge's headers go as set, less the ones the stack owns", () => {
    expect(requestHeaders({ Referer: "https://s.test/", Origin: "https://s.test", Cookie: "a=1", Host: "x", "Content-Length": "3" })).toEqual([
      ["cookie", "a=1"],
      ["origin", "https://s.test"],
      ["referer", "https://s.test/"],
    ]);
  });

  test("a response keeps its final URL, every Set-Cookie and its bytes", async () => {
    const res = toResponse({
      url: "https://s.test/landed",
      status: 200,
      statusText: "OK",
      headers: { "set-cookie": ["a=1; Path=/", "b=2"], "content-type": "text/plain" },
      body: new Uint8Array([0, 255, 7]),
    });
    expect(res.url).toBe("https://s.test/landed");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2"]);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 255, 7]);
    expect(toResponse({ url: "https://s.test/", status: 304, statusText: "", headers: {}, body: new Uint8Array() }).status).toBe(304);
  });

  test("the host's network runs over it unchanged", async () => {
    const sent: unknown[] = [];
    const network = createBunNetwork({
      userAgent: "Default/1",
      fetch: fetchOver(async (req) => {
        sent.push(req);
        return { url: "https://s.test/final", status: 403, statusText: "Forbidden", headers: { "cf-mitigated": "challenge", "set-cookie": "__cf_bm=x" }, body: new TextEncoder().encode("check") };
      }),
    });
    const res = await network.request({ url: "https://s.test/a", method: "POST", headers: { Referer: "https://s.test/" }, body: "q=1" });
    expect(sent).toEqual([{ url: "https://s.test/a", method: "POST", headers: [["referer", "https://s.test/"], ["user-agent", "Default/1"]], body: "q=1" }]);
    expect(res).toMatchObject({ url: "https://s.test/final", status: 403, body: "check", setCookies: ["__cf_bm=x"] });
    expect(res.headers["cf-mitigated"]).toBe("challenge");
  });

  test("a Request object or a stream body is refused rather than sent wrong", async () => {
    const f = fetchOver(async () => {
      throw new Error("unreached");
    });
    await expect(f(new Request("https://s.test/"))).rejects.toThrow(/pass a URL/);
    await expect(f("https://s.test/", { method: "POST", body: new Blob(["x"]) })).rejects.toThrow(/string or bytes/);
  });
});
