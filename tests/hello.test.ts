import { expect, test } from "vitest";

import { hello } from "../src/hello.ts";

test("says hello", () => {
  expect(hello()).toBe("Hello, world!");
});
