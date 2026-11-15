import { createBunNetwork } from "@comical/host-bun";
import { describe, expect, test } from "bun:test";
import { fetchOver, type RawRequest, type RawResponse, requestHeaders, toResponse, withSetCookies } from "./chromium-network.ts";

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

  describe("redirects, followed here because Chromium drops the Cookie header on each hop", () => {
    const hop = (url: string, status: number, headers: Record<string, string | string[]> = {}): RawResponse => ({ url, status, statusText: "", headers, body: new Uint8Array() });

    test("same origin keeps the session and adds the hop's cookies; the final response carries them all", async () => {
      const sent: RawRequest[] = [];
      const f = fetchOver(async (req) => {
        sent.push(req);
        if (req.url === "https://s.test/search/q/") return hop(req.url, 302, { location: "/search/q", "set-cookie": ["hop=1; Path=/"] });
        return { ...hop(req.url, 200, { "set-cookie": "last=2" }), body: new TextEncoder().encode("ok") };
      });
      const res = await f("https://s.test/search/q/", { headers: { Cookie: "trust=t; old=x", Referer: "https://s.test/" } });
      expect(sent.map((r) => r.url)).toEqual(["https://s.test/search/q/", "https://s.test/search/q"]);
      expect(sent[1]!.headers).toContainEqual(["cookie", "trust=t; old=x; hop=1"]);
      expect(sent[1]!.headers).toContainEqual(["referer", "https://s.test/"]);
      expect(res.url).toBe("https://s.test/search/q");
      expect(res.headers.getSetCookie()).toEqual(["hop=1; Path=/", "last=2"]);
      expect(await res.text()).toBe("ok");
    });

    test("cross origin drops Cookie and Authorization; a POST after 302 or any 303 goes on as a GET without its body", async () => {
      const sent: RawRequest[] = [];
      const f = fetchOver(async (req) => {
        sent.push(req);
        if (req.url === "https://s.test/form") return hop(req.url, 302, { location: "https://cdn.test/done" });
        return hop(req.url, 200);
      });
      await f("https://s.test/form", { method: "POST", body: "a=1", headers: { Cookie: "c=1", Authorization: "Bearer x", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "UA" } });
      expect(sent[1]).toEqual({ url: "https://cdn.test/done", method: "GET", headers: [["user-agent", "UA"]] });
    });

    test("307 keeps the method and body; too many hops and redirect: error throw; manual hands the redirect back", async () => {
      const sent: RawRequest[] = [];
      const f = fetchOver(async (req) => {
        sent.push(req);
        return req.url.endsWith("/a") ? hop(req.url, 307, { location: "/b" }) : req.url.endsWith("/loop") ? hop(req.url, 302, { location: "/loop" }) : hop(req.url, 200);
      });
      await f("https://s.test/a", { method: "PUT", body: "x" });
      expect(sent[1]).toMatchObject({ url: "https://s.test/b", method: "PUT", body: "x" });
      await expect(f("https://s.test/loop")).rejects.toThrow(/too many redirects/);
      await expect(f("https://s.test/a", { redirect: "error" })).rejects.toThrow(/redirected/);
      expect((await f("https://s.test/a", { redirect: "manual" })).status).toBe(307);
    });

    test("a hop's expired cookie leaves the Cookie header", () => {
      expect(withSetCookies("a=1; b=2", ["a=; Max-Age=0", "c=3; Path=/"])).toBe("b=2; c=3");
      expect(withSetCookies(undefined, ["x=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT"])).toBeUndefined();
    });
  });
});
