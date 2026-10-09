import { describe, expect, mock, test } from "bun:test";

mock.module("electron", () => ({ app: { isPackaged: false, setAsDefaultProtocolClient: () => true } }));

const { linkInArgs, linkRoute } = await import("./links.ts");

describe("linkRoute", () => {
  test("reads the route the way expo-router does", () => {
    expect(linkRoute("comical://add-registry?url=https%3A%2F%2Fx")).toBe("/add-registry?url=https%3A%2F%2Fx");
    expect(linkRoute("comical://oauth-token#access_token=t&state=native")).toBe("/oauth-token#access_token=t&state=native");
  });

  test("drops the trailing slash Windows adds on the way to the handler", () => {
    expect(linkRoute("comical://oauth-callback/?code=c&state=native")).toBe("/oauth-callback?code=c&state=native");
    expect(linkRoute("comical://oauth-token/#access_token=t&state=native")).toBe("/oauth-token#access_token=t&state=native");
    expect(linkRoute("comical://series/x/y/")).toBe("/series/x/y");
  });

  test("ignores other schemes and junk", () => {
    expect(linkRoute("https://example.invalid/oauth-callback?code=c")).toBeNull();
    expect(linkRoute("not a url")).toBeNull();
  });
});

describe("linkInArgs", () => {
  test("finds the link among the launcher's own switches", () => {
    const argv = ["comical.exe", "--allow-file-access-from-files", "comical://oauth-callback/?code=c&state=native"];
    expect(linkInArgs(argv)).toBe("/oauth-callback?code=c&state=native");
    expect(linkInArgs(["comical.exe", "--updated"])).toBeNull();
  });
});
