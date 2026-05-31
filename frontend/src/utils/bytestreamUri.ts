import {
  Digest,
  type DigestFunction_Value,
} from "@/lib/grpc-client/build/bazel/remote/execution/v2/remote_execution";
import { digestFunctionValueFromString } from "./digestFunctionUtils";

export interface ParsedBytestreamUri {
  instanceName?: string;
  digestFunction: DigestFunction_Value;
  digest: Digest;
}

const DEFAULT_DIGEST_FUNCTION = digestFunctionValueFromString("sha256");

export const parseBytestreamUri = (
  uri: string,
): ParsedBytestreamUri | undefined => {
  if (!uri.startsWith("bytestream://")) {
    return undefined;
  }

  const url = new URL(uri);
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const blobsIndex = segments.indexOf("blobs");
  if (blobsIndex < 0) {
    return undefined;
  }

  const instanceName =
    blobsIndex > 0 ? segments.slice(0, blobsIndex).join("/") : undefined;
  const blobSegments = segments.slice(blobsIndex + 1);

  let digestFunction = DEFAULT_DIGEST_FUNCTION;
  let digestHash = "";
  let sizeBytes = "";

  if (blobSegments.length >= 3) {
    digestFunction = digestFunctionValueFromString(blobSegments[0]);
    digestHash = blobSegments[1];
    sizeBytes = blobSegments[2];
  } else if (blobSegments.length >= 2) {
    digestHash = blobSegments[0];
    sizeBytes = blobSegments[1];
  } else {
    return undefined;
  }

  if (digestHash === "" || sizeBytes === "") {
    return undefined;
  }

  return {
    instanceName,
    digestFunction,
    digest: Digest.create({
      hash: digestHash,
      sizeBytes,
    }),
  };
};
