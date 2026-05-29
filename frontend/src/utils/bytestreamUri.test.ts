import { expect, test } from "vitest";
import { generateFileUrlFromBytestreamUri } from "./bytestreamUri";

test("generateFileUrlFromBytestreamUri", () => {
  expect(
    generateFileUrlFromBytestreamUri(
      "bytestream://localhost:8980/blobs/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/123",
      "test.log",
    ),
  ).toBe("/api/v1/servefile/blobs/sha256/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-123/test.log");

  expect(
    generateFileUrlFromBytestreamUri(
      "bytestream://localhost:8980/some/instance/blobs/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/123",
      "test.xml",
    ),
  ).toBe(
    "/api/v1/servefile/some/instance/blobs/sha256/file/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-123/test.xml",
  );

  expect(
    generateFileUrlFromBytestreamUri("file:///tmp/test.log", "test.log"),
  ).toBeNull();
});
