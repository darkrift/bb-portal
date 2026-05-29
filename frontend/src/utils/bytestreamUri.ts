import type {
  Digest,
  DigestFunction_Value,
} from "@/lib/grpc-client/build/bazel/remote/execution/v2/remote_execution";
import { DigestFunction_Value as DigestFunctionValue } from "@/lib/grpc-client/build/bazel/remote/execution/v2/remote_execution";
import { digestFunctionValueFromString } from "./digestFunctionUtils";
import { generateFileUrl } from "./urlGenerator";

const DEFAULT_BYTESTREAM_DIGEST_FUNCTION = DigestFunctionValue.SHA256;

export interface ParsedBytestreamUri {
  instanceName: string | undefined;
  digestFunction: DigestFunction_Value;
  digest: Digest;
}

export const parseBytestreamUri = (
  uri: string,
): ParsedBytestreamUri | null => {
  if (!uri.startsWith("bytestream://")) {
    return null;
  }

  try {
    const parsed = new URL(uri);
    return parseBytestreamPath(parsed.pathname);
  } catch {
    return null;
  }
};

const parseBytestreamPath = (
  pathname: string,
): ParsedBytestreamUri | null => {
  const pathSegments = pathname.split("/").filter(Boolean);
  const blobsIndex = pathSegments.indexOf("blobs");
  if (blobsIndex < 0) {
    return null;
  }

  const instanceName =
    blobsIndex > 0 ? pathSegments.slice(0, blobsIndex).join("/") : undefined;
  const blobSegments = pathSegments.slice(blobsIndex + 1);

  let digestFunction = DEFAULT_BYTESTREAM_DIGEST_FUNCTION;
  let hash: string;
  let sizeBytes: string;

  if (blobSegments.length === 2) {
    [hash, sizeBytes] = blobSegments;
  } else if (blobSegments.length === 3) {
    const parsedDigestFunction = digestFunctionValueFromString(
      blobSegments[0],
    );
    if (parsedDigestFunction === DigestFunctionValue.UNRECOGNIZED) {
      return null;
    }
    digestFunction = parsedDigestFunction;
    [hash, sizeBytes] = blobSegments.slice(1);
  } else {
    return null;
  }

  if (!hash || !sizeBytes || !/^\d+$/.test(sizeBytes)) {
    return null;
  }

  return {
    instanceName,
    digestFunction,
    digest: {
      hash,
      sizeBytes,
    },
  };
};

export const generateFileUrlFromBytestreamUri = (
  uri: string,
  fileName: string,
): string | null => {
  const result = parseBytestreamUri(uri);
  if (!result) {
    return null;
  }

  return generateFileUrl(
    result.instanceName,
    result.digestFunction,
    result.digest,
    fileName,
  );
};
